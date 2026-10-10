import { config } from './config.ts';
import { contractStats } from './contract.ts';
import { getInstanceId, pool } from './db.ts';
import { migrate } from './migrate.ts';
import { createApp } from './api/server.ts';
import { startParkingTimer, stopParkingTimer } from './events/parking.ts';
import { startConsumers } from './kafka/consumers.ts';
import { startPublisher, stopPublisher } from './kafka/publisher.ts';

// Arranque: esquema, contratos, API, y en segundo plano Kafka (catálogo primero) y outbox.
async function main() {
  await migrate();
  const instanceId = await getInstanceId();
  console.log(`[main] base lista, instance_id = ${instanceId}`);
  console.log(`[main] contrato: ${contractStats.inputs} entradas, ${contractStats.outputs} salidas`);

  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`[main] API escuchando en http://0.0.0.0:${config.port}`);
  });

  startParkingTimer();

  // Kafka no detiene la API: si el broker no está, se reintenta.
  let consumers: { stop(): Promise<void> } | null = null;
  const connectKafka = async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        await startPublisher();
        consumers = await startConsumers(instanceId);
        return;
      } catch (err: any) {
        console.error(`[main] Kafka no disponible (${config.kafkaBrokers.join(',')}): ${err.message}. Reintento en 5 s`);
        await stopPublisher();
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  connectKafka();

  const shutdown = async () => {
    console.log('[main] apagando...');
    stopParkingTimer();
    server.close();
    await consumers?.stop();
    await stopPublisher();
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[main] no se pudo arrancar:', err.message);
  process.exit(1);
});
