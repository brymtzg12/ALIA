import { withTx, type Db } from '../db.ts';
import { lockPart, recordMovement } from '../domain/ledger.ts';
import { issue, resolveUnmatched } from '../domain/operations.ts';
import { CatchUp } from '../kafka/catchUp.ts';
import { kafka } from '../kafka/client.ts';
import { OUTPUT_TOPIC } from '../events/outbox.ts';

// Reconstrucción de los movimientos que nacieron en la API (sección 9.3).
// Salidas, transferencias, conteos y recepciones resueltas no están en los tópicos del taller:
// se releen de inventory.events (los que traen origin "api") y se reaplican como hechos del
// libro mayor, en su orden original (movement_id de la base anterior), con idempotencia por
// command_id. Como el saldo es la suma de los movimientos, el on_hand final es el mismo.

type Fact = { type: string; data: any; envelopeTime: string; order: number };

const API_TYPES = new Set(['stock.issued', 'stock.transferred', 'stock.adjusted', 'stock.received']);

/** Lee inventory.events desde el inicio hasta sus marcas finales del arranque. */
async function readApiFacts(groupId: string, highs: Map<number, number>): Promise<Fact[]> {
  const facts: Fact[] = [];
  const catchUp = new CatchUp(new Map([[OUTPUT_TOPIC, highs]]));
  if (catchUp.isDone) return facts;

  const consumer = kafka.consumer({ groupId, sessionTimeout: 10000, heartbeatInterval: 3000 });
  await consumer.connect();
  await consumer.subscribe({ topics: [OUTPUT_TOPIC], fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ partition, message }: any) => {
      try {
        const ev = JSON.parse(message.value?.toString() ?? '');
        if (API_TYPES.has(ev?.event_type) && ev?.data?.origin === 'api' && ev?.data?.command_id) {
          facts.push({
            type: ev.event_type,
            data: ev.data,
            envelopeTime: ev.occurred_at,
            order: Number(ev.data.movement_id ?? Number.MAX_SAFE_INTEGER),
          });
        }
      } catch {
        // Un mensaje ajeno o ilegible en inventory.events no detiene la reconstrucción.
      }
      catchUp.processed(OUTPUT_TOPIC, partition, Number(message.offset));
    },
  });
  await catchUp.done;
  await consumer.disconnect();
  return facts.sort((a, b) => a.order - b.order);
}

async function commandApplied(db: Db, commandId: string): Promise<boolean> {
  const { rowCount } = await db.query(`SELECT 1 FROM movements WHERE command_id = $1 LIMIT 1`, [commandId]);
  return (rowCount ?? 0) > 0;
}

/** Aplica un hecho; devuelve 'applied', 'skipped' (ya estaba) o 'fallback' (registrado tal cual). */
async function applyFact(f: Fact): Promise<'applied' | 'skipped' | 'fallback'> {
  const d = f.data;
  const when = d.movement_occurred_at ?? d.received_at ?? f.envelopeTime;
  return withTx(async (db) => {
    if (await commandApplied(db, d.command_id)) return 'skipped';

    if (f.type === 'stock.issued') {
      // Primero con la lógica normal (consume la reserva de la orden); si no se puede, tal cual.
      await db.query('SAVEPOINT api_fact');
      try {
        await issue(db, {
          work_order_code: d.work_order_code,
          part_id: d.part_id,
          location_id: d.location_id,
          quantity: d.quantity,
          issued_by: d.issued_by,
        }, d.command_id, when);
        return 'applied';
      } catch {
        await db.query('ROLLBACK TO SAVEPOINT api_fact');
      }
      await lockPart(db, d.part_id);
      await recordMovement(db, {
        type: 'issue', partId: d.part_id, locationId: d.location_id, quantity: -d.quantity, occurredAt: when,
        reference: d.work_order_code ?? null, workOrderId: d.work_order_id, origin: 'api', commandId: d.command_id,
      });
      return 'fallback';
    }

    if (f.type === 'stock.received') {
      // Recepción resuelta a mano: se vuelve a resolver la recepción pendiente de esa línea.
      const { rows } = await db.query(
        `SELECT id FROM unmatched_receipts WHERE purchase_line_id = $1 AND resolved_at IS NULL`,
        [d.purchase_line_id],
      );
      if (!rows[0]) return 'skipped'; // ya entró por otro camino (p. ej. ahora sí coincide con el catálogo)
      await resolveUnmatched(db, rows[0].id, { part_id: d.part_id, location_id: d.location_id }, d.command_id);
      return 'applied';
    }

    if (f.type === 'stock.transferred') {
      await lockPart(db, d.part_id);
      const ref = `transfer:${d.from_location_id}->${d.to_location_id}`;
      await recordMovement(db, {
        type: 'transfer_out', partId: d.part_id, locationId: d.from_location_id, quantity: -d.quantity,
        occurredAt: when, reference: ref, origin: 'api', commandId: d.command_id,
      });
      await recordMovement(db, {
        type: 'transfer_in', partId: d.part_id, locationId: d.to_location_id, quantity: d.quantity,
        occurredAt: when, reference: ref, origin: 'api', commandId: d.command_id,
      });
      return 'applied';
    }

    // stock.adjusted: el delta original (un conteo no se puede recalcular contra otro saldo).
    await lockPart(db, d.part_id);
    await recordMovement(db, {
      type: 'adjustment', partId: d.part_id, locationId: d.location_id, quantity: d.delta, occurredAt: when,
      reference: d.reason, origin: 'api', commandId: d.command_id,
    });
    return 'applied';
  });
}

/** Relee y reaplica los hechos de la API. Se llama con las salidas suprimidas. */
export async function replayApiFacts(groupPrefix: string, highs: Map<number, number>) {
  const facts = await readApiFacts(`${groupPrefix}-apifacts`, highs);
  const result = { applied: 0, skipped: 0, fallback: 0, failed: 0 };
  for (const f of facts) {
    try {
      result[await applyFact(f)]++;
    } catch (err: any) {
      result.failed++;
      console.error(`[reconstrucción] no se pudo reaplicar ${f.type} ${f.data.command_id}: ${err.message}`);
    }
  }
  console.log(`[reconstrucción] hechos de la API en inventory.events: ${facts.length}`, result);
  return result;
}
