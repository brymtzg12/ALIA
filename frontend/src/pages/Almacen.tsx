import { useState } from 'react';
import { Card, Group, SimpleGrid, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useApi, type List } from '../api';
import { DataTable, QueryState } from '../components/DataView';
export default function AlmacenScreen() {
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [stock, setStock] = useState(true);
  const parts = useApi<List>('/parts?limit=1000&search=' + encodeURIComponent(debounced) + '&with_stock=' + stock);
  const shortages = useApi<List>('/shortages');
  const suggestions = useApi<List>('/reorder-suggestions');
  const orders = useApi<List>('/work-orders?status=open');
  const receipts = useApi<List>('/unmatched-receipts');
  const kpis = [
    { title: 'Piezas identificadas con faltante', query: shortages, count: new Set(shortages.data?.items.map(r => r.part_id).filter(id => id != null)).size },
    { title: 'Órdenes abiertas', query: orders, count: orders.data?.items.length },
    { title: 'Recepciones por relacionar', query: receipts, count: receipts.data?.items.length },
  ];
  return <Stack><Title order={2}>Almacén</Title><SimpleGrid cols={{ base: 1, sm: 3 }}>{kpis.map(kpi => <Card withBorder key={kpi.title}><Text c="dimmed">{kpi.title}</Text><Text size="xl" fw={700}>{kpi.query.isSuccess ? kpi.count : '—'}</Text><QueryState query={kpi.query} /></Card>)}</SimpleGrid>
    <Title order={3}>Sugerencias de compra</Title><QueryState query={suggestions} />{suggestions.data && <DataTable rows={suggestions.data.items} columns={[['part_id', 'Pieza'], ['sku', 'SKU'], ['name', 'Nombre'], ['suggested_quantity', 'Comprar'], ['work_order_codes', 'Órdenes']]} />}
    <Title order={3}>Faltantes abiertos</Title><QueryState query={shortages} />{shortages.data && <DataTable rows={shortages.data.items} columns={[['work_order_code', 'Orden'], ['part_id', 'Pieza'], ['name', 'Nombre'], ['missing_quantity', 'Cantidad'], ['opened_at', 'Desde']]} />}
    <Title order={3}>Inventario</Title><Group><TextInput label="Buscar pieza" placeholder="SKU o nombre" value={search} onChange={e => setSearch(e.currentTarget.value)} /><Switch label="Solo con existencia o faltantes" checked={stock} onChange={e => setStock(e.currentTarget.checked)} /></Group><Text c="dimmed" size="sm">Hasta 1,000 resultados. Usa la búsqueda para acotar el catálogo.</Text><QueryState query={parts} />{parts.data && <DataTable rows={parts.data.items} columns={[['part_id', 'Pieza'], ['sku', 'SKU'], ['name', 'Nombre'], ['on_hand', 'Existencia'], ['reserved', 'Reservado'], ['available', 'Disponible'], ['open_shortages', 'Faltantes']]} />}
  </Stack>;
}
