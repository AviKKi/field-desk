import { fail } from '../common/domain.js';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import { crmCustomers } from '../customers/customers.model.js';
import { crmOrders } from '../orders/orders.model.js';
import { crmShipmentLines } from '../fulfillment/fulfillment.model.js';

export const crmReturns = sqliteTable(
  'returns',
  {
    id: text('id').primaryKey(),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    gross_paise: integer('gross_paise').notNull(),
    fee_paise: integer('fee_paise').notNull(),
    reason: text('reason').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('returns_order_id_idx').on(t.order_id),
    index('returns_customer_id_idx').on(t.customer_id),
    check(
      'returns_gross_paise_check',
      sql`typeof(${t.gross_paise}) = 'integer' and ${t.gross_paise} > 0`,
    ),
    check(
      'returns_fee_paise_check',
      sql`typeof(${t.fee_paise}) = 'integer' and ${t.fee_paise} >= 0`,
    ),
  ],
);

export const crmReturnLines = sqliteTable(
  'return_lines',
  {
    id: text('id').primaryKey(),
    return_id: text('return_id')
      .notNull()
      .references(() => crmReturns.id, { onDelete: 'cascade' }),
    shipment_line_id: text('shipment_line_id')
      .notNull()
      .references(() => crmShipmentLines.id, { onDelete: 'cascade' }),
    qty: integer('qty').notNull(),
    amount_paise: integer('amount_paise').notNull(),
  },
  (t) => [
    index('return_lines_return_id_idx').on(t.return_id),
    index('return_lines_shipment_line_id_idx').on(t.shipment_line_id),
    check(
      'return_lines_qty_check',
      sql`typeof(${t.qty}) = 'integer' and ${t.qty} > 0`,
    ),
    check(
      'return_lines_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer' and ${t.amount_paise} > 0`,
    ),
  ],
);

export type ReturnRecord = typeof crmReturns.$inferSelect;
export class ReturnQuantity {
  constructor(
    readonly delivered: number,
    readonly returned: number,
  ) {}
  get returnable() {
    return this.delivered - this.returned;
  }
  assertReturnable(qty: number) {
    if (qty > this.returnable)
      fail('RETURN_EXCEEDED', 'The return exceeds delivered, unreturned units');
  }
  static assertFee(grossPaise: number, feePaise: number) {
    if (feePaise > grossPaise)
      fail(
        'FEE_EXCEEDED',
        'The deduction cannot exceed the returned goods value',
      );
  }
}
