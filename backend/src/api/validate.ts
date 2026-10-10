import Ajv2020 from 'ajv/dist/2020.js';
import { unprocessable } from './errors.ts';

// Validación de cuerpos POST con Ajv (sin dependencias extra). Inválido: 422 con "detail".

const ajv = new Ajv2020({ allErrors: true, strict: false });

const id = { type: 'integer', minimum: 1 };
const qty = { type: 'integer', minimum: 1 };

const schemas = {
  issue: {
    type: 'object',
    required: ['work_order_code', 'part_id', 'location_id', 'quantity', 'issued_by'],
    properties: {
      work_order_code: { type: 'string', minLength: 1 },
      part_id: id,
      location_id: id,
      quantity: qty,
      issued_by: { anyOf: [{ type: 'integer' }, { type: 'string', minLength: 1 }] },
    },
  },
  transfer: {
    type: 'object',
    required: ['part_id', 'from_location_id', 'to_location_id', 'quantity'],
    properties: { part_id: id, from_location_id: id, to_location_id: id, quantity: qty },
  },
  count: {
    type: 'object',
    required: ['location_id', 'reason', 'lines'],
    properties: {
      location_id: id,
      reason: { type: 'string', minLength: 1, pattern: '\\S' },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          required: ['part_id', 'counted_quantity'],
          properties: { part_id: id, counted_quantity: { type: 'integer', minimum: 0 } },
        },
      },
    },
  },
  policy: {
    type: 'object',
    required: ['min_qty', 'max_qty'],
    properties: {
      min_qty: { type: 'integer', minimum: 0 },
      max_qty: { type: 'integer', minimum: 1 },
      lead_time_days: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
    },
  },
  resolve: {
    type: 'object',
    required: ['part_id'],
    properties: { part_id: id, location_id: { anyOf: [id, { type: 'null' }] } },
  },
} as const;

const validators = Object.fromEntries(Object.entries(schemas).map(([k, s]) => [k, ajv.compile(s)])) as Record<
  keyof typeof schemas,
  any
>;

export function validateBody<T = any>(kind: keyof typeof schemas, body: unknown): T {
  const v = validators[kind];
  if (body == null || typeof body !== 'object' || !v(body)) {
    const detail = body == null || typeof body !== 'object'
      ? 'El cuerpo debe ser un objeto JSON'
      : ajv.errorsText(v.errors, { dataVar: 'cuerpo' });
    throw unprocessable(`Cuerpo inválido: ${detail}`);
  }
  return body as T;
}

/** Entero positivo de un parámetro de ruta o 404 si no lo es. */
export function intParam(value: string): number | null {
  return /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 2147483647 ? Number(value) : null;
}
