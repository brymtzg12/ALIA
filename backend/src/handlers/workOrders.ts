import { deleteWorkOrder } from '../domain/needs.ts';
import type { Handler } from './types.ts';

async function workOrderExists(db: any, workOrderId: number): Promise<boolean> {
  const { rowCount } = await db.query(`SELECT 1 FROM work_orders WHERE work_order_id = $1`, [workOrderId]);
  return rowCount > 0;
}

export const workOrderOpened: Handler = {
  async handle(db, ev) {
    const d = ev.data;
    await db.query(
      `INSERT INTO work_orders (work_order_id, code, model_id, department, stage, received_at)
       VALUES ($1, $2, $3, $4, 'awaiting_quick_inspection', $5)
       ON CONFLICT (work_order_id) DO UPDATE SET
         code = EXCLUDED.code, model_id = EXCLUDED.model_id,
         department = EXCLUDED.department, received_at = EXCLUDED.received_at`,
      [d.work_order_id, d.code, d.model_id, d.department, d.received_at],
    );
  },
};

export const workOrderStageChanged: Handler = {
  async missingRefs(db, ev) {
    return (await workOrderExists(db, ev.data.work_order_id)) ? null : `orden ${ev.data.work_order_id} desconocida`;
  },
  async handle(db, ev) {
    await db.query(`UPDATE work_orders SET stage = $2 WHERE work_order_id = $1`, [ev.data.work_order_id, ev.data.to_stage]);
  },
};

export const workOrderDeleted: Handler = {
  async missingRefs(db, ev) {
    return (await workOrderExists(db, ev.data.work_order_id)) ? null : `orden ${ev.data.work_order_id} desconocida`;
  },
  async handle(db, ev) {
    await db.query(
      `UPDATE work_orders SET deleted_at = COALESCE(deleted_at, $2) WHERE work_order_id = $1`,
      [ev.data.work_order_id, ev.occurred_at],
    );
    await deleteWorkOrder(db, ev.data.work_order_id);
  },
};
