import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

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

export const crmOrders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    number: text('number').notNull().unique(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    current_revision: integer('current_revision').notNull(),
    version: integer('version').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('orders_customer_id_idx').on(t.customer_id),
    check(
      'orders_current_revision_check',
      sql`typeof(${t.current_revision}) = 'integer' and ${t.current_revision} > 0`,
    ),
    check(
      'orders_version_check',
      sql`typeof(${t.version}) = 'integer' and ${t.version} >= 0`,
    ),
  ],
);

export const crmOrderRevisions = sqliteTable(
  'order_revisions',
  {
    id: text('id').primaryKey(),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    actor_id: text('actor_id').notNull(),
    reason: text('reason').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('order_revisions_order_id_idx').on(t.order_id),
    check(
      'order_revisions_revision_check',
      sql`typeof(${t.revision}) = 'integer' and ${t.revision} > 0`,
    ),
    uniqueIndex('order_revisions_number_idx').on(t.order_id, t.revision),
  ],
);

export const crmOrderLines = sqliteTable(
  'order_lines',
  {
    id: text('id').primaryKey(),
    revision_id: text('revision_id')
      .notNull()
      .references(() => crmOrderRevisions.id, { onDelete: 'cascade' }),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    line_key: text('line_key').notNull(),
    sku_id: text('sku_id')
      .notNull()
      .references(() => crmSkus.id, { onDelete: 'cascade' }),
    qty: integer('qty').notNull(),
    unit_price_paise: integer('unit_price_paise').notNull(),
    points_per_unit: integer('points_per_unit').notNull(),
  },
  (t) => [
    index('order_lines_revision_id_idx').on(t.revision_id),
    index('order_lines_order_id_idx').on(t.order_id),
    index('order_lines_sku_id_idx').on(t.sku_id),
    check(
      'order_lines_qty_check',
      sql`typeof(${t.qty}) = 'integer' and ${t.qty} > 0`,
    ),
    check(
      'order_lines_unit_price_paise_check',
      sql`typeof(${t.unit_price_paise}) = 'integer' and ${t.unit_price_paise} > 0`,
    ),
    check(
      'order_lines_points_per_unit_check',
      sql`typeof(${t.points_per_unit}) = 'integer' and ${t.points_per_unit} > 0`,
    ),
    uniqueIndex('order_lines_sku_idx').on(t.revision_id, t.sku_id),
  ],
);

export const crmApprovals = sqliteTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    actor_id: text('actor_id').notNull(),
    decision: text('decision').notNull(),
    reason: text('reason').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('approvals_order_id_idx').on(t.order_id),
    check(
      'approvals_revision_check',
      sql`typeof(${t.revision}) = 'integer' and ${t.revision} > 0`,
    ),
  ],
);

export const crmShipments = sqliteTable(
  'shipments',
  {
    id: text('id').primaryKey(),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    status: text('status').notNull(),
    original_shipment_id: text('original_shipment_id'),
    correction_id: text('correction_id'),
    created_at: text('created_at').notNull(),
    dispatched_at: text('dispatched_at'),
  },
  (t) => [
    index('shipments_order_id_idx').on(t.order_id),
    check(
      'shipments_revision_check',
      sql`typeof(${t.revision}) = 'integer' and ${t.revision} > 0`,
    ),
  ],
);

export const crmShipmentLines = sqliteTable(
  'shipment_lines',
  {
    id: text('id').primaryKey(),
    shipment_id: text('shipment_id')
      .notNull()
      .references(() => crmShipments.id, { onDelete: 'cascade' }),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    line_key: text('line_key').notNull(),
    sku_id: text('sku_id')
      .notNull()
      .references(() => crmSkus.id, { onDelete: 'cascade' }),
    loaded_qty: integer('loaded_qty').notNull(),
    dispatched_qty: integer('dispatched_qty').notNull(),
    unit_price_paise: integer('unit_price_paise').notNull(),
    points_per_unit: integer('points_per_unit').notNull(),
  },
  (t) => [
    index('shipment_lines_shipment_id_idx').on(t.shipment_id),
    index('shipment_lines_order_id_idx').on(t.order_id),
    index('shipment_lines_sku_id_idx').on(t.sku_id),
    check(
      'shipment_lines_loaded_qty_check',
      sql`typeof(${t.loaded_qty}) = 'integer' and ${t.loaded_qty} >= 0`,
    ),
    check(
      'shipment_lines_dispatched_qty_check',
      sql`typeof(${t.dispatched_qty}) = 'integer' and ${t.dispatched_qty} >= 0`,
    ),
    check(
      'shipment_lines_unit_price_paise_check',
      sql`typeof(${t.unit_price_paise}) = 'integer' and ${t.unit_price_paise} > 0`,
    ),
    check(
      'shipment_lines_points_per_unit_check',
      sql`typeof(${t.points_per_unit}) = 'integer' and ${t.points_per_unit} > 0`,
    ),
  ],
);

