import { Router } from 'express';
import { pool } from '../db.ts';
import { notFound } from './errors.ts';
import { intParam } from './validate.ts';

// Rutas del contrato de órdenes: materiales, faltantes y sugerencias de compra.

export const workRoutes = Router();

// GET /work-orders/{code}/materials — una línea por bom_line_id con necesidad vigente.
workRoutes.get('/work-orders/:code/materials', async (req: any, res: any) => {
  const { rows: wos } = await pool.query(
    `SELECT w.work_order_id, w.code, w.model_id, m.model_name, m.brand, w.stage, w.received_at, w.deleted_at
     FROM work_orders w LEFT JOIN bom_models m ON m.model_id = w.model_id
     WHERE w.code = $1 ORDER BY w.deleted_at NULLS FIRST, w.work_order_id DESC LIMIT 1`,
    [req.params.code],
  );
  const wo = wos[0];
  if (!wo) throw notFound(`La orden ${req.params.code} no existe`);

  const { rows } = await pool.query(
    `SELECT n.inspection_item_id, n.bom_line_id, n.part_id, n.name, n.required,
            COALESCE(r.reserved, 0)::int AS reserved,
            COALESCE(r.issued, 0)::int AS issued,
            CASE WHEN s.shortage_id IS NULL THEN 0 ELSE s.missing_quantity END AS missing,
            COALESCE(b.group_name, n.group_name) AS group_name,
            p.sku, COALESCE(p.family = 'SERVICIO', false) AS is_service,
            n.inspection_id
     FROM needs n
     LEFT JOIN LATERAL (
       SELECT SUM(quantity) FILTER (WHERE status = 'active') AS reserved, SUM(issued) AS issued
       FROM reservations WHERE work_order_id = n.work_order_id AND bom_line_id = n.bom_line_id
     ) r ON true
     LEFT JOIN shortages s ON s.work_order_id = n.work_order_id AND s.bom_line_id = n.bom_line_id AND s.closed_at IS NULL
     LEFT JOIN bom_lines b ON b.bom_line_id = n.bom_line_id
     LEFT JOIN parts p ON p.part_id = n.part_id
     WHERE n.work_order_id = $1
     ORDER BY COALESCE(b.sort_order, 2147483647), n.bom_line_id`,
    [wo.work_order_id],
  );
  // Extras por línea: kit_name (group_name o, si no hay, name) y line_status:
  // unidentified (sin pieza) · unknown_qty (sin cantidad) · complete · partial · missing.
  const lines = rows.map((l: any) => {
    const covered = l.reserved + l.issued;
    const line_status =
      l.part_id == null ? 'unidentified'
      : l.required == null ? 'unknown_qty'
      : covered >= l.required && l.missing === 0 ? 'complete'
      : covered > 0 ? 'partial'
      : 'missing';
    return { ...l, kit_name: l.group_name ?? l.name, line_status, complete: line_status === 'complete' };
  });
  const kits = new Map<string, any>();
  for (const l of lines) {
    const kit = kits.get(l.kit_name) ?? { kit_name: l.kit_name, bom_line_ids: [] as number[], complete: true };
    kit.bom_line_ids.push(l.bom_line_id);
    kit.complete = kit.complete && l.complete;
    kits.set(l.kit_name, kit);
  }
  res.json({
    work_order_id: wo.work_order_id,
    code: wo.code,
    // Extras:
    model_id: wo.model_id,
    model_name: wo.model_name ?? null,
    brand: wo.brand ?? null,
    stage: wo.stage,
    received_at: wo.received_at,
    deleted: wo.deleted_at != null,
    kit_complete: lines.length > 0 && lines.every((l: any) => l.complete),
    kits: [...kits.values()],
    lines,
  });
});

// GET /shortages?work_order_code=&part_id= — faltantes abiertos.
workRoutes.get('/shortages', async (req: any, res: any) => {
  const filters: string[] = ['s.closed_at IS NULL'];
  const params: unknown[] = [];
  if (req.query.work_order_code) {
    params.push(String(req.query.work_order_code));
    filters.push(`w.code = $${params.length}`);
  }
  if (req.query.part_id != null && req.query.part_id !== '') {
    const partId = intParam(String(req.query.part_id));
    if (partId == null) return res.json({ items: [] });
    params.push(partId);
    filters.push(`s.part_id = $${params.length}`);
  }
  const { rows } = await pool.query(
    `SELECT s.work_order_id, w.code AS work_order_code, s.part_id, s.name, s.missing_quantity,
            s.inspection_item_id, s.opened_at, s.bom_line_id, p.sku
     FROM shortages s JOIN work_orders w ON w.work_order_id = s.work_order_id
     LEFT JOIN parts p ON p.part_id = s.part_id
     WHERE ${filters.join(' AND ')}
     ORDER BY s.opened_at, s.shortage_id`,
    params,
  );
  res.json({ items: rows });
});

// GET /reorder-suggestions — sugerencias vigentes.
workRoutes.get('/reorder-suggestions', async (_req: any, res: any) => {
  const { rows } = await pool.query(
    `SELECT r.part_id, p.sku, p.name, r.suggested_quantity, r.work_order_ids, r.reason,
            pol.min_qty, pol.max_qty,
            ARRAY(SELECT w.code FROM unnest(r.work_order_ids) WITH ORDINALITY u(id, i)
                  JOIN work_orders w ON w.work_order_id = u.id ORDER BY u.i) AS work_order_codes,
            COALESCE(ps.on_hand, 0) - COALESCE(ps.reserved, 0) AS available,
            r.updated_at
     FROM reorder_suggestions r LEFT JOIN parts p ON p.part_id = r.part_id
     LEFT JOIN part_stock ps ON ps.part_id = r.part_id
     LEFT JOIN policies pol ON pol.part_id = r.part_id
     ORDER BY r.updated_at DESC, r.part_id`,
  );
  res.json({ items: rows });
});
