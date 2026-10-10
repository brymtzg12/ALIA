import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, Container, Stack, Title, Text, Button } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider, Navigate, Link } from 'react-router-dom';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import AppLayout from './components/AppLayout';
import LiveUpdates from './components/LiveUpdates';
import { theme, resolver } from './theme';
import AlmacenScreen from './pages/Almacen';
import { Ordenes, Materiales, Pieza, Salud, Pronostico } from './pages/Consultas';
import { Piso, Recepciones } from './pages/Operaciones';
import { Transferir, Contar } from './pages/PisoExtras';
import { Valuacion, Rotacion, Politicas } from './pages/Analitica';
const queryClient = new QueryClient();
const router = createBrowserRouter([{
  path: '/', element: <AppLayout />, children: [
    { index: true, element: <Navigate to="/almacen" replace /> },
    { path: 'almacen', element: <AlmacenScreen /> },
    { path: 'ordenes', element: <Ordenes /> },
    { path: 'ordenes/:code', element: <Materiales /> },
    { path: 'piezas/:id', element: <Pieza /> },
    { path: 'recepciones', element: <Recepciones /> },
    { path: 'salud', element: <Salud /> },
    { path: 'pronostico', element: <Pronostico /> },
    { path: 'piso', element: <Navigate to="/piso/retirar" replace /> },
    { path: 'piso/retirar', element: <Piso /> },
    { path: 'piso/transferir', element: <Transferir /> },
    { path: 'piso/contar', element: <Contar /> },
    { path: 'valuacion', element: <Valuacion /> },
    { path: 'rotacion', element: <Rotacion /> },
    { path: 'politicas', element: <Politicas /> },
    { path: '*', element: <Container size="sm" px={0} py="xl"><Stack gap="md" align="flex-start"><Title order={1}>Página no encontrada</Title><Text c="dimmed">Revisa la dirección.</Text><Button component={Link} to="/almacen" size="md">Volver al almacén</Button></Stack></Container> },
  ],
}]);
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><QueryClientProvider client={queryClient}><MantineProvider theme={theme} cssVariablesResolver={resolver} defaultColorScheme="auto"><Notifications /><LiveUpdates /><RouterProvider router={router} /></MantineProvider></QueryClientProvider></React.StrictMode>
);
