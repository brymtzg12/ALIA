import { useQuery } from '@tanstack/react-query';
export type Row = Record<string, unknown>;
export type List = { items: Row[] };
export async function request<T>(path: string, body?: unknown, method?: 'PUT' | 'DELETE'): Promise<T> {
  const response = await fetch('/api' + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.detail || 'No se pudo consultar la API (' + response.status + ').');
  if (data === null) throw new Error('La API no devolvió JSON. Comprueba que el backend esté encendido.');
  return data as T;
}
export function useApi<T>(path: string, enabled = true, interval: number | false = 15000) {
  return useQuery<T, Error>({ queryKey: [path], queryFn: () => request<T>(path), enabled, refetchInterval: interval });
}
