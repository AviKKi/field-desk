import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
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
