import { Router } from 'express';
import { pool, withTx } from '../db.ts';
import { count, issue, resolveUnmatched, transfer } from '../domain/operations.ts';
import { suggestCandidates } from '../domain/candidates.ts';
import { notFound } from './errors.ts';
import { intParam, validateBody } from './validate.ts';

// Rutas del contrato del libro mayor: saldos, kardex, salidas, transferencias, conteos y
// recepciones sin relacionar.

export const ledgerRoutes = Router();

async function requirePartId(raw: string): Promise<number> {
  const partId = intParam(raw);
  if (partId == null) throw notFound(`La pieza ${raw} no existe`);
  const { rowCount } = await pool.query(`SELECT 1 FROM parts WHERE part_id = $1`, [partId]);
  if (!rowCount) throw notFound(`La pieza ${partId} no existe`);
  return partId;
}

// GET /parts/{part_id}/availability
ledgerRoutes.get('/parts/:part_id/availability', async (req: any, res: any) => {
  const partId = await requirePartId(req.params.part_id);
  const totals = await pool.query(`SELECT on_hand, reserved FROM part_stock WHERE part_id = $1`, [partId]);
  const onHand = totals.rows[0]?.on_hand ?? 0;
  const reserved = totals.rows[0]?.reserved ?? 0;
  // La reserva es a nivel pieza: por ubicación se reporta reserved 0.
  const locs = await pool.query(
    `SELECT ls.location_id, l.code, ls.on_hand
     FROM location_stock ls LEFT JOIN locations l ON l.location_id = ls.location_id
     WHERE ls.part_id = $1 AND ls.on_hand <> 0
     ORDER BY ls.location_id`,
    [partId],
  );
  res.json({
    part_id: partId,
    on_hand: onHand,
    reserved,
    available: onHand - reserved,
    locations: locs.rows.map((l: any) => ({
      location_id: l.location_id,
      code: l.code,
      on_hand: l.on_hand,
      reserved: 0,
      available: l.on_hand,
    })),
  });
});

// GET /parts/{part_id}/ledger — del más reciente al más antiguo, con saldo total corrido.
ledgerRoutes.get('/parts/:part_id/ledger', async (req: any, res: any) => {
  const partId = await requirePartId(req.params.part_id);
  const { rows } = await pool.query(
    `SELECT movement_id, type, part_id, location_id, quantity, occurred_at, reference,
            work_order_id, unit_cost, currency, purchase_line_id, origin,
            SUM(quantity) OVER (ORDER BY occurred_at, movement_id)::int AS balance
     FROM movements WHERE part_id = $1
     ORDER BY occurred_at DESC, movement_id DESC`,
    [partId],
  );
  res.json({ part_id: partId, entries: rows });
});

// POST /issues
ledgerRoutes.post('/issues', async (req: any, res: any) => {
  const body = validateBody('issue', req.body);
  const movement = await withTx((db) => issue(db, body));
  res.status(201).json(movement);
});

// POST /transfers
ledgerRoutes.post('/transfers', async (req: any, res: any) => {
  const body = validateBody('transfer', req.body);
  const movement = await withTx((db) => transfer(db, body));
  res.status(201).json(movement);
});

// POST /counts
ledgerRoutes.post('/counts', async (req: any, res: any) => {
  const body = validateBody('count', req.body);
  const adjustments = await withTx((db) => count(db, body));
  res.status(201).json({ adjustments });
});

// GET /unmatched-receipts — pendientes de revisión manual.
ledgerRoutes.get('/unmatched-receipts', async (_req: any, res: any) => {
  const { rows } = await pool.query(
    `SELECT id, purchase_line_id, part_number, description, quantity, unit_price, currency, received_at,
            work_order_code, request_number, match_count
     FROM unmatched_receipts WHERE resolved_at IS NULL ORDER BY received_at, id`,
  );
  // Extra: candidatos sugeridos (part_id, sku, name, score de 0 a 1), del mejor al peor.
  const parts = (await pool.query(`SELECT part_id, sku, name FROM parts WHERE active`)).rows;
  res.json({ items: rows.map((r: any) => ({ ...r, candidates: suggestCandidates(r, parts) })) });
});

// POST /unmatched-receipts/{id}/resolve
ledgerRoutes.post('/unmatched-receipts/:id/resolve', async (req: any, res: any) => {
  const id = intParam(req.params.id);
  if (id == null) throw notFound(`La recepción sin relacionar ${req.params.id} no existe`);
  const body = validateBody('resolve', req.body);
  const movement = await withTx((db) => resolveUnmatched(db, id, body));
  res.status(200).json(movement);
});
