import { z } from 'zod';
import type { User } from './types.js';

const id = z.string().min(1).max(100);
const quantity = z.number().int().min(1).max(10000);
const amount = z.number().int().min(1).max(1000000000);
const reason = z.string().trim().min(3).max(1000);
const item = z
  .object({ skuId: id, qty: quantity, unitPricePaise: amount })
  .strict();
const lines = z
  .array(item)
  .min(1)
  .max(100)
  .refine(
    (value) => new Set(value.map((line) => line.skuId)).size === value.length,
    'Each SKU can appear only once',
  );
const action = <T extends string, S extends z.ZodRawShape>(
  type: T,
  payload: S,
) => z.object({ type: z.literal(type), payload: z.object(payload).strict() });

export const crmActionSchema = z.discriminatedUnion('type', [
  action('PUNCH_ORDER', {
    customerId: id,
    items: lines,
    reason: reason.optional(),
  }),
  action('EDIT_ORDER', { orderId: id, items: lines, reason }),
  action('SUBMIT_ORDER', { orderId: id }),
  action('APPROVE_ORDER', {
    orderId: id,
    revision: z.number().int().positive(),
  }),
  action('REJECT_ORDER', {
    orderId: id,
    revision: z.number().int().positive(),
    reason,
  }),
  action('START_LOADING', {
    orderId: id,
    items: z
      .array(z.object({ lineKey: id, qty: quantity }).strict())
      .min(1)
      .max(100),
  }),
  action('DISPATCH_SHIPMENT', { orderId: id, shipmentId: id }),
  action('CONFIRM_DELIVERY', {
    orderId: id,
    shipmentId: id,
    items: z
      .array(z.object({ shipmentLineId: id, qty: quantity }).strict())
      .min(1)
      .max(100),
  }),
  action('CANCEL_REMAINDER', { orderId: id, reason }),
  action('RECORD_RETURN', {
    orderId: id,
    items: z
      .array(z.object({ shipmentLineId: id, qty: quantity }).strict())
      .min(1)
      .max(100),
    feePaise: z.number().int().min(0).max(1000000000),
    reason,
  }),
  action('RECEIVE_CUSTOMER_PAYMENT', {
    customerId: id,
    amountPaise: amount,
    reference: z.string().trim().min(1).max(200),
  }),
  action('ALLOCATE_PAYMENT', { customerId: id }),
  action('REDEEM_POINTS', { customerId: id, chargeId: id, points: quantity }),
  action('ISSUE_CREDIT_NOTE', { customerId: id, amountPaise: amount, reason }),
  action('APPLY_CREDIT_NOTE', {
    customerId: id,
    creditNoteId: id,
    chargeId: id,
    amountPaise: amount,
  }),
  action('REFUND_CREDIT_NOTE', {
    customerId: id,
    creditNoteId: id,
    amountPaise: amount,
    reference: reason,
  }),
  action('CORRECT_DISPATCHED_ORDER', {
    orderId: id,
    items: z
      .array(item.extend({ deliveredQty: z.number().int().min(0).max(10000) }))
      .min(1)
      .max(100),
    reason,
    evidence: z.string().trim().min(8).max(2000),
    authorizationReference: reason,
    location: z.enum(['EXISTING_SHIPMENT', 'NEW_SHIPMENT']).optional(),
    shipmentId: id.optional(),
    dispatchedAt: z.iso.datetime().optional(),
  }),
]);

