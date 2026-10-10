import { compactSku, normSku } from './sku.ts';

// Candidatos sugeridos para relacionar a mano una recepción: piezas cuyo sku o nombre se parece
// al número de parte o a la descripción de la compra. Solo ayuda a la persona; nunca relaciona solo.

type PartLite = { part_id: number; sku: string | null; name: string };

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Coeficiente de Dice sobre bigramas: 1 = iguales, 0 = nada en común. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let common = 0;
  for (const [g, n] of A) common += Math.min(n, B.get(g) ?? 0);
  return (2 * common) / (a.length - 1 + (b.length - 1));
}

export function suggestCandidates(
  receipt: { part_number: string; description: string },
  parts: PartLite[],
  limit = 5,
): { part_id: number; sku: string | null; name: string; score: number }[] {
  const pn = compactSku(receipt.part_number) ?? '';
  const desc = (normSku(receipt.description) ?? '').replace(/\s+/g, ' ');
  return parts
    .map((p) => {
      const bySku = p.sku ? similarity(pn, compactSku(p.sku) ?? '') : 0;
      const byName = similarity(desc, (normSku(p.name) ?? '').replace(/\s+/g, ' ')) * 0.9;
      // El número de parte contenido en el sku (o al revés) es buena señal.
      const contains = p.sku && pn.length >= 4 && ((compactSku(p.sku) ?? '').includes(pn) || pn.includes(compactSku(p.sku) ?? '#')) ? 0.85 : 0;
      return { part_id: p.part_id, sku: p.sku, name: p.name, score: Math.max(bySku, byName, contains) };
    })
    .filter((c) => c.score >= 0.35)
    .sort((a, b) => b.score - a.score || a.part_id - b.part_id)
    .slice(0, limit)
    .map((c) => ({ ...c, score: Math.round(c.score * 100) / 100 }));
}
