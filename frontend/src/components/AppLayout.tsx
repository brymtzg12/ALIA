import { AppShell, Burger, Group, NavLink, Title, Button } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Outlet, Link, useLocation } from 'react-router-dom';

export default function AppLayout() {
  const [opened, { toggle }] = useDisclosure();
  const location = useLocation();

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{
        width: 250,
        breakpoint: 'sm',
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Title order={3}>KitListo</Title>
          </Group>
          <Button component={Link} to="/piso" color="blue" variant="light">
            Modo piso
          </Button>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <NavLink component={Link} to="/almacen" label="Almacén" active={location.pathname === '/almacen'} />
        <NavLink component={Link} to="/ordenes" label="Órdenes de Trabajo" active={location.pathname === '/ordenes'} />
        <NavLink component={Link} to="/recepciones" label="Recepciones" active={location.pathname === '/recepciones'} />
        <NavLink component={Link} to="/salud" label="Salud del Sistema" active={location.pathname === '/salud'} />
        <NavLink component={Link} to="/pronostico" label="Pronóstico" active={location.pathname === '/pronostico'} />
      </AppShell.Navbar>

      <AppShell.Main>
        {/* Aquí es donde React Router inyectará la pantalla de Almacén y las demás */}
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
