import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const crmSkus = sqliteTable(
  'skus',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    price_paise: integer('price_paise').notNull(),
    points_per_unit: integer('points_per_unit').notNull(),
  },
  (t) => [
    check(
      'skus_price_paise_check',
      sql`typeof(${t.price_paise}) = 'integer' and ${t.price_paise} > 0`,
    ),
    check(
      'skus_points_per_unit_check',
      sql`typeof(${t.points_per_unit}) = 'integer' and ${t.points_per_unit} > 0`,
    ),
  ],
);
