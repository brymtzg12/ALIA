import type { Db } from '../db.ts';

// Libro mayor: movimientos inmutables y saldos derivados (part_stock y location_stock),
// actualizados en la misma transacción.
//
// Candados: todo lo que mueve saldo o reservas de una pieza toma primero la fila de
// part_stock (FOR UPDATE), siempre en orden de part_id ascendente. Así location_stock,
// reservas y faltantes de esa pieza quedan serializados sin candados adicionales.

export type MovementType = 'receipt' | 'issue' | 'transfer_out' | 'transfer_in' | 'adjustment';

export type PartStock = { part_id: number; on_hand: number; reserved: number };

export type Movement = {
  movement_id: number;
  type: MovementType;
  part_id: number;
  location_id: number;
  quantity: number;
  occurred_at: string;
  reference: string | null;
};

/** Bloquea las filas de saldo de las piezas (creándolas si faltan), en orden ascendente. */
export async function lockParts(db: Db, partIds: number[]): Promise<Map<number, PartStock>> {
  const ids = [...new Set(partIds)].sort((a, b) => a - b);
  if (!ids.length) return new Map();
  await db.query(
    `INSERT INTO part_stock (part_id) SELECT unnest($1::int[]) ORDER BY 1 ON CONFLICT DO NOTHING`,
    [ids],
  );
  const { rows } = await db.query(
    `SELECT part_id, on_hand, reserved FROM part_stock WHERE part_id = ANY($1::int[]) ORDER BY part_id FOR UPDATE`,
    [ids],
  );
  return new Map(rows.map((r: PartStock) => [r.part_id, r]));
}

export async function lockPart(db: Db, partId: number): Promise<PartStock> {
  return (await lockParts(db, [partId])).get(partId)!;
}

export async function locationOnHand(db: Db, partId: number, locationId: number): Promise<number> {
  const { rows } = await db.query(
    `SELECT on_hand FROM location_stock WHERE part_id = $1 AND location_id = $2`,
    [partId, locationId],
  );
  return rows[0]?.on_hand ?? 0;
}

/**
 * Hora de un movimiento de la API: la del servidor, al segundo, pero nunca anterior al último
 * movimiento de la pieza. Así el kardex queda en orden aunque los relojes del taller y del
 * servidor no coincidan exactamente.
 */
export async function apiMovementTime(db: Db, partId: number): Promise<string> {
  const { rows } = await db.query(
    `SELECT GREATEST(date_trunc('second', clock_timestamp()),
                     COALESCE((SELECT max(occurred_at) FROM movements WHERE part_id = $1), '-infinity')) AS t`,
    [partId],
  );
  return rows[0].t;
}

export type NewMovement = {
  type: MovementType;
  partId: number;
  locationId: number;
  quantity: number; // con signo
  occurredAt: string;
  reference?: string | null;
  workOrderId?: number | null;
  unitCost?: string | null;
  currency?: string | null;
  purchaseLineId?: number | null;
  origin?: 'event' | 'api';
  commandId?: string | null;
};

/**
 * Registra un movimiento y actualiza los saldos. El llamador ya tiene el candado de la pieza
 * y ya validó lo que haya que validar (el conteo es el único que puede dejar available < 0).
 * Devuelve null si el movimiento ya existía (misma línea de compra o mismo comando).
 */
export async function recordMovement(db: Db, m: NewMovement): Promise<Movement | null> {
  const { rows } = await db.query(
    `INSERT INTO movements (type, part_id, location_id, quantity, occurred_at, reference, work_order_id,
                            unit_cost, currency, purchase_line_id, origin, command_id)
     VALUES ($1, $2, $3, $4, date_trunc('second', $5::timestamptz), $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT DO NOTHING
     RETURNING movement_id, type, part_id, location_id, quantity, occurred_at, reference`,
    [
      m.type, m.partId, m.locationId, m.quantity, m.occurredAt, m.reference ?? null, m.workOrderId ?? null,
      m.unitCost ?? null, m.currency ?? null, m.purchaseLineId ?? null, m.origin ?? 'event', m.commandId ?? null,
    ],
  );
  if (!rows[0]) return null;
  await db.query(`UPDATE part_stock SET on_hand = on_hand + $2 WHERE part_id = $1`, [m.partId, m.quantity]);
  // UPDATE primero: un INSERT ... ON CONFLICT revisa el CHECK (on_hand >= 0) sobre la fila
  // candidata antes de resolver el conflicto, y fallaría con cantidades negativas.
  const upd = await db.query(
    `UPDATE location_stock SET on_hand = on_hand + $3 WHERE part_id = $1 AND location_id = $2`,
    [m.partId, m.locationId, m.quantity],
  );
  if (!upd.rowCount) {
    await db.query(
      `INSERT INTO location_stock (part_id, location_id, on_hand) VALUES ($1, $2, $3)`,
      [m.partId, m.locationId, m.quantity],
    );
  }
  return rows[0];
}
