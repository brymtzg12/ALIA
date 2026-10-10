import { useState } from 'react';
import { Alert, Button, Card, Group, NumberInput, Select, SimpleGrid, Stack, Text } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { request, useApi, type List, type Row } from '../api';
import { DataTable, QueryState } from '../components/DataView';
import { FloorNav, OperatorPicker, ScanField } from '../components/FloorControls';
import { Code, ConfirmBar, EmptyState, PageHeader, Section, Stat } from '../components/Ui';
import { isInteger, recommendOrder, selectOrder, reservedByOrder, withdrawalLimit, type Reservation } from '../floorLogic';
import floor from './Piso.module.css';
import pages from './Pages.module.css';
export function Recepciones() {
  const query = useApi<List>('/unmatched-receipts');
  return <><PageHeader eyebrow="Almacén" title="Recepciones por relacionar" /><QueryState query={query} />{query.data && (query.data.items.length ? <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">{query.data.items.map(row => <Receipt key={String(row.id)} row={row} />)}</SimpleGrid> : <EmptyState>No hay recepciones pendientes.</EmptyState>)}</>;
}
function Receipt({ row }: { row: Row }) {
  const [part, setPart] = useState<string | number>('');
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => request('/unmatched-receipts/' + encodeURIComponent(String(row.id)) + '/resolve', { part_id: Number(part) }),
    onSuccess: () => { notifications.show({ title: 'Recepción relacionada', message: 'La entrada quedó registrada.', color: 'green' }); void client.invalidateQueries(); },
  });
  const candidates = (row.candidates ?? []) as Row[];
  return <Card><Stack><Group justify="space-between" align="start" wrap="nowrap" gap="md"><div className={pages.receiptHead}><Text className={pages.partNumber}>{String(row.part_number)}</Text><Text>{String(row.description)}</Text></div><Stat label="Cantidad" value={String(row.quantity)} /></Group>{candidates.length > 0 && <Select label="Piezas sugeridas" data={candidates.map(c => ({ value: String(c.part_id), label: String(c.sku ?? c.part_id) + ' · ' + String(c.name) }))} value={String(part) || null} onChange={value => setPart(value ?? '')} />}<Group align="end" gap="sm"><NumberInput className={pages.grow} label="ID de pieza" min={1} allowDecimal={false} value={part} onChange={setPart} /><Button disabled={!isInteger(part) || mutation.isSuccess} loading={mutation.isPending} onClick={() => mutation.mutate()}>Relacionar recepción</Button></Group>{mutation.error && <Alert color="red">{mutation.error.message}</Alert>}</Stack></Card>;
}
type Availability = { on_hand: number; reserved: number; available: number; locations: Row[] };
export function Piso() {
  const [location, setLocation] = useState('');
  const [part, setPart] = useState('');
  // Explicit selection survives scanning another piece. Suggestions never become explicit.
  const [order, setOrder] = useState('');
  const [quantityOverride, setQuantity] = useState<string | number | null>(null);
  const [operator, setOperator] = useState('');
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [notice, setNotice] = useState('');
  const [scanKey, setScanKey] = useState(0);
  const [lastIssue, setLastIssue] = useState<{ work_order_code: string; part_id: number; quantity: number } | null>(null);
  const client = useQueryClient();
  const locations = useApi<List>('/locations');
  const orders = useApi<List>('/work-orders?status=open');
  const reservations = useApi<{ items: Reservation[] }>('/parts/' + part + '/reservations', isInteger(part));
  const availability = useApi<Availability>('/parts/' + part + '/availability', isInteger(part));
  const reserves = reservedByOrder(reservations.data?.items ?? []);
  const recommendation = recommendOrder(reserves, quantityOverride != null && isInteger(quantityOverride) ? Number(quantityOverride) : undefined);
  const selectedOrder = selectOrder(order, reserves, quantityOverride != null && isInteger(quantityOverride) ? Number(quantityOverride) : undefined);
  const ownReserved = reserves.get(selectedOrder) ?? 0;
  const quantity = quantityOverride ?? (ownReserved || 1);
  const here = Number(availability.data?.locations.find(row => String(row.location_id) === location)?.on_hand ?? 0);
  const limit = withdrawalLimit(here, availability.data?.available ?? 0, ownReserved);
  const valid = isInteger(location) && isInteger(part) && isInteger(quantity) && !!selectedOrder && !!operator.trim() && Number(quantity) <= limit
    && availability.isSuccess && reservations.isSuccess && !availability.isFetching && !reservations.isFetching;
  const issue = useMutation({
    mutationFn: (body: { work_order_code: string; part_id: number; location_id: number; quantity: number; issued_by: string }) => request('/issues', body),
    onSuccess: (_data, body) => {
      notifications.show({ title: 'Salida registrada', message: 'La pieza se entregó a la orden.', color: 'green' });
      setPart(''); setCandidates([]); setQuantity(null); setScanKey(key => key + 1); setLastIssue(body); void client.invalidateQueries();
    },
    onError: () => { void availability.refetch(); void reservations.refetch(); },
  });
  function choosePart(value: string) { setPart(value); setQuantity(null); issue.reset(); }
  const codes = [...new Set([...reserves.keys(), ...(orders.data?.items.map(row => String(row.code)) ?? []), ...(order ? [order] : [])])];
  return <><PageHeader eyebrow="Operación de piso" title="Retirar piezas" description="Escanea ubicación, pieza y orden. Revisa la orden y la cantidad antes de confirmar." /><FloorNav />
    <div className={floor.steps}>
    <Section step={1} title="Escanear" tone="panel">
    {lastIssue && <Alert color="green" title="Última salida registrada">{lastIssue.quantity} × pieza {lastIssue.part_id} → orden <Code>{lastIssue.work_order_code}</Code></Alert>}
    <ScanField key={scanKey} disabled={issue.isPending} onResult={result => {
      setNotice(''); issue.reset();
      if (result.kind === 'location' && result.location) setLocation(String(result.location.location_id));
      else if (result.kind === 'work_order' && result.work_order) {
        if (result.work_order.deleted) { setNotice('La orden está dada de baja. Elige una orden activa.'); return; }
        setOrder(String(result.work_order.code)); setQuantity(null);
      } else if (result.kind === 'part' && result.parts?.length) {
        setCandidates(result.parts); choosePart(result.parts.length === 1 ? String(result.parts[0].part_id) : '');
        if (result.parts.length > 1) setNotice('Este SKU corresponde a varias piezas. Elige la correcta.');
      } else setNotice('Código no reconocido.');
    }} />
    {notice && <Alert color="orange">{notice}</Alert>}
    </Section>
    <Section step={2} title="Ubicación" tone="panel">
    <QueryState query={locations} /><Select searchable size="lg" label="Ubicación" disabled={issue.isPending} data={(locations.data?.items ?? []).filter(row => row.active !== false).map(row => ({ value: String(row.location_id), label: String(row.code) + ' · ' + String(row.name) }))} value={location || null} onChange={value => setLocation(value ?? '')} />
    </Section>
    <Section step={3} title="Pieza" tone="panel">
    {candidates.length > 1 && <Select size="lg" label="Seleccionar pieza" disabled={issue.isPending} data={candidates.map(row => ({ value: String(row.part_id), label: String(row.name) + ' (ID ' + row.part_id + ')' }))} value={part || null} onChange={value => choosePart(value ?? '')} />}
    <NumberInput size="lg" label="ID de pieza" disabled={issue.isPending} min={1} allowDecimal={false} value={part} onChange={value => { setCandidates([]); choosePart(String(value)); }} />
    {isInteger(part) && <><QueryState query={availability} />{availability.data && <DataTable rows={availability.data.locations} columns={[['code', 'Ubicación'], ['on_hand', 'Existencia']]} />}<QueryState query={reservations} /></>}
    </Section>
    <Section step={4} title="Orden de trabajo" tone="panel">
    <QueryState query={orders} /><Select searchable size="lg" label="Orden de trabajo" disabled={issue.isPending} placeholder="Escanea o elige la orden" value={selectedOrder || null} onChange={value => { setOrder(value ?? ''); setQuantity(null); issue.reset(); }} data={codes.map(value => ({ value, label: value + ' · ' + (reserves.get(value) ?? 0) + ' apartadas' }))} />
    {!order && recommendation && <Alert color="blue">Orden sugerida por su reserva: {recommendation}. Confirma que corresponde a tu trabajo.</Alert>}
    {isInteger(part) && reservations.isSuccess && !selectedOrder && <Alert color="orange">Hay varias órdenes posibles o ninguna con reserva suficiente. Escanea o elige la orden antes de retirar.</Alert>}
    {selectedOrder && <Text fw={600} size="lg" className={floor.callout}>Orden <Code>{selectedOrder}</Code>: {ownReserved} apartadas para esta pieza.</Text>}
    </Section>
    <Section step={5} title="Cantidad" tone="panel">
    <NumberInput size="lg" label="Cantidad a retirar" disabled={issue.isPending} min={1} allowDecimal={false} value={quantity} onChange={value => setQuantity(value)} />
    {availability.isSuccess && location && <SimpleGrid cols={2} spacing="sm"><Stat label="Existencia en ubicación" value={here} /><Stat label="Máximo retirable para esta orden" value={limit} /></SimpleGrid>}
    {availability.isSuccess && isInteger(quantity) && Number(quantity) > limit && <Alert color="red">No alcanza el saldo para esta orden y ubicación. Revisa la orden, la cantidad o las reservas.</Alert>}
    </Section>
    <Section step={6} title="Operador" tone="panel">
    <OperatorPicker value={operator} onChange={setOperator} />
    </Section>
    </div>
    <ConfirmBar><Button size="xl" fullWidth classNames={{ root: floor.confirm, label: floor.confirmLabel }} disabled={!valid} loading={issue.isPending} onClick={() => issue.mutate({ work_order_code: selectedOrder, part_id: Number(part), location_id: Number(location), quantity: Number(quantity), issued_by: operator.trim() })}>Confirmar retiro de {quantity} para {selectedOrder || 'una orden'}</Button>{issue.error && <Alert color="red">{issue.error.message}</Alert>}</ConfirmBar>
  </>;
}
