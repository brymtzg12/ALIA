import { isCatalogInSync } from '../events/catalogSync.ts';
import { emit } from '../events/outbox.ts';
import { matchPartNumber, registerReceipt } from '../domain/receiving.ts';
import type { Handler } from './types.ts';

// shop.purchasing: purchase.item_received.

export const purchaseItemReceived: Handler = {
  // Si no coincide con el catálogo mientras el catálogo va atrasado, se estaciona: la pieza
  // puede venir en camino (tópicos distintos no tienen orden entre sí). Con el catálogo al día,
  // lo que no coincide sí va a revisión manual (regla 22).
  async missingRefs(db, ev) {
    const d = ev.data;
    if (d.purpose === 'customer_order') return null;
    const match = await matchPartNumber(db, d.part_number, d.description);
    if (match.partId != null) return null;
    return (await isCatalogInSync()) ? null : 'esperando a que el catálogo alcance su marca final';
  },

  async handle(db, ev) {
    const d = ev.data;
    // Regla 9: material para un cliente. No entra, no surte y no emite nada.
    if (d.purpose === 'customer_order') return 'ignored';

    const match = await matchPartNumber(db, d.part_number, d.description);
    if (match.partId == null) {
      // Regla 10: ninguna o varias piezas. Queda para revisión manual.
      const ins = await db.query(
        `INSERT INTO unmatched_receipts (purchase_line_id, purchase_request_id, request_number, part_number, description,
                                         quantity, unit_price, currency, received_at, work_order_code, match_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (purchase_line_id) DO NOTHING RETURNING id`,
        [
          d.line_id, d.purchase_request_id, d.request_number, d.part_number, d.description,
          d.quantity, d.unit_price, d.currency, d.received_at, d.work_order_code, match.candidates.length,
        ],
      );
      if (!ins.rowCount) return 'ignored';
      await emit(db, 'stock.unmatched_receipt', `purchase_line:${d.line_id}`, {
        purchase_line_id: d.line_id,
        part_number: d.part_number,
        description: d.description,
        quantity: d.quantity,
        // Extras:
        unmatched_receipt_id: ins.rows[0].id,
        unit_price: d.unit_price,
        currency: d.currency,
        received_at: d.received_at,
        work_order_code: d.work_order_code,
        candidate_part_ids: match.candidates,
        reason: match.candidates.length > 1 ? 'sku_compartido' : 'sin_coincidencia',
      });
      return;
    }

    // Reglas 11 y 12: entra a U-100, emite stock.received y surte faltantes.
    const movement = await registerReceipt(db, {
      partId: match.partId,
      quantity: d.quantity,
      unitPrice: d.unit_price,
      currency: d.currency,
      purchaseLineId: d.line_id,
      receivedAt: d.received_at,
      workOrderCode: d.work_order_code,
      origin: 'event',
      extra: { part_number: d.part_number, request_number: d.request_number, match_rule: match.rule },
    });
    if (!movement) return 'ignored'; // esa línea de compra ya había entrado
  },
};
