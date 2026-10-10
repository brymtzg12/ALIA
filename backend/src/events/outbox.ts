import { randomUUID } from 'node:crypto';
import { validateOutput } from '../contract.ts';
import { pool, type Db } from '../db.ts';
import { isoSec } from '../time.ts';

export const OUTPUT_TOPIC = 'inventory.events';
export const DLQ_TOPIC = 'inventory.dlq';

// Mientras se relee la historia (reconstrucción o modo archivo) las salidas se guardan
// marcadas como publicadas, para no duplicar eventos en inventory.events.
let suppressPublishing = false;
export function setSuppressPublishing(value: boolean) {
  suppressPublishing = value;
}
export function isSuppressingPublishing() {
  return suppressPublishing;
}

export type OutputEvent = {
  event_id: string;
  event_type: string;
  event_version: 1;
  occurred_at: string;
  source: 'inventory';
  key: string;
  data: Record<string, unknown>;
};

export async function emit(db: Db, type: string, key: string, data: Record<string, unknown>): Promise<OutputEvent | null> {
  const event: OutputEvent = {
    event_id: randomUUID(),
    event_type: type,
    event_version: 1,
    occurred_at: isoSec(),
    source: 'inventory',
    key,
    data,
  };
  const check = validateOutput(type, event);
  if (!check.ok) {
    console.error(`[outbox] BUG: salida ${type} no cumple el contrato, no se publica: ${check.error}`, data);
    return null;
  }
  await db.query(
    `INSERT INTO outbox (event_id, kind, topic, key, event, published_at)
     VALUES ($1, 'event', $2, $3, $4, ${suppressPublishing ? 'now()' : 'NULL'})`,
    [event.event_id, OUTPUT_TOPIC, key, JSON.stringify(event)],
  );
  return event;
}

export async function sendToDlq(original: unknown, key: string | null, reason: string, db: Db | typeof pool = pool) {
  const eventId = (original as any)?.event_id;
  console.warn(`[dlq] ${eventId ?? '(sin event_id)'}: ${reason}`);
  await db.query(
    `INSERT INTO outbox (event_id, kind, topic, key, event, published_at)
     VALUES ($1, 'dlq', $2, $3, $4, ${suppressPublishing ? 'now()' : 'NULL'})`,
    [isUuid(eventId) ? eventId : randomUUID(), DLQ_TOPIC, key ?? '', JSON.stringify(original)],
  );
}

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
