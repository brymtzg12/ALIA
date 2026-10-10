import path from 'node:path';

// Variables de entorno (cargadas con node --env-file=.env).
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

const backendRoot = path.resolve(import.meta.dirname, '..');

export const config = {
  databaseUrl: required('DATABASE_URL'),
  kafkaBrokers: (process.env.KAFKA_BROKERS ?? 'localhost:19092').split(',').map((b) => b.trim()),
  port: Number(process.env.PORT ?? 8000),
  contractDir: path.resolve(backendRoot, process.env.CONTRACT_DIR ?? '../hackathon-inventario-kit/contract'),
  schemaFile: path.join(backendRoot, 'db', 'schema.sql'),
  usdMxn: Number(process.env.USD_MXN ?? 18.5),
  // Ubicación de recepción fija del contrato (regla 11).
  receivingLocationId: 100,
};