export const actionEnvelopeSchema = z
  .object({
    command: crmActionSchema,
    actorId: id.optional(),
    idempotencyKey: z.string().min(8).max(120),
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict();
export type CrmCommand = z.infer<typeof crmActionSchema>;
export type ActionEnvelope = z.infer<typeof actionEnvelopeSchema>;
export type CommandType = CrmCommand['type'];
export interface ActionResult {
  status: 'APPLIED' | 'REJECTED' | 'NEEDS_DECISION' | 'CONFLICT';
  actionId: string;
  errors: Array<{ code: string; message: string }>;
  decisions: Array<{
    key: string;
    prompt: string;
    options: Array<{ id: string; label: string }>;
  }>;
  effects: Array<{
    entity: string;
    operation: 'INSERT' | 'UPDATE' | 'APPEND';
    before?: unknown;
    after?: unknown;
  }>;
  trace: Array<{ stage: string; explanation: string }>;
  aggregateVersions: Record<string, number>;
  references: Record<string, string>;
}
export interface Customer {
  id: string;
  code: string;
  name: string;
  version: number;
}
export interface Sku {
  id: string;
  code: string;
  name: string;
  price_paise: number;
  points_per_unit: number;
}
export interface OrderListRow {
  id: string;
  number: string;
  customer_id: string;
  status: string;
  current_revision: number;
  version: number;
  created_at: string;
}
export interface OrderLine {
  lineKey: string;
  skuId: string;
  code: string;
  name: string;
  qty: number;
  unitPricePaise: number;
  canceled: number;
  loaded: number;
  dispatched: number;
  delivered: number;
  returned: number;
  open: number;
}
export interface ShipmentLine {
  id: string;
  line_key: string;
  sku_id: string;
  loaded_qty: number;
  dispatched_qty: number;
  unit_price_paise: number;
  delivered: number;
  returned: number;
}
export interface Shipment {
  id: string;
  status: string;
  revision: number;
  dispatched_at: string | null;
  original_shipment_id: string | null;
  lines: ShipmentLine[];
}
export interface EventRow {
  id: string;
  action_id: string;
  customer_id: string;
  order_id: string | null;
  actor_id: string;
  actor_name: string;
  requested_by: string;
  type: string;
  payload: string;
  occurred_at: string;
}
export interface OrderDetail {
  order: OrderListRow;
  lines: OrderLine[];
  shipments: Shipment[];
  revisions: Array<{
    id: string;
    revision: number;
    reason: string;
    actor_id: string;
    created_at: string;
    lines: Array<{ sku_id: string; qty: number; unit_price_paise: number }>;
  }>;
  approvals: Array<{
    id: string;
    revision: number;
    decision: string;
    actor_id: string;
    reason: string;
  }>;
  timeline: EventRow[];
}
export interface Charge {
  id: string;
  order_id: string;
  line_key: string | null;
  amount_paise: number;
  remainingPaise: number;
  outstandingPaise: number;
  cashPaidPaise: number;
  kind: string;
  created_at: string;
}
export interface CreditNote {
  id: string;
  amount_paise: number;
  availablePaise: number;
  appliedPaise: number;
  refundedPaise: number;
  reason: string;
}
export interface CustomerSummary {
  customer: Customer;
  netBalancePaise: number;
  outstandingPaise: number;
  unappliedCashPaise: number;
  receivedPaise: number;
  creditsOpenPaise: number;
  refundsPaise: number;
  points: {
    locked: number;
    available: number;
    redeemed: number;
    clawbackPending: number;
  };
  charges: Charge[];
  credits: CreditNote[];
}
export interface LedgerView {
  finance: Array<Record<string, unknown>>;
  receipts: Array<Record<string, unknown>>;
  allocations: Array<Record<string, unknown>>;
  creditApplications: Array<Record<string, unknown>>;
  credits: Array<Record<string, unknown>>;
  refunds: Array<Record<string, unknown>>;
  redemptions: Array<Record<string, unknown>>;
  rewards: Array<Record<string, unknown>>;
  returns: Array<Record<string, unknown>>;
  corrections: Array<Record<string, unknown>>;
}
export interface CrmBootstrap {
  customers: Customer[];
  skus: Sku[];
  orders: OrderListRow[];
  actors: User[];
}
export const SCENARIOS = [
  ['partial-delivery', 'Partial delivery'],
  ['reapproval', 'Commercial revision'],
  ['dispatch-edit', 'Dispatched order edit'],
  ['second-delivery', 'Second shipment'],
  ['cancel-order', 'Cancel an open order'],
  ['cancel-remainder', 'Cancel an unshipped remainder'],
  ['paid-return', 'Paid return with a deduction'],
  ['customer-payment', 'Payment across two orders'],
  ['redemption', 'Redeem available points'],
  ['spent-return', 'Return after redemption'],
  ['credit-settlement', 'Apply a return credit'],
  ['shipment-correction', 'Additional shipped items'],
  ['receipt-retry', 'Repeated payment request'],
  ['competing-returns', 'Competing return requests'],
] as const;
export interface ScenarioReport {
  id: string;
  runId?: string;
  complete?: boolean;
  customerId: string;
  steps: Array<{ label: string; result: ActionResult }>;
  summary: CustomerSummary;
}

export interface SavedWorkflow {
  id: string;
  scenarioId: string;
  customerId: string;
  customerName: string;
  complete: boolean;
  stepCount: number;
  createdAt: string;
}
