import { pool } from '../db.ts';
import { processParked } from './processor.ts';

// Reintento de eventos estacionados. Respeta el orden por llave: si el primero de una llave
// sigue estacionado, los siguientes de esa llave ni se intentan en esta pasada.
// No van a la DLQ por tiempo; se ven en /health.

let running: Promise<number> | null = null;
let again = false;

/** Reintenta los estacionados. Si ya hay una pasada en curso, agenda otra al terminar. */
export function retryParked(): Promise<number> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let total = 0;
    try {
      do {
        again = false;
        total += await retryPass();
      } while (again);
    } finally {
      running = null;
    }
    return total;
  })();
  return running;
}

/** Una pasada; repite mientras alguno salga del estacionamiento. Devuelve cuántos salieron. */
async function retryPass(): Promise<number> {
  let released = 0;
  for (;;) {
    const { rows } = await pool.query(`SELECT seq, topic, key, event FROM parked_events ORDER BY seq`);
    if (!rows.length) return released;
    const blocked = new Set<string>();
    let progress = 0;
    for (const row of rows) {
      const lane = `${row.topic}|${row.key}`;
      if (blocked.has(lane)) continue;
      const outcome = await processParked(row.topic, row.event, row.seq);
      if (outcome === 'parked') blocked.add(lane);
      else progress++;
    }
    released += progress;
    if (!progress) return released;
  }
}

let timer: NodeJS.Timeout | null = null;

export function startParkingTimer(intervalMs = 500) {
  if (timer) return;
  timer = setInterval(() => {
    retryParked().catch((err) => console.error('[parking] error al reintentar:', err));
  }, intervalMs);
  timer.unref();
}

export function stopParkingTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}
