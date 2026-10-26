import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const crmCustomers = sqliteTable(
  'customers',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [
    check(
      'customers_version_check',
      sql`typeof(${t.version}) = 'integer' and ${t.version} >= 0`,
    ),
  ],
);

export type Customer = typeof crmCustomers.$inferSelect;
