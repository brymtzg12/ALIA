import { pool } from '../db.ts';
import { producer } from './client.ts';

// key del mensaje = key del sobre (el contrato lo exige).

type Listener = (event: any) => void;
const listeners = new Set<Listener>();

export function onPublished(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let timer: NodeJS.Timeout | null = null;
let busy = false;

async function publishPending(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT id, kind, topic, key, event FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT 500`,
  );
  if (!rows.length) return 0;

  const byTopic = new Map<string, any[]>();
  for (const r of rows) {
    const value = typeof r.event === 'string' ? r.event : JSON.stringify(r.event);
    const list = byTopic.get(r.topic) ?? [];
    list.push({ key: r.key, value });
    byTopic.set(r.topic, list);
  }
  await producer.sendBatch({ topicMessages: [...byTopic].map(([topic, messages]) => ({ topic, messages })) });
  await pool.query(`UPDATE outbox SET published_at = now() WHERE id = ANY($1::bigint[])`, [rows.map((r: any) => r.id)]);

  for (const r of rows) {
    if (r.kind !== 'event') continue;
    for (const fn of listeners) {
      try {
        fn(r.event);
      } catch (err) {
        console.error('[publisher] error en un listener:', err);
      }
    }
  }
  return rows.length;
}

export async function startPublisher(intervalMs = 200) {
  await producer.connect();
  timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      while ((await publishPending()) === 500);
    } catch (err: any) {
      console.error('[publisher] error al publicar, se reintenta:', err.message);
    } finally {
      busy = false;
    }
  }, intervalMs);
}

export async function stopPublisher() {
  if (timer) clearInterval(timer);
  await producer.disconnect().catch(() => {});
}
