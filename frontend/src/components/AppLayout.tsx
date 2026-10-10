import { ActionIcon, AppShell, Burger, Button, Group, NavLink, ScrollArea, Stack, Text, Title, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Outlet, Link, useLocation } from 'react-router-dom';
import classes from './AppLayout.module.css';
const groups: [string, [string, string][]][] = [
  ['Operación de piso', [['/piso/retirar', 'Retirar piezas'], ['/piso/transferir', 'Transferir piezas'], ['/piso/contar', 'Contar piezas']]],
  ['Almacén', [['/almacen', 'Almacén'], ['/ordenes', 'Órdenes de trabajo'], ['/recepciones', 'Recepciones']]],
  ['Planeación', [['/pronostico', 'Pronóstico'], ['/politicas', 'Políticas']]],
  ['Análisis', [['/valuacion', 'Valuación'], ['/rotacion', 'Rotación']]],
  ['Sistema', [['/salud', 'Salud del sistema']]],
];
function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const next = computed === 'dark' ? 'light' : 'dark';
  return <ActionIcon variant="subtle" size={40} className={classes.schemeToggle} aria-label={next === 'dark' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'} title={next === 'dark' ? 'Modo oscuro' : 'Modo claro'} onClick={() => setColorScheme(next)}>
    {computed === 'dark'
      ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>}
  </ActionIcon>;
}
export default function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const location = useLocation();
  return <AppShell header={{ height: 64 }} navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
    <AppShell.Header><Group h="100%" px="md" justify="space-between" wrap="nowrap"><Group gap="sm" wrap="nowrap"><Burger aria-label="Abrir menú" opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" color="var(--kl-header-text)" /><Title order={3} className={classes.brand}><span className={classes.brandMark} aria-hidden="true" />ALIA</Title></Group><Group gap="xs" wrap="nowrap"><ColorSchemeToggle /><Button component={Link} to="/piso/retirar" color="seguridad.5" className={classes.floorButton} onClick={close}>Modo piso</Button></Group></Group></AppShell.Header>
    <AppShell.Navbar p="sm"><ScrollArea><Stack gap="lg" py="xs">{groups.map(([group, links]) => <div key={group}><Text component="div" className={classes.groupLabel}>{group}</Text>{links.map(([path, label]) => <NavLink key={path} component={Link} to={path} label={label} active={location.pathname === path || location.pathname.startsWith(path + '/')} onClick={close} />)}</div>)}</Stack></ScrollArea></AppShell.Navbar>
    <AppShell.Main><div className={classes.page}><Outlet /></div></AppShell.Main>
  </AppShell>;
}
