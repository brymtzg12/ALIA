export type Reservation = { work_order_code: string; quantity: number };

// quantity is the remaining reserve; issued must not be subtracted a second time.
export function reservedByOrder(rows: Reservation[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of rows) result.set(row.work_order_code, (result.get(row.work_order_code) ?? 0) + row.quantity);
  return result;
}

export function recommendOrder(reserves: Map<string, number>, requested?: number): string {
  const candidates = [...reserves].filter(([, quantity]) => quantity > 0 && (requested == null || quantity >= requested));
  if (requested != null) return candidates.length === 1 ? candidates[0][0] : '';
  const largest = Math.max(0, ...candidates.map(([, quantity]) => quantity));
  const best = candidates.filter(([, quantity]) => quantity === largest);
  return best.length === 1 ? best[0][0] : '';
}

export function withdrawalLimit(onHandHere: number, available: number, ownReserved: number): number {
  return Math.max(0, Math.min(onHandHere, available + ownReserved));
}

export function selectOrder(explicit: string, reserves: Map<string, number>, requested?: number): string {
  return explicit || recommendOrder(reserves, requested);
}

export function isInteger(value: unknown, min = 1): boolean {
  return value !== '' && value != null && Number.isInteger(Number(value)) && Number(value) >= min;
}