export const crmDeliveries = sqliteTable(
  'deliveries',
  {
    id: text('id').primaryKey(),
    shipment_line_id: text('shipment_line_id')
      .notNull()
      .references(() => crmShipmentLines.id, { onDelete: 'cascade' }),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    qty: integer('qty').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('deliveries_shipment_line_id_idx').on(t.shipment_line_id),
    index('deliveries_order_id_idx').on(t.order_id),
    check(
      'deliveries_qty_check',
      sql`typeof(${t.qty}) = 'integer' and ${t.qty} > 0`,
    ),
  ],
);

export const crmCancellations = sqliteTable(
  'cancellations',
  {
    id: text('id').primaryKey(),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    line_key: text('line_key').notNull(),
    qty: integer('qty').notNull(),
    reason: text('reason').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('cancellations_order_id_idx').on(t.order_id),
    check(
      'cancellations_qty_check',
      sql`typeof(${t.qty}) = 'integer' and ${t.qty} > 0`,
    ),
  ],
);

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

export const crmReceivableEntries = sqliteTable(
  'receivable_entries',
  {
    id: text('id').primaryKey(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    line_key: text('line_key'),
    shipment_line_id: text('shipment_line_id'),
    kind: text('kind').notNull(),
    amount_paise: integer('amount_paise').notNull(),
    adjusts_id: text('adjusts_id'),
    source_id: text('source_id').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('receivable_entries_customer_id_idx').on(t.customer_id),
    index('receivable_entries_order_id_idx').on(t.order_id),
    check(
      'receivable_entries_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer'`,
    ),
  ],
);

export const crmPaymentReceipts = sqliteTable(
  'payment_receipts',
  {
    id: text('id').primaryKey(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    amount_paise: integer('amount_paise').notNull(),
    reference: text('reference').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('payment_receipts_customer_id_idx').on(t.customer_id),
    check(
      'payment_receipts_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer' and ${t.amount_paise} > 0`,
    ),
  ],
);

export const crmPaymentAllocations = sqliteTable(
  'payment_allocations',
  {
    id: text('id').primaryKey(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    receipt_id: text('receipt_id')
      .notNull()
      .references(() => crmPaymentReceipts.id, { onDelete: 'cascade' }),
    charge_id: text('charge_id')
      .notNull()
      .references(() => crmReceivableEntries.id, { onDelete: 'cascade' }),
    amount_paise: integer('amount_paise').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('payment_allocations_customer_id_idx').on(t.customer_id),
    index('payment_allocations_receipt_id_idx').on(t.receipt_id),
    index('payment_allocations_charge_id_idx').on(t.charge_id),
    check(
      'payment_allocations_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer'`,
    ),
  ],
);

export const crmCreditNotes = sqliteTable(
  'credit_notes',
  {
    id: text('id').primaryKey(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    return_id: text('return_id'),
    amount_paise: integer('amount_paise').notNull(),
    reason: text('reason').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('credit_notes_customer_id_idx').on(t.customer_id),
    check(
      'credit_notes_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer' and ${t.amount_paise} > 0`,
    ),
  ],
);

export const crmCreditFunds = sqliteTable(
  'credit_funds',
  {
    id: text('id').primaryKey(),
    credit_note_id: text('credit_note_id')
      .notNull()
      .references(() => crmCreditNotes.id, { onDelete: 'cascade' }),
    receipt_id: text('receipt_id')
      .notNull()
      .references(() => crmPaymentReceipts.id, { onDelete: 'cascade' }),
    amount_paise: integer('amount_paise').notNull(),
  },
  (t) => [
    index('credit_funds_credit_note_id_idx').on(t.credit_note_id),
    index('credit_funds_receipt_id_idx').on(t.receipt_id),
    check(
      'credit_funds_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer' and ${t.amount_paise} > 0`,
    ),
  ],
);

export const crmCreditApplications = sqliteTable(
  'credit_applications',
  {
    id: text('id').primaryKey(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    credit_note_id: text('credit_note_id')
      .notNull()
      .references(() => crmCreditNotes.id, { onDelete: 'cascade' }),
    charge_id: text('charge_id')
      .notNull()
      .references(() => crmReceivableEntries.id, { onDelete: 'cascade' }),
    amount_paise: integer('amount_paise').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('credit_applications_customer_id_idx').on(t.customer_id),
    index('credit_applications_credit_note_id_idx').on(t.credit_note_id),
    index('credit_applications_charge_id_idx').on(t.charge_id),
    check(
      'credit_applications_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer'`,
    ),
  ],
);

export const crmCreditRefunds = sqliteTable(
  'credit_refunds',
  {
    id: text('id').primaryKey(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    credit_note_id: text('credit_note_id')
      .notNull()
      .references(() => crmCreditNotes.id, { onDelete: 'cascade' }),
    receipt_id: text('receipt_id')
      .notNull()
      .references(() => crmPaymentReceipts.id, { onDelete: 'cascade' }),
    amount_paise: integer('amount_paise').notNull(),
    reference: text('reference').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('credit_refunds_customer_id_idx').on(t.customer_id),
    index('credit_refunds_credit_note_id_idx').on(t.credit_note_id),
    index('credit_refunds_receipt_id_idx').on(t.receipt_id),
    check(
      'credit_refunds_amount_paise_check',
      sql`typeof(${t.amount_paise}) = 'integer' and ${t.amount_paise} > 0`,
    ),
  ],
);

export const crmRewardRedemptions = sqliteTable(
  'reward_redemptions',
  {
    id: text('id').primaryKey(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    charge_id: text('charge_id')
      .notNull()
      .references(() => crmReceivableEntries.id, { onDelete: 'cascade' }),
    points: integer('points').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('reward_redemptions_customer_id_idx').on(t.customer_id),
    index('reward_redemptions_charge_id_idx').on(t.charge_id),
    check(
      'reward_redemptions_points_check',
      sql`typeof(${t.points}) = 'integer'`,
    ),
  ],
);

export const crmRewardLedger = sqliteTable(
  'reward_ledger',
  {
    id: text('id').primaryKey(),
    customer_id: text('customer_id')
      .notNull()
      .references(() => crmCustomers.id, { onDelete: 'cascade' }),
    line_key: text('line_key'),
    bucket: text('bucket').notNull(),
    points_delta: integer('points_delta').notNull(),
    source_id: text('source_id').notNull(),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('reward_ledger_customer_id_idx').on(t.customer_id),
    check(
      'reward_ledger_points_delta_check',
      sql`typeof(${t.points_delta}) = 'integer'`,
    ),
  ],
);

export const crmCorrections = sqliteTable(
  'corrections',
  {
    id: text('id').primaryKey(),
    order_id: text('order_id')
      .notNull()
      .references(() => crmOrders.id, { onDelete: 'cascade' }),
    original_revision: integer('original_revision').notNull(),
    new_revision: integer('new_revision').notNull(),
    actor_id: text('actor_id').notNull(),
    reason: text('reason').notNull(),
    evidence: text('evidence').notNull(),
    authorization_reference: text('authorization_reference').notNull(),
    location: text('location').notNull(),
    shipment_id: text('shipment_id'),
    action_id: text('action_id').notNull(),
    created_at: text('created_at').notNull(),
  },
  (t) => [
    index('corrections_order_id_idx').on(t.order_id),
    check(
      'corrections_original_revision_check',
      sql`typeof(${t.original_revision}) = 'integer' and ${t.original_revision} > 0`,
    ),
    check(
      'corrections_new_revision_check',
      sql`typeof(${t.new_revision}) = 'integer' and ${t.new_revision} > 0`,
    ),
  ],
);

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

export const crmSampleRuns = sqliteTable('sample_runs', {
  id: text('id').primaryKey(),
  scenario_id: text('scenario_id').notNull(),
  customer_id: text('customer_id')
    .notNull()
    .references(() => crmCustomers.id, { onDelete: 'cascade' }),
  requester_id: text('requester_id').notNull(),
  complete: integer('complete').notNull().default(0),
  created_at: text('created_at').notNull(),
});

export const crmSampleSteps = sqliteTable(
  'sample_steps',
  {
    id: text('id').primaryKey(),
    run_id: text('run_id')
      .notNull()
      .references(() => crmSampleRuns.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    label: text('label').notNull(),
    envelope: text('envelope').notNull(),
    result: text('result').notNull(),
  },
  (t) => [uniqueIndex('sample_steps_position_idx').on(t.run_id, t.position)],
);
