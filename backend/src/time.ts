// El kardex se ordena por estas fechas, así que todo sale por aquí.

export function isoSec(value: Date | string | number = new Date()): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
