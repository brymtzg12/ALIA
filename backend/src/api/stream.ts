import { Router } from 'express';
import { pool } from '../db.ts';
import { onPublished } from '../kafka/publisher.ts';
import { getHealth } from './health.ts';

// Mensajes SIN nombre de evento (un solo onmessage los recibe todos); cada uno es un JSON con:
//  - { kind: "event", event }: cada salida stock.* publicada, con el sobre completo;
//  - { kind: "kit_complete", work_order_id, code }: cuando todas las líneas de una orden quedan cubiertas;
//  - { kind: "health", ...GET /health }: cada 5 segundos.

export const streamRoutes = Router();

type Client = { write: (chunk: string) => void };
const clients = new Set<Client>();

function broadcast(message: unknown) {
  const chunk = `data: ${JSON.stringify(message)}\n\n`;
  for (const c of clients) c.write(chunk);
}

const kitState = new Map<string, boolean>();
const KIT_EVENTS = new Set(['stock.reserved', 'stock.shortage_detected', 'stock.shortage_resolved', 'stock.issued']);

async function kitStatus(code: string): Promise<{ work_order_id: number; complete: boolean } | null> {
  const { rows } = await pool.query(
    `SELECT w.work_order_id, COUNT(n.bom_line_id)::int AS lines,
            COUNT(*) FILTER (WHERE n.part_id IS NOT NULL AND n.required IS NOT NULL AND s.shortage_id IS NULL
                             AND COALESCE(r.reserved, 0) + COALESCE(r.issued, 0) >= n.required)::int AS complete
     FROM work_orders w
     JOIN needs n ON n.work_order_id = w.work_order_id
     LEFT JOIN LATERAL (
       SELECT SUM(quantity) FILTER (WHERE status = 'active') AS reserved, SUM(issued) AS issued
       FROM reservations WHERE work_order_id = n.work_order_id AND bom_line_id = n.bom_line_id
     ) r ON true
     LEFT JOIN shortages s ON s.work_order_id = n.work_order_id AND s.bom_line_id = n.bom_line_id AND s.closed_at IS NULL
     WHERE w.code = $1 AND w.deleted_at IS NULL
     GROUP BY w.work_order_id`,
    [code],
  );
  if (!rows[0]) return null;
  return { work_order_id: rows[0].work_order_id, complete: rows[0].lines > 0 && rows[0].lines === rows[0].complete };
}

onPublished(async (event: any) => {
  if (!clients.size) return;
  broadcast({ kind: 'event', event });
  if (KIT_EVENTS.has(event.event_type) && event.key && !event.key.includes(':')) {
    try {
      const status = await kitStatus(event.key);
      if (!status) return;
      const before = kitState.get(event.key);
      kitState.set(event.key, status.complete);
      if (status.complete && before !== true) {
        broadcast({ kind: 'kit_complete', work_order_id: status.work_order_id, code: event.key });
      }
    } catch (err: any) {
      console.error('[stream] error al calcular el estado del kit:', err.message);
    }
  }
});

setInterval(async () => {
  if (!clients.size) return;
  try {
    broadcast({ kind: 'health', ...(await getHealth(clients.size)) });
  } catch (err: any) {
    console.error('[stream] error al calcular la salud:', err.message);
  }
}, 5000).unref();

streamRoutes.get('/stream', (req: any, res: any) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(`retry: 3000\n: conectado ${new Date().toISOString()}\n\n`);

  const client: Client = { write: (chunk) => res.write(chunk) };
  clients.add(client);
  const heartbeat = setInterval(() => res.write(`: latido ${Date.now()}\n\n`), 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(client);
  });
});

export function streamClientCount() {
  return clients.size;
}
