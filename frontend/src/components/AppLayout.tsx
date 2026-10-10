import { AppShell, Burger, Group, NavLink, ScrollArea, Title, Button } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Outlet, Link, useLocation } from 'react-router-dom';
const links = [
  ['/almacen', 'Almacén'], ['/ordenes', 'Órdenes de trabajo'], ['/recepciones', 'Recepciones'],
  ['/piso/retirar', 'Retirar piezas'], ['/piso/transferir', 'Transferir piezas'], ['/piso/contar', 'Contar piezas'],
  ['/pronostico', 'Pronóstico'], ['/valuacion', 'Valuación'], ['/rotacion', 'Rotación'], ['/politicas', 'Políticas'], ['/salud', 'Salud del sistema'],
];
export default function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const location = useLocation();
  return <AppShell header={{ height: 60 }} navbar={{ width: 250, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
    <AppShell.Header><Group h="100%" px="md" justify="space-between"><Group><Burger aria-label="Abrir menú" opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" /><Title order={3}>KitListo</Title></Group><Button component={Link} to="/piso/retirar" color="blue" variant="light" onClick={close}>Modo piso</Button></Group></AppShell.Header>
    <AppShell.Navbar p="md"><ScrollArea>{links.map(([path, label]) => <NavLink key={path} component={Link} to={path} label={label} active={location.pathname === path || location.pathname.startsWith(path + '/')} onClick={close} />)}</ScrollArea></AppShell.Navbar>
    <AppShell.Main><Outlet /></AppShell.Main>
  </AppShell>;
}
