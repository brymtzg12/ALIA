import { config } from './config.ts';
import { getInstanceId } from './db.ts';
import { migrate } from './migrate.ts';
import { setCatalogSyncCheck } from './events/catalogSync.ts';
import { setSuppressPublishing } from './events/outbox.ts';
import { startParkingTimer, stopParkingTimer } from './events/parking.ts';
import { resetStats } from './events/processor.ts';
import { consumerState, resetConsumerState, startConsumers } from './kafka/consumers.ts';
import { startPublisher, stopPublisher } from './kafka/publisher.ts';

// Ciclo de vida de lo que corre en segundo plano: consumidores, publicador del outbox y
// reintento de estacionados. Permite reconstruir desde cero sin reiniciar el proceso
// (la API y las conexiones SSE siguen vivas).

let consumers: { stop(): Promise<void> } | null = null;
let starting = false;
let resetting = false;
let paused = false;

/** Conecta Kafka (reintenta si el broker no está) y arranca consumidores y publicador. */
export async function startPipeline(): Promise<void> {
  const generation = ++consumerState.generation;
  starting = true;
  startParkingTimer();
  const instanceId = await getInstanceId();
  for (;;) {
    if (generation !== consumerState.generation) return;
    try {
      await startPublisher();
      const started = await startConsumers(instanceId, generation);
      if (generation !== consumerState.generation) {
        await started.stop();
        return;
      }
      consumers = started;
      starting = false;
      return;
    } catch (err: any) {
      console.error(`[pipeline] Kafka no disponible (${config.kafkaBrokers.join(',')}): ${err.message}. Reintento en 5 s`);
      await stopPublisher();
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

export async function stopPipeline(): Promise<void> {
  consumerState.generation++;
  stopParkingTimer();
  const current = consumers;
  consumers = null;
  await current?.stop();
  await stopPublisher();
}

/** Pausa los consumidores (para que el kit pueda borrar y recrear sus tópicos sin choques). */
export async function pausePipeline(): Promise<void> {
  // Se permite aunque esté arrancando (p. ej. si faltan tópicos): el arranque en curso ve que su
  // generación ya no es la vigente y se detiene solo.
  console.log('[pipeline] pausa solicitada: consumidores detenidos');
  await stopPipeline();
  paused = true;
}

export function pipelineStatus() {
  return { starting, resetting, paused };
}

/**
 * Reconstrucción desde cero en caliente: detiene todo, borra la base, la recrea (instance_id
 * nuevo = grupo de consumidores nuevo) y vuelve a leer los tópicos desde el inicio.
 */
export async function resetPipeline(): Promise<{ instance_id: string }> {
  if (resetting) throw new Error('Ya hay una reconstrucción en curso');
  // Mientras arranca (catálogo primero) los consumidores aún no se pueden detener limpiamente.
  if (starting && !paused) throw new Error('El servicio todavía está arrancando; espera a que /health diga catalog_ready');
  resetting = true;
  try {
    console.log('[pipeline] reconstrucción solicitada: deteniendo consumidores');
    await stopPipeline();
    paused = false;
    resetConsumerState();
    resetStats();
    setSuppressPublishing(false);
    setCatalogSyncCheck(async () => true);
    await migrate({ reset: true });
    const instanceId = await getInstanceId();
    console.log(`[pipeline] base recreada, instance_id = ${instanceId}; releyendo los tópicos`);
    startPipeline().catch((err) => console.error('[pipeline] error al arrancar:', err));
    return { instance_id: instanceId };
  } finally {
    resetting = false;
  }
}
