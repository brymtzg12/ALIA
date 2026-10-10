import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { config } from '../config.ts';

const args = new Set(process.argv.slice(2));
const keepTopics = args.has('--keep-topics');
const snapshot = args.has('--snapshot');
const kitDir = path.resolve(config.contractDir, '..');
const backendDir = path.resolve(import.meta.dirname, '..', '..');
const api = `http://localhost:${config.port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function step(msg: string) {
  console.log(`\n== ${msg}`);
}

function docker(argv: string[], env: Record<string, string> = {}) {
  const r = spawnSync('docker', argv, { cwd: kitDir, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (r.error) throw new Error(`No se pudo ejecutar docker (¿Docker Desktop está abierto?): ${r.error.message}`);
  return r;
}

async function getJson(url: string, init?: RequestInit): Promise<{ status: number; body: any } | null> {
  try {
    const res = await fetch(url, init);
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return null;
  }
}

async function main() {
  const post = (route: string) =>
    getJson(`${api}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'RESET' }),
    });

  if (!keepTopics) {
    step('Pausando los consumidores del backend');
    const paused = await post('/admin/pause');
    if (paused && paused.status !== 200) throw new Error(`El backend no se pudo pausar (${paused.status}): ${paused.body?.detail}`);
    console.log(paused ? '   pausado' : '   el backend no está corriendo (no hace falta pausarlo)');

    step('Borrando los tópicos del kit y recargando las 6 semanas del dataset');
    const since = new Date(Date.now() - 2000).toISOString();
    const up = docker(['compose', 'up', '-d', '--force-recreate', 'simulator'], { RESET: '1', SPEED: '0' });
    if (up.status !== 0) throw new Error(`docker compose falló:\n${up.stderr}`);
    const deadline = Date.now() + 240_000;
    for (;;) {
      const logs = docker(['compose', 'logs', '--since', since, 'simulator']).stdout ?? '';
      const done = /replay terminado: (\d+) eventos/.exec(logs);
      if (done) {
        console.log(`   simulador listo: ${done[1]} eventos recargados`);
        break;
      }
      if (/Traceback|KafkaException/.test(logs)) {
        const tail = logs.trim().split('\n').slice(-4).join('\n');
        throw new Error(`El simulador falló al recargar:\n${tail}\nVuelve a correr pnpm demo:reset.`);
      }
      if (Date.now() > deadline) throw new Error('El simulador no terminó de recargar en 4 minutos; revisa: docker compose logs simulator');
      await sleep(2000);
    }
    // Se deja el simulador con su configuración normal (sin RESET) para el resto de la demo:
    // sigue vivo y su panel responde; RESET solo actúa al arrancar.
  }

  step('Reconstruyendo la base desde cero');
  const reset = await post('/admin/reset');
  if (!reset) {
    console.log('   El backend no está corriendo: se borra la base directamente.');
    const { migrate } = await import('../migrate.ts');
    const { pool } = await import('../db.ts');
    await migrate({ reset: true });
    await pool.end();
    console.log('   Listo. Ahora arranca el backend con: pnpm dev (se reconstruye solo al iniciar).');
    return;
  }
  if (reset.status !== 200) throw new Error(`El backend rechazó la reconstrucción (${reset.status}): ${reset.body?.detail}`);
  console.log(`   base nueva, instance_id = ${reset.body.instance_id}`);

  step('Esperando a que el servicio relea los tópicos');
  const deadline = Date.now() + 240_000;
  let h: any = null;
  for (;;) {
    h = (await getJson(`${api}/health`))?.body;
    const lagZero = h?.consumers?.every((c: any) => c.lag === 0);
    if (h && !h.rebuilding && h.catalog_ready && lagZero && Number(h.processed) > 0) break;
    if (Date.now() > deadline) throw new Error('El servicio no terminó de reconstruir en 4 minutos; revisa /health');
    await sleep(2000);
  }
  console.log(`   procesados: ${h.processed} · errores: ${h.errors} · estacionados: ${h.parked} · DLQ: ${h.dlq}`);

  step('Comprobando');
  const junk = await getJson(`${api}/parts?search=${encodeURIComponent('PIEZA DE PRUEBA')}&limit=5`);
  const junkCount = junk?.body?.items?.length ?? 0;
  const orders = await getJson(`${api}/work-orders?status=open`);
  console.log(`   piezas de prueba: ${junkCount}${junkCount ? ' (quedan datos de las pruebas de contrato)' : ' (limpio)'}`);
  console.log(`   órdenes abiertas: ${orders?.body?.items?.length ?? '?'}`);
  if (Number(h.errors) > 0 || Number(h.parked) > 0) console.log('   OJO: hay errores o estacionados; revisa /health antes de presentar.');

  if (snapshot) {
    step('Tomando la foto de saldos (backend/saldo.json)');
    const r = docker([
      'compose', 'run', '--rm', '-v', `${backendDir}:/out`, 'contract-tests',
      'snapshot', '--out', '/out/saldo.json', '--api', 'http://host.docker.internal:8000',
    ]);
    console.log((r.stdout || r.stderr).trim().split('\n').slice(-2).join('\n'));
  }

  console.log('\nListo para la demo. No corras las pruebas de contrato después de esto: vuelven a dejar datos de prueba.');
}

main().catch((err) => {
  console.error(`\nNo se pudo completar: ${err.message}`);
  process.exitCode = 1;
});
