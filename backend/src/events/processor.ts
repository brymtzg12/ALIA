import { isKnownInputType, validateInput } from '../contract.ts';
import { withTx, type Db } from '../db.ts';
import { handlers } from '../handlers/index.ts';
import type { InputEvent } from '../handlers/types.ts';
import { sendToDlq } from './outbox.ts';

// Camino único de procesamiento de eventos de entrada (Kafka y modo archivo).

export type Outcome = 'ok' | 'ignored' | 'duplicate' | 'parked' | 'invalid' | 'unknown_type' | 'error';

export const stats: Record<Outcome, number> & { lastProcessedAt: string | null; lastEventId: string | null } = {
  ok: 0, ignored: 0, duplicate: 0, parked: 0, invalid: 0, unknown_type: 0, error: 0,
  lastProcessedAt: null, lastEventId: null,
};

const MAX_ATTEMPTS = 3;

export function resetStats() {
  for (const k of ['ok', 'ignored', 'duplicate', 'parked', 'invalid', 'unknown_type', 'error'] as const) stats[k] = 0;
  stats.lastProcessedAt = null;
  stats.lastEventId = null;
}

type Message = { topic: string; key: string | null; value: string | object };

/** Procesa un mensaje recién llegado. Nunca lanza: lo que no se puede procesar va a la DLQ. */
export async function processMessage(msg: Message): Promise<Outcome> {
  let event: InputEvent;
  try {
    event = typeof msg.value === 'string' ? JSON.parse(msg.value) : (msg.value as InputEvent);
  } catch {
    await sendToDlq(String(msg.value), msg.key, 'JSON inválido');
    return count('invalid');
  }

  const type = event?.event_type;
  if (typeof type !== 'string' || !isKnownInputType(type)) {
    console.warn(`[processor] event_type desconocido, se ignora: ${type}`);
    return count('unknown_type');
  }
  const check = validateInput(type, event);
  if (!check.ok) {
    await sendToDlq(event, msg.key ?? event.key ?? null, `no cumple el esquema: ${check.error}`);
    return count('invalid');
  }

  return count(await processWithRetry(msg.topic, event, null));
}

/** Reintento de un evento estacionado (llamado desde parking.ts). */
export async function processParked(topic: string, event: InputEvent, seq: number): Promise<Outcome> {
  return processWithRetry(topic, event, seq);
}

async function processWithRetry(topic: string, event: InputEvent, parkedSeq: number | null): Promise<Outcome> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await processOnce(topic, event, parkedSeq);
    } catch (err: any) {
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 100 * attempt));
        continue;
      }
      console.error(`[processor] ${event.event_type} ${event.event_id} falló ${MAX_ATTEMPTS} veces:`, err);
      // Al DLQ con su key, y se marca procesado con error para no trabar la partición.
      await withTx(async (db) => {
        await sendToDlq(event, event.key, `error al procesar: ${err?.message ?? err}`, db);
        await db.query(
          `INSERT INTO processed_events (event_id, event_type, topic, status) VALUES ($1, $2, $3, 'error')
           ON CONFLICT (event_id) DO NOTHING`,
          [event.event_id, event.event_type, topic],
        );
        if (parkedSeq != null) await db.query(`DELETE FROM parked_events WHERE seq = $1`, [parkedSeq]);
      });
      return 'error';
    }
  }
}

async function processOnce(topic: string, event: InputEvent, parkedSeq: number | null): Promise<Outcome> {
  const handler = handlers[event.event_type];
  return withTx(async (db) => {
    // 1. Idempotencia: el event_id se registra en la misma transacción que los efectos.
    const inserted = await db.query(
      `INSERT INTO processed_events (event_id, event_type, topic) VALUES ($1, $2, $3)
       ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [event.event_id, event.event_type, topic],
    );
    if (inserted.rowCount === 0) {
      if (parkedSeq != null) await db.query(`DELETE FROM parked_events WHERE seq = $1`, [parkedSeq]);
      return 'duplicate';
    }

    // 2. Una reentrega de algo que ya está estacionado espera su turno.
    if (parkedSeq == null) {
      const already = await db.query(`SELECT 1 FROM parked_events WHERE event_id = $1`, [event.event_id]);
      if (already.rowCount) {
        await unmarkProcessed(db, event.event_id);
        return 'duplicate';
      }
    }

    // 3. Orden por llave: si hay un evento anterior de la misma llave estacionado, este espera detrás.
    const ahead = await db.query(
      `SELECT 1 FROM parked_events WHERE topic = $1 AND key = $2 AND ($3::bigint IS NULL OR seq < $3) LIMIT 1`,
      [topic, event.key, parkedSeq],
    );
    let reason: string | null = ahead.rowCount ? 'esperando a un evento anterior de la misma llave' : null;

    // 4. Referencias desconocidas: se estaciona (no es error).
    if (!reason && handler.missingRefs) reason = await handler.missingRefs(db, event);
    if (reason) {
      await unmarkProcessed(db, event.event_id);
      await park(db, topic, event, reason, parkedSeq);
      return 'parked';
    }

    // 5. Efectos y salidas (outbox) en la misma transacción.
    const result = await handler.handle(db, event);
    if (result === 'ignored') {
      await db.query(`UPDATE processed_events SET status = 'ignored' WHERE event_id = $1`, [event.event_id]);
    }
    if (parkedSeq != null) await db.query(`DELETE FROM parked_events WHERE seq = $1`, [parkedSeq]);

    stats.lastProcessedAt = new Date().toISOString();
    stats.lastEventId = event.event_id;
    return result === 'ignored' ? 'ignored' : 'ok';
  });
}

async function unmarkProcessed(db: Db, eventId: string) {
  await db.query(`DELETE FROM processed_events WHERE event_id = $1`, [eventId]);
}

async function park(db: Db, topic: string, event: InputEvent, reason: string, parkedSeq: number | null) {
  if (parkedSeq != null) {
    await db.query(
      `UPDATE parked_events SET reason = $2, attempts = attempts + 1, last_attempt_at = now() WHERE seq = $1`,
      [parkedSeq, reason],
    );
  } else {
    await db.query(
      `INSERT INTO parked_events (event_id, topic, key, event, reason) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.event_id, topic, event.key, JSON.stringify(event), reason],
    );
  }
}

function count(outcome: Outcome): Outcome {
  stats[outcome]++;
  return outcome;
}
