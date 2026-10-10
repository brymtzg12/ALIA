import type { Db } from '../db.ts';
import { applyApproval, voidInspection } from '../domain/needs.ts';
import type { Handler, InputEvent } from './types.ts';

// shop.inspections. Solo approved crea necesidad (regla 1); el resto registra el estado.

async function upsertInspection(db: Db, ev: InputEvent, status: string) {
  const d = ev.data;
  await db.query(
    `INSERT INTO inspections (inspection_id, work_order_id, kind, status, items, approved_by, approved_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (inspection_id) DO UPDATE SET
       work_order_id = EXCLUDED.work_order_id,
       kind = COALESCE(EXCLUDED.kind, inspections.kind),
       status = EXCLUDED.status,
       items = COALESCE(EXCLUDED.items, inspections.items),
       approved_by = COALESCE(EXCLUDED.approved_by, inspections.approved_by),
       approved_at = COALESCE(EXCLUDED.approved_at, inspections.approved_at),
       updated_at = now()`,
    [
      d.inspection_id, d.work_order_id, d.kind ?? null, status,
      d.items ? JSON.stringify(d.items) : null, d.approved_by ?? null, d.approved_at ?? null,
    ],
  );
}

async function workOrderState(db: Db, workOrderId: number): Promise<'missing' | 'deleted' | 'alive'> {
  const { rows } = await db.query(`SELECT deleted_at FROM work_orders WHERE work_order_id = $1`, [workOrderId]);
  if (!rows[0]) return 'missing';
  return rows[0].deleted_at ? 'deleted' : 'alive';
}

async function workOrderRef(db: Db, workOrderId: number) {
  const { rows } = await db.query(`SELECT work_order_id, code FROM work_orders WHERE work_order_id = $1`, [workOrderId]);
  return rows[0] as { work_order_id: number; code: string };
}

async function requireWorkOrder(db: Db, ev: InputEvent): Promise<string | null> {
  return (await workOrderState(db, ev.data.work_order_id)) === 'missing' ? `orden ${ev.data.work_order_id} desconocida` : null;
}

function statusHandler(status: string): Handler {
  return {
    missingRefs: requireWorkOrder,
    async handle(db, ev) {
      await upsertInspection(db, ev, status);
    },
  };
}

export const inspectionSubmitted = statusHandler('submitted');
export const inspectionRejected = statusHandler('rejected');
export const inspectionDiscarded = statusHandler('discarded');

export const inspectionApproved: Handler = {
  // Falta la orden, una pieza de un renglón buy, o la línea de la lista de partes
  // cuando quantity es null (para tomar su qty_per_unit).
  async missingRefs(db, ev) {
    const d = ev.data;
    const state = await workOrderState(db, d.work_order_id);
    if (state === 'missing') return `orden ${d.work_order_id} desconocida`;
    if (state === 'deleted') return null; // se ignora en handle

    const buys = d.items.filter((it: any) => it.action === 'buy');
    const partIds = [...new Set(buys.map((it: any) => it.part_id).filter((p: any) => p != null))];
    if (partIds.length) {
      const { rows } = await db.query(`SELECT part_id FROM parts WHERE part_id = ANY($1::int[])`, [partIds]);
      const known = new Set(rows.map((r: any) => r.part_id));
      const missing = partIds.filter((p) => !known.has(p));
      if (missing.length) return `piezas desconocidas: ${missing.join(', ')}`;
    }
    const lineIds = [...new Set(buys.filter((it: any) => it.quantity == null).map((it: any) => it.bom_line_id))];
    if (lineIds.length) {
      const { rows } = await db.query(`SELECT bom_line_id FROM bom_lines WHERE bom_line_id = ANY($1::int[])`, [lineIds]);
      const known = new Set(rows.map((r: any) => r.bom_line_id));
      const missing = lineIds.filter((l) => !known.has(l));
      if (missing.length) return `líneas de lista de partes desconocidas: ${missing.join(', ')}`;
    }
    return null;
  },
  async handle(db, ev) {
    if ((await workOrderState(db, ev.data.work_order_id)) === 'deleted') return 'ignored';
    await upsertInspection(db, ev, 'approved');
    const wo = await workOrderRef(db, ev.data.work_order_id);
    await applyApproval(db, wo, ev.data.inspection_id, ev.data.items);
  },
};

export const inspectionVoided: Handler = {
  missingRefs: requireWorkOrder,
  async handle(db, ev) {
    await upsertInspection(db, ev, 'voided');
    await voidInspection(db, ev.data.work_order_id, ev.data.inspection_id);
  },
};
