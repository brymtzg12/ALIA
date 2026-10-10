import { config } from '../config.ts';
import type { Db } from '../db.ts';
import { emit } from '../events/outbox.ts';
import { lockPart, recordMovement, type Movement } from './ledger.ts';
import { compactSku, normSku } from './sku.ts';
import { fillShortagesFromReceipt } from './fulfillment.ts';

// Recepciones de compra: relación con el catálogo y entrada al almacén.

export type MatchResult = { partId: number } | { partId: null; candidates: number[] };

/**
 * Relaciona un número de parte con el sku del catálogo:
 *  1. exacto normalizado (mayúsculas, sin espacios en los extremos);
 *  2. si no hubo ninguno, compacto (sin espacios, guiones, puntos, comas ni diagonales).
 * Solo se relaciona si da exactamente una pieza. Se busca en todo el catálogo (activas o no),
 * para que el resultado no cambie si una pieza se da de baja después de comprarse.
 */
export async function matchPartNumber(db: Db, partNumber: string): Promise<MatchResult> {
  const norm = normSku(partNumber);
  if (!norm) return { partId: null, candidates: [] };

  const exact = await db.query(`SELECT part_id FROM parts WHERE sku_norm = $1 ORDER BY part_id`, [norm]);
  if (exact.rows.length === 1) return { partId: exact.rows[0].part_id };
  if (exact.rows.length > 1) return { partId: null, candidates: exact.rows.map((r: any) => r.part_id) };

  const compact = compactSku(partNumber);
  if (compact) {
    const c = await db.query(`SELECT part_id FROM parts WHERE sku_compact = $1 ORDER BY part_id`, [compact]);
    if (c.rows.length === 1) return { partId: c.rows[0].part_id };
    if (c.rows.length > 1) return { partId: null, candidates: c.rows.map((r: any) => r.part_id) };
  }
  return { partId: null, candidates: [] };
}

export type ReceiptInput = {
  partId: number;
  locationId?: number;
  quantity: number;
  unitPrice: string;
  currency: string;
  purchaseLineId: number;
  receivedAt: string;
  workOrderCode: string | null;
  origin: 'event' | 'api';
  commandId?: string | null;
  extra?: Record<string, unknown>;
};

/**
 * Registra la entrada (por defecto en U-100), emite stock.received y surte faltantes de la
 * pieza. Devuelve null si esa línea de compra ya había entrado.
 */
export async function registerReceipt(db: Db, r: ReceiptInput): Promise<Movement | null> {
  const locationId = r.locationId ?? config.receivingLocationId;
  await lockPart(db, r.partId);
  const movement = await recordMovement(db, {
    type: 'receipt',
    partId: r.partId,
    locationId,
    quantity: r.quantity,
    occurredAt: r.receivedAt,
    reference: `purchase_line:${r.purchaseLineId}`,
    unitCost: r.unitPrice,
    currency: r.currency,
    purchaseLineId: r.purchaseLineId,
    origin: r.origin,
    commandId: r.commandId ?? null,
  });
  if (!movement) return null;

  await emit(db, 'stock.received', `part:${r.partId}`, {
    part_id: r.partId,
    location_id: locationId,
    quantity: r.quantity,
    unit_cost: r.unitPrice,
    currency: r.currency,
    purchase_line_id: r.purchaseLineId,
    // Extras (permitidos por el contrato):
    movement_id: movement.movement_id,
    received_at: movement.occurred_at,
    work_order_code: r.workOrderCode,
    origin: r.origin,
    ...(r.commandId ? { command_id: r.commandId } : {}),
    ...r.extra,
  });

  await fillShortagesFromReceipt(db, r.partId, r.quantity, r.workOrderCode);
  return movement;
}
