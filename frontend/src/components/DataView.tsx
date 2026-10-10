import { Alert, Button, Loader, Stack, Table, Text } from '@mantine/core';
import type { UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Row } from '../api';
export function QueryState({ query }: { query: UseQueryResult<unknown, Error> }) {
  if (query.isPending && query.fetchStatus !== 'idle') return <Loader size="sm" />;
  if (query.error) return <Alert color="red" title="Error de conexión"><Stack gap="xs"><Text>{query.error.message}</Text><Button size="xs" onClick={() => void query.refetch()}>Reintentar</Button></Stack></Alert>;
  return null;
}
export function DataTable({ rows, columns }: { rows: Row[]; columns: [string, string][] }) {
  if (!rows.length) return <Text c="dimmed">No hay registros.</Text>;
  return <Table.ScrollContainer minWidth={650}><Table striped highlightOnHover><Table.Thead><Table.Tr>{columns.map(([key, title]) => <Table.Th key={key}>{title}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{rows.map((row, i) => <Table.Tr key={i}>{columns.map(([key]) => {
    const value = row[key];
    const label = value == null ? 'Sin información' : Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? value ? 'Sí' : 'No' : String(value);
    return <Table.Td key={key}>{(key === 'work_order_code' || key === 'code') && /^R\d/.test(label) ? <Link to={'/ordenes/' + encodeURIComponent(label)}>{label}</Link> : key === 'part_id' && value != null ? <Link to={'/piezas/' + value}>{label}</Link> : label}</Table.Td>;
  })}</Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>;
}
