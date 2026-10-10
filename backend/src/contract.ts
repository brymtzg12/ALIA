import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { config } from './config.ts';

type IndexEntry = { topic: string; schema: string };
type ContractIndex = { input: Record<string, IndexEntry>; output: Record<string, IndexEntry> };
type Validator = ((data: unknown) => boolean) & { errors?: any[] | null };

const schemasDir = path.join(config.contractDir, 'schemas');
const index: ContractIndex = JSON.parse(fs.readFileSync(path.join(schemasDir, 'index.json'), 'utf8'));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

function loadSchema(relPath: string): string {
  const schema = JSON.parse(fs.readFileSync(path.join(schemasDir, relPath), 'utf8'));
  ajv.addSchema(schema);
  return schema.$id;
}

loadSchema('common.schema.json');

function compileGroup(group: Record<string, IndexEntry>): Map<string, Validator> {
  const ids = Object.entries(group).map(([type, entry]) => [type, loadSchema(entry.schema)] as const);
  const validators = new Map<string, Validator>();
  for (const [type, id] of ids) {
    const v = ajv.getSchema(id);
    if (!v) throw new Error(`No se pudo compilar el esquema de ${type}`);
    validators.set(type, v as Validator);
  }
  return validators;
}

const inputValidators = compileGroup(index.input);
const outputValidators = compileGroup(index.output);

export const INPUT_TOPICS: Record<string, string> = Object.fromEntries(
  Object.entries(index.input).map(([type, e]) => [type, e.topic]),
);

export const OUTPUT_TYPES = new Set(outputValidators.keys());

export type ValidationResult = { ok: true } | { ok: false; error: string };

function run(v: Validator | undefined, type: string, event: unknown): ValidationResult {
  if (!v) return { ok: false, error: `event_type desconocido: ${type}` };
  if (v(event)) return { ok: true };
  return { ok: false, error: ajv.errorsText(v.errors, { dataVar: 'evento' }) };
}

export function isKnownInputType(type: string): boolean {
  return inputValidators.has(type);
}

export function validateInput(type: string, event: unknown): ValidationResult {
  return run(inputValidators.get(type), type, event);
}

export function validateOutput(type: string, event: unknown): ValidationResult {
  return run(outputValidators.get(type), type, event);
}

export const contractStats = {
  inputs: inputValidators.size,
  outputs: outputValidators.size,
};
