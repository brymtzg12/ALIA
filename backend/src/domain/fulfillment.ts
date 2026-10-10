import type { Db } from '../db.ts';
import { emit } from '../events/outbox.ts';
import { availableOf, reserve } from './reservations.ts';
import { recomputeSuggestion } from './suggestions.ts';

// Surtido de faltantes con una entrada (regla 12).

/**
 * Con una entrada de la pieza se surten sus faltantes abiertos: primero los de la orden de
 * workOrderCode (si viene y sigue viva) y después los demás, del más antiguo al más nuevo.
 * Cada uno emite stock.reserved + stock.shortage_resolved con lo cubierto. Un faltante
 * cubierto en parte sigue abierto con el resto. Los de cantidad desconocida no se surten solos.
 * Requisito: el llamador tiene el candado de part_stock de la pieza.
 */
export async function fillShortagesFromReceipt(db: Db, partId: number, _quantity: number, workOrderCode: string | null) {
  let available = await availableOf(db, partId);
  if (available > 0) {
    const { rows } = await db.query(
      `SELECT s.shortage_id, s.work_order_id, w.code, s.bom_line_id, s.name, s.missing_quantity, s.inspection_item_id
       FROM shortages s JOIN work_orders w ON w.work_order_id = s.work_order_id
       WHERE s.part_id = $1 AND s.closed_at IS NULL AND s.missing_quantity > 0 AND w.deleted_at IS NULL
       ORDER BY (w.code = $2) DESC, s.opened_at, s.shortage_id`,
      [partId, workOrderCode ?? ''],
    );
    for (const s of rows) {
      if (available <= 0) break;
      const take = Math.min(available, s.missing_quantity);
      available -= take;
      const wo = { work_order_id: s.work_order_id, code: s.code };
      await reserve(
        db,
        { wo, bomLineId: s.bom_line_id, partId, name: s.name, inspectionItemId: s.inspection_item_id },
        take,
        'receipt',
      );
      const left = s.missing_quantity - take;
      await db.query(
        `UPDATE shortages SET missing_quantity = $2, closed_at = CASE WHEN $2 = 0 THEN now() END WHERE shortage_id = $1`,
        [s.shortage_id, left],
      );
      await emit(db, 'stock.shortage_resolved', s.code, {
        work_order_id: s.work_order_id,
        part_id: partId,
        quantity: take,
        // Extras:
        work_order_code: s.code,
        bom_line_id: s.bom_line_id,
        inspection_item_id: s.inspection_item_id,
        remaining_missing: left,
      });
    }
  }
  await recomputeSuggestion(db, partId);
}
