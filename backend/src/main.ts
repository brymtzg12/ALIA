import { config } from './config.ts';
import { contractStats } from './contract.ts';
import { getInstanceId, pool } from './db.ts';
import { migrate } from './migrate.ts';
import { createApp } from './api/server.ts';
import { startPipeline, stopPipeline } from './pipeline.ts';

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

  // Kafka no detiene la API: si el broker no está, se reintenta en segundo plano.
  startPipeline().catch((err) => console.error('[main] error al arrancar Kafka:', err));

  const shutdown = async () => {
    console.log('[main] apagando...');
    server.close();
    await stopPipeline();
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
