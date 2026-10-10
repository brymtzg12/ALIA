import { compactSku, normSku } from '../domain/sku.ts';
import type { Handler } from './types.ts';

// shop.catalog: piezas, ubicaciones y listas de partes. Nunca se estacionan.

export const partUpserted: Handler = {
  async handle(db, ev) {
    const d = ev.data;
    await db.query(
      `INSERT INTO parts (part_id, sku, sku_norm, sku_compact, name, family, "group", subgroup,
                          unit_id, unit_name, image_url, active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
       ON CONFLICT (part_id) DO UPDATE SET
         sku = EXCLUDED.sku, sku_norm = EXCLUDED.sku_norm, sku_compact = EXCLUDED.sku_compact,
         name = EXCLUDED.name, family = EXCLUDED.family, "group" = EXCLUDED."group",
         subgroup = EXCLUDED.subgroup, unit_id = EXCLUDED.unit_id, unit_name = EXCLUDED.unit_name,
         image_url = EXCLUDED.image_url, active = EXCLUDED.active, updated_at = now()`,
      [
        d.part_id, d.sku, normSku(d.sku), compactSku(d.sku), d.name, d.family, d.group, d.subgroup,
        d.unit?.id ?? null, d.unit?.name ?? null, d.image_url, d.active,
      ],
    );
    // Fila de saldo (candado para reservar) desde que la pieza existe.
    await db.query(`INSERT INTO part_stock (part_id) VALUES ($1) ON CONFLICT DO NOTHING`, [d.part_id]);
  },
};

export const locationUpserted: Handler = {
  async handle(db, ev) {
    const d = ev.data;
    await db.query(
      `INSERT INTO locations (location_id, code, name, is_workbench, active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (location_id) DO UPDATE SET
         code = EXCLUDED.code, name = EXCLUDED.name,
         is_workbench = EXCLUDED.is_workbench, active = EXCLUDED.active`,
      [d.location_id, d.code, d.name, d.is_workbench, d.active],
    );
  },
};

export const bomUpserted: Handler = {
  // La lista llega completa: reemplaza todas las líneas del modelo.
  async handle(db, ev) {
    const d = ev.data;
    await db.query(
      `INSERT INTO bom_models (model_id, model_name, brand, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (model_id) DO UPDATE SET model_name = EXCLUDED.model_name, brand = EXCLUDED.brand, updated_at = now()`,
      [d.model_id, d.model_name, d.brand],
    );
    await db.query(`DELETE FROM bom_lines WHERE model_id = $1`, [d.model_id]);
    for (const l of d.lines) {
      await db.query(
        `INSERT INTO bom_lines (bom_line_id, model_id, part_id, name, group_name, unit_name, qty_per_unit, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (bom_line_id) DO UPDATE SET
           model_id = EXCLUDED.model_id, part_id = EXCLUDED.part_id, name = EXCLUDED.name,
           group_name = EXCLUDED.group_name, unit_name = EXCLUDED.unit_name,
           qty_per_unit = EXCLUDED.qty_per_unit, sort_order = EXCLUDED.sort_order`,
        [l.bom_line_id, d.model_id, l.part_id, l.name, l.group_name, l.unit?.name ?? null, l.qty_per_unit, l.sort_order],
      );
    }
  },
};
