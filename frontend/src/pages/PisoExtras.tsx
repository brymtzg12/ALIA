import { useState } from 'react';
import { Alert, Button, Group, NumberInput, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { request, useApi, type List, type Row } from '../api';
import { DataTable, QueryState } from '../components/DataView';
import { FloorNav, ScanField } from '../components/FloorControls';
import { isInteger } from '../floorLogic';
function locationOptions(items: Row[]) {
  return items.filter(row => row.active !== false).map(row => ({ value: String(row.location_id), label: String(row.code) + ' · ' + String(row.name) }));
}
export function Transferir() {
  const [part, setPart] = useState<string | number>('');
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [scanTarget, setScanTarget] = useState<string | null>('origen');
  const [quantity, setQuantity] = useState<string | number>(1);
  const [notice, setNotice] = useState('');
  const client = useQueryClient();
  const locations = useApi<List>('/locations');
  const stock = useApi<{ locations: Row[] }>('/parts/' + part + '/availability', isInteger(part));
  const here = Number(stock.data?.locations.find(row => String(row.location_id) === from)?.on_hand ?? 0);
  const transfer = useMutation({
    mutationFn: (body: { part_id: number; from_location_id: number; to_location_id: number; quantity: number }) => request('/transfers', body),
    onSuccess: () => { notifications.show({ title: 'Transferencia registrada', message: 'La pieza cambió de ubicación.', color: 'green' }); setQuantity(1); void client.invalidateQueries(); },
    onError: () => { void stock.refetch(); },
  });
  const valid = isInteger(part) && isInteger(from) && isInteger(to) && from !== to && isInteger(quantity) && Number(quantity) <= here && stock.isSuccess && !stock.isFetching;
  return <Stack><Title order={2}>Transferir piezas</Title><FloorNav /><Select label="La siguiente ubicación escaneada será" data={[{ value: 'origen', label: 'Origen' }, { value: 'destino', label: 'Destino' }]} value={scanTarget} onChange={setScanTarget} allowDeselect={false} />
    <ScanField disabled={transfer.isPending} onResult={result => {
      setNotice(''); transfer.reset();
      if (result.kind === 'location' && result.location) {
        const value = String(result.location.location_id);
        if (scanTarget === 'destino') setTo(value); else { setFrom(value); setScanTarget('destino'); }
      } else if (result.kind === 'part' && result.parts?.length) {
        setCandidates(result.parts); setPart(result.parts.length === 1 ? String(result.parts[0].part_id) : '');
      } else setNotice('Escanea una pieza o una ubicación.');
    }} />{notice && <Alert>{notice}</Alert>}
    <QueryState query={locations} /><Select searchable label="Ubicación de origen" disabled={transfer.isPending} data={locationOptions(locations.data?.items ?? [])} value={from || null} onChange={value => setFrom(value ?? '')} /><Select searchable label="Ubicación de destino" disabled={transfer.isPending} data={locationOptions(locations.data?.items ?? [])} value={to || null} onChange={value => setTo(value ?? '')} />
    {candidates.length > 1 && <Select label="Pieza del SKU compartido" disabled={transfer.isPending} data={candidates.map(row => ({ value: String(row.part_id), label: String(row.name) + ' · ID ' + row.part_id }))} value={String(part) || null} onChange={value => setPart(value ?? '')} />}
    <NumberInput label="ID de pieza" disabled={transfer.isPending} min={1} allowDecimal={false} value={part} onChange={setPart} />
    {isInteger(part) && <><QueryState query={stock} />{stock.data && <DataTable rows={stock.data.locations} columns={[['code', 'Ubicación'], ['on_hand', 'Existencia']]} />}</>}
    <NumberInput label="Cantidad a transferir" disabled={transfer.isPending} min={1} allowDecimal={false} value={quantity} onChange={setQuantity} />
    {from && stock.isSuccess && <Text>Existencia en origen: {here}</Text>}{from && to === from && <Alert color="red">El origen y el destino deben ser diferentes.</Alert>}{stock.isSuccess && Number(quantity) > here && <Alert color="red">La cantidad supera la existencia en origen.</Alert>}
    <Button disabled={!valid} loading={transfer.isPending} onClick={() => transfer.mutate({ part_id: Number(part), from_location_id: Number(from), to_location_id: Number(to), quantity: Number(quantity) })}>Confirmar transferencia</Button>{transfer.error && <Alert color="red">{transfer.error.message}</Alert>}
  </Stack>;
}
export function Contar() {
  const [location, setLocation] = useState('');
  const [reason, setReason] = useState('');
  const [counts, setCounts] = useState<Record<string, string | number>>({});
  const [extraParts, setExtraParts] = useState<string[]>([]);
  const [newPart, setNewPart] = useState<string | number>('');
  const [notice, setNotice] = useState('');
  const client = useQueryClient();
  const locations = useApi<List>('/locations');
  const stock = useApi<List>('/locations/' + location + '/stock', isInteger(location));
  const count = useMutation({
    mutationFn: (body: { location_id: number; reason: string; lines: { part_id: number; counted_quantity: number }[] }) => request<{ adjustments: Row[] }>('/counts', body),
    onSuccess: () => { notifications.show({ title: 'Conteo registrado', message: 'Los ajustes quedaron guardados.', color: 'green' }); setCounts({}); void client.invalidateQueries(); },
  });
  function chooseLocation(value: string) { setLocation(value); setCounts({}); setExtraParts([]); count.reset(); }
  function addPart(value: string) { if (isInteger(value)) setExtraParts(parts => [...new Set([...parts, value])]); }
  const rows = [...(stock.data?.items ?? []), ...extraParts.filter(id => !stock.data?.items.some(row => String(row.part_id) === id)).map(id => ({ part_id: Number(id), name: 'Pieza ' + id, on_hand: 0 }))];
  const captured = Object.entries(counts).filter(([, value]) => value !== '');
  const valid = isInteger(location) && !!reason.trim() && captured.length > 0 && captured.every(([id, value]) => isInteger(id) && isInteger(value, 0));
  return <Stack><Title order={2}>Conteo de ubicación</Title><FloorNav /><Text>Solo se ajustan las piezas con cantidad capturada. Cero significa que no encontraste unidades; una casilla vacía no modifica esa pieza.</Text>
    <ScanField disabled={count.isPending} onResult={result => {
      setNotice('');
      if (result.kind === 'location' && result.location) chooseLocation(String(result.location.location_id));
      else if (result.kind === 'part' && result.parts?.length === 1) addPart(String(result.parts[0].part_id));
      else setNotice('Escanea una ubicación o una pieza única. Para SKU compartido, agrega el ID de la pieza.');
    }} />{notice && <Alert>{notice}</Alert>}
    <QueryState query={locations} /><Select searchable label="Ubicación a contar" disabled={count.isPending} data={locationOptions(locations.data?.items ?? [])} value={location || null} onChange={value => chooseLocation(value ?? '')} />
    {isInteger(location) && <><QueryState query={stock} /><Table.ScrollContainer minWidth={500}><Table><Table.Thead><Table.Tr><Table.Th>Pieza</Table.Th><Table.Th>Registrado</Table.Th><Table.Th>Contado</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{rows.map(row => <Table.Tr key={String(row.part_id)}><Table.Td>{String(row.name)} · ID {String(row.part_id)}</Table.Td><Table.Td>{String(row.on_hand)}</Table.Td><Table.Td><NumberInput aria-label={'Cantidad contada de la pieza ' + row.part_id} disabled={count.isPending} min={0} allowDecimal={false} value={counts[String(row.part_id)] ?? ''} onChange={value => setCounts(previous => ({ ...previous, [String(row.part_id)]: value }))} /></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer><Group align="end"><NumberInput label="Agregar pieza por ID" disabled={count.isPending} min={1} allowDecimal={false} value={newPart} onChange={setNewPart} /><Button variant="light" disabled={!isInteger(newPart) || count.isPending} onClick={() => { addPart(String(newPart)); setNewPart(''); }}>Agregar pieza</Button></Group></>}
    <TextInput label="Motivo del conteo" disabled={count.isPending} value={reason} onChange={e => setReason(e.currentTarget.value)} /><Button disabled={!valid} loading={count.isPending} onClick={() => count.mutate({ location_id: Number(location), reason: reason.trim(), lines: captured.map(([id, value]) => ({ part_id: Number(id), counted_quantity: Number(value) })) })}>Registrar conteo de {captured.length} piezas</Button>
    {count.error && <Alert color="red">{count.error.message}</Alert>}{count.data && <><Title order={3}>Ajustes registrados</Title><DataTable rows={count.data.adjustments} columns={[['part_id', 'Pieza'], ['delta', 'Diferencia']]} /></>}
  </Stack>;
}
