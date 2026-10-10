import { useState } from 'react';
import { Alert, Button, Card, NumberInput, Select, Stack, Text, Title } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { request, useApi, type List, type Row } from '../api';
import { DataTable, QueryState } from '../components/DataView';
import { FloorNav, OperatorPicker, ScanField } from '../components/FloorControls';
import { isInteger, recommendOrder, selectOrder, reservedByOrder, withdrawalLimit, type Reservation } from '../floorLogic';
export function Recepciones() {
  const query = useApi<List>('/unmatched-receipts');
  return <Stack><Title order={2}>Recepciones por relacionar</Title><QueryState query={query} />{query.data && (query.data.items.length ? query.data.items.map(row => <Receipt key={String(row.id)} row={row} />) : <Text>No hay recepciones pendientes.</Text>)}</Stack>;
}
function Receipt({ row }: { row: Row }) {
  const [part, setPart] = useState<string | number>('');
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => request('/unmatched-receipts/' + encodeURIComponent(String(row.id)) + '/resolve', { part_id: Number(part) }),
    onSuccess: () => { notifications.show({ title: 'Recepción relacionada', message: 'La entrada quedó registrada.', color: 'green' }); void client.invalidateQueries(); },
  });
  const candidates = (row.candidates ?? []) as Row[];
  return <Card withBorder><Stack><Text fw={600}>{String(row.part_number)} · {String(row.description)}</Text><Text>Cantidad: {String(row.quantity)}</Text>{candidates.length > 0 && <Select label="Piezas sugeridas" data={candidates.map(c => ({ value: String(c.part_id), label: String(c.sku ?? c.part_id) + ' · ' + String(c.name) }))} value={String(part) || null} onChange={value => setPart(value ?? '')} />}<NumberInput label="ID de pieza" min={1} allowDecimal={false} value={part} onChange={setPart} /><Button disabled={!isInteger(part) || mutation.isSuccess} loading={mutation.isPending} onClick={() => mutation.mutate()}>Relacionar recepción</Button>{mutation.error && <Alert color="red">{mutation.error.message}</Alert>}</Stack></Card>;
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
    onSuccess: () => {
      notifications.show({ title: 'Salida registrada', message: 'La pieza se entregó a la orden.', color: 'green' });
      setPart(''); setCandidates([]); setQuantity(null); void client.invalidateQueries();
    },
    onError: () => { void availability.refetch(); void reservations.refetch(); },
  });
  function choosePart(value: string) { setPart(value); setQuantity(null); issue.reset(); }
  const codes = [...new Set([...reserves.keys(), ...(orders.data?.items.map(row => String(row.code)) ?? []), ...(order ? [order] : [])])];
  return <Stack><Title order={2}>Retirar piezas</Title><FloorNav /><Text c="dimmed">Escanea ubicación, pieza y orden. Revisa la orden y la cantidad antes de confirmar.</Text>
    <ScanField disabled={issue.isPending} onResult={result => {
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
    <QueryState query={locations} /><Select searchable label="Ubicación" disabled={issue.isPending} data={(locations.data?.items ?? []).filter(row => row.active !== false).map(row => ({ value: String(row.location_id), label: String(row.code) + ' · ' + String(row.name) }))} value={location || null} onChange={value => setLocation(value ?? '')} />
    {candidates.length > 1 && <Select label="Seleccionar pieza" disabled={issue.isPending} data={candidates.map(row => ({ value: String(row.part_id), label: String(row.name) + ' (ID ' + row.part_id + ')' }))} value={part || null} onChange={value => choosePart(value ?? '')} />}
    <NumberInput label="ID de pieza" disabled={issue.isPending} min={1} allowDecimal={false} value={part} onChange={value => { setCandidates([]); choosePart(String(value)); }} />
    {isInteger(part) && <><QueryState query={availability} />{availability.data && <DataTable rows={availability.data.locations} columns={[['code', 'Ubicación'], ['on_hand', 'Existencia']]} />}<QueryState query={reservations} /></>}
    <QueryState query={orders} /><Select searchable label="Orden de trabajo" disabled={issue.isPending} placeholder="Escanea o elige la orden" value={selectedOrder || null} onChange={value => { setOrder(value ?? ''); setQuantity(null); issue.reset(); }} data={codes.map(value => ({ value, label: value + ' · ' + (reserves.get(value) ?? 0) + ' apartadas' }))} />
    {!order && recommendation && <Alert color="blue">Orden sugerida por su reserva: {recommendation}. Confirma que corresponde a tu trabajo.</Alert>}
    {isInteger(part) && reservations.isSuccess && !selectedOrder && <Alert color="orange">Hay varias órdenes posibles o ninguna con reserva suficiente. Escanea o elige la orden antes de retirar.</Alert>}
    {selectedOrder && <Text fw={600}>Orden {selectedOrder}: {ownReserved} apartadas para esta pieza.</Text>}
    <NumberInput label="Cantidad a retirar" disabled={issue.isPending} min={1} allowDecimal={false} value={quantity} onChange={value => setQuantity(value)} />
    {availability.isSuccess && location && <Text>Existencia en ubicación: {here} · Máximo retirable para esta orden: {limit}</Text>}
    {availability.isSuccess && isInteger(quantity) && Number(quantity) > limit && <Alert color="red">No alcanza el saldo para esta orden y ubicación. Revisa la orden, la cantidad o las reservas.</Alert>}
    <OperatorPicker value={operator} onChange={setOperator} />
    <Button disabled={!valid} loading={issue.isPending} onClick={() => issue.mutate({ work_order_code: selectedOrder, part_id: Number(part), location_id: Number(location), quantity: Number(quantity), issued_by: operator.trim() })}>Confirmar retiro de {quantity} para {selectedOrder || 'una orden'}</Button>{issue.error && <Alert color="red">{issue.error.message}</Alert>}
  </Stack>;
}
