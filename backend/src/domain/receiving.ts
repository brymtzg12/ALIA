import { config } from '../config.ts';
import type { Db } from '../db.ts';
import { emit } from '../events/outbox.ts';
import { lockPart, recordMovement, type Movement } from './ledger.ts';
import { compactSku, normSku } from './sku.ts';
import { fillShortagesFromReceipt } from './fulfillment.ts';

// Recepciones de compra: relación con el catálogo y entrada al almacén.

export type MatchResult = { partId: number; rule: string } | { partId: null; candidates: number[] };

// Prefijos que el taller antepone al número de parte: "NP: ", "N/P ", "P/N:", "PN-"...
const PART_NUMBER_PREFIX = /^\s*(?:N\/?P|P\/?N)\s*[:#.\-]?\s+|^\s*(?:N\/?P|P\/?N)\s*[:#.\-]\s*/i;
// "S/N ..." = sin número de parte: solo sirve la descripción.
const NO_PART_NUMBER = /^\s*S\/N/i;

/** Texto normalizado para comparar nombres y descripciones: mayúsculas, espacios simples. */
function normText(value: string | null | undefined): string | null {
  const n = normSku(value)?.replace(/\s+/g, ' ');
  return n || null;
}

async function bySku(db: Db, value: string): Promise<number[]> {
  const norm = normSku(value);
  if (!norm) return [];
  const exact = await db.query(`SELECT part_id FROM parts WHERE sku_norm = $1 ORDER BY part_id`, [norm]);
  if (exact.rows.length) return exact.rows.map((r: any) => r.part_id);
  const compact = compactSku(value);
  if (!compact) return [];
  const c = await db.query(`SELECT part_id FROM parts WHERE sku_compact = $1 ORDER BY part_id`, [compact]);
  return c.rows.map((r: any) => r.part_id);
}

/** De varias piezas, la única cuyo nombre es igual a la descripción (o null si no hay una sola). */
async function pickByName(db: Db, partIds: number[], description: string): Promise<number | null> {
  const desc = normText(description);
  if (!desc) return null;
  const { rows } = await db.query(`SELECT part_id, name FROM parts WHERE part_id = ANY($1::int[])`, [partIds]);
  const hits = rows.filter((r: any) => normText(r.name) === desc);
  return hits.length === 1 ? hits[0].part_id : null;
}

/**
 * Relaciona una recepción con el catálogo. Solo se relaciona si queda exactamente una pieza;
 * si no, va a revisión manual (nunca se adivina).
 *  1. Número de parte (sin prefijos "NP:", "P/N"...) contra el sku: exacto normalizado y, si no
 *     hay, compacto (sin espacios, guiones, puntos, comas ni diagonales).
 *  2. Si da varias piezas (sku compartido): la única cuyo nombre es igual a la descripción.
 *     Si no hay una sola, revisión manual.
 *  3. Si no hay número ("S/N ...") o no coincidió con nada: la descripción contra el sku y, si no,
 *     contra el nombre (exacto).
 * Se busca en todo el catálogo (activas o no), para que el resultado no cambie si una pieza se da
 * de baja o recibe su sku después de comprarse (reconstruir debe dar lo mismo).
 */
export async function matchPartNumber(db: Db, partNumber: string, description = ''): Promise<MatchResult> {
  const noNumber = NO_PART_NUMBER.test(partNumber);
  const cleaned = partNumber.replace(PART_NUMBER_PREFIX, '');

  if (!noNumber) {
    const ids = await bySku(db, cleaned);
    if (ids.length === 1) return { partId: ids[0], rule: cleaned === partNumber ? 'sku' : 'sku_sin_prefijo' };
    if (ids.length > 1) {
      const picked = await pickByName(db, ids, description);
      return picked != null ? { partId: picked, rule: 'sku_compartido_por_descripcion' } : { partId: null, candidates: ids };
    }
  }

  // Sin número útil: la descripción.
  const desc = normText(description);
  if (desc) {
    const ids = await bySku(db, desc);
    if (ids.length === 1) return { partId: ids[0], rule: 'descripcion_como_sku' };
    if (ids.length > 1) {
      const picked = await pickByName(db, ids, description);
      return picked != null ? { partId: picked, rule: 'descripcion_como_sku' } : { partId: null, candidates: ids };
    }
    const { rows } = await db.query(
      `SELECT part_id FROM parts WHERE upper(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = $1 ORDER BY part_id`,
      [desc],
    );
    if (rows.length === 1) return { partId: rows[0].part_id, rule: 'descripcion_como_nombre' };
    if (rows.length > 1) return { partId: null, candidates: rows.map((r: any) => r.part_id) };
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
