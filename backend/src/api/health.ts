import { pool } from '../db.ts';
import { stats } from '../events/processor.ts';
import { fetchHighWatermarks, INPUT_TOPICS } from '../kafka/client.ts';
import { consumerState } from '../kafka/consumers.ts';

async function computeLag(): Promise<{ topic: string; lag: number | null }[]> {
  if (!consumerState.groupPrefix) return INPUT_TOPICS.map((topic) => ({ topic, lag: null }));
  try {
    const highs = await fetchHighWatermarks(INPUT_TOPICS);
    return [...highs].map(([topic, parts]) => {
      let total = 0;
      for (const [partition, high] of parts) {
        const done = consumerState.processedOffsets.get(`${topic}|${partition}`);
        const startHigh = consumerState.startupHighs?.get(topic)?.get(partition) ?? 0;
        total += Math.max(0, high - (done != null ? done + 1 : Math.min(startHigh, high)));
      }
      return { topic, lag: total };
    });
  } catch {
    return INPUT_TOPICS.map((topic) => ({ topic, lag: null }));
  }
}

export async function getHealth(sseClients = 0) {
  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*) FROM processed_events) AS processed,
      (SELECT count(*) FROM processed_events WHERE status = 'error') AS errors,
      (SELECT count(*) FROM parked_events) AS parked,
      (SELECT count(*) FROM outbox WHERE kind = 'dlq') AS dlq,
      (SELECT count(*) FROM outbox WHERE published_at IS NULL) AS outbox_pending,
      (SELECT max(processed_at) FROM processed_events) AS last_event_at
  `);
  const parkedList = await pool.query(
    `SELECT event_id, topic, key, event->>'event_type' AS event_type, reason, attempts, parked_at
     FROM parked_events ORDER BY seq LIMIT 20`,
  );
  return {
    status: 'ok',
    rebuilding: consumerState.rebuilding,
    catalog_ready: consumerState.catalogReady,
    consumers: await computeLag(),
    ...rows[0],
    group_prefix: consumerState.groupPrefix,
    sse_clients: sseClients,
    outcomes: stats,
    parked_events: parkedList.rows,
  };
}
