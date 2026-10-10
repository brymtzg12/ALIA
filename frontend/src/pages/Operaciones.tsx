import { useState } from 'react';
import { Alert, Button, Card, Group, NumberInput, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { request, useApi, type List, type Row } from '../api';
import { DataTable, QueryState } from '../components/DataView';
import Scanner from '../components/Scanner';
const positiveId = (value: unknown) => Number.isInteger(Number(value)) && Number(value) > 0;
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
  return <Card withBorder><Stack><Text fw={600}>{String(row.part_number)} · {String(row.description)}</Text><Text>Cantidad: {String(row.quantity)}</Text>{candidates.length > 0 && <Select label="Piezas sugeridas" data={candidates.map(c => ({ value: String(c.part_id), label: String(c.sku ?? c.part_id) + ' · ' + String(c.name) }))} value={String(part) || null} onChange={value => setPart(value ?? '')} />}<NumberInput label="ID de pieza" min={1} allowDecimal={false} value={part} onChange={setPart} /><Button disabled={!positiveId(part) || mutation.isSuccess} loading={mutation.isPending} onClick={() => mutation.mutate()}>Relacionar recepción</Button>{mutation.error && <Alert color="red">{mutation.error.message}</Alert>}</Stack></Card>;
}
type ScanResult = { kind: string; location?: Row; work_order?: Row; parts?: Row[] };
export function Piso() {
  const [code, setCode] = useState('');
  const [location, setLocation] = useState('');
  const [part, setPart] = useState('');
  const [order, setOrder] = useState('');
  const [quantity, setQuantity] = useState<string | number>(1);
  const [operator, setOperator] = useState('');
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [notice, setNotice] = useState('');
  const client = useQueryClient();
  const locations = useApi<List>('/locations');
  const orders = useApi<List>('/work-orders?status=open');
  const reservations = useApi<List>('/parts/' + part + '/reservations', !!part);
  const availability = useApi<Row & { locations: Row[] }>('/parts/' + part + '/availability', !!part);
  const scan = useMutation({
    mutationFn: (raw: string) => request<ScanResult>('/scan?code=' + encodeURIComponent(raw)),
    onSuccess: result => {
      setNotice('');
      if (result.kind === 'location' && result.location) setLocation(String(result.location.location_id));
      else if (result.kind === 'work_order' && result.work_order) setOrder(String(result.work_order.code));
      else if (result.kind === 'part' && result.parts?.length) {
        setCandidates(result.parts); setOrder('');
        setPart(result.parts.length === 1 ? String(result.parts[0].part_id) : '');
        if (result.parts.length > 1) setNotice('Este SKU corresponde a varias piezas. Elige la correcta.');
      } else setNotice('Código no reconocido.');
    },
  });
  const issue = useMutation({
    mutationFn: (workOrderCode: string) => request('/issues', { work_order_code: workOrderCode, part_id: Number(part), location_id: Number(location), quantity: Number(quantity), issued_by: operator.trim() }),
    onSuccess: () => { notifications.show({ title: 'Salida registrada', message: 'La pieza se entregó a la orden.', color: 'green' }); setQuantity(1); void client.invalidateQueries(); },
  });
  const reservationOptions = reservations.data?.items.map(row => String(row.work_order_code)) ?? [];
  const selectedOrder = order || reservationOptions[0] || '';
  const valid = positiveId(location) && positiveId(part) && positiveId(quantity) && !!selectedOrder && !!operator.trim();
  return <Stack><Title order={2}>Retirar piezas</Title><Text c="dimmed">Escanea ubicación, pieza y orden. También puedes escribir los códigos o elegir de las listas.</Text>
    <Scanner onCode={value => { setCode(value); scan.mutate(value); }} /><Group align="end"><TextInput label="Código de etiqueta" value={code} onChange={e => setCode(e.currentTarget.value)} /><Button loading={scan.isPending} disabled={!code.trim()} onClick={() => scan.mutate(code.trim())}>Leer código</Button></Group>
    {notice && <Alert>{notice}</Alert>}{scan.error && <Alert color="red">{scan.error.message}</Alert>}
    <QueryState query={locations} /><Select searchable label="Ubicación" data={(locations.data?.items ?? []).filter(row => row.active !== false).map(row => ({ value: String(row.location_id), label: String(row.code) + ' · ' + String(row.name) }))} value={location || null} onChange={value => setLocation(value ?? '')} />
    {candidates.length > 1 && <Select label="Seleccionar pieza" data={candidates.map(row => ({ value: String(row.part_id), label: String(row.name) + ' (ID ' + row.part_id + ')' }))} value={part || null} onChange={value => { setPart(value ?? ''); setOrder(''); }} />}
    <NumberInput label="ID de pieza" min={1} allowDecimal={false} value={part} onChange={value => { setPart(String(value)); setOrder(''); }} />
    {part && <><QueryState query={availability} />{availability.data && <DataTable rows={availability.data.locations} columns={[['code', 'Ubicación'], ['on_hand', 'Existencia']]} />}<QueryState query={reservations} /></>}
    <QueryState query={orders} /><Select searchable label="Orden de trabajo" value={selectedOrder || null} onChange={value => setOrder(value ?? '')} data={[...new Set([...reservationOptions, ...(orders.data?.items.map(row => String(row.code)) ?? []), ...(order ? [order] : [])])].map(value => ({ value, label: value + (reservationOptions.includes(value) ? ' · Con reserva' : '') }))} />
    <NumberInput label="Cantidad a retirar" min={1} allowDecimal={false} value={quantity} onChange={setQuantity} /><TextInput label="Entregado por" value={operator} onChange={e => setOperator(e.currentTarget.value)} />
    <Button disabled={!valid} loading={issue.isPending} onClick={() => { issue.mutate(selectedOrder); }}>Confirmar retiro</Button>{issue.error && <Alert color="red">{issue.error.message}</Alert>}
  </Stack>;
}
