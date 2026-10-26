import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const crmSeedHistory = sqliteTable('seed_history', {
  id: text('id').primaryKey(),
  summary: text('summary').notNull(),
  created_at: text('created_at').notNull(),
});
