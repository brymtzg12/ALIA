import type { Db } from '../db.ts';
import { emit } from '../events/outbox.ts';

// Sugerencias de compra (regla 18). Una pieza con faltantes abiertos tiene una sugerencia:
//  - suggested_quantity = suma de missing_quantity no nulos, + 1 por cada faltante sin cantidad
//    (para que la sugerencia exista); nunca menor que lo que falta;
//  - work_order_ids = las órdenes de esos faltantes, sin repetir y ordenadas.
// Se emite stock.reorder_suggested solo cuando nace o cambia. Sin faltantes se borra sin emitir.
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

  if (!workOrderIds.length) {
    if (current.rowCount) await db.query(`DELETE FROM reorder_suggestions WHERE part_id = $1`, [partId]);
    return;
  }

  const quantity = Math.max(1, missing + unknown);

  const prev = current.rows[0];
  if (prev && prev.suggested_quantity === quantity && sameIds(prev.work_order_ids, workOrderIds)) return;

  await db.query(
    `INSERT INTO reorder_suggestions (part_id, suggested_quantity, work_order_ids, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (part_id) DO UPDATE SET suggested_quantity = EXCLUDED.suggested_quantity,
       work_order_ids = EXCLUDED.work_order_ids, updated_at = now()`,
    [partId, quantity, workOrderIds],
  );
  const part = await db.query(`SELECT sku, name FROM parts WHERE part_id = $1`, [partId]);
  await emit(db, 'stock.reorder_suggested', `part:${partId}`, {
    part_id: partId,
    suggested_quantity: quantity,
    work_order_ids: workOrderIds,
    // Extras:
    sku: part.rows[0]?.sku ?? null,
    name: part.rows[0]?.name ?? null,
    missing_quantity: missing,
    shortages_without_quantity: unknown,
  });
}

function sameIds(a: number[], b: number[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
