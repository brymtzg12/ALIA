import type { Db } from '../db.ts';
import { lockParts } from './ledger.ts';
import {
  availableOf, closeShortage, lineCoverage, releaseLine, reserve, setShortage,
  type LineRef, type WorkOrderRef,
} from './reservations.ts';
import { recomputeSuggestion } from './suggestions.ts';

// Necesidades de una orden por (orden, bom_line_id) — reglas 1 a 8, 13 y 14.

type ApprovalItem = {
  inspection_item_id: number;
  bom_line_id: number;
  part_id: number | null;
  name: string;
  action: string | null;
  quantity: number | null;
};

type Need = {
  bom_line_id: number;
  part_id: number | null;
  name: string;
  required: number | null;
  inspection_item_id: number;
};

/**
 * Aplica una inspección aprobada. Cada renglón con action = buy fija la necesidad de su línea
 * (reemplaza, no suma). repair y ok no generan necesidad. Las líneas que no vienen conservan
 * la suya (una full con items [] no cambia nada).
 */
export async function applyApproval(db: Db, wo: WorkOrderRef, inspectionId: number, items: ApprovalItem[]) {
  const buys = items.filter((it) => it.action === 'buy');
  if (!buys.length) return;

  // quantity null: se usa el qty_per_unit de la lista de partes vigente (regla 5).
  const lineIds = buys.filter((it) => it.quantity == null).map((it) => it.bom_line_id);
  const perUnit = new Map<number, number | null>();
  if (lineIds.length) {
    const { rows } = await db.query(
      `SELECT bom_line_id, qty_per_unit FROM bom_lines WHERE bom_line_id = ANY($1::int[])`,
      [lineIds],
    );
    for (const r of rows) perUnit.set(r.bom_line_id, r.qty_per_unit);
  }

  // Necesidades vigentes de esas líneas (pueden cambiar de pieza).
  const { rows: prevRows } = await db.query(
    `SELECT bom_line_id, part_id FROM needs WHERE work_order_id = $1 AND bom_line_id = ANY($2::int[])`,
    [wo.work_order_id, buys.map((b) => b.bom_line_id)],
  );
  const prevPart = new Map<number, number | null>(prevRows.map((r: any) => [r.bom_line_id, r.part_id]));

  // Candados de todas las piezas involucradas, en orden ascendente, antes de tocar nada.
  const parts = [...buys.map((b) => b.part_id), ...prevPart.values()].filter((p): p is number => p != null);
  await lockParts(db, parts);

  const touched = new Set<number>();
  for (const it of buys) {
    const required = it.quantity ?? perUnit.get(it.bom_line_id) ?? null;
    const line: LineRef = {
      wo,
      bomLineId: it.bom_line_id,
      partId: it.part_id,
      name: it.name,
      inspectionItemId: it.inspection_item_id,
    };

    // Si la línea cambió de pieza, lo apartado para la pieza anterior se libera.
    const before = prevPart.get(it.bom_line_id);
    if (prevPart.has(it.bom_line_id) && before !== it.part_id) {
      await releaseLine(db, wo.work_order_id, it.bom_line_id, null);
      await closeShortage(db, wo.work_order_id, it.bom_line_id);
      if (before != null) touched.add(before);
    }

    await db.query(
      `INSERT INTO needs (work_order_id, bom_line_id, part_id, name, group_name, required, inspection_id, inspection_item_id, updated_at)
       SELECT $1, $2, $3, $4, (SELECT group_name FROM bom_lines WHERE bom_line_id = $2), $5, $6, $7, now()
       ON CONFLICT (work_order_id, bom_line_id) DO UPDATE SET
         part_id = EXCLUDED.part_id, name = EXCLUDED.name, group_name = COALESCE(EXCLUDED.group_name, needs.group_name),
         required = EXCLUDED.required, inspection_id = EXCLUDED.inspection_id,
         inspection_item_id = EXCLUDED.inspection_item_id, updated_at = now()`,
      [wo.work_order_id, it.bom_line_id, it.part_id, it.name, required, inspectionId, it.inspection_item_id],
    );
    prevPart.set(it.bom_line_id, it.part_id);

    await reconcileLine(db, line, required);
    if (it.part_id != null) touched.add(it.part_id);
  }

  for (const partId of [...touched].sort((a, b) => a - b)) await recomputeSuggestion(db, partId);
}

