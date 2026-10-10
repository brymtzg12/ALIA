-- KitListo · esquema del servicio de inventario
-- Se aplica completo al arrancar (idempotente: IF NOT EXISTS). Sin claves foráneas entre
-- tablas alimentadas por eventos, porque los eventos llegan en desorden entre tópicos.

-- ---------------------------------------------------------------------------
-- Meta e infraestructura de eventos
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS meta (
  key   text PRIMARY KEY,
  value text NOT NULL
);

-- Idempotencia: un event_id procesado no vuelve a tener efectos ni salidas.
CREATE TABLE IF NOT EXISTS processed_events (
  event_id     uuid PRIMARY KEY,
  event_type   text NOT NULL,
  topic        text NOT NULL,
  status       text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'ignored', 'error')),
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- Eventos que referencian algo aún desconocido (pieza, orden, línea de la lista de partes).
-- seq conserva el orden de llegada para reintentar respetando el orden por llave.
CREATE TABLE IF NOT EXISTS parked_events (
  seq             bigserial PRIMARY KEY,
  event_id        uuid NOT NULL UNIQUE,
  topic           text NOT NULL,
  key             text NOT NULL,
  event           jsonb NOT NULL,
  reason          text NOT NULL,
  attempts        integer NOT NULL DEFAULT 0,
  parked_at       timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz
);
CREATE INDEX IF NOT EXISTS parked_events_key_idx ON parked_events (key);

