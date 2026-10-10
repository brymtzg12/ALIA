import { randomUUID } from 'node:crypto';
import type { Db } from '../db.ts';
import { emit } from '../events/outbox.ts';

// Requisito: el llamador ya tiene el candado de part_stock de la pieza (ledger.lockParts).

export type WorkOrderRef = { work_order_id: number; code: string };

export type LineRef = {
  wo: WorkOrderRef;
  bomLineId: number;
  partId: number | null;
  name: string;
  inspectionItemId: number;
};

export async function availableOf(db: Db, partId: number): Promise<number> {
  const { rows } = await db.query(`SELECT on_hand - reserved AS available FROM part_stock WHERE part_id = $1`, [partId]);
  return rows[0]?.available ?? 0;
}

export async function reserve(db: Db, line: LineRef & { partId: number }, quantity: number, reason: string) {
  if (quantity <= 0) return;
  const reservationId = randomUUID();
  await db.query(
    `INSERT INTO reservations (reservation_id, work_order_id, bom_line_id, part_id, quantity, inspection_item_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [reservationId, line.wo.work_order_id, line.bomLineId, line.partId, quantity, line.inspectionItemId],
  );
  await db.query(`UPDATE part_stock SET reserved = reserved + $2 WHERE part_id = $1`, [line.partId, quantity]);
  await emit(db, 'stock.reserved', line.wo.code, {
    reservation_id: reservationId,
    work_order_id: line.wo.work_order_id,
    part_id: line.partId,
    quantity,
    inspection_item_id: line.inspectionItemId,
    work_order_code: line.wo.code,
    bom_line_id: line.bomLineId,
    reason,
  });
}

export async function lineCoverage(db: Db, workOrderId: number, bomLineId: number) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(quantity) FILTER (WHERE status = 'active'), 0)::int AS reserved,
            COALESCE(SUM(issued), 0)::int AS issued
     FROM reservations WHERE work_order_id = $1 AND bom_line_id = $2`,
    [workOrderId, bomLineId],
  );
  return rows[0] as { reserved: number; issued: number };
}

/**
 * Libera hasta `amount` (o todo, si es null) de las reservas activas de la línea, de la más
 * nueva a la más antigua. No emite evento (regla 15). Devuelve lo liberado.
 */
export async function releaseLine(db: Db, workOrderId: number, bomLineId: number, amount: number | null): Promise<number> {
  const { rows } = await db.query(
    `SELECT reservation_id, part_id, quantity FROM reservations
     WHERE work_order_id = $1 AND bom_line_id = $2 AND status = 'active' AND quantity > 0
     ORDER BY created_at DESC, reservation_id DESC`,
    [workOrderId, bomLineId],
  );
  let left = amount ?? Infinity;
  let released = 0;
  for (const r of rows) {
    if (left <= 0) break;
    const take = Math.min(left, r.quantity);
    left -= take;
    released += take;
    await db.query(
      `UPDATE reservations SET quantity = quantity - $2, updated_at = now(),
         status = CASE WHEN quantity - $2 > 0 THEN 'active' WHEN issued > 0 THEN 'fulfilled' ELSE 'cancelled' END
       WHERE reservation_id = $1`,
      [r.reservation_id, take],
    );
    await db.query(`UPDATE part_stock SET reserved = reserved - $2 WHERE part_id = $1`, [r.part_id, take]);
  }
  return released;
}

/**
 * Deja el faltante abierto de la línea en `missing` (null = cantidad desconocida).
 * Con missing 0 lo cierra sin emitir. Emite stock.shortage_detected cuando nace o cambia.
 */
export async function setShortage(db: Db, line: LineRef, missing: number | null, required: number | null) {
  const { rows } = await db.query(
    `SELECT shortage_id, part_id, missing_quantity FROM shortages
     WHERE work_order_id = $1 AND bom_line_id = $2 AND closed_at IS NULL`,
    [line.wo.work_order_id, line.bomLineId],
  );
  const open = rows[0];

  if (missing === 0) {
    if (open) await db.query(`UPDATE shortages SET missing_quantity = 0, closed_at = now() WHERE shortage_id = $1`, [open.shortage_id]);
    return;
  }
  if (open && open.missing_quantity === missing && open.part_id === line.partId) return;

  if (open) {
    await db.query(
      `UPDATE shortages SET part_id = $2, name = $3, missing_quantity = $4, inspection_item_id = $5 WHERE shortage_id = $1`,
      [open.shortage_id, line.partId, line.name, missing, line.inspectionItemId],
    );
  } else {
    await db.query(
      `INSERT INTO shortages (work_order_id, bom_line_id, part_id, name, missing_quantity, inspection_item_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [line.wo.work_order_id, line.bomLineId, line.partId, line.name, missing, line.inspectionItemId],
    );
  }
  await emit(db, 'stock.shortage_detected', line.wo.code, {
    work_order_id: line.wo.work_order_id,
    part_id: line.partId,
    name: line.name,
    missing_quantity: missing,
    inspection_item_id: line.inspectionItemId,
    work_order_code: line.wo.code,
    bom_line_id: line.bomLineId,
    required,
  });
}

export async function closeShortage(db: Db, workOrderId: number, bomLineId: number) {
  await db.query(
    `UPDATE shortages SET closed_at = now() WHERE work_order_id = $1 AND bom_line_id = $2 AND closed_at IS NULL`,
    [workOrderId, bomLineId],
  );
}
