import { Router } from 'express';
import { config } from '../config.ts';
import { pool } from '../db.ts';
import { notFound } from './errors.ts';
import { intParam } from './validate.ts';

export const analyticsRoutes = Router();

analyticsRoutes.get('/valuation', async (_req: any, res: any) => {
  const rate = config.usdMxn;
  const { rows } = await pool.query(
    `SELECT p.part_id, p.sku, p.name, (p.family = 'SERVICIO') AS is_service,
            COALESCE(ps.on_hand, 0) AS on_hand,
            SUM(m.quantity)::int AS received_quantity,
            COUNT(*)::int AS receipts,
            SUM(m.quantity * (m.unit_cost::numeric * CASE WHEN m.currency = 'USD' THEN $1::numeric ELSE 1 END))
              / NULLIF(SUM(m.quantity), 0) AS average_cost_mxn,
            COUNT(*) FILTER (WHERE m.currency = 'USD')::int AS receipts_usd
     FROM movements m
     JOIN parts p ON p.part_id = m.part_id
     LEFT JOIN part_stock ps ON ps.part_id = m.part_id
     WHERE m.type = 'receipt' AND m.unit_cost IS NOT NULL
     GROUP BY p.part_id, ps.on_hand
     ORDER BY p.part_id`,
    [rate],
  );
  let total = 0;
  const items = rows.map((r: any) => {
    const avg = Number(r.average_cost_mxn ?? 0);
    const value = avg * r.on_hand;
    total += value;
    return {
      ...r,
      avg_cost: avg.toFixed(2),
      value: value.toFixed(2),
      average_cost_mxn: avg.toFixed(2),
      inventory_value_mxn: value.toFixed(2),
    };
  });
  items.sort((a: any, b: any) => Number(b.value) - Number(a.value));
  res.json({
    currency: 'MXN',
    fx_usd_mxn: rate.toFixed(4),
    total_value: total.toFixed(2),
    method: 'costo promedio ponderado de todas las recepciones',
    usd_mxn_rate: rate.toFixed(4),
    total_value_mxn: total.toFixed(2),
    items,
  });
});

type LineForecast = {
  bom_line_id: number;
  part_id: number | null;
  name: string;
  group_name: string | null;
  qty_per_unit: number | null;
  orders_requested: number;
  orders_with_approval: number;
  probability: number;
  average_quantity: number | null;
  avg_quantity: number | null;
  expected_quantity: number;
  explanation: string;
};

