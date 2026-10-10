// Fechas: siempre ISO 8601 en UTC, terminadas en Z y sin milisegundos (AAAA-MM-DDTHH:MM:SSZ).
// El kardex se ordena por estas fechas, así que todo sale por aquí.

export function isoSec(value: Date | string | number = new Date()): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
