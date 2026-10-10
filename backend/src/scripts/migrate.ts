import { migrate } from '../migrate.ts';
import { getInstanceId, pool } from '../db.ts';

const reset = process.argv.includes('--reset');

try {
  await migrate({ reset });
  console.log(`[migrate] esquema aplicado${reset ? ' (base borrada y recreada)' : ''}`);
  console.log(`[migrate] instance_id = ${await getInstanceId()}`);
} catch (err: any) {
  console.error('[migrate] falló:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
