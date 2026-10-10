import { randomUUID } from 'node:crypto';
import type { Db } from '../db.ts';
import { emit } from '../events/outbox.ts';
import { conflict, notFound } from '../api/errors.ts';
import { apiMovementTime, locationOnHand, lockPart, lockParts, recordMovement, type Movement } from './ledger.ts';
import { registerReceipt } from './receiving.ts';

// Operaciones de piso que nacen en la API: salida, transferencia, conteo y recepción resuelta.
// Cada salida stock.* lleva origin "api" y command_id (campos extra) para poder reaplicarla
// al reconstruir (los tópicos del taller no las contienen).

export async function findWorkOrderByCode(db: Db, code: string) {
  const { rows } = await db.query(
    `SELECT work_order_id, code, model_id, deleted_at FROM work_orders
     WHERE code = $1 ORDER BY deleted_at NULLS FIRST, work_order_id DESC LIMIT 1`,
    [code],
  );
  return rows[0] ?? null;
}

async function requirePart(db: Db, partId: number) {
  const { rows } = await db.query(`SELECT part_id, sku, name FROM parts WHERE part_id = $1`, [partId]);
  if (!rows[0]) throw notFound(`La pieza ${partId} no existe`);
  return rows[0];
}

async function requireLocation(db: Db, locationId: number) {
  const { rows } = await db.query(`SELECT location_id, code FROM locations WHERE location_id = $1`, [locationId]);
  if (!rows[0]) throw notFound(`La ubicación ${locationId} no existe`);
  return rows[0];
}

// --- POST /issues ---------------------------------------------------------------------

export type IssueInput = {
  work_order_code: string;
  part_id: number;
  location_id: number;
  quantity: number;
  issued_by: number | string;
};

/**
 * Salida contra una orden (regla 16). Consume primero la reserva de esa orden para esa pieza.
 * 409 si no alcanza el saldo de la ubicación o si dejaría el disponible negativo.
 */
export async function issue(
  db: Db,
  input: IssueInput,
  commandId = randomUUID(),
  occurredAt: string | null = null, // al reconstruir: la hora original
): Promise<Movement> {
  const wo = await findWorkOrderByCode(db, input.work_order_code);
  if (!wo) throw notFound(`La orden ${input.work_order_code} no existe`);
  await requirePart(db, input.part_id);
  await requireLocation(db, input.location_id);
  if (wo.deleted_at) throw conflict(`La orden ${input.work_order_code} está dada de baja`);

  const stock = await lockPart(db, input.part_id);
  const here = await locationOnHand(db, input.part_id, input.location_id);
  if (here < input.quantity) {
    throw conflict(`No alcanza el saldo en la ubicación: hay ${here}, se piden ${input.quantity}`);
  }

  // Reservas activas de esta orden para esta pieza, de la más antigua a la más nueva.
  const res = await db.query(
    `SELECT reservation_id, quantity FROM reservations
     WHERE work_order_id = $1 AND part_id = $2 AND status = 'active' AND quantity > 0
     ORDER BY created_at, reservation_id`,
    [wo.work_order_id, input.part_id],
  );
  const ownReserved = res.rows.reduce((s: number, r: any) => s + r.quantity, 0);
  const fromReservation = Math.min(input.quantity, ownReserved);
  const availableAfter = stock.on_hand - input.quantity - (stock.reserved - fromReservation);
  if (availableAfter < 0) {
    throw conflict(
      `La salida dejaría el disponible negativo: hay ${stock.on_hand - stock.reserved} disponibles ` +
        `y ${ownReserved} reservados para la orden`,
    );
  }

  let left = fromReservation;
  for (const r of res.rows) {
    if (left <= 0) break;
    const take = Math.min(left, r.quantity);
    left -= take;
    await db.query(
      `UPDATE reservations SET quantity = quantity - $2, issued = issued + $2,
         status = CASE WHEN quantity - $2 = 0 THEN 'fulfilled' ELSE status END, updated_at = now()
       WHERE reservation_id = $1`,
      [r.reservation_id, take],
    );
  }
  if (fromReservation > 0) {
    await db.query(`UPDATE part_stock SET reserved = reserved - $2 WHERE part_id = $1`, [input.part_id, fromReservation]);
  }

  const movement = (await recordMovement(db, {
    type: 'issue',
    partId: input.part_id,
    locationId: input.location_id,
    quantity: -input.quantity,
    occurredAt: occurredAt ?? (await apiMovementTime(db, input.part_id)),
    reference: wo.code,
    workOrderId: wo.work_order_id,
    origin: 'api',
    commandId,
  }))!;

  await emit(db, 'stock.issued', wo.code, {
    work_order_id: wo.work_order_id,
    part_id: input.part_id,
    location_id: input.location_id,
    quantity: input.quantity,
    issued_by: input.issued_by,
    // Extras:
    work_order_code: wo.code,
    from_reservation: fromReservation,
    movement_id: movement.movement_id,
    movement_occurred_at: movement.occurred_at,
    origin: 'api',
    command_id: commandId,
  });
  return movement;
}

