import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';
import { pool } from '../db.ts';
import { migrate } from '../migrate.ts';
import { setSuppressPublishing } from '../events/outbox.ts';
import { processMessage, stats } from '../events/processor.ts';
import { retryParked } from '../events/parking.ts';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) ?? path.resolve(config.contractDir, '..', 'data', 'events.jsonl');
const reset = args.includes('--reset');
const catalogFirst = args.includes('--catalog-first');

const RETRY_AFTER = new Set(['shop.catalog', 'shop.work_orders']);

async function main() {
  await migrate({ reset });
  setSuppressPublishing(true);

  const entries = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const ordered = catalogFirst
    ? [...entries.filter((e) => e.topic === 'shop.catalog'), ...entries.filter((e) => e.topic !== 'shop.catalog')]
    : entries;

  const started = Date.now();
  for (const [i, entry] of ordered.entries()) {
    const outcome = await processMessage({ topic: entry.topic, key: entry.event?.key ?? null, value: entry.event });
    if (RETRY_AFTER.has(entry.topic) && outcome === 'ok') await retryParked();
    if ((i + 1) % 250 === 0) console.log(`[replay] ${i + 1}/${ordered.length}`);
  }
  await retryParked();

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const { rows } = await pool.query(`
    SELECT
      (SELECT count(*) FROM processed_events) AS processed,
      (SELECT count(*) FROM parked_events) AS parked,
      (SELECT count(*) FROM outbox WHERE kind = 'event') AS outputs,
      (SELECT count(*) FROM outbox WHERE kind = 'dlq') AS dlq`);
  console.log(`[replay] ${ordered.length} entregas en ${secs}s`);
  console.log(`[replay] resultado por entrega:`, {
    ok: stats.ok, ignored: stats.ignored, duplicate: stats.duplicate, parked_al_llegar: stats.parked,
    invalid: stats.invalid, unknown_type: stats.unknown_type, error: stats.error,
  });
  console.log(`[replay] base:`, rows[0]);
  if (Number(rows[0].parked) > 0) {
    const left = await pool.query(`SELECT event->>'event_type' AS type, key, reason FROM parked_events ORDER BY seq LIMIT 10`);
    console.log('[replay] siguen estacionados:', left.rows);
  }
}

main()
  .catch((err) => {
    console.error('[replay] falló:', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
