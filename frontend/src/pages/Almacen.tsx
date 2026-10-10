import { useState } from 'react';
import { Select, SimpleGrid, Switch, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useApi, type List, type Row } from '../api';
import { DataTable, QueryState } from '../components/DataView';
import { PageHeader, Section, Stat } from '../components/Ui';
import pages from './Pages.module.css';
export default function AlmacenScreen() {
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [stock, setStock] = useState(true);
  const parts = useApi<List>('/parts?limit=1000&search=' + encodeURIComponent(debounced) + '&with_stock=' + stock);
  const shortages = useApi<List>('/shortages');
  const suggestions = useApi<List>('/reorder-suggestions');
  const orders = useApi<List>('/work-orders?status=open');
  const receipts = useApi<List>('/unmatched-receipts');
  const [location, setLocation] = useState<string | null>(null);
  const locations = useApi<List>('/locations');
  const withStock = (locations.data?.items ?? []).find(row => Number(row.units) > 0);
  const shownLocation = location ?? (withStock ? String(withStock.location_id) : null);
  const locationStock = useApi<Row & { items: Row[] }>('/locations/' + shownLocation + '/stock', shownLocation != null);
  const kpis = [
    { title: 'Piezas identificadas con faltante', query: shortages, count: new Set(shortages.data?.items.map(r => r.part_id).filter(id => id != null)).size },
    { title: 'Órdenes abiertas', query: orders, count: orders.data?.items.length },
    { title: 'Recepciones por relacionar', query: receipts, count: receipts.data?.items.length },
  ];
  return <><PageHeader title="Almacén" /><SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">{kpis.map(kpi => <Stat key={kpi.title} size="lg" label={kpi.title} value={kpi.query.isSuccess ? kpi.count : '—'}><QueryState query={kpi.query} /></Stat>)}</SimpleGrid>
    <Section title="Sugerencias de compra"><QueryState query={suggestions} />{suggestions.data && <DataTable rows={suggestions.data.items} columns={[['part_id', 'Pieza'], ['sku', 'SKU'], ['name', 'Nombre'], ['suggested_quantity', 'Comprar'], ['work_order_codes', 'Órdenes']]} />}</Section>
    <Section title="Faltantes abiertos"><QueryState query={shortages} />{shortages.data && <DataTable rows={shortages.data.items} columns={[['work_order_code', 'Orden'], ['part_id', 'Pieza'], ['name', 'Nombre'], ['missing_quantity', 'Cantidad'], ['opened_at', 'Desde']]} />}</Section>
    <Section title="Inventario"><div className={pages.toolbar}><TextInput className={pages.search} label="Buscar pieza" placeholder="SKU o nombre" value={search} onChange={e => setSearch(e.currentTarget.value)} /><Switch size="md" label="Solo con existencia o faltantes" checked={stock} onChange={e => setStock(e.currentTarget.checked)} /></div><Text c="dimmed" size="sm">Hasta 1,000 resultados. Usa la búsqueda para acotar el catálogo.</Text><QueryState query={parts} />{parts.data && <DataTable rows={parts.data.items} columns={[['part_id', 'Pieza'], ['sku', 'SKU'], ['name', 'Nombre'], ['on_hand', 'Existencia'], ['reserved', 'Reservado'], ['available', 'Disponible'], ['open_shortages', 'Faltantes']]} />}</Section>
    <Section title="Existencias por ubicación"><QueryState query={locations} /><div className={pages.toolbar}><Select searchable className={pages.search} label="Ubicación" placeholder="Elige una ubicación" data={(locations.data?.items ?? []).filter(row => row.active !== false).map(row => ({ value: String(row.location_id), label: String(row.code) + ' · ' + String(row.name) + ' · ' + String(row.parts ?? 0) + ' piezas, ' + String(row.units ?? 0) + ' unidades' }))} value={shownLocation} onChange={setLocation} allowDeselect={false} /></div>{shownLocation && <><Text c="dimmed" size="sm">«Aquí» es la existencia en esta ubicación. Reservado y disponible son de la pieza en total, porque las reservas son por pieza y no por ubicación.</Text><QueryState query={locationStock} />{locationStock.data && <DataTable rows={locationStock.data.items} columns={[['part_id', 'Pieza'], ['sku', 'SKU'], ['name', 'Nombre'], ['on_hand', 'Aquí'], ['part_reserved', 'Reservado'], ['part_available', 'Disponible']]} />}</>}</Section>
  </>;
}
