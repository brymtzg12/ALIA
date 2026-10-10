
export function normSku(value: string | null | undefined): string | null {
  if (value == null) return null;
  const n = value.trim().toUpperCase();
  return n === '' ? null : n;
}

export function compactSku(value: string | null | undefined): string | null {
  const n = normSku(value);
  if (n == null) return null;
  const c = n.replace(/[\s\-./\\,_]+/g, '');
  return c === '' ? null : c;
}
