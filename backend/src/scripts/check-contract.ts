import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';
import { contractStats, INPUT_TOPICS, validateInput } from '../contract.ts';

// Verifica que los esquemas del kit compilan y que cada evento del dataset es válido.
// No necesita base de datos ni broker.

const file = process.argv[2] ?? path.resolve(config.contractDir, '..', 'data', 'events.jsonl');
console.log(`[contrato] ${contractStats.inputs} esquemas de entrada y ${contractStats.outputs} de salida compilados`);

const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
const byType = new Map<string, number>();
const ids = new Set<string>();
let invalid = 0;
let wrongTopic = 0;
let duplicates = 0;

for (const [i, line] of lines.entries()) {
  const { topic, event } = JSON.parse(line);
  const type = event.event_type;
  byType.set(type, (byType.get(type) ?? 0) + 1);
  if (ids.has(event.event_id)) duplicates++;
  ids.add(event.event_id);
  if (INPUT_TOPICS[type] !== topic) wrongTopic++;
  const r = validateInput(type, event);
  if (!r.ok) {
    invalid++;
    if (invalid <= 5) console.log(`  línea ${i + 1} (${type}): ${r.error}`);
  }
}

console.log(`[contrato] ${lines.length} entregas, ${ids.size} event_id únicos, ${duplicates} reentregas`);
for (const [type, n] of [...byType].sort()) console.log(`  ${type.padEnd(26)} ${n}`);
console.log(`[contrato] inválidos: ${invalid}, tópico incorrecto: ${wrongTopic}`);
if (invalid || wrongTopic) process.exitCode = 1;