async function modelForecast(modelId: number): Promise<{ model: any; inspections: number; lines: LineForecast[] } | null> {
  const model = (await pool.query(`SELECT model_id, model_name, brand FROM bom_models WHERE model_id = $1`, [modelId])).rows[0];
  if (!model) return null;

  const { rows: lines } = await pool.query(
    `SELECT bom_line_id, part_id, name, group_name, qty_per_unit FROM bom_lines WHERE model_id = $1 ORDER BY sort_order, bom_line_id`,
    [modelId],
  );
  const { rows: asks } = await pool.query(
    `WITH approved AS (
       SELECT i.work_order_id, i.items FROM inspections i
       JOIN work_orders w ON w.work_order_id = i.work_order_id
       WHERE w.model_id = $1 AND i.status IN ('approved', 'voided') AND i.items IS NOT NULL
     )
     SELECT (SELECT COUNT(DISTINCT work_order_id) FROM approved)::int AS orders,
            x.bom_line_id, COUNT(DISTINCT x.work_order_id)::int AS requested, AVG(x.qty)::float AS avg_qty
     FROM (
       SELECT a.work_order_id, (it->>'bom_line_id')::int AS bom_line_id,
              MAX(COALESCE((it->>'quantity')::int, b.qty_per_unit)) AS qty
       FROM approved a
       CROSS JOIN LATERAL jsonb_array_elements(a.items) it
       LEFT JOIN bom_lines b ON b.bom_line_id = (it->>'bom_line_id')::int
       WHERE it->>'action' = 'buy'
       GROUP BY a.work_order_id, (it->>'bom_line_id')::int
     ) x
     GROUP BY x.bom_line_id`,
    [modelId],
  );
  const ordersRow = await pool.query(
    `SELECT COUNT(DISTINCT i.work_order_id)::int AS n FROM inspections i
     JOIN work_orders w ON w.work_order_id = i.work_order_id
     WHERE w.model_id = $1 AND i.status IN ('approved', 'voided')`,
    [modelId],
  );
  const orders = ordersRow.rows[0].n;
  const byLine = new Map(asks.map((a: any) => [a.bom_line_id, a]));

  const result: LineForecast[] = lines.map((l: any) => {
    const a: any = byLine.get(l.bom_line_id);
    const requested = a?.requested ?? 0;
    const probability = orders ? requested / orders : 0;
    const avg = a?.avg_qty != null ? Math.round(a.avg_qty * 100) / 100 : null;
    return {
      ...l,
      orders_requested: requested,
      orders_with_approval: orders,
      probability: Math.round(probability * 1000) / 1000,
      average_quantity: avg,
      avg_quantity: avg,
      expected_quantity: Math.round(probability * (avg ?? l.qty_per_unit ?? 1) * 100) / 100,
      explanation: orders
        ? `Se pidió comprar en ${requested} de ${orders} órdenes del modelo ${model.model_name}` +
          (avg != null ? `, ${avg} en promedio` : '')
        : `Aún no hay órdenes del modelo ${model.model_name} con inspección aprobada`,
    };
  });
  result.sort((a, b) => b.probability - a.probability || a.bom_line_id - b.bom_line_id);
  const insp = await pool.query(
    `SELECT COUNT(*)::int AS n FROM inspections i JOIN work_orders w ON w.work_order_id = i.work_order_id
     WHERE w.model_id = $1 AND i.status IN ('approved', 'voided')`,
    [modelId],
  );
  return { model, inspections: insp.rows[0].n, lines: result };
}

analyticsRoutes.get('/forecast/models/:model_id', async (req: any, res: any) => {
  const id = intParam(req.params.model_id);
  const f = id == null ? null : await modelForecast(id);
  if (!f) throw notFound(`El modelo ${req.params.model_id} no existe`);
  res.json({
    ...f.model,
    inspections: f.inspections,
    orders_with_approval: f.lines[0]?.orders_with_approval ?? 0,
    lines: f.lines,
  });
});

analyticsRoutes.get('/forecast/models', async (_req: any, res: any) => {
  const { rows } = await pool.query(
    `SELECT m.model_id, m.model_name, m.brand,
            (SELECT COUNT(*) FROM bom_lines b WHERE b.model_id = m.model_id)::int AS lines,
            (SELECT COUNT(*) FROM work_orders w WHERE w.model_id = m.model_id)::int AS work_orders
     FROM bom_models m ORDER BY m.model_name`,
  );
  res.json({ items: rows });
});

