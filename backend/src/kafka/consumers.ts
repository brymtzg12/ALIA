import { pool } from '../db.ts';
import { setCatalogSyncCheck } from '../events/catalogSync.ts';
import { OUTPUT_TOPIC, setSuppressPublishing } from '../events/outbox.ts';
import { replayApiFacts } from '../replay/apiFacts.ts';
import { processMessage } from '../events/processor.ts';
import { retryParked } from '../events/parking.ts';
import { CatchUp } from './catchUp.ts';
import { admin, CATALOG_TOPIC, fetchHighWatermarks, INPUT_TOPICS, kafka, SHOP_TOPICS } from './client.ts';

// Consumidores: shop.catalog primero hasta sus marcas finales del arranque; solo entonces
// arranca el de órdenes, inspecciones y compras (regla 22). El del catálogo sigue corriendo.

export const consumerState = {
  groupPrefix: '',
  catalogReady: false,
  rebuilding: false,
  startupHighs: null as Map<string, Map<number, number>> | null,
  // Último offset procesado por "topic|partition" (para el lag en /health).
  processedOffsets: new Map<string, number>(),
};

const RETRY_AFTER = new Set(['shop.catalog', 'shop.work_orders']);

/** Offsets ya confirmados del grupo, para no esperar mensajes que nunca van a llegar. */
async function applyCommitted(groupId: string, topics: string[], catchUp: CatchUp) {
  const committed = await admin.fetchOffsets({ groupId, topics });
  for (const t of committed) {
    for (const p of t.partitions) {
      const off = Number(p.offset);
      if (off >= 0) catchUp.committed(t.topic, p.partition, off);
    }
  }
}

function makeHandler(catchUp: CatchUp | null) {
  return async ({ topic, partition, message }: any) => {
    const outcome = await processMessage({
      topic,
      key: message.key ? message.key.toString() : null,
      value: message.value ? message.value.toString() : '',
    });
    consumerState.processedOffsets.set(`${topic}|${partition}`, Number(message.offset));
    catchUp?.processed(topic, partition, Number(message.offset));
    if (RETRY_AFTER.has(topic) && outcome === 'ok') {
      retryParked().catch((err) => console.error('[kafka] error al reintentar estacionados:', err));
    }
  };
}

/**
 * Crea un consumidor y lo mantiene vivo: si truena con un error que kafkajs no reintenta
 * por su cuenta (restart = false), se desconecta y se vuelve a crear a los 5 s.
 */
async function runConsumer(groupId: string, topics: string[], runOpts: Record<string, unknown>) {
  let current: any = null;
  let stopped = false;

  const start = async () => {
    // Sesión corta: al reiniciar en desarrollo, el miembro anterior se descarta en 10 s, no en 30.
    const consumer = kafka.consumer({ groupId, sessionTimeout: 10000, heartbeatInterval: 3000 });
    current = consumer;
    consumer.on(consumer.events.CRASH, async (e: any) => {
      if (e.payload?.restart || stopped) return;
      console.error(`[kafka] el consumidor ${groupId} se detuvo (${e.payload?.error?.message}); se reinicia en 5 s`);
      await consumer.disconnect().catch(() => {});
      setTimeout(() => {
        if (!stopped) start().catch((err) => console.error(`[kafka] no se pudo reiniciar ${groupId}:`, err.message));
      }, 5000);
    });
    await consumer.connect();
    await consumer.subscribe({ topics, fromBeginning: true });
    await consumer.run(runOpts);
  };
  await start();

  return {
    async stop() {
      stopped = true;
      await current?.disconnect().catch(() => {});
    },
  };
}

export async function startConsumers(instanceId: string) {
  consumerState.groupPrefix = `kitlisto-${instanceId}`;
  await admin.connect();

  const highs = await fetchHighWatermarks(INPUT_TOPICS);
  consumerState.startupHighs = highs;

  // Reconstrucción: base nueva (nada procesado) y tópicos con historia. Hasta alcanzar las
  // marcas del arranque, las salidas se guardan como publicadas sin enviarse.
  const { rows } = await pool.query(`SELECT count(*) AS n FROM processed_events`);
  const hasHistory = [...highs.values()].some((parts) => [...parts.values()].some((h) => h > 0));
  const allCatchUp = new CatchUp(highs);
  if (Number(rows[0].n) === 0 && hasHistory) {
    consumerState.rebuilding = true;
    setSuppressPublishing(true);
    // Marcas de inventory.events del arranque: hasta ahí se releen los hechos de la API.
    const outputHighs = (await fetchHighWatermarks([OUTPUT_TOPIC])).get(OUTPUT_TOPIC)!;
    console.log('[kafka] base nueva: reconstruyendo desde el inicio sin publicar salidas');
    allCatchUp.done
      .then(() => replayApiFacts(consumerState.groupPrefix, outputHighs))
      .catch((err) => console.error('[kafka] error al reaplicar los hechos de la API:', err))
      .finally(() => {
        consumerState.rebuilding = false;
        setSuppressPublishing(false);
        console.log('[kafka] reconstrucción terminada: se publican las salidas nuevas');
      });
  }

  // 1. Catálogo.
  const catalogGroup = `${consumerState.groupPrefix}-catalog`;
  const catalogCatchUp = new CatchUp(new Map([[CATALOG_TOPIC, highs.get(CATALOG_TOPIC)!]]));
  await applyCommitted(catalogGroup, [CATALOG_TOPIC], catalogCatchUp);
  await applyCommitted(catalogGroup, [CATALOG_TOPIC], allCatchUp);

  const catalogHandler = makeHandler(catalogCatchUp);
  const catalogConsumer = await runConsumer(catalogGroup, [CATALOG_TOPIC], {
    eachMessage: async (payload: any) => {
      await catalogHandler(payload);
      allCatchUp.processed(payload.topic, payload.partition, Number(payload.message.offset));
    },
  });

  console.log('[kafka] consumiendo shop.catalog hasta el final antes que lo demás...');
  await catalogCatchUp.done;
  consumerState.catalogReady = true;
  // Desde aquí, "catálogo al día" = lo procesado alcanza la marca final actual de cada partición.
  setCatalogSyncCheck(async () => {
    try {
      const current = await fetchHighWatermarks([CATALOG_TOPIC]);
      for (const [partition, high] of current.get(CATALOG_TOPIC)!) {
        const done = consumerState.processedOffsets.get(`${CATALOG_TOPIC}|${partition}`);
        const startHigh = highs.get(CATALOG_TOPIC)?.get(partition) ?? 0;
        const next = done != null ? done + 1 : startHigh;
        if (next < high) return false;
      }
      return true;
    } catch {
      return true; // sin broker no se puede saber; no bloquear las recepciones
    }
  });
  console.log('[kafka] catálogo al día');
  await retryParked();

  // 2. Órdenes, inspecciones y compras (particiones en paralelo).
  const shopGroup = `${consumerState.groupPrefix}-shop`;
  await applyCommitted(shopGroup, SHOP_TOPICS, allCatchUp);
  const shopConsumer = await runConsumer(shopGroup, SHOP_TOPICS, {
    partitionsConsumedConcurrently: 3,
    eachMessage: makeHandler(allCatchUp),
  });
  console.log('[kafka] consumiendo shop.work_orders, shop.inspections y shop.purchasing');

  return {
    async stop() {
      await Promise.allSettled([catalogConsumer.stop(), shopConsumer.stop(), admin.disconnect()]);
    },
  };
}