// --- POST /transfers ------------------------------------------------------------------

export type TransferInput = { part_id: number; from_location_id: number; to_location_id: number; quantity: number };

export async function transfer(db: Db, input: TransferInput, commandId = randomUUID()): Promise<Movement> {
  await requirePart(db, input.part_id);
  await requireLocation(db, input.from_location_id);
  await requireLocation(db, input.to_location_id);
  if (input.from_location_id === input.to_location_id) {
    throw conflict('El origen y el destino son la misma ubicación');
  }

  await lockPart(db, input.part_id);
  const here = await locationOnHand(db, input.part_id, input.from_location_id);
  if (here < input.quantity) {
    throw conflict(`No alcanza el saldo en el origen: hay ${here}, se piden ${input.quantity}`);
  }

  const occurredAt = await apiMovementTime(db, input.part_id);
  const out = (await recordMovement(db, {
    type: 'transfer_out', partId: input.part_id, locationId: input.from_location_id, quantity: -input.quantity,
    occurredAt, reference: `transfer:${input.from_location_id}->${input.to_location_id}`, origin: 'api', commandId,
  }))!;
  await recordMovement(db, {
    type: 'transfer_in', partId: input.part_id, locationId: input.to_location_id, quantity: input.quantity,
    occurredAt, reference: `transfer:${input.from_location_id}->${input.to_location_id}`, origin: 'api', commandId,
  });

  await emit(db, 'stock.transferred', `part:${input.part_id}`, {
    part_id: input.part_id,
    from_location_id: input.from_location_id,
    to_location_id: input.to_location_id,
    quantity: input.quantity,
    // Extras:
    movement_id: out.movement_id,
    movement_occurred_at: out.occurred_at,
    origin: 'api',
    command_id: commandId,
  });
  return out;
}

// --- POST /counts ---------------------------------------------------------------------

export type CountInput = { location_id: number; reason: string; lines: { part_id: number; counted_quantity: number }[] };

/**
 * Conteo cíclico (regla 17): un ajuste por cada diferencia. Es lo único que puede dejar
 * available negativo (no se valida contra las reservas). Las piezas no listadas no se tocan.
 */
export async function count(db: Db, input: CountInput): Promise<{ part_id: number; delta: number }[]> {
  await requireLocation(db, input.location_id);
  for (const line of input.lines) await requirePart(db, line.part_id);

  // Candados de todas las piezas del conteo en orden ascendente.
  await lockParts(db, input.lines.map((l) => l.part_id));

  const adjustments: { part_id: number; delta: number }[] = [];
  for (const line of input.lines) {
    const current = await locationOnHand(db, line.part_id, input.location_id);
    const delta = line.counted_quantity - current;
    if (delta === 0) continue;
    const commandId = randomUUID();
    const movement = (await recordMovement(db, {
      type: 'adjustment', partId: line.part_id, locationId: input.location_id, quantity: delta,
      occurredAt: await apiMovementTime(db, line.part_id), reference: input.reason, origin: 'api', commandId,
    }))!;
    await emit(db, 'stock.adjusted', `part:${line.part_id}`, {
      part_id: line.part_id,
      location_id: input.location_id,
      delta,
      reason: input.reason,
      // Extras:
      counted_quantity: line.counted_quantity,
      movement_id: movement.movement_id,
      movement_occurred_at: movement.occurred_at,
      origin: 'api',
      command_id: commandId,
    });
    adjustments.push({ part_id: line.part_id, delta });
  }
  return adjustments;
}

// --- POST /unmatched-receipts/{id}/resolve --------------------------------------------

export async function resolveUnmatched(
  db: Db,
  id: number,
  input: { part_id: number; location_id?: number | null },
  commandId = randomUUID(),
): Promise<Movement> {
  const { rows } = await db.query(`SELECT * FROM unmatched_receipts WHERE id = $1 FOR UPDATE`, [id]);
  const ur = rows[0];
  if (!ur) throw notFound(`La recepción sin relacionar ${id} no existe`);
  if (ur.resolved_at) throw conflict(`La recepción ${id} ya fue resuelta (pieza ${ur.resolved_part_id})`);
  await requirePart(db, input.part_id);
  if (input.location_id != null) await requireLocation(db, input.location_id);

  const movement = await registerReceipt(db, {
    partId: input.part_id,
    locationId: input.location_id ?? undefined,
    quantity: ur.quantity,
    unitPrice: ur.unit_price,
    currency: ur.currency,
    purchaseLineId: ur.purchase_line_id,
    receivedAt: ur.received_at,
    workOrderCode: ur.work_order_code,
    origin: 'api',
    commandId,
    extra: { part_number: ur.part_number, unmatched_receipt_id: ur.id },
  });
  if (!movement) throw conflict(`La línea de compra ${ur.purchase_line_id} ya había entrado al inventario`);

  await db.query(`UPDATE unmatched_receipts SET resolved_part_id = $2, resolved_at = now() WHERE id = $1`, [id, input.part_id]);
  return movement;
}
