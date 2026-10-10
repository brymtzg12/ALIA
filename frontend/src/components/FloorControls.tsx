import { lazy, Suspense, useState } from 'react';
import { Alert, Button, Group, Loader, Select, Stack, TextInput } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { request, type Row } from '../api';
import classes from './FloorControls.module.css';
const Scanner = lazy(() => import('./Scanner'));
export type ScanResult = { kind: string; location?: Row; work_order?: Row; parts?: Row[] };
export function FloorNav() {
  const { pathname } = useLocation();
  return <nav aria-label="Modos de piso" className={classes.floorNav}>{([['/piso/retirar', 'Retirar'], ['/piso/transferir', 'Transferir'], ['/piso/contar', 'Contar']] as const).map(([to, label]) => <Button key={to} component={Link} to={to} size="lg" variant={pathname === to ? 'filled' : 'default'} aria-current={pathname === to ? 'page' : undefined} className={classes.floorNavItem}>{label}</Button>)}</nav>;
}
export function ScanField({ onResult, disabled = false }: { onResult: (result: ScanResult) => void; disabled?: boolean }) {
  const [code, setCode] = useState('');
  const scan = useMutation({
    mutationFn: (raw: string) => request<ScanResult>('/scan?code=' + encodeURIComponent(raw.trim())),
    onSuccess: onResult,
  });
  return <Stack gap="md"><Suspense fallback={<Loader size="sm" />}>{!disabled && !scan.isPending && <Scanner onCode={value => { setCode(value); scan.mutate(value); }} />}</Suspense><Group align="end" gap="sm" className={classes.scanRow}><TextInput label="Código de etiqueta" size="lg" className={classes.grow} classNames={{ input: classes.codeInput }} value={code} disabled={disabled || scan.isPending} onChange={e => setCode(e.currentTarget.value)} /><Button size="lg" disabled={disabled || !code.trim()} loading={scan.isPending} onClick={() => scan.mutate(code)}>Leer código</Button></Group>{scan.error && <Alert color="red">{scan.error.message}</Alert>}</Stack>;
}
export function OperatorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [names, setNames] = useState<string[]>(() => {
    try { const stored: unknown = JSON.parse(localStorage.getItem('kitlisto-operators') ?? '[]'); return Array.isArray(stored) ? stored.filter((name): name is string => typeof name === 'string') : []; } catch { return []; }
  });
  function remember() {
    const name = value.trim();
    if (!name) return;
    const next = [...new Set([...names, name])];
    setNames(next); onChange(name);
    try { localStorage.setItem('kitlisto-operators', JSON.stringify(next)); } catch { /* La sesión funciona sin almacenamiento local. */ }
  }
  return <Stack gap="md"><Select label="¿Quién eres?" size="lg" placeholder="Elige un operador guardado" data={names} value={names.includes(value) ? value : null} onChange={name => onChange(name ?? '')} searchable /><Group align="end" gap="sm" className={classes.scanRow}><TextInput label="Nombre o identificador del operador" size="lg" className={classes.grow} value={value} onChange={e => onChange(e.currentTarget.value)} /><Button size="lg" variant="light" disabled={!value.trim()} onClick={remember}>Guardar operador</Button></Group></Stack>;
}
