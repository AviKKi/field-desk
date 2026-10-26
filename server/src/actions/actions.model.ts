import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const crmActionRequests = sqliteTable(
  'action_requests',
  {
    id: text('id').primaryKey(),
    requester_id: text('requester_id').notNull(),
    actor_id: text('actor_id').notNull(),
    idempotency_key: text('idempotency_key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    result: text('result').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('action_requests_key_idx').on(
      t.requester_id,
      t.idempotency_key,
    ),
  ],
);
