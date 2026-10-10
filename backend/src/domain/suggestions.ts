import type { Db } from '../db.ts';
import { emit } from '../events/outbox.ts';
import { getPolicy } from './policies.ts';

// Requisito: el llamador tiene el candado de part_stock de la pieza.

export async function recomputeSuggestion(db: Db, partId: number | null) {
  if (partId == null) return;
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(s.missing_quantity), 0)::int AS missing,
            COUNT(*) FILTER (WHERE s.missing_quantity IS NULL)::int AS unknown,
            COALESCE(array_agg(DISTINCT s.work_order_id ORDER BY s.work_order_id), '{}') AS work_order_ids
     FROM shortages s JOIN work_orders w ON w.work_order_id = s.work_order_id
     WHERE s.part_id = $1 AND s.closed_at IS NULL AND w.deleted_at IS NULL
       AND (s.missing_quantity IS NULL OR s.missing_quantity > 0)`,
    [partId],
  );
  const { missing, unknown } = rows[0];
  const workOrderIds: number[] = rows[0].work_order_ids;
  const current = await db.query(
    `SELECT suggested_quantity, work_order_ids FROM reorder_suggestions WHERE part_id = $1`,
    [partId],
  );

  const forShortages = workOrderIds.length ? Math.max(1, missing + unknown) : 0;

  let forPolicy = 0;
  let projected: number | null = null;
  const policy = await getPolicy(db, partId);
  if (policy) {
    const stock = await db.query(`SELECT on_hand - reserved AS available FROM part_stock WHERE part_id = $1`, [partId]);
    projected = (stock.rows[0]?.available ?? 0) - missing;
    if (projected < policy.min_qty) forPolicy = Math.max(1, policy.max_qty - projected);
  }

  const quantity = Math.max(forShortages, forPolicy);
  if (quantity <= 0) {
    if (current.rowCount) await db.query(`DELETE FROM reorder_suggestions WHERE part_id = $1`, [partId]);
    return;
  }
  const reason = forShortages && forPolicy ? 'shortage_and_min' : forPolicy ? 'below_min' : 'shortage';

  const prev = current.rows[0];
  if (prev && prev.suggested_quantity === quantity && sameIds(prev.work_order_ids, workOrderIds)) return;

  await db.query(
    `INSERT INTO reorder_suggestions (part_id, suggested_quantity, work_order_ids, reason, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (part_id) DO UPDATE SET suggested_quantity = EXCLUDED.suggested_quantity,
       work_order_ids = EXCLUDED.work_order_ids, reason = EXCLUDED.reason, updated_at = now()`,
    [partId, quantity, workOrderIds, reason],
  );
  const part = await db.query(`SELECT sku, name FROM parts WHERE part_id = $1`, [partId]);
  await emit(db, 'stock.reorder_suggested', `part:${partId}`, {
    part_id: partId,
    suggested_quantity: quantity,
    work_order_ids: workOrderIds,
    sku: part.rows[0]?.sku ?? null,
    name: part.rows[0]?.name ?? null,
    missing_quantity: missing,
    shortages_without_quantity: unknown,
    reason,
    ...(policy ? { min_qty: policy.min_qty, max_qty: policy.max_qty, projected_available: projected } : {}),
  });
}

function sameIds(a: number[], b: number[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
