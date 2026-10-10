import { Stack, Title, Text } from '@mantine/core';
import { useParams } from 'react-router-dom';
import { useApi, type List, type Row } from '../api';
import { DataTable, QueryState } from '../components/DataView';
export function Ordenes() {
  const query = useApi<List>('/work-orders?status=open');
  return <Stack><Title order={2}>Órdenes abiertas</Title><QueryState query={query} />{query.data && <DataTable rows={query.data.items} columns={[['code', 'Orden'], ['model_name', 'Modelo'], ['stage', 'Etapa'], ['lines_total', 'Materiales'], ['lines_complete', 'Completos'], ['missing_total', 'Faltantes'], ['kit_complete', 'Kit completo']]} />}</Stack>;
}
export function Materiales() {
  const { code } = useParams();
  const query = useApi<{ lines: Row[]; deleted: boolean }>('/work-orders/' + encodeURIComponent(code!) + '/materials');
  return <Stack><Title order={2}>Materiales de {code}</Title><QueryState query={query} />{query.data && <>{query.data.deleted && <Text c="red">Orden dada de baja</Text>}<DataTable rows={query.data.lines} columns={[['part_id', 'Pieza'], ['name', 'Nombre'], ['required', 'Necesario'], ['reserved', 'Reservado'], ['issued', 'Entregado'], ['missing', 'Faltante'], ['line_status', 'Estado']]} /></>}</Stack>;
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
  const query = useApi<List & { open_orders: number }>('/forecast/open-orders');
  return <Stack><Title order={2}>Pronóstico de demanda</Title><Text c="dimmed">Estimación histórica para órdenes sin inspección aprobada.</Text><QueryState query={query} />{query.data && <><Text>Órdenes consideradas: {query.data.open_orders}</Text><DataTable rows={query.data.items} columns={[['part_id', 'Pieza'], ['name', 'Nombre'], ['expected_quantity', 'Demanda esperada'], ['available', 'Disponible'], ['gap', 'Brecha'], ['explanation', 'Base del cálculo']]} /></>}</Stack>;
}
