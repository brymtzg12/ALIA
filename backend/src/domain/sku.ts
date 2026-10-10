// Normalización de números de parte y sku.

/** Mínimo del contrato: mayúsculas y sin espacios en los extremos. */
export function normSku(value: string | null | undefined): string | null {
  if (value == null) return null;
  const n = value.trim().toUpperCase();
  return n === '' ? null : n;
}

/** Forma compacta: además sin espacios internos, guiones, puntos, comas ni diagonales. */
export function compactSku(value: string | null | undefined): string | null {
  const n = normSku(value);
  if (n == null) return null;
  const c = n.replace(/[\s\-./\\,_]+/g, '');
  return c === '' ? null : c;
}
