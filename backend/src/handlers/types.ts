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
  missingRefs?: (db: Db, ev: InputEvent) => Promise<string | null>;
  handle: (db: Db, ev: InputEvent) => Promise<HandlerResult>;
};
