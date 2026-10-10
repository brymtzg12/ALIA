import { useState } from 'react';
import { Alert, Button, Card, Group, NumberInput, Stack, Table, Text, Title } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { request, useApi, type List, type Row } from '../api';
import { DataTable, QueryState } from '../components/DataView';
import { isInteger } from '../floorLogic';
export function Valuacion() {
  const query = useApi<List & { total_value_mxn: string; usd_mxn_rate: string; method: string }>('/valuation');
  return <Stack><Title order={2}>Valuación del inventario</Title><QueryState query={query} />{query.data && <><Card withBorder><Text c="dimmed">Valor total en MXN</Text><Text size="xl" fw={700}>{new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(query.data.total_value_mxn))}</Text><Text size="sm">{query.data.method} · Tipo de cambio utilizado: {query.data.usd_mxn_rate} MXN por USD</Text></Card><DataTable rows={query.data.items} columns={[['part_id', 'Pieza'], ['sku', 'SKU'], ['name', 'Nombre'], ['on_hand', 'Existencia'], ['average_cost_mxn', 'Costo promedio MXN'], ['inventory_value_mxn', 'Valor MXN']]} /></>}</Stack>;
}
export function Rotacion() {
  const [days, setDays] = useState<string | number>(30);
  const query = useApi<{ reference_date: string; critical: Row[]; idle: Row[] }>('/rotation?days=' + (isInteger(days) ? Math.min(Number(days), 3650) : 30));
  return <Stack><Title order={2}>Rotación de piezas</Title><NumberInput label="Días para considerar una pieza sin movimiento" min={1} max={3650} allowDecimal={false} value={days} onChange={setDays} /><QueryState query={query} />{query.data && <><Text c="dimmed">Fecha de referencia del dataset: {new Date(query.data.reference_date).toLocaleString('es-MX')}. La clasificación usa los movimientos registrados.</Text><Title order={3}>Piezas críticas</Title><DataTable rows={query.data.critical} columns={[['part_id', 'Pieza'], ['name', 'Nombre'], ['issued_quantity', 'Unidades entregadas'], ['open_shortages', 'Faltantes abiertos'], ['score', 'Prioridad']]} /><Title order={3}>Piezas sin movimiento</Title><DataTable rows={query.data.idle} columns={[['part_id', 'Pieza'], ['name', 'Nombre'], ['on_hand', 'Existencia'], ['days_idle', 'Días sin movimiento'], ['last_movement_at', 'Último movimiento']]} /></>}</Stack>;
}
type PolicyDraft = { part: string | number; min: string | number; max: string | number; lead: string | number };
export function Politicas() {
  const [draft, setDraft] = useState<PolicyDraft>({ part: '', min: 0, max: 1, lead: 7 });
  const [leadDays, setLeadDays] = useState<string | number>(7);
  const policies = useApi<List>('/policies');
  const recommendations = useApi<List>('/policies/recommended?lead_time_days=' + (isInteger(leadDays) ? Math.min(Number(leadDays), 180) : 7), true, false);
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (command: { method: 'PUT' | 'DELETE'; part: number; body?: unknown }) => request<Row>('/policies/' + command.part, command.body, command.method),
    onSuccess: (_data, command) => { notifications.show({ title: command.method === 'DELETE' ? 'Política eliminada' : 'Política guardada', message: 'Las sugerencias de compra se actualizaron.', color: 'green' }); void client.invalidateQueries({ predicate: query => ['/policies', '/reorder-suggestions', '/parts'].includes(String(query.queryKey[0]).split('?')[0]) }); },
  });
  const valid = isInteger(draft.part) && isInteger(draft.min, 0) && isInteger(draft.max) && Number(draft.max) >= Number(draft.min) && isInteger(draft.lead, 0);
  const exists = policies.data?.items.some(row => Number(row.part_id) === Number(draft.part));
  function edit(row: Row) {
    mutation.reset();
    setDraft({ part: Number(row.part_id), min: Number(row.min_qty), max: Number(row.max_qty), lead: row.lead_time_days == null ? 7 : Number(row.lead_time_days) });
  }
  return <Stack><Title order={2}>Políticas de inventario</Title><Text>Mínimos y máximos para sugerencias de compra. Cargar una recomendación permite revisarla antes de guardar.</Text>
    <Card withBorder><Stack><Title order={3}>Editar política</Title><Group grow><NumberInput label="ID de pieza" disabled={mutation.isPending} min={1} allowDecimal={false} value={draft.part} onChange={part => { mutation.reset(); setDraft(previous => ({ ...previous, part })); }} /><NumberInput label="Mínimo" disabled={mutation.isPending} min={0} allowDecimal={false} value={draft.min} onChange={min => setDraft(previous => ({ ...previous, min }))} /><NumberInput label="Máximo" disabled={mutation.isPending} min={1} allowDecimal={false} value={draft.max} onChange={max => setDraft(previous => ({ ...previous, max }))} /><NumberInput label="Días de entrega" disabled={mutation.isPending} min={0} allowDecimal={false} value={draft.lead} onChange={lead => setDraft(previous => ({ ...previous, lead }))} /></Group>
      {Number(draft.max) < Number(draft.min) && <Alert color="red">El máximo debe ser igual o mayor que el mínimo.</Alert>}
      <Group><Button disabled={!valid} loading={mutation.isPending} onClick={() => mutation.mutate({ method: 'PUT', part: Number(draft.part), body: { min_qty: Number(draft.min), max_qty: Number(draft.max), lead_time_days: Number(draft.lead) } })}>Guardar política</Button><Button color="red" variant="light" disabled={!exists || mutation.isPending} onClick={() => mutation.mutate({ method: 'DELETE', part: Number(draft.part) })}>Quitar política de pieza {String(draft.part)}</Button></Group>
      {mutation.error && <Alert color="red">{mutation.error.message}</Alert>}{mutation.isSuccess && <Alert color="green">Cambios guardados.</Alert>}
    </Stack></Card>
    <Title order={3}>Políticas actuales</Title><QueryState query={policies} />{policies.data && <><DataTable rows={policies.data.items} columns={[['part_id', 'Pieza'], ['name', 'Nombre'], ['min_qty', 'Mínimo'], ['max_qty', 'Máximo'], ['lead_time_days', 'Días de entrega'], ['available', 'Disponible'], ['below_min', 'Estado']]} /><Group>{policies.data.items.map(row => <Button key={String(row.part_id)} size="xs" variant="light" disabled={mutation.isPending} onClick={() => edit(row)}>Editar {String(row.sku ?? row.part_id)}</Button>)}</Group></>}
    <Title order={3}>Recomendaciones históricas</Title><NumberInput label="Días de entrega para calcular recomendaciones" min={1} max={180} allowDecimal={false} value={leadDays} onChange={setLeadDays} /><QueryState query={recommendations} />{recommendations.data && (recommendations.data.items.length ? <Table.ScrollContainer minWidth={650}><Table><Table.Thead><Table.Tr><Table.Th>Pieza</Table.Th><Table.Th>Mínimo / máximo</Table.Th><Table.Th>Explicación</Table.Th><Table.Th>Acción</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{recommendations.data.items.map(row => <Table.Tr key={String(row.part_id)}><Table.Td>{String(row.name)} · {String(row.sku ?? row.part_id)}</Table.Td><Table.Td>{String(row.min_qty)} / {String(row.max_qty)}</Table.Td><Table.Td>{String(row.explanation)}</Table.Td><Table.Td><Button size="xs" variant="light" disabled={mutation.isPending} onClick={() => edit(row)}>Cargar para revisar</Button></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer> : <Text>No hay historial suficiente para recomendar políticas.</Text>)}
  </Stack>;
}
