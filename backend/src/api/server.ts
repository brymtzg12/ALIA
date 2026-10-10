import express from 'express';
import { pausePipeline, resetPipeline } from '../pipeline.ts';
import { conflict, HttpError } from './errors.ts';
import { getHealth } from './health.ts';
import { ledgerRoutes } from './ledgerRoutes.ts';
import { workRoutes } from './workRoutes.ts';
import { floorRoutes } from './floorRoutes.ts';
import { analyticsRoutes } from './analyticsRoutes.ts';
import { policyRoutes } from './policyRoutes.ts';
import { streamClientCount, streamRoutes } from './stream.ts';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.use((req: any, res: any, next: any) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/health', async (_req: any, res: any) => {
    res.json(await getHealth(streamClientCount()));
  });

  // Reconstrucción desde cero en caliente (para dejar la demo limpia). Solo desde la misma
  // máquina y con confirmación explícita: borra la base y vuelve a leer los tópicos.
  const localOnly = (req: any) => {
    const ip = String(req.socket?.remoteAddress ?? '');
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) throw new HttpError(403, 'Solo se permite desde la misma máquina');
    if (req.body?.confirm !== 'RESET') throw new HttpError(422, 'Falta confirmar: envía { "confirm": "RESET" }');
  };
  // Pausa los consumidores antes de que el kit borre sus tópicos (si siguen conectados, Kafka
  // recrea los tópicos al instante y el simulador falla al crearlos).
  app.post('/admin/pause', async (req: any, res: any) => {
    localOnly(req);
    try {
      await pausePipeline();
      res.json({ status: 'pausado' });
    } catch (err: any) {
      throw conflict(err.message);
    }
  });
  app.post('/admin/reset', async (req: any, res: any) => {
    localOnly(req);
    try {
      res.json({ status: 'reconstruyendo', ...(await resetPipeline()) });
    } catch (err: any) {
      throw conflict(err.message);
    }
  });

  app.use(ledgerRoutes);
  app.use(workRoutes);
  app.use(floorRoutes);
  app.use(analyticsRoutes);
  app.use(policyRoutes);
  app.use(streamRoutes);

  app.use((_req: any, _res: any, next: any) => next(new HttpError(404, 'Ruta no encontrada')));

  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err instanceof HttpError) return res.status(err.status).json({ detail: err.message });
    if (err?.type === 'entity.parse.failed') return res.status(422).json({ detail: 'El cuerpo no es JSON válido' });
    console.error('[api] error inesperado:', err);
    res.status(500).json({ detail: 'Error interno del servidor' });
  });

  return app;
}