analyticsRoutes.get('/forecast/open-orders', async (_req: any, res: any) => {
  const { rows: open } = await pool.query(
    `SELECT w.work_order_id, w.code, w.model_id FROM work_orders w
     WHERE w.deleted_at IS NULL AND COALESCE(w.stage, '') <> 'final_release'
       AND NOT EXISTS (SELECT 1 FROM inspections i WHERE i.work_order_id = w.work_order_id AND i.status = 'approved')
     ORDER BY w.received_at`,
  );
  const forecasts = new Map<number, LineForecast[]>();
  const demand = new Map<number, { part_id: number; name: string; expected: number; orders: Set<string>; reasons: Set<string> }>();
  for (const wo of open) {
    if (!forecasts.has(wo.model_id)) forecasts.set(wo.model_id, (await modelForecast(wo.model_id))?.lines ?? []);
    for (const l of forecasts.get(wo.model_id)!) {
      if (l.part_id == null || l.expected_quantity <= 0) continue;
      const d = demand.get(l.part_id) ?? { part_id: l.part_id, name: l.name, expected: 0, orders: new Set(), reasons: new Set() };
      d.expected += l.expected_quantity;
      d.orders.add(wo.code);
      d.reasons.add(l.explanation);
      demand.set(l.part_id, d);
    }
  }
  const partIds = [...demand.keys()];
  const stock = partIds.length
    ? (await pool.query(
        `SELECT p.part_id, p.sku, COALESCE(ps.on_hand, 0) - COALESCE(ps.reserved, 0) AS available
         FROM parts p LEFT JOIN part_stock ps ON ps.part_id = p.part_id WHERE p.part_id = ANY($1::int[])`,
        [partIds],
      )).rows
    : [];
  const avail = new Map(stock.map((s: any) => [s.part_id, s]));
  const items = [...demand.values()].map((d) => {
    const expected = Math.ceil(d.expected - 1e-9);
    const s: any = avail.get(d.part_id);
    const available = s?.available ?? 0;
    return {
      part_id: d.part_id,
      sku: s?.sku ?? null,
      name: d.name,
      expected_quantity: expected,
      expected_demand: expected,
      expected_demand_exact: Math.round(d.expected * 100) / 100,
      available,
      gap: Math.max(0, expected - available),
      work_order_codes: [...d.orders],
      explanation: `${d.orders.size} órdenes abiertas sin inspección aprobada probablemente pidan ${expected}; hay ${available} disponibles`,
      basis: [...d.reasons],
    };
  });
  items.sort((a, b) => b.gap - a.gap || b.expected_demand - a.expected_demand);
  res.json({ open_orders: open.length, items });
});

// Piezas críticas (más salidas y faltantes) y piezas sin movimiento en N días. La fecha de
// referencia es el movimiento más reciente registrado (el dataset es histórico).
analyticsRoutes.get('/rotation', async (req: any, res: any) => {
  const days = Math.max(1, Math.min(Number(req.query.days) || 30, 3650));
  const ref = (await pool.query(`SELECT COALESCE(max(occurred_at), now()) AS t FROM movements`)).rows[0].t;
  const { rows } = await pool.query(
    `SELECT p.part_id, p.sku, p.name, (p.family = 'SERVICIO') AS is_service,
            COALESCE(ps.on_hand, 0) AS on_hand, COALESCE(ps.reserved, 0) AS reserved,
            COALESCE(mv.issued_qty, 0)::int AS issued_quantity, COALESCE(mv.issues, 0)::int AS issues,
            COALESCE(mv.received_qty, 0)::int AS received_quantity,
            COALESCE(sh.shortages, 0)::int AS shortages, COALESCE(sh.open_shortages, 0)::int AS open_shortages,
            mv.last_movement_at
     FROM parts p
     LEFT JOIN part_stock ps ON ps.part_id = p.part_id
     LEFT JOIN (
       SELECT part_id, SUM(-quantity) FILTER (WHERE type = 'issue') AS issued_qty,
              COUNT(*) FILTER (WHERE type = 'issue') AS issues,
              SUM(quantity) FILTER (WHERE type = 'receipt') AS received_qty,
              max(occurred_at) AS last_movement_at
       FROM movements GROUP BY part_id
     ) mv ON mv.part_id = p.part_id
     LEFT JOIN (
       SELECT part_id, COUNT(*) AS shortages, COUNT(*) FILTER (WHERE closed_at IS NULL) AS open_shortages
       FROM shortages WHERE part_id IS NOT NULL GROUP BY part_id
     ) sh ON sh.part_id = p.part_id`,
  );
  const refMs = new Date(ref).getTime();
  const critical = rows
    .filter((r: any) => r.issues + r.shortages > 0)
    .map((r: any) => ({ ...r, score: r.issued_quantity + 2 * r.shortages + 3 * r.open_shortages }))
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 25);
  const stale = rows
    .filter((r: any) => r.on_hand > 0 && (!r.last_movement_at || refMs - new Date(r.last_movement_at).getTime() > days * 86400000))
    .map((r: any) => ({
      ...r,
      days_idle: r.last_movement_at ? Math.floor((refMs - new Date(r.last_movement_at).getTime()) / 86400000) : null,
    }))
    .sort((a: any, b: any) => (b.days_idle ?? 1e9) - (a.days_idle ?? 1e9));
  res.json({ reference_date: ref, days, critical, idle: stale });
});
