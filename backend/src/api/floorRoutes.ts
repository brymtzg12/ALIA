import { Router } from 'express';
import { pool } from '../db.ts';
import { compactSku, normSku } from '../domain/sku.ts';
import { notFound } from './errors.ts';
import { intParam } from './validate.ts';

export const floorRoutes = Router();

const PART_ROW = `
  p.part_id, p.sku, p.name, p.family, p."group", p.subgroup, p.unit_name, p.image_url, p.active,
  COALESCE(p.family = 'SERVICIO', false) AS is_service,
  COALESCE(ps.on_hand, 0) AS on_hand, COALESCE(ps.reserved, 0) AS reserved,
  COALESCE(ps.on_hand, 0) - COALESCE(ps.reserved, 0) AS available,
  COALESCE(sh.open_shortages, 0)::int AS open_shortages,
  (rs.part_id IS NOT NULL) AS has_suggestion,
  CASE WHEN p.sku IS NULL THEN 'P-' || p.part_id ELSE p.sku END AS label_code`;

const PART_JOINS = `
  LEFT JOIN part_stock ps ON ps.part_id = p.part_id
  LEFT JOIN (SELECT part_id, COUNT(*) AS open_shortages FROM shortages
             WHERE closed_at IS NULL AND part_id IS NOT NULL GROUP BY part_id) sh ON sh.part_id = p.part_id
  LEFT JOIN reorder_suggestions rs ON rs.part_id = p.part_id`;

// kind: location (U-ddd) · work_order (R + 9 dígitos [+ -N]) · part (P-<id> o sku; puede traer
// varias piezas si el sku es compartido) · unknown. Siempre 200.

async function scan(raw: string) {
  const code = normSku(raw) ?? '';

  if (/^U-\d{3}$/.test(code)) {
    const { rows } = await pool.query(
      `SELECT location_id, code, name, is_workbench, active FROM locations
       WHERE code = $1 ORDER BY active DESC, location_id DESC LIMIT 1`,
      [code],
    );
    if (rows[0]) return { code: raw, kind: 'location', location: rows[0] };
  }

  if (/^R\d{9}(-\d+)?$/.test(code)) {
    const { rows } = await pool.query(
      `SELECT work_order_id, code, (deleted_at IS NOT NULL) AS deleted FROM work_orders
       WHERE code = $1 ORDER BY deleted_at NULLS FIRST, work_order_id DESC LIMIT 1`,
      [code],
    );
    if (rows[0]) return { code: raw, kind: 'work_order', work_order: rows[0] };
  }

  let ids: number[] = [];
  const pid = /^P-(\d+)$/.exec(code);
  if (pid) {
    const { rows } = await pool.query(`SELECT part_id FROM parts WHERE part_id = $1`, [Number(pid[1])]);
    ids = rows.map((r: any) => r.part_id);
  }
  if (!ids.length && code) {
    let { rows } = await pool.query(`SELECT part_id FROM parts WHERE sku_norm = $1 ORDER BY active DESC, part_id`, [code]);
    if (!rows.length) {
      const compact = compactSku(raw);
      if (compact) ({ rows } = await pool.query(`SELECT part_id FROM parts WHERE sku_compact = $1 ORDER BY active DESC, part_id`, [compact]));
    }
    ids = rows.map((r: any) => r.part_id);
  }
  if (ids.length) {
    const { rows } = await pool.query(
      `SELECT ${PART_ROW} FROM parts p ${PART_JOINS} WHERE p.part_id = ANY($1::int[]) ORDER BY p.active DESC, p.part_id`,
      [ids],
    );
    return { code: raw, kind: 'part', parts: rows };
  }
  return { code: raw, kind: 'unknown' };
}

floorRoutes.get('/scan', async (req: any, res: any) => {
  res.json(await scan(String(req.query.code ?? '')));
});

floorRoutes.get('/scan/*code', async (req: any, res: any) => {
  const segments = req.params.code;
  res.json(await scan(Array.isArray(segments) ? segments.join('/') : String(segments)));
});

floorRoutes.get('/locations', async (req: any, res: any) => {
  const params: unknown[] = [];
  let where = 'TRUE';
  if (req.query.workbench === 'true' || req.query.workbench === 'false') {
    params.push(req.query.workbench === 'true');
    where = `l.is_workbench = $1`;
  }
  const { rows } = await pool.query(
    `SELECT l.location_id, l.code, l.name, l.is_workbench, l.active,
            COUNT(ls.part_id) FILTER (WHERE ls.on_hand > 0)::int AS parts,
            COALESCE(SUM(ls.on_hand) FILTER (WHERE ls.on_hand > 0), 0)::int AS units
     FROM locations l LEFT JOIN location_stock ls ON ls.location_id = l.location_id
     WHERE ${where}
     GROUP BY l.location_id ORDER BY l.code, l.location_id`,
    params,
  );
  res.json({ items: rows });
});

