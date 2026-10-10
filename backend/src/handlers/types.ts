import type { Db } from '../db.ts';

export type InputEvent = {
  event_id: string;
  event_type: string;
  event_version: number;
  occurred_at: string;
  source: string;
  key: string;
  data: any;
};

export type HandlerResult = void | 'ignored';

export type Handler = {
  /**
   * Revisa que exista todo lo que el evento referencia. Devuelve el motivo si falta algo
   * (el evento se estaciona y se reintenta), o null si se puede procesar.
   */
  missingRefs?: (db: Db, ev: InputEvent) => Promise<string | null>;
  /** Aplica los efectos. Todo dentro de la transacción recibida (incluido el outbox). */
  handle: (db: Db, ev: InputEvent) => Promise<HandlerResult>;
};
