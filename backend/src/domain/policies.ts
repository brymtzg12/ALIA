import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db.ts';

// Políticas de mínimo y máximo por pieza (extra, regla 18: "o bajo su mínimo, si configuran
// políticas"). Se guardan en la base y también en backend/data/policies.json, para que
// sobrevivan a una reconstrucción (no vienen en los tópicos del taller) y queden en el repo.

export type Policy = { part_id: number; min_qty: number; max_qty: number; lead_time_days: number | null };

const FILE = path.resolve(import.meta.dirname, '..', '..', 'data', 'policies.json');

function readFile(): Policy[] {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeFile(policies: Policy[]) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const sorted = [...policies].sort((a, b) => a.part_id - b.part_id);
  fs.writeFileSync(FILE, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}

/** Carga el archivo a la base (al migrar o reconstruir). */
export async function loadPoliciesFromFile(db: { query: Db['query'] }) {
  for (const p of readFile()) {
    await db.query(
      `INSERT INTO policies (part_id, min_qty, max_qty, lead_time_days) VALUES ($1, $2, $3, $4)
       ON CONFLICT (part_id) DO UPDATE SET min_qty = EXCLUDED.min_qty, max_qty = EXCLUDED.max_qty,
         lead_time_days = EXCLUDED.lead_time_days`,
      [p.part_id, p.min_qty, p.max_qty, p.lead_time_days ?? null],
    );
  }
}

export async function getPolicy(db: Db, partId: number): Promise<Policy | null> {
  const { rows } = await db.query(
    `SELECT part_id, min_qty, max_qty, lead_time_days FROM policies WHERE part_id = $1 AND min_qty IS NOT NULL AND max_qty IS NOT NULL`,
    [partId],
  );
  return rows[0] ?? null;
}

export async function savePolicy(db: Db, p: Policy) {
  await db.query(
    `INSERT INTO policies (part_id, min_qty, max_qty, lead_time_days) VALUES ($1, $2, $3, $4)
     ON CONFLICT (part_id) DO UPDATE SET min_qty = EXCLUDED.min_qty, max_qty = EXCLUDED.max_qty,
       lead_time_days = EXCLUDED.lead_time_days`,
    [p.part_id, p.min_qty, p.max_qty, p.lead_time_days],
  );
  writeFile([...readFile().filter((x) => x.part_id !== p.part_id), p]);
}

export async function deletePolicy(db: Db, partId: number): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM policies WHERE part_id = $1`, [partId]);
  writeFile(readFile().filter((x) => x.part_id !== partId));
  return (rowCount ?? 0) > 0;
}

/**
 * Mínimo y máximo recomendados con el uso histórico: lo que pidieron las inspecciones aprobadas
 * (la mayor cantidad por orden y línea) entre el periodo de las órdenes. Mínimo = consumo diario ×
 * días de entrega; máximo = consumo de (días de entrega + 14 días de revisión).
 */
export async function recommendedPolicies(db: { query: Db['query'] }, leadDays: number) {
  const { rows } = await db.query(
    `WITH span AS (
       SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (max(received_at) - min(received_at))) / 86400))::int AS days
       FROM work_orders
     ),
     asks AS (
       SELECT i.work_order_id, (it->>'bom_line_id')::int AS bom_line_id,
              COALESCE((it->>'part_id')::int, b.part_id) AS part_id,
              MAX(COALESCE((it->>'quantity')::int, b.qty_per_unit)) AS qty
       FROM inspections i
       CROSS JOIN LATERAL jsonb_array_elements(i.items) it
       LEFT JOIN bom_lines b ON b.bom_line_id = (it->>'bom_line_id')::int
       WHERE i.status IN ('approved', 'voided') AND it->>'action' = 'buy'
       GROUP BY i.work_order_id, (it->>'bom_line_id')::int, COALESCE((it->>'part_id')::int, b.part_id)
     )
     SELECT a.part_id, p.sku, p.name, SUM(a.qty)::int AS demand, COUNT(DISTINCT a.work_order_id)::int AS orders,
            (SELECT days FROM span) AS days,
            COALESCE(ps.on_hand, 0) - COALESCE(ps.reserved, 0) AS available
     FROM asks a JOIN parts p ON p.part_id = a.part_id
     LEFT JOIN part_stock ps ON ps.part_id = a.part_id
     WHERE a.part_id IS NOT NULL AND a.qty IS NOT NULL
     GROUP BY a.part_id, p.sku, p.name, ps.on_hand, ps.reserved
     ORDER BY SUM(a.qty) DESC, a.part_id`,
  );
  return rows.map((r: any) => {
    const perDay = r.demand / r.days;
    const min = Math.max(1, Math.ceil(perDay * leadDays));
    const max = Math.max(min + 1, Math.ceil(perDay * (leadDays + 14)));
    return {
      part_id: r.part_id,
      sku: r.sku,
      name: r.name,
      demand: r.demand,
      orders: r.orders,
      days: r.days,
      per_day: Math.round(perDay * 100) / 100,
      lead_time_days: leadDays,
      min_qty: min,
      max_qty: max,
      available: r.available,
      explanation:
        `Se pidieron ${r.demand} en ${r.days} días (${(Math.round(perDay * 100) / 100).toString()} por día, ` +
        `${r.orders} órdenes); con ${leadDays} días de entrega: mínimo ${min} y máximo ${max}`,
    };
  });
}
