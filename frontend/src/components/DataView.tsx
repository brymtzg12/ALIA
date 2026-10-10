import { Alert, Badge, Button, Group, Loader, Stack, Table, Text } from '@mantine/core';
import type { UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Row } from '../api';
import { EmptyState } from './Ui';
import classes from './DataView.module.css';
const statuses: Record<string, [string, string]> = {
  partial: ['Parcial', 'orange'], complete: ['Completo', 'green'], missing: ['Faltante', 'red'],
  unidentified: ['Sin identificar', 'gray'], unknown_qty: ['Cantidad pendiente', 'gray'],
  receipt: ['Entrada', 'green'], issue: ['Salida', 'blue'], transfer_out: ['Transferencia de salida', 'orange'],
  transfer_in: ['Transferencia de entrada', 'cyan'], adjustment: ['Ajuste', 'violet'],
  awaiting_quick_inspection: ['Espera diagnóstico rápido', 'gray'], quick_inspection: ['Diagnóstico rápido', 'orange'],
  awaiting_full_inspection: ['Espera inspección completa', 'gray'], full_inspection: ['Inspección completa', 'orange'],
  cleaning: ['Limpieza', 'blue'], assembly: ['Armado', 'cyan'], run_in: ['Asentamiento', 'violet'],
  final_assembly: ['Armado final', 'cyan'], final_release: ['Liberado', 'green'],
  shortage: ['Por faltante', 'red'], below_min: ['Bajo mínimo', 'orange'],
  shortage_and_min: ['Faltante y bajo mínimo', 'red'], ok: ['Operativo', 'green'],
};
export function StatusBadge({ value }: { value: unknown }) {
  const [label, color] = statuses[String(value)] ?? [value == null ? 'Sin información' : String(value), 'gray'];
  return <Badge color={color} variant="light">{label}</Badge>;
}
export function QueryState({ query }: { query: UseQueryResult<unknown, Error> }) {
  if (query.isPending && query.fetchStatus !== 'idle') return <Group py="xs"><Loader size="sm" type="dots" /></Group>;
  if (query.error) return <Alert color="red" title="No se pudo cargar"><Stack gap="xs"><Text>{query.error.message}</Text><Button size="sm" color="red" variant="outline" onClick={() => void query.refetch()} className={classes.retry}>Reintentar</Button></Stack></Alert>;
  return null;
}
const currencyKeys = new Set(['avg_cost', 'value', 'average_cost_mxn', 'inventory_value_mxn']);
const codeKeys = new Set(['part_id', 'location_id', 'sku', 'code', 'work_order_code', 'reference', 'topic', 'part_number']);
function isNumericColumn(rows: Row[], key: string) {
  return currencyKeys.has(key) || key === 'probability' || (!key.endsWith('_id') && rows.some(row => typeof row[key] === 'number'));
}
export function DataTable({ rows, columns }: { rows: Row[]; columns: [string, string][] }) {
  if (!rows.length) return <EmptyState>No hay registros.</EmptyState>;
  const numeric = new Set(columns.filter(([key]) => isNumericColumn(rows, key)).map(([key]) => key));
  return <Table.ScrollContainer minWidth={650} className={classes.frame}><Table striped highlightOnHover><Table.Thead><Table.Tr>{columns.map(([key, title]) => <Table.Th key={key} className={numeric.has(key) ? classes.num : undefined}>{title}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{rows.map((row, i) => <Table.Tr key={String(row.movement_id ?? row.bom_line_id ?? row.inspection_item_id ?? row.id ?? i)}>{columns.map(([key]) => {
    const value = row[key];
    let label = value == null ? 'Sin información' : Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? value ? 'Sí' : 'No' : String(value);
    if (key === 'probability' && value != null) label = new Intl.NumberFormat('es-MX', { style: 'percent', maximumFractionDigits: 1 }).format(Number(value));
    if (currencyKeys.has(key) && value != null) label = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value));
    if (key.endsWith('_at') && typeof value === 'string' && !Number.isNaN(Date.parse(value))) label = new Date(value).toLocaleString('es-MX');
    let content = <>{label}</>;
    if (['line_status', 'type', 'stage', 'status', 'reason', 'suggestion_reason'].includes(key) && statuses[String(value)]) content = <StatusBadge value={value} />;
    else if (key === 'kit_complete' || key === 'complete') content = <Badge color={value ? 'green' : 'orange'}>{value ? 'Completo' : 'Pendiente'}</Badge>;
    else if (key === 'below_min') content = <Badge color={value ? 'red' : 'green'}>{value ? 'Bajo mínimo' : 'En rango'}</Badge>;
    else if ((key === 'work_order_code' || key === 'code') && /^R\d/.test(label)) content = <Link to={'/ordenes/' + encodeURIComponent(label)}>{label}</Link>;
    else if (key === 'part_id' && value != null) content = <Link to={'/piezas/' + value}>{label}</Link>;
    return <Table.Td key={key} className={numeric.has(key) ? classes.num : codeKeys.has(key) ? classes.code : undefined}>{content}</Table.Td>;
  })}</Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>;
}