/**
 * Ajusta reservas y faltante de una línea a su necesidad:
 *  - pieza sin identificar: faltante con la cantidad pedida, nunca reserva (regla 6);
 *  - cantidad desconocida: faltante con missing null, sin reservas (regla 5);
 *  - si la necesidad supera lo cubierto (reservado + entregado), reserva min(disponible, diferencia)
 *    y lo que no alcance es faltante (regla 7); si baja, el faltante se reduce primero y luego
 *    se libera el excedente de la reserva (regla 2).
 */
async function reconcileLine(db: Db, line: LineRef, required: number | null) {
  if (line.partId == null) {
    await setShortage(db, line, required, required);
    return;
  }
  if (required == null) {
    await releaseLine(db, line.wo.work_order_id, line.bomLineId, null);
    await setShortage(db, line, null, null);
    return;
  }

  const { reserved, issued } = await lineCoverage(db, line.wo.work_order_id, line.bomLineId);
  const covered = reserved + issued;
  if (required > covered) {
    const want = required - covered;
    const take = Math.max(0, Math.min(await availableOf(db, line.partId), want));
    await reserve(db, { ...line, partId: line.partId }, take, 'approval');
    await setShortage(db, line, want - take, required);
  } else {
    if (required < covered) await releaseLine(db, line.wo.work_order_id, line.bomLineId, covered - required);
    await setShortage(db, line, 0, required);
  }
}

/** Quita necesidades: libera sus reservas y cierra sus faltantes (sin emitir, regla 15). */
async function dropNeeds(db: Db, workOrderId: number, needs: Need[]) {
  const parts = needs.map((n) => n.part_id).filter((p): p is number => p != null);
  await lockParts(db, parts);
  for (const n of needs) {
    await releaseLine(db, workOrderId, n.bom_line_id, null);
    await closeShortage(db, workOrderId, n.bom_line_id);
    await db.query(`DELETE FROM needs WHERE work_order_id = $1 AND bom_line_id = $2`, [workOrderId, n.bom_line_id]);
  }
  return [...new Set(parts)].sort((a, b) => a - b);
}

/** inspection.voided (regla 13): solo las líneas cuya necesidad vigente vino de esa inspección. */
export async function voidInspection(db: Db, workOrderId: number, inspectionId: number) {
  const { rows } = await db.query(
    `SELECT bom_line_id, part_id, name, required, inspection_item_id FROM needs
     WHERE work_order_id = $1 AND inspection_id = $2`,
    [workOrderId, inspectionId],
  );
  const parts = await dropNeeds(db, workOrderId, rows);
  for (const p of parts) await recomputeSuggestion(db, p);
}

/** work_order.deleted (regla 14): libera todo lo de la orden y cierra todos sus faltantes. */
export async function deleteWorkOrder(db: Db, workOrderId: number) {
  const { rows } = await db.query(
    `SELECT bom_line_id, part_id, name, required, inspection_item_id FROM needs WHERE work_order_id = $1`,
    [workOrderId],
  );
  // Reservas o faltantes que hubieran quedado fuera de una necesidad vigente.
  const { rows: extra } = await db.query(
    `SELECT DISTINCT bom_line_id, part_id FROM (
       SELECT bom_line_id, part_id FROM reservations WHERE work_order_id = $1 AND status = 'active'
       UNION SELECT bom_line_id, part_id FROM shortages WHERE work_order_id = $1 AND closed_at IS NULL
     ) x`,
    [workOrderId],
  );
  const known = new Set(rows.map((r: any) => r.bom_line_id));
  const all: Need[] = [
    ...rows,
    ...extra
      .filter((e: any) => !known.has(e.bom_line_id))
      .map((e: any) => ({ bom_line_id: e.bom_line_id, part_id: e.part_id, name: '', required: null, inspection_item_id: 0 })),
  ];
  const parts = await dropNeeds(db, workOrderId, all);
  for (const p of parts) await recomputeSuggestion(db, p);
}
