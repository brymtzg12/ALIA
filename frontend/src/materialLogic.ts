import type { Row } from './api';
export function groupMaterials(lines: Row[], kits: Row[] = []): { name: string; lines: Row[]; complete: boolean }[] {
  const groups = new Map<string, Row[]>();
  for (const line of lines) {
    const matchingKit = kits.find(kit => Array.isArray(kit.bom_line_ids) && kit.bom_line_ids.includes(line.bom_line_id));
    const name = String(line.kit_name ?? matchingKit?.kit_name ?? line.group_name ?? line.name ?? 'Materiales');
    groups.set(name, [...(groups.get(name) ?? []), line]);
  }
  return [...groups].map(([name, rows]) => ({ name, lines: rows, complete: rows.every(line => line.complete === true || line.line_status === 'complete') }));
}
