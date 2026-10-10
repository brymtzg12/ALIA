import express from 'express';
import { HttpError } from './errors.ts';
import { getHealth } from './health.ts';
import { ledgerRoutes } from './ledgerRoutes.ts';
import { workRoutes } from './workRoutes.ts';
import { floorRoutes } from './floorRoutes.ts';
import { analyticsRoutes } from './analyticsRoutes.ts';
import { streamClientCount, streamRoutes } from './stream.ts';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // CORS abierto para el frontend en desarrollo.
  app.use((req: any, res: any, next: any) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/health', async (_req: any, res: any) => {
    res.json(await getHealth(streamClientCount()));
  });

  app.use(ledgerRoutes);
  app.use(workRoutes);
  app.use(floorRoutes);
  app.use(analyticsRoutes);
  app.use(streamRoutes);

  // Ruta desconocida.
  app.use((_req: any, _res: any, next: any) => next(new HttpError(404, 'Ruta no encontrada')));

  // Manejador de errores: siempre { detail }.
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err instanceof HttpError) return res.status(err.status).json({ detail: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(422).json({ detail: 'El cuerpo no es JSON válido' });
    console.error('[api] error inesperado:', err);
    res.status(500).json({ detail: 'Error interno del servidor' });
  });

  return app;
}
