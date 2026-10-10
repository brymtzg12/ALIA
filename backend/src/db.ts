import pg from 'pg';
import { config } from './config.ts';
import { isoSec } from './time.ts';

// Parsers: bigint (count, bigserial) a número; fechas a texto ISO sin milisegundos.
// numeric se deja como texto: los importes viajan como texto decimal.
const { types } = pg;
types.setTypeParser(20, (v: string) => Number(v)); // int8
types.setTypeParser(1184, (v: string) => isoSec(new Date(v))); // timestamptz
types.setTypeParser(1114, (v: string) => isoSec(new Date(v + 'Z'))); // timestamp

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

pool.on('error', (err: Error) => {
  console.error('[db] error en una conexión inactiva:', err.message);
});

export type Db = pg.PoolClient;

// Errores que se resuelven reintentando la transacción completa.
const RETRYABLE = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected
const MAX_ATTEMPTS = 5;

/**
 * Ejecuta fn dentro de una transacción. Reintenta ante deadlock o falla de serialización
 * (hasta 5 veces, con espera corta aleatoria). Cualquier otro error hace rollback y se propaga.
 */
export async function withTx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      if (RETRYABLE.has(err?.code) && attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 10 + Math.random() * 40 * attempt));
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

export async function getInstanceId(): Promise<string> {
  const { rows } = await pool.query(`SELECT value FROM meta WHERE key = 'instance_id'`);
  if (!rows[0]) throw new Error('La base no tiene instance_id: corre la migración');
  return rows[0].value;
}
