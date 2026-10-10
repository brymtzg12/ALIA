import fs from 'node:fs';
import { config } from './config.ts';
import { pool } from './db.ts';
import { loadPoliciesFromFile } from './domain/policies.ts';

/** Aplica db/schema.sql (idempotente). Con reset borra todo antes: base nueva = grupo nuevo. */
export async function migrate({ reset = false } = {}): Promise<void> {
  const sql = fs.readFileSync(config.schemaFile, 'utf8');
  const client = await pool.connect();
  try {
    if (reset) {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    }
    await client.query(sql);
    // Las políticas no vienen de los tópicos: se recargan del archivo en cada base nueva.
    await loadPoliciesFromFile(client);
  } finally {
    client.release();
  }
}