-- Outbox: las salidas se escriben en la misma transacción que los efectos.
-- kind = 'event' va a inventory.events; kind = 'dlq' va a inventory.dlq.
CREATE TABLE IF NOT EXISTS outbox (
  id           bigserial PRIMARY KEY,
  event_id     uuid NOT NULL,
  kind         text NOT NULL DEFAULT 'event' CHECK (kind IN ('event', 'dlq')),
  topic        text NOT NULL,
  key          text NOT NULL,
  event        jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox (id) WHERE published_at IS NULL;

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS parts (
  part_id     integer PRIMARY KEY,
  sku         text,
  sku_norm    text,          -- mayúsculas, sin espacios en los extremos
  sku_compact text,          -- además sin espacios internos, guiones, puntos ni diagonales
  name        text NOT NULL,
  family      text,
  "group"     text,
  subgroup    text,
  unit_id     integer,
  unit_name   text,
  image_url   text,
  active      boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS parts_sku_norm_idx ON parts (sku_norm);
CREATE INDEX IF NOT EXISTS parts_sku_compact_idx ON parts (sku_compact);

CREATE TABLE IF NOT EXISTS locations (
  location_id  integer PRIMARY KEY,
  code         text NOT NULL,   -- sin UNIQUE: un código puede reasignarse a otro id
  name         text NOT NULL,
  is_workbench boolean NOT NULL DEFAULT false,
  active       boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS locations_code_idx ON locations (code);

CREATE TABLE IF NOT EXISTS bom_models (
  model_id   integer PRIMARY KEY,
  model_name text NOT NULL,
  brand      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- bom.upserted reemplaza todas las líneas del modelo.
CREATE TABLE IF NOT EXISTS bom_lines (
  bom_line_id  integer PRIMARY KEY,
  model_id     integer NOT NULL,
  part_id      integer,
  name         text NOT NULL,
  group_name   text,
  unit_name    text,
  qty_per_unit integer,
  sort_order   integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS bom_lines_model_idx ON bom_lines (model_id);

-- Alias aprendidos al resolver recepciones a mano: part_number normalizado a pieza.
CREATE TABLE IF NOT EXISTS aliases (
  part_number_norm text PRIMARY KEY,
  part_id          integer NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Taller: órdenes e inspecciones
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS work_orders (
  work_order_id integer PRIMARY KEY,
  code          text NOT NULL,
  model_id      integer NOT NULL,
  department    text NOT NULL,
  stage         text,
  received_at   timestamptz NOT NULL,
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS work_orders_code_idx ON work_orders (code);

CREATE TABLE IF NOT EXISTS inspections (
  inspection_id integer PRIMARY KEY,
  work_order_id integer NOT NULL,
  kind          text,
  status        text NOT NULL CHECK (status IN ('submitted', 'approved', 'rejected', 'discarded', 'voided')),
  items         jsonb,
  approved_by   integer,
  approved_at   timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inspections_wo_idx ON inspections (work_order_id);

-- ---------------------------------------------------------------------------
-- Necesidades, reservas, faltantes y sugerencias
-- ---------------------------------------------------------------------------

-- Necesidad vigente por (orden, línea). inspection_id = la aprobación que la fijó (para voided).
CREATE TABLE IF NOT EXISTS needs (
  work_order_id      integer NOT NULL,
  bom_line_id        integer NOT NULL,
  part_id            integer,
  name               text NOT NULL,
  group_name         text,
  required           integer,
  inspection_id      integer NOT NULL,
  inspection_item_id integer NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_order_id, bom_line_id)
);

-- Una fila por cada stock.reserved emitido. La reserva es a nivel pieza (sin ubicación).
-- quantity = lo que sigue apartado; issued = lo ya entregado contra esta reserva.
CREATE TABLE IF NOT EXISTS reservations (
  reservation_id     uuid PRIMARY KEY,
  work_order_id      integer NOT NULL,
  bom_line_id        integer NOT NULL,
  part_id            integer NOT NULL,
  quantity           integer NOT NULL CHECK (quantity >= 0),
  issued             integer NOT NULL DEFAULT 0 CHECK (issued >= 0),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fulfilled', 'cancelled')),
  inspection_item_id integer NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reservations_wo_part_idx ON reservations (work_order_id, part_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS reservations_part_idx ON reservations (part_id) WHERE status = 'active';

-- Uno abierto por (orden, línea). missing_quantity null = cantidad desconocida.
CREATE TABLE IF NOT EXISTS shortages (
  shortage_id        bigserial PRIMARY KEY,
  work_order_id      integer NOT NULL,
  bom_line_id        integer NOT NULL,
  part_id            integer,
  name               text NOT NULL,
  missing_quantity   integer CHECK (missing_quantity IS NULL OR missing_quantity >= 0),
  inspection_item_id integer NOT NULL,
  opened_at          timestamptz NOT NULL DEFAULT now(),
  closed_at          timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS shortages_open_uq ON shortages (work_order_id, bom_line_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS shortages_part_open_idx ON shortages (part_id, opened_at) WHERE closed_at IS NULL;

-- Sugerencia vigente por pieza; se compara contra la nueva para decidir si se emite.
CREATE TABLE IF NOT EXISTS reorder_suggestions (
  part_id            integer PRIMARY KEY,
  suggested_quantity integer NOT NULL CHECK (suggested_quantity >= 1),
  work_order_ids     integer[] NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Extra: políticas mínimo/máximo por pieza.
CREATE TABLE IF NOT EXISTS policies (
  part_id        integer PRIMARY KEY,
  min_qty        integer,
  max_qty        integer,
  reorder_qty    integer,
  lead_time_days integer
);

-- ---------------------------------------------------------------------------
-- Libro mayor
-- ---------------------------------------------------------------------------

-- Saldos derivados de movements (se actualizan en la misma transacción).
-- part_stock es el candado para reservar (SELECT ... FOR UPDATE).
-- No hay CHECK de reserved <= on_hand: un conteo puede dejar available negativo (regla 17);
-- salidas, transferencias y reservas lo validan en código con el candado tomado.
CREATE TABLE IF NOT EXISTS part_stock (
  part_id  integer PRIMARY KEY,
  on_hand  integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0)
);

CREATE TABLE IF NOT EXISTS location_stock (
  part_id     integer NOT NULL,
  location_id integer NOT NULL,
  on_hand     integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  PRIMARY KEY (part_id, location_id)
);

-- Inmutable. Saldo = suma de quantity.
CREATE TABLE IF NOT EXISTS movements (
  movement_id      bigserial PRIMARY KEY,
  type             text NOT NULL CHECK (type IN ('receipt', 'issue', 'transfer_out', 'transfer_in', 'adjustment')),
  part_id          integer NOT NULL,
  location_id      integer NOT NULL,
  quantity         integer NOT NULL CHECK (quantity <> 0),
  occurred_at      timestamptz NOT NULL,
  reference        text,
  work_order_id    integer,
  unit_cost        text,          -- texto decimal tal cual llegó ("1850.00")
  currency         text,
  purchase_line_id integer,
  origin           text NOT NULL DEFAULT 'event' CHECK (origin IN ('event', 'api')),
  command_id       uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS movements_part_idx ON movements (part_id, occurred_at, movement_id);
-- Una línea de compra entra una sola vez al inventario.
CREATE UNIQUE INDEX IF NOT EXISTS movements_receipt_line_uq ON movements (purchase_line_id) WHERE type = 'receipt';
-- Idempotencia de los movimientos de la API (un comando puede generar dos filas: transferencia).
CREATE UNIQUE INDEX IF NOT EXISTS movements_command_uq ON movements (command_id, type) WHERE command_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS unmatched_receipts (
  id                  bigserial PRIMARY KEY,
  purchase_line_id    integer NOT NULL UNIQUE,
  purchase_request_id integer,
  request_number      text,
  part_number         text NOT NULL,
  description         text NOT NULL,
  quantity            integer NOT NULL,
  unit_price          text NOT NULL,   -- texto decimal tal cual llegó
  currency            text NOT NULL,
  received_at         timestamptz NOT NULL,
  work_order_code     text,
  match_count         integer NOT NULL DEFAULT 0,   -- 0 = ninguna pieza, >1 = sku compartido
  resolved_part_id    integer,
  resolved_at         timestamptz
);

-- ---------------------------------------------------------------------------
-- Semillas
-- ---------------------------------------------------------------------------

-- U-100 (Recepción): varias pruebas no la publican y toda entrada cae ahí.
INSERT INTO locations (location_id, code, name, is_workbench, active)
VALUES (100, 'U-100', 'Recepción', false, true)
ON CONFLICT (location_id) DO NOTHING;

-- instance_id: nombre del grupo de consumidores. Base nueva = grupo nuevo = relee desde el inicio.
INSERT INTO meta (key, value)
VALUES ('instance_id', gen_random_uuid()::text)
ON CONFLICT (key) DO NOTHING;