floorRoutes.get('/locations/:id/stock', async (req: any, res: any) => {
  const id = intParam(req.params.id);
  const loc = id == null ? null : (await pool.query(`SELECT * FROM locations WHERE location_id = $1`, [id])).rows[0];
  if (!loc) throw notFound(`La ubicación ${req.params.id} no existe`);
  const { rows } = await pool.query(
    `SELECT ls.part_id, p.sku, p.name, ls.on_hand,
            COALESCE(p.family = 'SERVICIO', false) AS is_service,
            COALESCE(ps.on_hand, 0) AS part_on_hand, COALESCE(ps.reserved, 0) AS part_reserved,
            COALESCE(ps.on_hand, 0) - COALESCE(ps.reserved, 0) AS part_available
     FROM location_stock ls
     LEFT JOIN parts p ON p.part_id = ls.part_id
     LEFT JOIN part_stock ps ON ps.part_id = ls.part_id
     WHERE ls.location_id = $1 AND ls.on_hand > 0
     ORDER BY p.name, ls.part_id`,
    [id],
  );
  res.json({ location_id: loc.location_id, code: loc.code, name: loc.name, is_workbench: loc.is_workbench, items: rows });
});

floorRoutes.get('/parts', async (req: any, res: any) => {
  const search = String(req.query.search ?? '').trim();
  const limit = Math.min(Number(req.query.limit) || 50, 1000);
  const params: unknown[] = [limit];
  const where: string[] = [];
  if (search) {
    params.push(`%${search.toUpperCase()}%`, compactSku(search) ?? '');
    where.push(`(p.sku_norm LIKE $2 OR upper(p.name) LIKE $2
                 OR ($3 <> '' AND p.sku_compact LIKE '%' || $3 || '%') OR p.part_id::text = $3)`);
  }
  if (req.query.with_stock === 'true') where.push(`(COALESCE(ps.on_hand, 0) > 0 OR COALESCE(sh.open_shortages, 0) > 0)`);
  const { rows } = await pool.query(
    `SELECT ${PART_ROW} FROM parts p ${PART_JOINS}
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY p.active DESC, p.name, p.part_id LIMIT $1`,
    params,
  );
  res.json({ items: rows });
});

floorRoutes.get('/parts/:part_id', async (req: any, res: any) => {
  const id = intParam(req.params.part_id);
  const { rows } = id == null
    ? { rows: [] as any[] }
    : await pool.query(`SELECT ${PART_ROW} FROM parts p ${PART_JOINS} WHERE p.part_id = $1`, [id]);
  if (!rows[0]) throw notFound(`La pieza ${req.params.part_id} no existe`);
  res.json(rows[0]);
});

floorRoutes.get('/parts/:part_id/reservations', async (req: any, res: any) => {
  const id = intParam(req.params.part_id);
  const exists = id != null && (await pool.query(`SELECT 1 FROM parts WHERE part_id = $1`, [id])).rowCount;
  if (!exists) throw notFound(`La pieza ${req.params.part_id} no existe`);
  const { rows } = await pool.query(
    `SELECT r.reservation_id, r.work_order_id, w.code AS work_order_code, r.bom_line_id,
            r.quantity, r.issued, r.created_at, r.inspection_item_id, w.stage
     FROM reservations r JOIN work_orders w ON w.work_order_id = r.work_order_id
     WHERE r.part_id = $1 AND r.status = 'active' AND r.quantity > 0
     ORDER BY r.created_at, r.reservation_id`,
    [id],
  );
  res.json({ items: rows });
});

floorRoutes.get('/work-orders', async (req: any, res: any) => {
  const where = req.query.status === 'all' ? 'TRUE' : `w.deleted_at IS NULL AND COALESCE(w.stage, '') <> 'final_release'`;
  const { rows } = await pool.query(
    `SELECT w.work_order_id, w.code, w.model_id, m.model_name, m.brand, w.department, w.stage,
            w.received_at, (w.deleted_at IS NOT NULL) AS deleted,
            COALESCE(x.lines_total, 0)::int AS lines_total,
            COALESCE(x.lines_complete, 0)::int AS lines_complete,
            COALESCE(x.missing_total, 0)::int AS missing_total,
            COALESCE(x.unidentified, 0)::int AS unidentified,
            COALESCE(x.open_shortages, 0)::int AS open_shortages,
            (COALESCE(x.lines_total, 0) > 0 AND x.lines_total = x.lines_complete) AS kit_complete
     FROM work_orders w
     LEFT JOIN bom_models m ON m.model_id = w.model_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS lines_total,
              COUNT(*) FILTER (WHERE n.part_id IS NOT NULL AND n.required IS NOT NULL AND s.shortage_id IS NULL
                               AND COALESCE(r.reserved, 0) + COALESCE(r.issued, 0) >= n.required) AS lines_complete,
              SUM(s.missing_quantity) AS missing_total,
              COUNT(*) FILTER (WHERE n.part_id IS NULL) AS unidentified,
              COUNT(s.shortage_id) AS open_shortages
       FROM needs n
       LEFT JOIN LATERAL (
         SELECT SUM(quantity) FILTER (WHERE status = 'active') AS reserved, SUM(issued) AS issued
         FROM reservations WHERE work_order_id = n.work_order_id AND bom_line_id = n.bom_line_id
       ) r ON true
       LEFT JOIN shortages s ON s.work_order_id = n.work_order_id AND s.bom_line_id = n.bom_line_id AND s.closed_at IS NULL
       WHERE n.work_order_id = w.work_order_id
     ) x ON true
     WHERE ${where}
     ORDER BY w.received_at DESC, w.work_order_id DESC`,
  );
  res.json({ items: rows });
});
