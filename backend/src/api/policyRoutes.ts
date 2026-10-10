import { Router } from 'express';
import { pool, withTx } from '../db.ts';
import { lockPart } from '../domain/ledger.ts';
import { deletePolicy, recommendedPolicies, savePolicy } from '../domain/policies.ts';
import { recomputeSuggestion } from '../domain/suggestions.ts';
import { notFound, unprocessable } from './errors.ts';
import { intParam, validateBody } from './validate.ts';

export const policyRoutes = Router();

policyRoutes.get('/policies', async (_req: any, res: any) => {
  const { rows } = await pool.query(
    `SELECT pol.part_id, p.sku, p.name, pol.min_qty, pol.max_qty, pol.lead_time_days,
            COALESCE(ps.on_hand, 0) AS on_hand, COALESCE(ps.reserved, 0) AS reserved,
            COALESCE(ps.on_hand, 0) - COALESCE(ps.reserved, 0) AS available,
            (COALESCE(ps.on_hand, 0) - COALESCE(ps.reserved, 0) < pol.min_qty) AS below_min,
            rs.suggested_quantity, rs.reason AS suggestion_reason
     FROM policies pol
     JOIN parts p ON p.part_id = pol.part_id
     LEFT JOIN part_stock ps ON ps.part_id = pol.part_id
     LEFT JOIN reorder_suggestions rs ON rs.part_id = pol.part_id
     WHERE pol.min_qty IS NOT NULL AND pol.max_qty IS NOT NULL
     ORDER BY below_min DESC, p.name`,
  );
  res.json({ items: rows });
});

policyRoutes.get('/policies/recommended', async (req: any, res: any) => {
  const lead = Math.max(1, Math.min(Number(req.query.lead_time_days) || 7, 180));
  res.json({ lead_time_days: lead, items: await recommendedPolicies(pool, lead) });
});

policyRoutes.put('/policies/:part_id', async (req: any, res: any) => {
  const partId = intParam(req.params.part_id);
  const exists = partId != null && (await pool.query(`SELECT 1 FROM parts WHERE part_id = $1`, [partId])).rowCount;
  if (!exists) throw notFound(`La pieza ${req.params.part_id} no existe`);
  const body = validateBody('policy', req.body);
  if (body.max_qty < body.min_qty) throw unprocessable('El máximo no puede ser menor que el mínimo');

  const policy = { part_id: partId!, min_qty: body.min_qty, max_qty: body.max_qty, lead_time_days: body.lead_time_days ?? null };
  await withTx(async (db) => {
    await lockPart(db, partId!);
    await savePolicy(db, policy);
    await recomputeSuggestion(db, partId!);
  });
  const suggestion = (await pool.query(`SELECT suggested_quantity, reason FROM reorder_suggestions WHERE part_id = $1`, [partId])).rows[0] ?? null;
  res.json({ ...policy, suggestion });
});

policyRoutes.delete('/policies/:part_id', async (req: any, res: any) => {
  const partId = intParam(req.params.part_id);
  if (partId == null) throw notFound(`La pieza ${req.params.part_id} no existe`);
  const removed = await withTx(async (db) => {
    await lockPart(db, partId);
    const ok = await deletePolicy(db, partId);
    await recomputeSuggestion(db, partId);
    return ok;
  });
  if (!removed) throw notFound(`La pieza ${partId} no tiene política`);
  res.json({ part_id: partId, deleted: true });
});
