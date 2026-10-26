import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { crmCustomers } from '../customers/customers.model.js';

export const crmBusinessEvents = sqliteTable(
  'business_events',
  {
    id: text('id').primaryKey(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    order_id: text('order_id'),
    actor_id: text('actor_id').notNull(),
    actor_name: text('actor_name').notNull(),
    requested_by: text('requested_by').notNull(),
    action_id: text('action_id').notNull(),
    type: text('type').notNull(),
    payload: text('payload').notNull(),
    occurred_at: text('occurred_at').notNull(),
  },
  (t) => [index('business_events_customer_id_idx').on(t.customer_id)],
);

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
