import { useState } from 'react';
import { Alert, Badge, Button, Card, Group, Select, SimpleGrid, Stack, Title, Text } from '@mantine/core';
import { useParams } from 'react-router-dom';
import { useApi, type List, type Row } from '../api';
import { DataTable, QueryState, StatusBadge } from '../components/DataView';
import { Code, EmptyState, PageHeader, Section, Stat } from '../components/Ui';
import pages from './Pages.module.css';
import { groupMaterials } from '../materialLogic';
export function Ordenes() {
  const query = useApi<List>('/work-orders?status=open');
  return <><PageHeader eyebrow="Almacén" title="Órdenes abiertas" /><QueryState query={query} />{query.data && <DataTable rows={query.data.items} columns={[['code', 'Orden'], ['model_name', 'Modelo'], ['stage', 'Etapa'], ['lines_total', 'Materiales'], ['lines_complete', 'Completos'], ['missing_total', 'Faltantes'], ['kit_complete', 'Kit completo']]} />}</>;
}
export function Materiales() {
  const { code } = useParams();
  const query = useApi<{ lines: Row[]; kits?: Row[]; deleted: boolean; kit_complete: boolean }>('/work-orders/' + encodeURIComponent(code!) + '/materials');
  const kits = groupMaterials(query.data?.lines ?? [], query.data?.kits ?? []);
  return <><PageHeader back={{ to: '/ordenes', label: 'Órdenes' }} eyebrow="Orden de trabajo" title={<>Materiales de <Code>{code}</Code></>} actions={query.data && <Badge size="lg" color={query.data.kit_complete ? 'green' : 'orange'}>{query.data.kit_complete ? 'Todos los kits completos' : 'Materiales pendientes'}</Badge>} /><QueryState query={query} />{query.data && <>{query.data.deleted && <Alert color="red">Orden dada de baja</Alert>}{!kits.length && <EmptyState>Esta orden aún no tiene materiales aprobados.</EmptyState>}{kits.map(kit => <Card key={kit.name} className={kit.complete ? pages.kitDone : pages.kit}><Stack><Group justify="space-between"><Title order={3}>{kit.name}</Title><Badge color={kit.complete ? 'green' : 'orange'}>{kit.complete ? 'Kit completo' : 'Kit pendiente'}</Badge></Group><DataTable rows={kit.lines} columns={[['part_id', 'Pieza'], ['sku', 'SKU'], ['name', 'Nombre'], ['required', 'Necesario'], ['reserved', 'Reservado'], ['issued', 'Entregado'], ['missing', 'Faltante'], ['line_status', 'Estado']]} /></Stack></Card>)}</>}</>;
}
export function Pieza() {
  const { id } = useParams();
  const availability = useApi<Row & { locations: Row[] }>('/parts/' + id + '/availability');
  const ledger = useApi<{ entries: Row[] }>('/parts/' + id + '/ledger');
  return <><PageHeader eyebrow="Pieza" title={<>Pieza <Code>{id}</Code></>} /><QueryState query={availability} />{availability.data && <><SimpleGrid cols={{ base: 1, xs: 3 }} spacing="md"><Stat size="lg" label="Existencia" value={String(availability.data.on_hand)} /><Stat size="lg" label="Reservado" value={String(availability.data.reserved)} /><Stat size="lg" label="Disponible" value={String(availability.data.available)} /></SimpleGrid><Section title="Ubicaciones"><DataTable rows={availability.data.locations} columns={[['location_id', 'Ubicación'], ['code', 'Código'], ['on_hand', 'Existencia']]} /></Section></>}<Section title="Kardex"><QueryState query={ledger} />{ledger.data && <DataTable rows={ledger.data.entries} columns={[['occurred_at', 'Fecha'], ['type', 'Movimiento'], ['location_id', 'Ubicación'], ['quantity', 'Cantidad'], ['balance', 'Saldo'], ['reference', 'Referencia']]} />}</Section></>;
}
export function Salud() {
  const query = useApi<Row & { consumers: Row[] }>('/health');
  return <><PageHeader eyebrow="Sistema" title="Salud del sistema" actions={query.data && <StatusBadge value={query.data.status} />} /><QueryState query={query} />{query.data && <>{query.data.rebuilding === true && <Alert color="orange">Sincronizando…</Alert>}<Section title="Indicadores"><DataTable rows={[query.data]} columns={[['status', 'Estado'], ['catalog_ready', 'Catálogo listo'], ['processed', 'Procesados'], ['errors', 'Errores'], ['parked', 'Pendientes'], ['outbox_pending', 'Publicaciones pendientes']]} /></Section><Section title="Consumidores"><DataTable rows={query.data.consumers} columns={[['topic', 'Tópico'], ['lag', 'Eventos atrasados']]} /></Section></>}</>;
}
export function Pronostico() {
  const [selected, setSelected] = useState<string | null>(null);
  const query = useApi<List & { open_orders: number }>('/forecast/open-orders');
  const models = useApi<List>('/forecast/models', true, false);
  // Por defecto, el modelo con más órdenes (el primero por nombre podría no tener historial).
  const busiest = [...(models.data?.items ?? [])].sort((a, b) => Number(b.work_orders ?? 0) - Number(a.work_orders ?? 0))[0];
  const model = selected ?? (busiest ? String(busiest.model_id) : null);
  const forecast = useApi<{ lines: Row[]; orders_with_approval: number }>('/forecast/models/' + model, !!model, false);
  return <><PageHeader eyebrow="Planeación" title="Pronóstico de demanda" />
    <Section title="Órdenes sin inspección aprobada"><QueryState query={query} />{query.data && <>{query.data.open_orders === 0 ? <Alert color="blue">No hay órdenes abiertas sin inspección aprobada. Consulta abajo la demanda histórica por modelo.</Alert> : <Text>Órdenes consideradas: <Code>{query.data.open_orders}</Code></Text>}{query.data.items.length > 0 && <DataTable rows={query.data.items} columns={[['part_id', 'Pieza'], ['name', 'Nombre'], ['expected_quantity', 'Demanda esperada'], ['available', 'Disponible'], ['gap', 'Brecha'], ['explanation', 'Base del cálculo']]} />}</>}</Section>
    <Section title="Histórico por modelo" actions={<Button variant="light" loading={models.isFetching || forecast.isFetching} onClick={() => { void models.refetch(); if (model) void forecast.refetch(); }}>Actualizar histórico</Button>}><Text c="dimmed" className={pages.prose}>Probabilidad de compra y cantidad esperada a partir de inspecciones aprobadas. Es una estimación, no una reserva.</Text><QueryState query={models} /><div className={pages.toolbar}><Select searchable className={pages.search} label="Modelo" placeholder="Elige un modelo" data={(models.data?.items ?? []).map(row => ({ value: String(row.model_id), label: String(row.model_name) + ' · ' + String(row.brand ?? '') }))} value={model} onChange={setSelected} allowDeselect={false} /></div>
    {model && <><QueryState query={forecast} />{forecast.data && <><Text>Órdenes con inspección aprobada: <Code>{forecast.data.orders_with_approval}</Code></Text><DataTable rows={forecast.data.lines} columns={[['part_id', 'Pieza'], ['name', 'Nombre'], ['group_name', 'Kit'], ['probability', 'Probabilidad de compra'], ['average_quantity', 'Cantidad media'], ['expected_quantity', 'Cantidad esperada'], ['explanation', 'Explicación']]} /></>}</>}</Section>
  </>;
}
