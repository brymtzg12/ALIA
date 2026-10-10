import { useState } from 'react';
import { Alert, Badge, Button, Card, Group, Select, Stack, Title, Text } from '@mantine/core';
import { useParams } from 'react-router-dom';
import { useApi, type List, type Row } from '../api';
import { DataTable, QueryState } from '../components/DataView';
import { groupMaterials } from '../materialLogic';
export function Ordenes() {
  const query = useApi<List>('/work-orders?status=open');
  return <Stack><Title order={2}>Órdenes abiertas</Title><QueryState query={query} />{query.data && <DataTable rows={query.data.items} columns={[['code', 'Orden'], ['model_name', 'Modelo'], ['stage', 'Etapa'], ['lines_total', 'Materiales'], ['lines_complete', 'Completos'], ['missing_total', 'Faltantes'], ['kit_complete', 'Kit completo']]} />}</Stack>;
}
export function Materiales() {
  const { code } = useParams();
  const query = useApi<{ lines: Row[]; kits?: Row[]; deleted: boolean; kit_complete: boolean }>('/work-orders/' + encodeURIComponent(code!) + '/materials');
  const kits = groupMaterials(query.data?.lines ?? [], query.data?.kits ?? []);
  return <Stack><Title order={2}>Materiales de {code}</Title><QueryState query={query} />{query.data && <>{query.data.deleted && <Alert color="red">Orden dada de baja</Alert>}<Badge color={query.data.kit_complete ? 'green' : 'orange'}>{query.data.kit_complete ? 'Todos los kits completos' : 'Materiales pendientes'}</Badge>{!kits.length && <Text>Esta orden aún no tiene materiales aprobados.</Text>}{kits.map(kit => <Card withBorder key={kit.name}><Stack><Group justify="space-between"><Title order={3}>{kit.name}</Title><Badge color={kit.complete ? 'green' : 'orange'}>{kit.complete ? 'Kit completo' : 'Kit pendiente'}</Badge></Group><DataTable rows={kit.lines} columns={[['part_id', 'Pieza'], ['sku', 'SKU'], ['name', 'Nombre'], ['required', 'Necesario'], ['reserved', 'Reservado'], ['issued', 'Entregado'], ['missing', 'Faltante'], ['line_status', 'Estado']]} /></Stack></Card>)}</>}</Stack>;
}
export function Pieza() {
  const { id } = useParams();
  const availability = useApi<Row & { locations: Row[] }>('/parts/' + id + '/availability');
  const ledger = useApi<{ entries: Row[] }>('/parts/' + id + '/ledger');
  return <Stack><Title order={2}>Pieza {id}</Title><QueryState query={availability} />{availability.data && <><Text>Existencia: {String(availability.data.on_hand)} · Reservado: {String(availability.data.reserved)} · Disponible: {String(availability.data.available)}</Text><DataTable rows={availability.data.locations} columns={[['location_id', 'Ubicación'], ['code', 'Código'], ['on_hand', 'Existencia']]} /></>}<Title order={3}>Kardex</Title><QueryState query={ledger} />{ledger.data && <DataTable rows={ledger.data.entries} columns={[['occurred_at', 'Fecha'], ['type', 'Movimiento'], ['location_id', 'Ubicación'], ['quantity', 'Cantidad'], ['balance', 'Saldo'], ['reference', 'Referencia']]} />}</Stack>;
}
export function Salud() {
  const query = useApi<Row & { consumers: Row[] }>('/health');
  return <Stack><Title order={2}>Salud del sistema</Title><QueryState query={query} />{query.data && <>{query.data.rebuilding === true && <Text c="orange">Sincronizando…</Text>}<DataTable rows={[query.data]} columns={[['status', 'Estado'], ['catalog_ready', 'Catálogo listo'], ['processed', 'Procesados'], ['errors', 'Errores'], ['parked', 'Pendientes'], ['outbox_pending', 'Publicaciones pendientes']]} /><Title order={3}>Consumidores</Title><DataTable rows={query.data.consumers} columns={[['topic', 'Tópico'], ['lag', 'Eventos atrasados']]} /></>}</Stack>;
}
export function Pronostico() {
  const [selected, setSelected] = useState<string | null>(null);
  const query = useApi<List & { open_orders: number }>('/forecast/open-orders');
  const models = useApi<List>('/forecast/models', true, false);
  const model = selected ?? (models.data?.items[0] ? String(models.data.items[0].model_id) : null);
  const forecast = useApi<{ lines: Row[]; orders_with_approval: number }>('/forecast/models/' + model, !!model, false);
  return <Stack><Title order={2}>Pronóstico de demanda</Title><Title order={3}>Órdenes sin inspección aprobada</Title><QueryState query={query} />{query.data && <>{query.data.open_orders === 0 ? <Alert color="blue">No hay órdenes abiertas sin inspección aprobada. Consulta abajo la demanda histórica por modelo.</Alert> : <Text>Órdenes consideradas: {query.data.open_orders}</Text>}{query.data.items.length > 0 && <DataTable rows={query.data.items} columns={[['part_id', 'Pieza'], ['name', 'Nombre'], ['expected_quantity', 'Demanda esperada'], ['available', 'Disponible'], ['gap', 'Brecha'], ['explanation', 'Base del cálculo']]} />}</>}
    <Group justify="space-between"><Title order={3}>Histórico por modelo</Title><Button variant="light" loading={models.isFetching || forecast.isFetching} onClick={() => { void models.refetch(); if (model) void forecast.refetch(); }}>Actualizar histórico</Button></Group><Text c="dimmed">Probabilidad de compra y cantidad esperada a partir de inspecciones aprobadas. Es una estimación, no una reserva.</Text><QueryState query={models} /><Select searchable label="Modelo" placeholder="Elige un modelo" data={(models.data?.items ?? []).map(row => ({ value: String(row.model_id), label: String(row.model_name) + ' · ' + String(row.brand ?? '') }))} value={model} onChange={setSelected} allowDeselect={false} />
    {model && <><QueryState query={forecast} />{forecast.data && <><Text>Órdenes con inspección aprobada: {forecast.data.orders_with_approval}</Text><DataTable rows={forecast.data.lines} columns={[['part_id', 'Pieza'], ['name', 'Nombre'], ['group_name', 'Kit'], ['probability', 'Probabilidad de compra'], ['average_quantity', 'Cantidad media'], ['expected_quantity', 'Cantidad esperada'], ['explanation', 'Explicación']]} /></>}</>}
  </Stack>;
}
