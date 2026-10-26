import { createHash, randomUUID, scryptSync } from 'node:crypto';
import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { SCENARIOS } from '@crm/shared/crm';
import type { SQL } from 'drizzle-orm';
import type { User, Role } from '@crm/shared';
import type {
  ActionEnvelope,
  ActionResult,
  CrmCommand,
  CrmBootstrap,
  Customer,
  CustomerSummary,
  OrderListRow,
  OrderDetail,
  Shipment,
  OrderLine,
  ShipmentLine,
  Charge,
  CreditNote,
  EventRow,
  LedgerView,
  ScenarioReport,
  Sku,
  SavedWorkflow,
} from '@crm/shared/crm';
import { DatabaseService } from '../database/database.service.js';

type Row = Record<string, string | number | null>;
type Order = OrderListRow;
interface Line {
  id: string;
  revision_id: string;
  line_key: string;
  order_id: string;
  sku_id: string;
  qty: number;
  unit_price_paise: number;
  points_per_unit: number;
}
interface Context {
  id: string;
  actor: User;
  requester: User;
  now: string;
  customerId: string;
  orderId?: string;
  effects: ActionResult['effects'];
  references: Record<string, string>;
}
type Payload<T extends CrmCommand['type']> = Extract<
  CrmCommand,
  { type: T }
>['payload'];
class Failure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
class StopAfterStep extends Error {}
class Decision extends Error {
  constructor(readonly decisions: ActionResult['decisions']) {
    super('Additional shipment information is required');
  }
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function fail(code: string, message: string): never {
  throw new Failure(code, message);
}
function safe(value: number) {
  if (!Number.isSafeInteger(value))
    fail('AMOUNT_RANGE', 'The amount exceeds the supported range');
  return value;
}
function distinct(ids: string[]) {
  if (new Set(ids).size !== ids.length)
    fail('DUPLICATE_ITEM', 'Submit each line only once');
}

@Injectable()
export class CrmService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {}
  private all<T>(query: SQL) {
    return this.database.db.all<T>(query);
  }
  private one<T>(query: SQL) {
    return this.database.db.get<T>(query);
  }
  private total(query: SQL) {
    return safe(this.one<{ n: number }>(query)?.n ?? 0);
  }
  private add(c: Context, table: string, row: Row) {
    const entries = Object.entries(row);
    this.database.db.run(
      sql`insert into ${sql.identifier(table)} (${sql.join(
        entries.map(([key]) => sql.identifier(key)),
        sql`, `,
      )}) values (${sql.join(
        entries.map(([, value]) => sql`${value}`),
        sql`, `,
      )})`,
    );
    c.effects.push({
      entity: table,
      operation: [
        'reward_ledger',
        'receivable_entries',
        'payment_allocations',
        'credit_applications',
        'credit_refunds',
        'reward_redemptions',
        'business_events',
      ].includes(table)
        ? 'APPEND'
        : 'INSERT',
      after: row,
    });
  }
  private change(c: Context, table: string, id: string, patch: Row) {
    const before = this.one<Row>(
      sql`select * from ${sql.identifier(table)} where id = ${id}`,
    );
    this.database.db.run(
      sql`update ${sql.identifier(table)} set ${sql.join(
        Object.entries(patch).map(
          ([key, value]) => sql`${sql.identifier(key)} = ${value}`,
        ),
        sql`, `,
      )} where id = ${id}`,
    );
    c.effects.push({
      entity: table,
      operation: 'UPDATE',
      before,
      after: { ...before, ...patch },
    });
  }
  private authorize(c: Context, ...roles: Role[]) {
    if (!roles.includes(c.actor.role))
      fail('FORBIDDEN', 'This operation requires a different role');
  }
  private order(c: Context, id: string) {
    const order = this.one<Order>(sql`select * from orders where id = ${id}`);
    if (!order) fail('NOT_FOUND', 'Order not found');
    c.customerId = order.customer_id;
    c.orderId = id;
    return order;
  }
  private customer(c: Context, id: string) {
    const customer = this.one<Customer>(
      sql`select * from customers where id = ${id}`,
    );
    if (!customer) fail('NOT_FOUND', 'Customer not found');
    c.customerId = id;
    return customer;
  }
  private lines(order: Order): Line[] {
    return this.all<Line>(
      sql`select l.* from order_lines l join order_revisions r on r.id=l.revision_id where r.order_id=${order.id} and r.revision=${order.current_revision} order by l.rowid`,
    );
  }

  execute(envelope: ActionEnvelope, requester: User): ActionResult {
    return this.database.db.transaction(
      () => {
        const actorId = envelope.actorId ?? requester.id;
        if (actorId !== requester.id && requester.role !== 'ADMIN')
          throw new ForbiddenException(
            'You cannot submit actions as another staff member',
          );
        const row = this.one<{
          id: string;
          name: string;
          email: string;
          role: Role;
          active: number;
          created_at: string;
        }>(sql`select * from users where id=${actorId}`);
        if (!row?.active)
          throw new ForbiddenException(
            'The staff account is inactive or missing',
          );
        const actor: User = { ...row, active: true, createdAt: row.created_at };
        const fingerprint = createHash('sha256')
          .update(
            stable({
              command: envelope.command,
              actorId,
              expectedVersion: envelope.expectedVersion,
            }),
          )
          .digest('hex');
        const previous = this.one<{ fingerprint: string; result: string }>(
          sql`select fingerprint,result from action_requests where requester_id=${requester.id} and idempotency_key=${envelope.idempotencyKey}`,
        );
        if (previous) {
          if (previous.fingerprint === fingerprint)
            return JSON.parse(previous.result) as ActionResult;
          return {
            status: 'CONFLICT',
            actionId: '',
            errors: [
              {
                code: 'IDEMPOTENCY_CONFLICT',
                message:
                  'This request key has already been used for different input',
              },
            ],
            decisions: [],
            effects: [],
            trace: [],
            aggregateVersions: {},
            references: {},
          };
        }
        const c: Context = {
          id: randomUUID(),
          actor,
          requester,
          now: new Date().toISOString(),
          customerId: '',
          effects: [],
          references: {},
        };
        const result: ActionResult = {
          status: 'APPLIED',
          actionId: c.id,
          errors: [],
          decisions: [],
          effects: c.effects,
          trace: [],
          aggregateVersions: {},
          references: c.references,
        };
        try {
          this.database.db.transaction(() => {
            const p = envelope.command.payload;
            const aggregate =
              'orderId' in p
                ? this.order(c, p.orderId)
                : this.customer(c, p.customerId);
            if (
              envelope.command.type !== 'PUNCH_ORDER' &&
              envelope.expectedVersion === undefined
            )
              fail(
                'VERSION_REQUIRED',
                'Refresh the record and include its version',
              );
            if (
              envelope.expectedVersion !== undefined &&
              envelope.expectedVersion !== aggregate.version
            )
              fail(
                'VERSION_CONFLICT',
                'The record changed. Refresh and try again.',
              );
            switch (envelope.command.type) {
              case 'PUNCH_ORDER':
                this.punch(c, envelope.command.payload);
                break;
              case 'EDIT_ORDER':
                this.edit(c, envelope.command.payload);
                break;
              case 'SUBMIT_ORDER':
                this.submit(c, envelope.command.payload);
                break;
              case 'APPROVE_ORDER':
                this.approve(c, envelope.command.payload);
                break;
              case 'REJECT_ORDER':
                this.reject(c, envelope.command.payload);
                break;
              case 'START_LOADING':
                this.load(c, envelope.command.payload);
                break;
              case 'DISPATCH_SHIPMENT':
                this.dispatch(c, envelope.command.payload);
                break;
              case 'CONFIRM_DELIVERY':
                this.deliver(c, envelope.command.payload);
                break;
              case 'CANCEL_REMAINDER':
                this.cancel(c, envelope.command.payload);
                break;
              case 'RECORD_RETURN':
                this.returnItems(c, envelope.command.payload);
                break;
              case 'RECEIVE_CUSTOMER_PAYMENT':
                this.receive(c, envelope.command.payload);
                break;
              case 'ALLOCATE_PAYMENT':
                this.allocate(c, envelope.command.payload);
                break;
              case 'REDEEM_POINTS':
                this.redeem(c, envelope.command.payload);
                break;
              case 'ISSUE_CREDIT_NOTE':
                this.issueCredit(c, envelope.command.payload);
                break;
              case 'APPLY_CREDIT_NOTE':
                this.applyCredit(c, envelope.command.payload);
                break;
              case 'REFUND_CREDIT_NOTE':
                this.refundCredit(c, envelope.command.payload);
                break;
              case 'CORRECT_DISPATCHED_ORDER':
                this.correct(c, envelope.command.payload);
                break;
            }
            this.database.db.run(
              sql`update customers set version=version+1 where id=${c.customerId}`,
            );
            this.database.db.run(
              sql`update orders set version=version+1 where customer_id=${c.customerId}`,
            );
            result.aggregateVersions[c.customerId] = this.one<Customer>(
              sql`select * from customers where id=${c.customerId}`,
            )!.version;
            for (const order of this.all<Order>(
              sql`select * from orders where customer_id=${c.customerId}`,
            ))
              result.aggregateVersions[order.id] = order.version;
            this.add(c, 'business_events', {
              id: randomUUID(),
              customer_id: c.customerId,
              order_id: c.orderId ?? null,
              actor_id: actor.id,
              actor_name: actor.name,
              requested_by: requester.id,
              action_id: c.id,
              type: envelope.command.type,
              payload: JSON.stringify(envelope.command.payload),
              occurred_at: c.now,
            });
            result.trace.push({
              stage: 'completed',
              explanation: `${envelope.command.type} completed by ${actor.name}. ${c.effects.length} records written.`,
            });
          });
        } catch (error) {
          c.effects.length = 0;
          result.aggregateVersions = {};
          result.references = {};
          if (error instanceof Decision) {
            result.status = 'NEEDS_DECISION';
            result.decisions = error.decisions;
          } else if (error instanceof Failure) {
            result.status = error.code.includes('CONFLICT')
              ? 'CONFLICT'
              : 'REJECTED';
            result.errors = [{ code: error.code, message: error.message }];
          } else throw error;
          result.trace.push({
            stage: 'not_applied',
            explanation: error.message,
          });
        }
        this.database.db.run(
          sql`insert into action_requests (id,requester_id,actor_id,idempotency_key,fingerprint,result,created_at) values (${c.id},${requester.id},${actor.id},${envelope.idempotencyKey},${fingerprint},${JSON.stringify(result)},${c.now})`,
        );
        return result;
      },
      { behavior: 'immediate' },
    );
  }

  private punch(c: Context, p: Payload<'PUNCH_ORDER'>) {
    this.authorize(c, 'SALES', 'ADMIN');
    this.customer(c, p.customerId);
    const orderId = randomUUID();
    c.orderId = orderId;
    c.references.orderId = orderId;
    const revisionId = randomUUID();
    this.add(c, 'orders', {
      id: orderId,
      number: `SO-${Date.now().toString(36).toUpperCase()}-${orderId.slice(0, 4).toUpperCase()}`,
      customer_id: c.customerId,
      status: 'DRAFT',
      current_revision: 1,
      version: 0,
      created_at: c.now,
    });
    this.add(c, 'order_revisions', {
      id: revisionId,
      order_id: orderId,
      revision: 1,
      actor_id: c.actor.id,
      reason: p.reason ?? 'Order created',
      created_at: c.now,
    });
    for (const item of p.items) {
      const sku = this.one<Sku>(sql`select * from skus where id=${item.skuId}`);
      if (!sku) fail('SKU_NOT_FOUND', 'Select an existing SKU');
      safe(item.qty * item.unitPricePaise);
      this.add(c, 'order_lines', {
        id: randomUUID(),
        revision_id: revisionId,
        order_id: orderId,
        line_key: randomUUID(),
        sku_id: sku.id,
        qty: item.qty,
        unit_price_paise: item.unitPricePaise,
        points_per_unit: sku.points_per_unit,
      });
    }
  }

  private edit(c: Context, p: Payload<'EDIT_ORDER'>) {
    this.authorize(c, 'SALES', 'ADMIN');
    const order = this.order(c, p.orderId);
    if (
      this.total(
        sql`select count(*) n from shipments where order_id=${order.id} and dispatched_at is not null`,
      )
    )
      fail(
        'ORDER_DISPATCHED',
        'Dispatched orders require an authorized shipment correction',
      );
    if (
      order.status === 'CANCELLED' ||
      this.total(
        sql`select count(*) n from cancellations where order_id=${order.id}`,
      )
    )
      fail('ORDER_CANCELLED', 'Canceled quantities cannot be edited');
    const existing = this.lines(order);
    const revisionId = randomUUID();
    this.add(c, 'order_revisions', {
      id: revisionId,
      order_id: order.id,
      revision: order.current_revision + 1,
      actor_id: c.actor.id,
      reason: p.reason,
      created_at: c.now,
    });
    for (const item of p.items) {
      const sku = this.one<Sku>(sql`select * from skus where id=${item.skuId}`);
      if (!sku) fail('SKU_NOT_FOUND', 'Select an existing SKU');
      safe(item.qty * item.unitPricePaise);
      this.add(c, 'order_lines', {
        id: randomUUID(),
        revision_id: revisionId,
        order_id: order.id,
        line_key:
          existing.find((line) => line.sku_id === sku.id)?.line_key ??
          randomUUID(),
        sku_id: sku.id,
        qty: item.qty,
        unit_price_paise: item.unitPricePaise,
        points_per_unit: sku.points_per_unit,
      });
    }
    for (const shipment of this.all<{ id: string }>(
      sql`select id from shipments where order_id=${order.id} and status='LOADING'`,
    ))
      this.change(c, 'shipments', shipment.id, { status: 'VOIDED' });
    this.change(c, 'orders', order.id, {
      current_revision: order.current_revision + 1,
      status: ['APPROVED', 'REAPPROVAL_REQUIRED'].includes(order.status)
        ? 'REAPPROVAL_REQUIRED'
        : 'DRAFT',
    });
    for (const line of existing) {
      const locked = this.total(
        sql`select coalesce(sum(points_delta),0) n from reward_ledger where line_key=${line.line_key} and bucket='LOCKED'`,
      );
      if (locked)
        this.add(c, 'reward_ledger', {
          id: randomUUID(),
          customer_id: c.customerId,
          line_key: line.line_key,
          bucket: 'LOCKED',
          points_delta: -locked,
          source_id: revisionId,
          action_id: c.id,
          created_at: c.now,
        });
    }
  }

  private submit(c: Context, p: Payload<'SUBMIT_ORDER'>) {
    this.authorize(c, 'SALES', 'ADMIN');
    const order = this.order(c, p.orderId);
    if (!['DRAFT', 'REJECTED', 'REAPPROVAL_REQUIRED'].includes(order.status))
      fail('ORDER_STATE', 'This order is not awaiting submission');
    this.change(c, 'orders', order.id, {
      status:
        order.status === 'REAPPROVAL_REQUIRED'
          ? 'REAPPROVAL_REQUIRED'
          : 'PENDING',
    });
  }

  private approve(c: Context, p: Payload<'APPROVE_ORDER'>) {
    this.authorize(c, 'KAM', 'ADMIN');
    const order = this.order(c, p.orderId);
    if (!['PENDING', 'REAPPROVAL_REQUIRED'].includes(order.status))
      fail('ORDER_STATE', 'Submit the current revision for approval first');
    if (p.revision !== order.current_revision)
      fail('REVISION_CONFLICT', 'Approve the current commercial revision');
    this.add(c, 'approvals', {
      id: randomUUID(),
      order_id: order.id,
      revision: p.revision,
      actor_id: c.actor.id,
      decision: 'APPROVED',
      reason: 'Commercial approval',
      created_at: c.now,
    });
    this.change(c, 'orders', order.id, { status: 'APPROVED' });
    for (const line of this.lines(order)) {
      const canceled = this.total(
        sql`select coalesce(sum(qty),0) n from cancellations where line_key=${line.line_key}`,
      );
      const current = this.total(
        sql`select coalesce(sum(points_delta),0) n from reward_ledger where line_key=${line.line_key} and bucket='LOCKED'`,
      );
      const desired = safe((line.qty - canceled) * line.points_per_unit);
      if (desired !== current)
        this.add(c, 'reward_ledger', {
          id: randomUUID(),
          customer_id: c.customerId,
          line_key: line.line_key,
          bucket: 'LOCKED',
          points_delta: desired - current,
          source_id: order.id,
          action_id: c.id,
          created_at: c.now,
        });
    }
  }

  private reject(c: Context, p: Payload<'REJECT_ORDER'>) {
    this.authorize(c, 'KAM', 'ADMIN');
    const order = this.order(c, p.orderId);
    if (!['PENDING', 'REAPPROVAL_REQUIRED'].includes(order.status))
      fail('ORDER_STATE', 'The order is not awaiting approval');
    if (p.revision !== order.current_revision)
      fail('REVISION_CONFLICT', 'Review the current commercial revision');
    this.add(c, 'approvals', {
      id: randomUUID(),
      order_id: order.id,
      revision: p.revision,
      actor_id: c.actor.id,
      decision: 'REJECTED',
      reason: p.reason,
      created_at: c.now,
    });
    this.change(c, 'orders', order.id, { status: 'REJECTED' });
  }

  private load(c: Context, p: Payload<'START_LOADING'>) {
    this.authorize(c, 'WAREHOUSE', 'ADMIN');
    const order = this.order(c, p.orderId);
    if (
      order.status !== 'APPROVED' ||
      !this.total(
        sql`select count(*) n from approvals where order_id=${order.id} and revision=${order.current_revision} and decision='APPROVED'`,
      )
    )
      fail('APPROVAL_REQUIRED', 'The current revision needs approval');
    distinct(p.items.map((item) => item.lineKey));
    const lines = this.lines(order);
    const shipmentId = randomUUID();
    c.references.shipmentId = shipmentId;
    this.add(c, 'shipments', {
      id: shipmentId,
      order_id: order.id,
      revision: order.current_revision,
      status: 'LOADING',
      original_shipment_id: null,
      correction_id: null,
      created_at: c.now,
      dispatched_at: null,
    });
    for (const item of p.items) {
      const line = lines.find((row) => row.line_key === item.lineKey);
      if (!line)
        fail(
          'LINE_NOT_FOUND',
          'The line does not belong to the current revision',
        );
      const reserved = this.total(
        sql`select coalesce(sum(l.loaded_qty),0) n from shipment_lines l join shipments s on s.id=l.shipment_id where l.line_key=${line.line_key} and s.status!='VOIDED' and s.id!=${shipmentId}`,
      );
      const canceled = this.total(
        sql`select coalesce(sum(qty),0) n from cancellations where line_key=${line.line_key}`,
      );
      if (item.qty > line.qty - reserved - canceled)
        fail('QUANTITY_EXCEEDED', 'Loading exceeds the unshipped quantity');
      this.add(c, 'shipment_lines', {
        id: randomUUID(),
        shipment_id: shipmentId,
        order_id: order.id,
        line_key: line.line_key,
        sku_id: line.sku_id,
        loaded_qty: item.qty,
        dispatched_qty: 0,
        unit_price_paise: line.unit_price_paise,
        points_per_unit: line.points_per_unit,
      });
    }
  }

  private dispatch(c: Context, p: Payload<'DISPATCH_SHIPMENT'>) {
    this.authorize(c, 'WAREHOUSE', 'ADMIN');
    const order = this.order(c, p.orderId);
    const shipment = this.one<{ id: string; status: string; revision: number }>(
      sql`select * from shipments where id=${p.shipmentId} and order_id=${order.id}`,
    );
    if (!shipment || shipment.status !== 'LOADING')
      fail('SHIPMENT_STATE', 'Select a shipment that is loading');
    if (
      order.status !== 'APPROVED' ||
      shipment.revision !== order.current_revision ||
      !this.total(
        sql`select count(*) n from approvals where order_id=${order.id} and revision=${order.current_revision} and decision='APPROVED'`,
      )
    )
      fail('APPROVAL_REQUIRED', 'The loading document needs current approval');
    this.change(c, 'shipments', shipment.id, {
      status: 'DISPATCHED',
      dispatched_at: c.now,
    });
    for (const line of this.all<ShipmentLine>(
      sql`select * from shipment_lines where shipment_id=${shipment.id}`,
    ))
      this.change(c, 'shipment_lines', line.id, {
        dispatched_qty: line.loaded_qty,
      });
  }

  private deliver(c: Context, p: Payload<'CONFIRM_DELIVERY'>) {
    this.authorize(c, 'WAREHOUSE', 'ADMIN');
    const order = this.order(c, p.orderId);
    const shipment = this.one<{ id: string; status: string }>(
      sql`select * from shipments where id=${p.shipmentId} and order_id=${order.id}`,
    );
    if (!shipment || shipment.status !== 'DISPATCHED')
      fail('SHIPMENT_STATE', 'Select an open dispatched shipment');
    distinct(p.items.map((item) => item.shipmentLineId));
    for (const item of p.items) {
      const line = this.one<ShipmentLine & { points_per_unit: number }>(
        sql`select * from shipment_lines where id=${item.shipmentLineId} and shipment_id=${shipment.id}`,
      );
      if (!line)
        fail(
          'LINE_NOT_FOUND',
          'The shipment line does not belong to this shipment',
        );
      const delivered = this.total(
        sql`select coalesce(sum(qty),0) n from deliveries where shipment_line_id=${line.id}`,
      );
      if (item.qty > line.dispatched_qty - delivered)
        fail('QUANTITY_EXCEEDED', 'Delivery exceeds the dispatched quantity');
      const deliveryId = randomUUID();
      this.add(c, 'deliveries', {
        id: deliveryId,
        shipment_line_id: line.id,
        order_id: order.id,
        qty: item.qty,
        action_id: c.id,
        created_at: c.now,
      });
      this.add(c, 'receivable_entries', {
        id: randomUUID(),
        customer_id: c.customerId,
        order_id: order.id,
        line_key: line.line_key,
        shipment_line_id: line.id,
        kind: 'DELIVERY',
        amount_paise: safe(item.qty * line.unit_price_paise),
        adjusts_id: null,
        source_id: deliveryId,
        action_id: c.id,
        created_at: c.now,
      });
    }
    const remaining = this.total(
      sql`select coalesce(sum(l.dispatched_qty-(select coalesce(sum(d.qty),0) from deliveries d where d.shipment_line_id=l.id)),0) n from shipment_lines l where l.shipment_id=${shipment.id}`,
    );
    if (!remaining)
      this.change(c, 'shipments', shipment.id, { status: 'DELIVERED' });

    for (const receipt of this.all<{ id: string; amount_paise: number }>(
      sql`select * from payment_receipts where customer_id=${c.customerId} order by created_at,rowid`,
    )) {
      let available =
        receipt.amount_paise -
        this.total(
          sql`select coalesce(sum(amount_paise),0) n from payment_allocations where receipt_id=${receipt.id}`,
        ) -
        this.total(
          sql`select coalesce(sum(amount_paise),0) n from credit_funds where receipt_id=${receipt.id}`,
        );
      if (available < 0)
        fail('RECEIPT_MISMATCH', 'Receipt allocations exceed captured funds');
      for (const charge of this.all<Charge>(
        sql`select * from receivable_entries where customer_id=${c.customerId} and amount_paise>0 order by created_at,rowid`,
      )) {
        if (!available) break;
        const face =
          charge.amount_paise +
          this.total(
            sql`select coalesce(sum(amount_paise),0) n from receivable_entries where adjusts_id=${charge.id}`,
          );
        const cash = this.total(
          sql`select coalesce(sum(amount_paise),0) n from payment_allocations where charge_id=${charge.id}`,
        );
        const credit = this.total(
          sql`select coalesce(sum(amount_paise),0) n from credit_applications where charge_id=${charge.id}`,
        );
        const redeemed = this.total(
          sql`select coalesce(sum(points),0) n from reward_redemptions where charge_id=${charge.id}`,
        );
        const take = Math.min(
          available,
          Math.max(0, face - cash - credit - redeemed),
        );
        if (take)
          this.add(c, 'payment_allocations', {
            id: randomUUID(),
            customer_id: c.customerId,
            receipt_id: receipt.id,
            charge_id: charge.id,
            amount_paise: take,
            action_id: c.id,
            created_at: c.now,
          });
        available -= take;
      }
    }

    for (const orderRow of this.all<Order>(
      sql`select * from orders where customer_id=${c.customerId}`,
    )) {
      for (const lineRow of this.lines(orderRow)) {
        const canceledQty = this.total(
          sql`select coalesce(sum(qty),0) n from cancellations where line_key=${lineRow.line_key}`,
        );
        const returnedQty = this.total(
          sql`select coalesce(sum(r.qty),0) n from return_lines r join shipment_lines s on s.id=r.shipment_line_id where s.line_key=${lineRow.line_key}`,
        );
        const entitled =
          orderRow.status === 'APPROVED'
            ? safe(
                Math.max(0, lineRow.qty - canceledQty - returnedQty) *
                  lineRow.points_per_unit,
              )
            : 0;
        let earned = 0;
        for (const chargeRow of this.all<Charge>(
          sql`select * from receivable_entries where line_key=${lineRow.line_key} and amount_paise>0`,
        )) {
          const qualifyingCash = this.total(
            sql`select coalesce(sum(amount_paise),0) n from payment_allocations where charge_id=${chargeRow.id}`,
          );
          earned = safe(
            earned +
              Number(
                (BigInt(qualifyingCash) * BigInt(lineRow.points_per_unit)) /
                  BigInt(lineRow.unit_price_paise),
              ),
          );
        }
        earned = Math.min(entitled, earned);
        const previousEarned = this.total(
          sql`select coalesce(sum(points_delta),0) n from reward_ledger where line_key=${lineRow.line_key} and bucket='AVAILABLE'`,
        );
        if (earned !== previousEarned)
          this.add(c, 'reward_ledger', {
            id: randomUUID(),
            customer_id: c.customerId,
            line_key: lineRow.line_key,
            bucket: 'AVAILABLE',
            points_delta: earned - previousEarned,
            source_id: c.id,
            action_id: c.id,
            created_at: c.now,
          });
        const previousLocked = this.total(
          sql`select coalesce(sum(points_delta),0) n from reward_ledger where line_key=${lineRow.line_key} and bucket='LOCKED'`,
        );
        if (entitled - earned !== previousLocked)
          this.add(c, 'reward_ledger', {
            id: randomUUID(),
            customer_id: c.customerId,
            line_key: lineRow.line_key,
            bucket: 'LOCKED',
            points_delta: entitled - earned - previousLocked,
            source_id: c.id,
            action_id: c.id,
            created_at: c.now,
          });
      }
    }
    const spendable = this.total(
      sql`select coalesce(sum(points_delta),0) n from reward_ledger where customer_id=${c.customerId} and bucket='AVAILABLE'`,
    );
    const outstandingClawback = this.total(
      sql`select coalesce(sum(points_delta),0) n from reward_ledger where customer_id=${c.customerId} and bucket='CLAWBACK_PENDING'`,
    );
    if (spendable < 0) {
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'AVAILABLE',
        points_delta: -spendable,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'CLAWBACK_PENDING',
        points_delta: -spendable,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
    } else if (outstandingClawback > 0 && spendable > 0) {
      const offset = Math.min(outstandingClawback, spendable);
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'AVAILABLE',
        points_delta: -offset,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'CLAWBACK_PENDING',
        points_delta: -offset,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
    }
  }

  private cancel(c: Context, p: Payload<'CANCEL_REMAINDER'>) {
    this.authorize(c, 'SALES', 'ADMIN');
    const order = this.order(c, p.orderId);
    let canceledTotal = 0;
    for (const shipment of this.all<{ id: string }>(
      sql`select id from shipments where order_id=${order.id} and status='LOADING'`,
    ))
      this.change(c, 'shipments', shipment.id, { status: 'VOIDED' });
    for (const line of this.lines(order)) {
      const sent = this.total(
        sql`select coalesce(sum(l.dispatched_qty),0) n from shipment_lines l join shipments s on s.id=l.shipment_id where l.line_key=${line.line_key} and s.status!='VOIDED'`,
      );
      const prior = this.total(
        sql`select coalesce(sum(qty),0) n from cancellations where line_key=${line.line_key}`,
      );
      const qty = line.qty - sent - prior;
      if (qty > 0) {
        this.add(c, 'cancellations', {
          id: randomUUID(),
          order_id: order.id,
          line_key: line.line_key,
          qty,
          reason: p.reason,
          action_id: c.id,
          created_at: c.now,
        });
        canceledTotal += qty;
      }
    }
    if (!canceledTotal)
      fail('NOTHING_TO_CANCEL', 'There are no unshipped units to cancel');
    if (
      !this.total(
        sql`select coalesce(sum(dispatched_qty),0) n from shipment_lines where order_id=${order.id}`,
      )
    )
      this.change(c, 'orders', order.id, { status: 'CANCELLED' });

    for (const orderRow of this.all<Order>(
      sql`select * from orders where customer_id=${c.customerId}`,
    )) {
      for (const lineRow of this.lines(orderRow)) {
        const canceledQty = this.total(
          sql`select coalesce(sum(qty),0) n from cancellations where line_key=${lineRow.line_key}`,
        );
        const returnedQty = this.total(
          sql`select coalesce(sum(r.qty),0) n from return_lines r join shipment_lines s on s.id=r.shipment_line_id where s.line_key=${lineRow.line_key}`,
        );
        const entitled =
          orderRow.status === 'APPROVED'
            ? safe(
                Math.max(0, lineRow.qty - canceledQty - returnedQty) *
                  lineRow.points_per_unit,
              )
            : 0;
        let earned = 0;
        for (const chargeRow of this.all<Charge>(
          sql`select * from receivable_entries where line_key=${lineRow.line_key} and amount_paise>0`,
        )) {
          const qualifyingCash = this.total(
            sql`select coalesce(sum(amount_paise),0) n from payment_allocations where charge_id=${chargeRow.id}`,
          );
          earned = safe(
            earned +
              Number(
                (BigInt(qualifyingCash) * BigInt(lineRow.points_per_unit)) /
                  BigInt(lineRow.unit_price_paise),
              ),
          );
        }
        earned = Math.min(entitled, earned);
        const previousEarned = this.total(
          sql`select coalesce(sum(points_delta),0) n from reward_ledger where line_key=${lineRow.line_key} and bucket='AVAILABLE'`,
        );
        if (earned !== previousEarned)
          this.add(c, 'reward_ledger', {
            id: randomUUID(),
            customer_id: c.customerId,
            line_key: lineRow.line_key,
            bucket: 'AVAILABLE',
            points_delta: earned - previousEarned,
            source_id: c.id,
            action_id: c.id,
            created_at: c.now,
          });
        const previousLocked = this.total(
          sql`select coalesce(sum(points_delta),0) n from reward_ledger where line_key=${lineRow.line_key} and bucket='LOCKED'`,
        );
        if (entitled - earned !== previousLocked)
          this.add(c, 'reward_ledger', {
            id: randomUUID(),
            customer_id: c.customerId,
            line_key: lineRow.line_key,
            bucket: 'LOCKED',
            points_delta: entitled - earned - previousLocked,
            source_id: c.id,
            action_id: c.id,
            created_at: c.now,
          });
      }
    }
    const spendable = this.total(
      sql`select coalesce(sum(points_delta),0) n from reward_ledger where customer_id=${c.customerId} and bucket='AVAILABLE'`,
    );
    const outstandingClawback = this.total(
      sql`select coalesce(sum(points_delta),0) n from reward_ledger where customer_id=${c.customerId} and bucket='CLAWBACK_PENDING'`,
    );
    if (spendable < 0) {
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'AVAILABLE',
        points_delta: -spendable,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'CLAWBACK_PENDING',
        points_delta: -spendable,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
    } else if (outstandingClawback > 0 && spendable > 0) {
      const offset = Math.min(outstandingClawback, spendable);
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'AVAILABLE',
        points_delta: -offset,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'CLAWBACK_PENDING',
        points_delta: -offset,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
    }
  }

  private returnItems(c: Context, p: Payload<'RECORD_RETURN'>) {
    this.authorize(c, 'WAREHOUSE', 'ADMIN');
    const order = this.order(c, p.orderId);
    distinct(p.items.map((item) => item.shipmentLineId));
    const returned = p.items.map((item) => {
      const line = this.one<ShipmentLine>(
        sql`select * from shipment_lines where id=${item.shipmentLineId} and order_id=${order.id}`,
      );
      if (!line) fail('LINE_NOT_FOUND', 'Select a line from this order');
      const delivered = this.total(
        sql`select coalesce(sum(qty),0) n from deliveries where shipment_line_id=${line.id}`,
      );
      const prior = this.total(
        sql`select coalesce(sum(qty),0) n from return_lines where shipment_line_id=${line.id}`,
      );
      if (item.qty > delivered - prior)
        fail(
          'RETURN_EXCEEDED',
          'The return exceeds delivered, unreturned units',
        );
      return {
        line,
        qty: item.qty,
        amount: safe(item.qty * line.unit_price_paise),
      };
    });
    const gross = safe(returned.reduce((sum, item) => sum + item.amount, 0));
    if (p.feePaise > gross)
      fail(
        'FEE_EXCEEDED',
        'The deduction cannot exceed the returned goods value',
      );
    const returnId = randomUUID();
    c.references.returnId = returnId;
    this.add(c, 'returns', {
      id: returnId,
      customer_id: c.customerId,
      order_id: order.id,
      gross_paise: gross,
      fee_paise: p.feePaise,
      reason: p.reason,
      action_id: c.id,
      created_at: c.now,
    });
    const released = new Map<string, number>();
    for (const { line, qty, amount } of returned) {
      this.add(c, 'return_lines', {
        id: randomUUID(),
        return_id: returnId,
        shipment_line_id: line.id,
        qty,
        amount_paise: amount,
      });
      let remaining = amount;
      for (const charge of this.all<Charge>(
        sql`select * from receivable_entries where shipment_line_id=${line.id} and amount_paise>0 order by rowid`,
      )) {
        if (!remaining) break;
        const face =
          charge.amount_paise +
          this.total(
            sql`select coalesce(sum(amount_paise),0) n from receivable_entries where adjusts_id=${charge.id}`,
          );
        const reduction = Math.min(face, remaining);
        if (!reduction) continue;
        this.add(c, 'receivable_entries', {
          id: randomUUID(),
          customer_id: c.customerId,
          order_id: order.id,
          line_key: line.line_key,
          shipment_line_id: line.id,
          kind: 'RETURN',
          amount_paise: -reduction,
          adjusts_id: charge.id,
          source_id: returnId,
          action_id: c.id,
          created_at: c.now,
        });
        remaining -= reduction;
        const cash = this.total(
          sql`select coalesce(sum(amount_paise),0) n from payment_allocations where charge_id=${charge.id}`,
        );
        const credits = this.total(
          sql`select coalesce(sum(amount_paise),0) n from credit_applications where charge_id=${charge.id}`,
        );
        const rewards = this.total(
          sql`select coalesce(sum(points),0) n from reward_redemptions where charge_id=${charge.id}`,
        );
        let overage = Math.max(
          0,
          cash + credits + rewards - (face - reduction),
        );
        for (const allocation of this.all<{ receipt_id: string; n: number }>(
          sql`select receipt_id,sum(amount_paise) n from payment_allocations where charge_id=${charge.id} group by receipt_id having sum(amount_paise)>0 order by min(rowid) desc`,
        )) {
          const take = Math.min(overage, allocation.n);
          if (!take) continue;
          this.add(c, 'payment_allocations', {
            id: randomUUID(),
            customer_id: c.customerId,
            receipt_id: allocation.receipt_id,
            charge_id: charge.id,
            amount_paise: -take,
            action_id: c.id,
            created_at: c.now,
          });
          released.set(
            allocation.receipt_id,
            (released.get(allocation.receipt_id) ?? 0) + take,
          );
          overage -= take;
        }
        for (const application of this.all<{
          credit_note_id: string;
          n: number;
        }>(
          sql`select credit_note_id,sum(amount_paise) n from credit_applications where charge_id=${charge.id} group by credit_note_id having sum(amount_paise)>0 order by min(rowid) desc`,
        )) {
          const take = Math.min(overage, application.n);
          if (!take) continue;
          this.add(c, 'credit_applications', {
            id: randomUUID(),
            customer_id: c.customerId,
            credit_note_id: application.credit_note_id,
            charge_id: charge.id,
            amount_paise: -take,
            action_id: c.id,
            created_at: c.now,
          });
          overage -= take;
        }
        if (overage > 0) {
          if (overage > rewards)
            fail(
              'SETTLEMENT_MISMATCH',
              'The return cannot be settled against its source documents',
            );
          this.add(c, 'reward_redemptions', {
            id: randomUUID(),
            customer_id: c.customerId,
            charge_id: charge.id,
            points: -overage,
            action_id: c.id,
            created_at: c.now,
          });
          this.add(c, 'reward_ledger', {
            id: randomUUID(),
            customer_id: c.customerId,
            line_key: null,
            bucket: 'AVAILABLE',
            points_delta: overage,
            source_id: returnId,
            action_id: c.id,
            created_at: c.now,
          });
          this.add(c, 'reward_ledger', {
            id: randomUUID(),
            customer_id: c.customerId,
            line_key: null,
            bucket: 'REDEEMED',
            points_delta: -overage,
            source_id: returnId,
            action_id: c.id,
            created_at: c.now,
          });
        }
      }
      if (remaining)
        fail('CHARGE_MISMATCH', 'Delivered charges do not cover this return');
    }
    if (p.feePaise) {
      const feeId = randomUUID();
      let due = p.feePaise;
      this.add(c, 'receivable_entries', {
        id: feeId,
        customer_id: c.customerId,
        order_id: order.id,
        line_key: null,
        shipment_line_id: null,
        kind: 'RETURN_FEE',
        amount_paise: p.feePaise,
        adjusts_id: null,
        source_id: returnId,
        action_id: c.id,
        created_at: c.now,
      });
      for (const [receiptId, available] of released) {
        const take = Math.min(due, available);
        if (!take) continue;
        this.add(c, 'payment_allocations', {
          id: randomUUID(),
          customer_id: c.customerId,
          receipt_id: receiptId,
          charge_id: feeId,
          amount_paise: take,
          action_id: c.id,
          created_at: c.now,
        });
        released.set(receiptId, available - take);
        due -= take;
      }
    }
    const credit = safe(
      [...released.values()].reduce((sum, value) => sum + value, 0),
    );
    if (credit) {
      const creditId = randomUUID();
      c.references.creditNoteId = creditId;
      this.add(c, 'credit_notes', {
        id: creditId,
        customer_id: c.customerId,
        return_id: returnId,
        amount_paise: credit,
        reason: p.reason,
        action_id: c.id,
        created_at: c.now,
      });
      for (const [receiptId, amount] of released)
        if (amount)
          this.add(c, 'credit_funds', {
            id: randomUUID(),
            credit_note_id: creditId,
            receipt_id: receiptId,
            amount_paise: amount,
          });
    }

    for (const receipt of this.all<{ id: string; amount_paise: number }>(
      sql`select * from payment_receipts where customer_id=${c.customerId} order by created_at,rowid`,
    )) {
      let available =
        receipt.amount_paise -
        this.total(
          sql`select coalesce(sum(amount_paise),0) n from payment_allocations where receipt_id=${receipt.id}`,
        ) -
        this.total(
          sql`select coalesce(sum(amount_paise),0) n from credit_funds where receipt_id=${receipt.id}`,
        );
      if (available < 0)
        fail('RECEIPT_MISMATCH', 'Receipt allocations exceed captured funds');
      for (const charge of this.all<Charge>(
        sql`select * from receivable_entries where customer_id=${c.customerId} and amount_paise>0 order by created_at,rowid`,
      )) {
        if (!available) break;
        const face =
          charge.amount_paise +
          this.total(
            sql`select coalesce(sum(amount_paise),0) n from receivable_entries where adjusts_id=${charge.id}`,
          );
        const cash = this.total(
          sql`select coalesce(sum(amount_paise),0) n from payment_allocations where charge_id=${charge.id}`,
        );
        const credit = this.total(
          sql`select coalesce(sum(amount_paise),0) n from credit_applications where charge_id=${charge.id}`,
        );
        const redeemed = this.total(
          sql`select coalesce(sum(points),0) n from reward_redemptions where charge_id=${charge.id}`,
        );
        const take = Math.min(
          available,
          Math.max(0, face - cash - credit - redeemed),
        );
        if (take)
          this.add(c, 'payment_allocations', {
            id: randomUUID(),
            customer_id: c.customerId,
            receipt_id: receipt.id,
            charge_id: charge.id,
            amount_paise: take,
            action_id: c.id,
            created_at: c.now,
          });
        available -= take;
      }
    }

    for (const orderRow of this.all<Order>(
      sql`select * from orders where customer_id=${c.customerId}`,
    )) {
      for (const lineRow of this.lines(orderRow)) {
        const canceledQty = this.total(
          sql`select coalesce(sum(qty),0) n from cancellations where line_key=${lineRow.line_key}`,
        );
        const returnedQty = this.total(
          sql`select coalesce(sum(r.qty),0) n from return_lines r join shipment_lines s on s.id=r.shipment_line_id where s.line_key=${lineRow.line_key}`,
        );
        const entitled =
          orderRow.status === 'APPROVED'
            ? safe(
                Math.max(0, lineRow.qty - canceledQty - returnedQty) *
                  lineRow.points_per_unit,
              )
            : 0;
        let earned = 0;
        for (const chargeRow of this.all<Charge>(
          sql`select * from receivable_entries where line_key=${lineRow.line_key} and amount_paise>0`,
        )) {
          const qualifyingCash = this.total(
            sql`select coalesce(sum(amount_paise),0) n from payment_allocations where charge_id=${chargeRow.id}`,
          );
          earned = safe(
            earned +
              Number(
                (BigInt(qualifyingCash) * BigInt(lineRow.points_per_unit)) /
                  BigInt(lineRow.unit_price_paise),
              ),
          );
        }
        earned = Math.min(entitled, earned);
        const previousEarned = this.total(
          sql`select coalesce(sum(points_delta),0) n from reward_ledger where line_key=${lineRow.line_key} and bucket='AVAILABLE'`,
        );
        if (earned !== previousEarned)
          this.add(c, 'reward_ledger', {
            id: randomUUID(),
            customer_id: c.customerId,
            line_key: lineRow.line_key,
            bucket: 'AVAILABLE',
            points_delta: earned - previousEarned,
            source_id: c.id,
            action_id: c.id,
            created_at: c.now,
          });
        const previousLocked = this.total(
          sql`select coalesce(sum(points_delta),0) n from reward_ledger where line_key=${lineRow.line_key} and bucket='LOCKED'`,
        );
        if (entitled - earned !== previousLocked)
          this.add(c, 'reward_ledger', {
            id: randomUUID(),
            customer_id: c.customerId,
            line_key: lineRow.line_key,
            bucket: 'LOCKED',
            points_delta: entitled - earned - previousLocked,
            source_id: c.id,
            action_id: c.id,
            created_at: c.now,
          });
      }
    }
    const spendable = this.total(
      sql`select coalesce(sum(points_delta),0) n from reward_ledger where customer_id=${c.customerId} and bucket='AVAILABLE'`,
    );
    const outstandingClawback = this.total(
      sql`select coalesce(sum(points_delta),0) n from reward_ledger where customer_id=${c.customerId} and bucket='CLAWBACK_PENDING'`,
    );
    if (spendable < 0) {
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'AVAILABLE',
        points_delta: -spendable,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'CLAWBACK_PENDING',
        points_delta: -spendable,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
    } else if (outstandingClawback > 0 && spendable > 0) {
      const offset = Math.min(outstandingClawback, spendable);
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'AVAILABLE',
        points_delta: -offset,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'CLAWBACK_PENDING',
        points_delta: -offset,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
    }
  }

  private receive(c: Context, p: Payload<'RECEIVE_CUSTOMER_PAYMENT'>) {
    this.authorize(c, 'ACCOUNTS', 'ADMIN');
    this.customer(c, p.customerId);
    const receiptId = randomUUID();
    c.references.receiptId = receiptId;
    this.add(c, 'payment_receipts', {
      id: receiptId,
      customer_id: c.customerId,
      amount_paise: p.amountPaise,
      reference: p.reference,
      action_id: c.id,
      created_at: c.now,
    });

    for (const receipt of this.all<{ id: string; amount_paise: number }>(
      sql`select * from payment_receipts where customer_id=${c.customerId} order by created_at,rowid`,
    )) {
      let available =
        receipt.amount_paise -
        this.total(
          sql`select coalesce(sum(amount_paise),0) n from payment_allocations where receipt_id=${receipt.id}`,
        ) -
        this.total(
          sql`select coalesce(sum(amount_paise),0) n from credit_funds where receipt_id=${receipt.id}`,
        );
      if (available < 0)
        fail('RECEIPT_MISMATCH', 'Receipt allocations exceed captured funds');
      for (const charge of this.all<Charge>(
        sql`select * from receivable_entries where customer_id=${c.customerId} and amount_paise>0 order by created_at,rowid`,
      )) {
        if (!available) break;
        const face =
          charge.amount_paise +
          this.total(
            sql`select coalesce(sum(amount_paise),0) n from receivable_entries where adjusts_id=${charge.id}`,
          );
        const cash = this.total(
          sql`select coalesce(sum(amount_paise),0) n from payment_allocations where charge_id=${charge.id}`,
        );
        const credit = this.total(
          sql`select coalesce(sum(amount_paise),0) n from credit_applications where charge_id=${charge.id}`,
        );
        const redeemed = this.total(
          sql`select coalesce(sum(points),0) n from reward_redemptions where charge_id=${charge.id}`,
        );
        const take = Math.min(
          available,
          Math.max(0, face - cash - credit - redeemed),
        );
        if (take)
          this.add(c, 'payment_allocations', {
            id: randomUUID(),
            customer_id: c.customerId,
            receipt_id: receipt.id,
            charge_id: charge.id,
            amount_paise: take,
            action_id: c.id,
            created_at: c.now,
          });
        available -= take;
      }
    }

    for (const orderRow of this.all<Order>(
      sql`select * from orders where customer_id=${c.customerId}`,
    )) {
      for (const lineRow of this.lines(orderRow)) {
        const canceledQty = this.total(
          sql`select coalesce(sum(qty),0) n from cancellations where line_key=${lineRow.line_key}`,
        );
        const returnedQty = this.total(
          sql`select coalesce(sum(r.qty),0) n from return_lines r join shipment_lines s on s.id=r.shipment_line_id where s.line_key=${lineRow.line_key}`,
        );
        const entitled =
          orderRow.status === 'APPROVED'
            ? safe(
                Math.max(0, lineRow.qty - canceledQty - returnedQty) *
                  lineRow.points_per_unit,
              )
            : 0;
        let earned = 0;
        for (const chargeRow of this.all<Charge>(
          sql`select * from receivable_entries where line_key=${lineRow.line_key} and amount_paise>0`,
        )) {
          const qualifyingCash = this.total(
            sql`select coalesce(sum(amount_paise),0) n from payment_allocations where charge_id=${chargeRow.id}`,
          );
          earned = safe(
            earned +
              Number(
                (BigInt(qualifyingCash) * BigInt(lineRow.points_per_unit)) /
                  BigInt(lineRow.unit_price_paise),
              ),
          );
        }
        earned = Math.min(entitled, earned);
        const previousEarned = this.total(
          sql`select coalesce(sum(points_delta),0) n from reward_ledger where line_key=${lineRow.line_key} and bucket='AVAILABLE'`,
        );
        if (earned !== previousEarned)
          this.add(c, 'reward_ledger', {
            id: randomUUID(),
            customer_id: c.customerId,
            line_key: lineRow.line_key,
            bucket: 'AVAILABLE',
            points_delta: earned - previousEarned,
            source_id: c.id,
            action_id: c.id,
            created_at: c.now,
          });
        const previousLocked = this.total(
          sql`select coalesce(sum(points_delta),0) n from reward_ledger where line_key=${lineRow.line_key} and bucket='LOCKED'`,
        );
        if (entitled - earned !== previousLocked)
          this.add(c, 'reward_ledger', {
            id: randomUUID(),
            customer_id: c.customerId,
            line_key: lineRow.line_key,
            bucket: 'LOCKED',
            points_delta: entitled - earned - previousLocked,
            source_id: c.id,
            action_id: c.id,
            created_at: c.now,
          });
      }
    }
    const spendable = this.total(
      sql`select coalesce(sum(points_delta),0) n from reward_ledger where customer_id=${c.customerId} and bucket='AVAILABLE'`,
    );
    const outstandingClawback = this.total(
      sql`select coalesce(sum(points_delta),0) n from reward_ledger where customer_id=${c.customerId} and bucket='CLAWBACK_PENDING'`,
    );
    if (spendable < 0) {
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'AVAILABLE',
        points_delta: -spendable,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'CLAWBACK_PENDING',
        points_delta: -spendable,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
    } else if (outstandingClawback > 0 && spendable > 0) {
      const offset = Math.min(outstandingClawback, spendable);
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'AVAILABLE',
        points_delta: -offset,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'CLAWBACK_PENDING',
        points_delta: -offset,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
    }
  }

  private allocate(c: Context, p: Payload<'ALLOCATE_PAYMENT'>) {
    this.authorize(c, 'ACCOUNTS', 'ADMIN');
    this.customer(c, p.customerId);

    for (const receipt of this.all<{ id: string; amount_paise: number }>(
      sql`select * from payment_receipts where customer_id=${c.customerId} order by created_at,rowid`,
    )) {
      let available =
        receipt.amount_paise -
        this.total(
          sql`select coalesce(sum(amount_paise),0) n from payment_allocations where receipt_id=${receipt.id}`,
        ) -
        this.total(
          sql`select coalesce(sum(amount_paise),0) n from credit_funds where receipt_id=${receipt.id}`,
        );
      if (available < 0)
        fail('RECEIPT_MISMATCH', 'Receipt allocations exceed captured funds');
      for (const charge of this.all<Charge>(
        sql`select * from receivable_entries where customer_id=${c.customerId} and amount_paise>0 order by created_at,rowid`,
      )) {
        if (!available) break;
        const face =
          charge.amount_paise +
          this.total(
            sql`select coalesce(sum(amount_paise),0) n from receivable_entries where adjusts_id=${charge.id}`,
          );
        const cash = this.total(
          sql`select coalesce(sum(amount_paise),0) n from payment_allocations where charge_id=${charge.id}`,
        );
        const credit = this.total(
          sql`select coalesce(sum(amount_paise),0) n from credit_applications where charge_id=${charge.id}`,
        );
        const redeemed = this.total(
          sql`select coalesce(sum(points),0) n from reward_redemptions where charge_id=${charge.id}`,
        );
        const take = Math.min(
          available,
          Math.max(0, face - cash - credit - redeemed),
        );
        if (take)
          this.add(c, 'payment_allocations', {
            id: randomUUID(),
            customer_id: c.customerId,
            receipt_id: receipt.id,
            charge_id: charge.id,
            amount_paise: take,
            action_id: c.id,
            created_at: c.now,
          });
        available -= take;
      }
    }

    for (const orderRow of this.all<Order>(
      sql`select * from orders where customer_id=${c.customerId}`,
    )) {
      for (const lineRow of this.lines(orderRow)) {
        const canceledQty = this.total(
          sql`select coalesce(sum(qty),0) n from cancellations where line_key=${lineRow.line_key}`,
        );
        const returnedQty = this.total(
          sql`select coalesce(sum(r.qty),0) n from return_lines r join shipment_lines s on s.id=r.shipment_line_id where s.line_key=${lineRow.line_key}`,
        );
        const entitled =
          orderRow.status === 'APPROVED'
            ? safe(
                Math.max(0, lineRow.qty - canceledQty - returnedQty) *
                  lineRow.points_per_unit,
              )
            : 0;
        let earned = 0;
        for (const chargeRow of this.all<Charge>(
          sql`select * from receivable_entries where line_key=${lineRow.line_key} and amount_paise>0`,
        )) {
          const qualifyingCash = this.total(
            sql`select coalesce(sum(amount_paise),0) n from payment_allocations where charge_id=${chargeRow.id}`,
          );
          earned = safe(
            earned +
              Number(
                (BigInt(qualifyingCash) * BigInt(lineRow.points_per_unit)) /
                  BigInt(lineRow.unit_price_paise),
              ),
          );
        }
        earned = Math.min(entitled, earned);
        const previousEarned = this.total(
          sql`select coalesce(sum(points_delta),0) n from reward_ledger where line_key=${lineRow.line_key} and bucket='AVAILABLE'`,
        );
        if (earned !== previousEarned)
          this.add(c, 'reward_ledger', {
            id: randomUUID(),
            customer_id: c.customerId,
            line_key: lineRow.line_key,
            bucket: 'AVAILABLE',
            points_delta: earned - previousEarned,
            source_id: c.id,
            action_id: c.id,
            created_at: c.now,
          });
        const previousLocked = this.total(
          sql`select coalesce(sum(points_delta),0) n from reward_ledger where line_key=${lineRow.line_key} and bucket='LOCKED'`,
        );
        if (entitled - earned !== previousLocked)
          this.add(c, 'reward_ledger', {
            id: randomUUID(),
            customer_id: c.customerId,
            line_key: lineRow.line_key,
            bucket: 'LOCKED',
            points_delta: entitled - earned - previousLocked,
            source_id: c.id,
            action_id: c.id,
            created_at: c.now,
          });
      }
    }
    const spendable = this.total(
      sql`select coalesce(sum(points_delta),0) n from reward_ledger where customer_id=${c.customerId} and bucket='AVAILABLE'`,
    );
    const outstandingClawback = this.total(
      sql`select coalesce(sum(points_delta),0) n from reward_ledger where customer_id=${c.customerId} and bucket='CLAWBACK_PENDING'`,
    );
    if (spendable < 0) {
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'AVAILABLE',
        points_delta: -spendable,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'CLAWBACK_PENDING',
        points_delta: -spendable,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
    } else if (outstandingClawback > 0 && spendable > 0) {
      const offset = Math.min(outstandingClawback, spendable);
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'AVAILABLE',
        points_delta: -offset,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'CLAWBACK_PENDING',
        points_delta: -offset,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
    }
  }

  private redeem(c: Context, p: Payload<'REDEEM_POINTS'>) {
    this.authorize(c, 'SALES', 'ACCOUNTS', 'ADMIN');
    this.customer(c, p.customerId);
    const balance = this.total(
      sql`select coalesce(sum(points_delta),0) n from reward_ledger where customer_id=${c.customerId} and bucket='AVAILABLE'`,
    );
    const debt = this.total(
      sql`select coalesce(sum(points_delta),0) n from reward_ledger where customer_id=${c.customerId} and bucket='CLAWBACK_PENDING'`,
    );
    if (debt || p.points > balance)
      fail('POINTS_UNAVAILABLE', 'There are not enough available points');
    const charge = this.one<Charge>(
      sql`select * from receivable_entries where id=${p.chargeId} and customer_id=${c.customerId} and amount_paise>0`,
    );
    if (!charge)
      fail(
        'CHARGE_NOT_FOUND',
        'Select an outstanding charge belonging to this customer',
      );
    const due =
      charge.amount_paise +
      this.total(
        sql`select coalesce(sum(amount_paise),0) n from receivable_entries where adjusts_id=${charge.id}`,
      ) -
      this.total(
        sql`select coalesce(sum(amount_paise),0) n from payment_allocations where charge_id=${charge.id}`,
      ) -
      this.total(
        sql`select coalesce(sum(amount_paise),0) n from credit_applications where charge_id=${charge.id}`,
      ) -
      this.total(
        sql`select coalesce(sum(points),0) n from reward_redemptions where charge_id=${charge.id}`,
      );
    if (p.points > due)
      fail('AMOUNT_EXCEEDED', 'The redemption exceeds the outstanding charge');
    this.add(c, 'reward_redemptions', {
      id: randomUUID(),
      customer_id: c.customerId,
      charge_id: charge.id,
      points: p.points,
      action_id: c.id,
      created_at: c.now,
    });
    this.add(c, 'reward_ledger', {
      id: randomUUID(),
      customer_id: c.customerId,
      line_key: null,
      bucket: 'AVAILABLE',
      points_delta: -p.points,
      source_id: charge.id,
      action_id: c.id,
      created_at: c.now,
    });
    this.add(c, 'reward_ledger', {
      id: randomUUID(),
      customer_id: c.customerId,
      line_key: null,
      bucket: 'REDEEMED',
      points_delta: p.points,
      source_id: charge.id,
      action_id: c.id,
      created_at: c.now,
    });
  }

  private issueCredit(c: Context, p: Payload<'ISSUE_CREDIT_NOTE'>) {
    this.authorize(c, 'ACCOUNTS', 'ADMIN');
    this.customer(c, p.customerId);
    let available = 0;
    const funds = this.all<{ id: string; amount_paise: number }>(
      sql`select * from payment_receipts where customer_id=${c.customerId} order by rowid`,
    ).map((receipt) => {
      const free =
        receipt.amount_paise -
        this.total(
          sql`select coalesce(sum(amount_paise),0) n from payment_allocations where receipt_id=${receipt.id}`,
        ) -
        this.total(
          sql`select coalesce(sum(amount_paise),0) n from credit_funds where receipt_id=${receipt.id}`,
        );
      available = safe(available + free);
      return { id: receipt.id, free };
    });
    if (p.amountPaise > available)
      fail(
        'CASH_UNAVAILABLE',
        'The credit exceeds the customer’s unapplied cash',
      );
    const creditId = randomUUID();
    c.references.creditNoteId = creditId;
    this.add(c, 'credit_notes', {
      id: creditId,
      customer_id: c.customerId,
      return_id: null,
      amount_paise: p.amountPaise,
      reason: p.reason,
      action_id: c.id,
      created_at: c.now,
    });
    let left = p.amountPaise;
    for (const receipt of funds) {
      const take = Math.min(left, receipt.free);
      if (take)
        this.add(c, 'credit_funds', {
          id: randomUUID(),
          credit_note_id: creditId,
          receipt_id: receipt.id,
          amount_paise: take,
        });
      left -= take;
    }
  }

  private applyCredit(c: Context, p: Payload<'APPLY_CREDIT_NOTE'>) {
    this.authorize(c, 'ACCOUNTS', 'ADMIN');
    this.customer(c, p.customerId);
    const note = this.one<{ id: string; amount_paise: number }>(
      sql`select * from credit_notes where id=${p.creditNoteId} and customer_id=${c.customerId}`,
    );
    if (!note)
      fail('CREDIT_NOT_FOUND', 'Select a credit belonging to this customer');
    const available =
      note.amount_paise -
      this.total(
        sql`select coalesce(sum(amount_paise),0) n from credit_applications where credit_note_id=${note.id}`,
      ) -
      this.total(
        sql`select coalesce(sum(amount_paise),0) n from credit_refunds where credit_note_id=${note.id}`,
      );
    if (p.amountPaise > available)
      fail('CREDIT_EXCEEDED', 'The application exceeds the open credit');
    const charge = this.one<Charge>(
      sql`select * from receivable_entries where id=${p.chargeId} and customer_id=${c.customerId} and amount_paise>0`,
    );
    if (!charge)
      fail('CHARGE_NOT_FOUND', 'Select a charge belonging to this customer');
    const due =
      charge.amount_paise +
      this.total(
        sql`select coalesce(sum(amount_paise),0) n from receivable_entries where adjusts_id=${charge.id}`,
      ) -
      this.total(
        sql`select coalesce(sum(amount_paise),0) n from payment_allocations where charge_id=${charge.id}`,
      ) -
      this.total(
        sql`select coalesce(sum(amount_paise),0) n from credit_applications where charge_id=${charge.id}`,
      ) -
      this.total(
        sql`select coalesce(sum(points),0) n from reward_redemptions where charge_id=${charge.id}`,
      );
    if (p.amountPaise > due)
      fail('AMOUNT_EXCEEDED', 'The application exceeds the outstanding charge');
    this.add(c, 'credit_applications', {
      id: randomUUID(),
      customer_id: c.customerId,
      credit_note_id: note.id,
      charge_id: charge.id,
      amount_paise: p.amountPaise,
      action_id: c.id,
      created_at: c.now,
    });
  }

  private refundCredit(c: Context, p: Payload<'REFUND_CREDIT_NOTE'>) {
    this.authorize(c, 'ACCOUNTS', 'ADMIN');
    this.customer(c, p.customerId);
    const note = this.one<{ id: string; amount_paise: number }>(
      sql`select * from credit_notes where id=${p.creditNoteId} and customer_id=${c.customerId}`,
    );
    if (!note)
      fail('CREDIT_NOT_FOUND', 'Select a credit belonging to this customer');
    const available =
      note.amount_paise -
      this.total(
        sql`select coalesce(sum(amount_paise),0) n from credit_applications where credit_note_id=${note.id}`,
      ) -
      this.total(
        sql`select coalesce(sum(amount_paise),0) n from credit_refunds where credit_note_id=${note.id}`,
      );
    if (p.amountPaise > available)
      fail('CREDIT_EXCEEDED', 'The refund exceeds the open credit');
    let remaining = p.amountPaise;
    for (const fund of this.all<{ receipt_id: string; amount_paise: number }>(
      sql`select * from credit_funds where credit_note_id=${note.id} order by rowid`,
    )) {
      const free =
        fund.amount_paise -
        this.total(
          sql`select coalesce(sum(amount_paise),0) n from credit_refunds where credit_note_id=${note.id} and receipt_id=${fund.receipt_id}`,
        );
      const take = Math.min(free, remaining);
      if (!take) continue;
      this.add(c, 'credit_refunds', {
        id: randomUUID(),
        customer_id: c.customerId,
        credit_note_id: note.id,
        receipt_id: fund.receipt_id,
        amount_paise: take,
        reference: p.reference,
        action_id: c.id,
        created_at: c.now,
      });
      remaining -= take;
    }
    if (remaining)
      fail('FUNDING_MISMATCH', 'The credit has insufficient receipt backing');
  }

  private correct(c: Context, p: Payload<'CORRECT_DISPATCHED_ORDER'>) {
    this.authorize(c, 'KAM', 'ADMIN');
    const order = this.order(c, p.orderId);
    const shipments = this.all<{
      id: string;
      status: string;
      dispatched_at: string;
    }>(
      sql`select * from shipments where order_id=${order.id} and dispatched_at is not null order by rowid`,
    );
    if (!shipments.length)
      fail(
        'ORDER_NOT_DISPATCHED',
        'Use an ordinary commercial edit before dispatch',
      );
    if (!p.location || (p.location === 'EXISTING_SHIPMENT' && !p.shipmentId))
      throw new Decision([
        {
          key: 'shipment',
          prompt: 'Where were these additional units physically dispatched?',
          options: [
            ...shipments.map((shipment) => ({
              id: shipment.id,
              label: `Existing dispatch ${shipment.id.slice(0, 8)}`,
            })),
            {
              id: 'NEW_SHIPMENT',
              label: 'A separate shipment with its own dispatch time',
            },
          ],
        },
      ]);
    const original =
      p.location === 'EXISTING_SHIPMENT'
        ? shipments.find((row) => row.id === p.shipmentId)
        : undefined;
    if (p.location === 'EXISTING_SHIPMENT' && !original)
      fail(
        'SHIPMENT_NOT_FOUND',
        'Select a dispatched shipment belonging to this order',
      );
    if (
      p.location === 'NEW_SHIPMENT' &&
      (!p.dispatchedAt || Date.parse(p.dispatchedAt) > Date.now())
    )
      fail(
        'DISPATCH_TIME_REQUIRED',
        'Provide the actual past dispatch time for the separate shipment',
      );
    distinct(p.items.map((item) => item.skuId));
    for (const item of p.items)
      if (item.deliveredQty > item.qty)
        fail(
          'QUANTITY_EXCEEDED',
          'Delivered units cannot exceed corrected dispatched units',
        );
    const correctionId = randomUUID(),
      revisionId = randomUUID(),
      shipmentId = randomUUID();
    c.references.correctionId = correctionId;
    c.references.shipmentId = shipmentId;
    const oldLines = this.lines(order);
    const additions = p.items.map((item) => {
      const sku = this.one<Sku>(sql`select * from skus where id=${item.skuId}`);
      if (!sku) fail('SKU_NOT_FOUND', 'Select an existing SKU');
      const line = oldLines.find((row) => row.sku_id === sku.id);
      if (line && line.unit_price_paise !== item.unitPricePaise)
        fail(
          'PRICE_MISMATCH',
          'Additional units of an existing line must retain its agreed price',
        );
      return { ...item, sku, lineKey: line?.line_key ?? randomUUID() };
    });
    this.add(c, 'order_revisions', {
      id: revisionId,
      order_id: order.id,
      revision: order.current_revision + 1,
      actor_id: c.actor.id,
      reason: p.reason,
      created_at: c.now,
    });
    for (const line of oldLines)
      this.add(c, 'order_lines', {
        id: randomUUID(),
        revision_id: revisionId,
        order_id: order.id,
        line_key: line.line_key,
        sku_id: line.sku_id,
        qty: safe(
          line.qty +
            (additions.find((item) => item.skuId === line.sku_id)?.qty ?? 0),
        ),
        unit_price_paise: line.unit_price_paise,
        points_per_unit: line.points_per_unit,
      });
    for (const item of additions)
      if (!oldLines.some((line) => line.sku_id === item.skuId))
        this.add(c, 'order_lines', {
          id: randomUUID(),
          revision_id: revisionId,
          order_id: order.id,
          line_key: item.lineKey,
          sku_id: item.skuId,
          qty: item.qty,
          unit_price_paise: item.unitPricePaise,
          points_per_unit: item.sku.points_per_unit,
        });
    for (const loading of this.all<{ id: string }>(
      sql`select id from shipments where order_id=${order.id} and status='LOADING'`,
    )) {
      this.change(c, 'shipments', loading.id, { status: 'VOIDED' });
    }
    this.add(c, 'corrections', {
      id: correctionId,
      order_id: order.id,
      original_revision: order.current_revision,
      new_revision: order.current_revision + 1,
      actor_id: c.actor.id,
      reason: p.reason,
      evidence: p.evidence,
      authorization_reference: p.authorizationReference,
      location: p.location,
      shipment_id: original?.id ?? null,
      action_id: c.id,
      created_at: c.now,
    });
    this.add(c, 'approvals', {
      id: randomUUID(),
      order_id: order.id,
      revision: order.current_revision + 1,
      actor_id: c.actor.id,
      decision: 'APPROVED',
      reason: p.authorizationReference,
      created_at: c.now,
    });
    this.change(c, 'orders', order.id, {
      status: 'APPROVED',
      current_revision: order.current_revision + 1,
    });
    this.add(c, 'shipments', {
      id: shipmentId,
      order_id: order.id,
      revision: order.current_revision + 1,
      status: additions.every((item) => item.deliveredQty === item.qty)
        ? 'DELIVERED'
        : 'DISPATCHED',
      original_shipment_id: original?.id ?? null,
      correction_id: correctionId,
      created_at: c.now,
      dispatched_at: original?.dispatched_at ?? p.dispatchedAt!,
    });
    for (const item of additions) {
      const lineId = randomUUID();
      this.add(c, 'shipment_lines', {
        id: lineId,
        shipment_id: shipmentId,
        order_id: order.id,
        line_key: item.lineKey,
        sku_id: item.skuId,
        loaded_qty: item.qty,
        dispatched_qty: item.qty,
        unit_price_paise: item.unitPricePaise,
        points_per_unit: item.sku.points_per_unit,
      });
      if (item.deliveredQty) {
        const deliveryId = randomUUID();
        this.add(c, 'deliveries', {
          id: deliveryId,
          shipment_line_id: lineId,
          order_id: order.id,
          qty: item.deliveredQty,
          action_id: c.id,
          created_at: c.now,
        });
        this.add(c, 'receivable_entries', {
          id: randomUUID(),
          customer_id: c.customerId,
          order_id: order.id,
          line_key: item.lineKey,
          shipment_line_id: lineId,
          kind: 'CORRECTION',
          amount_paise: safe(item.deliveredQty * item.unitPricePaise),
          adjusts_id: null,
          source_id: deliveryId,
          action_id: c.id,
          created_at: c.now,
        });
      }
    }

    for (const receipt of this.all<{ id: string; amount_paise: number }>(
      sql`select * from payment_receipts where customer_id=${c.customerId} order by created_at,rowid`,
    )) {
      let available =
        receipt.amount_paise -
        this.total(
          sql`select coalesce(sum(amount_paise),0) n from payment_allocations where receipt_id=${receipt.id}`,
        ) -
        this.total(
          sql`select coalesce(sum(amount_paise),0) n from credit_funds where receipt_id=${receipt.id}`,
        );
      if (available < 0)
        fail('RECEIPT_MISMATCH', 'Receipt allocations exceed captured funds');
      for (const charge of this.all<Charge>(
        sql`select * from receivable_entries where customer_id=${c.customerId} and amount_paise>0 order by created_at,rowid`,
      )) {
        if (!available) break;
        const face =
          charge.amount_paise +
          this.total(
            sql`select coalesce(sum(amount_paise),0) n from receivable_entries where adjusts_id=${charge.id}`,
          );
        const cash = this.total(
          sql`select coalesce(sum(amount_paise),0) n from payment_allocations where charge_id=${charge.id}`,
        );
        const credit = this.total(
          sql`select coalesce(sum(amount_paise),0) n from credit_applications where charge_id=${charge.id}`,
        );
        const redeemed = this.total(
          sql`select coalesce(sum(points),0) n from reward_redemptions where charge_id=${charge.id}`,
        );
        const take = Math.min(
          available,
          Math.max(0, face - cash - credit - redeemed),
        );
        if (take)
          this.add(c, 'payment_allocations', {
            id: randomUUID(),
            customer_id: c.customerId,
            receipt_id: receipt.id,
            charge_id: charge.id,
            amount_paise: take,
            action_id: c.id,
            created_at: c.now,
          });
        available -= take;
      }
    }

    for (const orderRow of this.all<Order>(
      sql`select * from orders where customer_id=${c.customerId}`,
    )) {
      for (const lineRow of this.lines(orderRow)) {
        const canceledQty = this.total(
          sql`select coalesce(sum(qty),0) n from cancellations where line_key=${lineRow.line_key}`,
        );
        const returnedQty = this.total(
          sql`select coalesce(sum(r.qty),0) n from return_lines r join shipment_lines s on s.id=r.shipment_line_id where s.line_key=${lineRow.line_key}`,
        );
        const entitled =
          orderRow.status === 'APPROVED'
            ? safe(
                Math.max(0, lineRow.qty - canceledQty - returnedQty) *
                  lineRow.points_per_unit,
              )
            : 0;
        let earned = 0;
        for (const chargeRow of this.all<Charge>(
          sql`select * from receivable_entries where line_key=${lineRow.line_key} and amount_paise>0`,
        )) {
          const qualifyingCash = this.total(
            sql`select coalesce(sum(amount_paise),0) n from payment_allocations where charge_id=${chargeRow.id}`,
          );
          earned = safe(
            earned +
              Number(
                (BigInt(qualifyingCash) * BigInt(lineRow.points_per_unit)) /
                  BigInt(lineRow.unit_price_paise),
              ),
          );
        }
        earned = Math.min(entitled, earned);
        const previousEarned = this.total(
          sql`select coalesce(sum(points_delta),0) n from reward_ledger where line_key=${lineRow.line_key} and bucket='AVAILABLE'`,
        );
        if (earned !== previousEarned)
          this.add(c, 'reward_ledger', {
            id: randomUUID(),
            customer_id: c.customerId,
            line_key: lineRow.line_key,
            bucket: 'AVAILABLE',
            points_delta: earned - previousEarned,
            source_id: c.id,
            action_id: c.id,
            created_at: c.now,
          });
        const previousLocked = this.total(
          sql`select coalesce(sum(points_delta),0) n from reward_ledger where line_key=${lineRow.line_key} and bucket='LOCKED'`,
        );
        if (entitled - earned !== previousLocked)
          this.add(c, 'reward_ledger', {
            id: randomUUID(),
            customer_id: c.customerId,
            line_key: lineRow.line_key,
            bucket: 'LOCKED',
            points_delta: entitled - earned - previousLocked,
            source_id: c.id,
            action_id: c.id,
            created_at: c.now,
          });
      }
    }
    const spendable = this.total(
      sql`select coalesce(sum(points_delta),0) n from reward_ledger where customer_id=${c.customerId} and bucket='AVAILABLE'`,
    );
    const outstandingClawback = this.total(
      sql`select coalesce(sum(points_delta),0) n from reward_ledger where customer_id=${c.customerId} and bucket='CLAWBACK_PENDING'`,
    );
    if (spendable < 0) {
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'AVAILABLE',
        points_delta: -spendable,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'CLAWBACK_PENDING',
        points_delta: -spendable,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
    } else if (outstandingClawback > 0 && spendable > 0) {
      const offset = Math.min(outstandingClawback, spendable);
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'AVAILABLE',
        points_delta: -offset,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
      this.add(c, 'reward_ledger', {
        id: randomUUID(),
        customer_id: c.customerId,
        line_key: null,
        bucket: 'CLAWBACK_PENDING',
        points_delta: -offset,
        source_id: c.id,
        action_id: c.id,
        created_at: c.now,
      });
    }
  }

  bootstrap(user: User): CrmBootstrap {
    const actors =
      user.role === 'ADMIN'
        ? this.all<{
            id: string;
            name: string;
            email: string;
            role: Role;
            active: number;
            created_at: string;
          }>(
            sql`select id,name,email,role,active,created_at from users where active=1 order by name`,
          ).map((row) => ({ ...row, active: true, createdAt: row.created_at }))
        : [user];
    return {
      customers: this.all<Customer>(sql`select * from customers order by name`),
      skus: this.all<Sku>(sql`select * from skus order by code`),
      orders: this.all<OrderListRow>(
        sql`select * from orders order by created_at desc,rowid desc`,
      ),
      actors,
    };
  }

  detail(id: string): OrderDetail {
    const order = this.one<Order>(sql`select * from orders where id=${id}`);
    if (!order) throw new NotFoundException('Order not found');
    const lines: OrderLine[] = this.lines(order).map((line) => {
      const sku = this.one<Sku>(
        sql`select * from skus where id=${line.sku_id}`,
      )!;
      const canceled = this.total(
        sql`select coalesce(sum(qty),0) n from cancellations where line_key=${line.line_key}`,
      );
      const loaded = this.total(
        sql`select coalesce(sum(l.loaded_qty),0) n from shipment_lines l join shipments s on s.id=l.shipment_id where l.line_key=${line.line_key} and s.status='LOADING'`,
      );
      const dispatched = this.total(
        sql`select coalesce(sum(l.dispatched_qty),0) n from shipment_lines l join shipments s on s.id=l.shipment_id where l.line_key=${line.line_key} and s.status!='VOIDED'`,
      );
      const delivered = this.total(
        sql`select coalesce(sum(d.qty),0) n from deliveries d join shipment_lines l on l.id=d.shipment_line_id where l.line_key=${line.line_key}`,
      );
      const returned = this.total(
        sql`select coalesce(sum(r.qty),0) n from return_lines r join shipment_lines l on l.id=r.shipment_line_id where l.line_key=${line.line_key}`,
      );
      return {
        lineKey: line.line_key,
        skuId: line.sku_id,
        code: sku.code,
        name: sku.name,
        qty: line.qty,
        unitPricePaise: line.unit_price_paise,
        canceled,
        loaded,
        dispatched,
        delivered,
        returned,
        open: line.qty - canceled - dispatched,
      };
    });
    const shipments = this.all<Omit<Shipment, 'lines'>>(
      sql`select * from shipments where order_id=${id} order by rowid`,
    ).map((shipment) => ({
      ...shipment,
      lines: this.all<ShipmentLine>(
        sql`select * from shipment_lines where shipment_id=${shipment.id} order by rowid`,
      ).map((line) => ({
        ...line,
        delivered: this.total(
          sql`select coalesce(sum(qty),0) n from deliveries where shipment_line_id=${line.id}`,
        ),
        returned: this.total(
          sql`select coalesce(sum(qty),0) n from return_lines where shipment_line_id=${line.id}`,
        ),
      })),
    }));
    const revisions = this.all<Omit<OrderDetail['revisions'][number], 'lines'>>(
      sql`select * from order_revisions where order_id=${id} order by revision`,
    ).map((revision) => ({
      ...revision,
      lines: this.all<{
        sku_id: string;
        qty: number;
        unit_price_paise: number;
      }>(
        sql`select sku_id,qty,unit_price_paise from order_lines where revision_id=${revision.id} order by rowid`,
      ),
    }));
    return {
      order,
      lines,
      shipments,
      revisions,
      approvals: this.all<OrderDetail['approvals'][number]>(
        sql`select * from approvals where order_id=${id} order by rowid`,
      ),
      timeline: this.all<EventRow>(
        sql`select * from business_events where order_id=${id} order by rowid`,
      ),
    };
  }

  summary(customerId: string): CustomerSummary {
    const customer = this.one<Customer>(
      sql`select * from customers where id=${customerId}`,
    );
    if (!customer) throw new NotFoundException('Customer not found');
    const charges = this.all<Charge>(
      sql`select * from receivable_entries where customer_id=${customerId} and amount_paise>0 order by rowid`,
    ).map((charge) => {
      const remainingPaise =
        charge.amount_paise +
        this.total(
          sql`select coalesce(sum(amount_paise),0) n from receivable_entries where adjusts_id=${charge.id}`,
        );
      const cashPaidPaise = this.total(
        sql`select coalesce(sum(amount_paise),0) n from payment_allocations where charge_id=${charge.id}`,
      );
      const credit = this.total(
        sql`select coalesce(sum(amount_paise),0) n from credit_applications where charge_id=${charge.id}`,
      );
      const redeemed = this.total(
        sql`select coalesce(sum(points),0) n from reward_redemptions where charge_id=${charge.id}`,
      );
      return {
        ...charge,
        remainingPaise,
        cashPaidPaise,
        outstandingPaise: safe(
          remainingPaise - cashPaidPaise - credit - redeemed,
        ),
      };
    });
    const credits = this.all<CreditNote>(
      sql`select * from credit_notes where customer_id=${customerId} order by rowid`,
    ).map((note) => {
      const appliedPaise = this.total(
        sql`select coalesce(sum(amount_paise),0) n from credit_applications where credit_note_id=${note.id}`,
      );
      const refundedPaise = this.total(
        sql`select coalesce(sum(amount_paise),0) n from credit_refunds where credit_note_id=${note.id}`,
      );
      return {
        ...note,
        appliedPaise,
        refundedPaise,
        availablePaise: note.amount_paise - appliedPaise - refundedPaise,
      };
    });
    const receipts = this.all<{ id: string; amount_paise: number }>(
      sql`select * from payment_receipts where customer_id=${customerId}`,
    );
    const unappliedCashPaise = safe(
      receipts.reduce(
        (sum, receipt) =>
          sum +
          receipt.amount_paise -
          this.total(
            sql`select coalesce(sum(amount_paise),0) n from payment_allocations where receipt_id=${receipt.id}`,
          ) -
          this.total(
            sql`select coalesce(sum(amount_paise),0) n from credit_funds where receipt_id=${receipt.id}`,
          ),
        0,
      ),
    );
    const receivedPaise = this.total(
      sql`select coalesce(sum(amount_paise),0) n from payment_receipts where customer_id=${customerId}`,
    );
    const refundsPaise = this.total(
      sql`select coalesce(sum(amount_paise),0) n from credit_refunds where customer_id=${customerId}`,
    );
    const redemption = this.total(
      sql`select coalesce(sum(points),0) n from reward_redemptions where customer_id=${customerId}`,
    );
    const netBalancePaise = safe(
      this.total(
        sql`select coalesce(sum(amount_paise),0) n from receivable_entries where customer_id=${customerId}`,
      ) -
        receivedPaise +
        refundsPaise -
        redemption,
    );
    return {
      customer,
      charges,
      credits,
      netBalancePaise,
      unappliedCashPaise,
      receivedPaise,
      refundsPaise,
      outstandingPaise: safe(
        charges.reduce((sum, row) => sum + row.outstandingPaise, 0),
      ),
      creditsOpenPaise: safe(
        credits.reduce((sum, row) => sum + row.availablePaise, 0),
      ),
      points: {
        locked: this.total(
          sql`select coalesce(sum(points_delta),0) n from reward_ledger where customer_id=${customerId} and bucket='LOCKED'`,
        ),
        available: this.total(
          sql`select coalesce(sum(points_delta),0) n from reward_ledger where customer_id=${customerId} and bucket='AVAILABLE'`,
        ),
        redeemed: this.total(
          sql`select coalesce(sum(points_delta),0) n from reward_ledger where customer_id=${customerId} and bucket='REDEEMED'`,
        ),
        clawbackPending: this.total(
          sql`select coalesce(sum(points_delta),0) n from reward_ledger where customer_id=${customerId} and bucket='CLAWBACK_PENDING'`,
        ),
      },
    };
  }

  ledger(customerId: string): LedgerView {
    this.summary(customerId);
    return {
      finance: this.all(
        sql`select * from receivable_entries where customer_id=${customerId} order by rowid`,
      ),
      receipts: this.all(
        sql`select * from payment_receipts where customer_id=${customerId} order by rowid`,
      ),
      allocations: this.all(
        sql`select * from payment_allocations where customer_id=${customerId} order by rowid`,
      ),
      creditApplications: this.all(
        sql`select * from credit_applications where customer_id=${customerId} order by rowid`,
      ),
      credits: this.all(
        sql`select * from credit_notes where customer_id=${customerId} order by rowid`,
      ),
      refunds: this.all(
        sql`select * from credit_refunds where customer_id=${customerId} order by rowid`,
      ),
      redemptions: this.all(
        sql`select * from reward_redemptions where customer_id=${customerId} order by rowid`,
      ),
      rewards: this.all(
        sql`select * from reward_ledger where customer_id=${customerId} order by rowid`,
      ),
      returns: this.all(
        sql`select * from returns where customer_id=${customerId} order by rowid`,
      ),
      corrections: this.all(
        sql`select c.* from corrections c join orders o on o.id=c.order_id where o.customer_id=${customerId} order by c.rowid`,
      ),
    };
  }

  trace(id: string, user: User): ActionResult {
    const row = this.one<{
      result: string;
      requester_id: string;
      actor_id: string;
    }>(sql`select * from action_requests where id=${id}`);
    if (!row) throw new NotFoundException('Activity not found');
    if (
      user.role !== 'ADMIN' &&
      row.requester_id !== user.id &&
      row.actor_id !== user.id
    )
      throw new ForbiddenException(
        'This activity belongs to another staff member',
      );
    return JSON.parse(row.result) as ActionResult;
  }

  seed(user: User) {
    if (user.role !== 'ADMIN' || this.config.get('NODE_ENV') === 'production')
      throw new ForbiddenException(
        'Sample data is available to local administrators',
      );
    this.database.db.transaction(() => {
      const c: Context = {
        id: randomUUID(),
        actor: user,
        requester: user,
        now: new Date().toISOString(),
        customerId: '',
        effects: [],
        references: {},
      };
      for (const [suffix, role, name] of [
        ['1', 'SALES', 'Sales desk'],
        ['2', 'KAM', 'Commercial desk'],
        ['3', 'WAREHOUSE', 'Warehouse desk'],
        ['4', 'ACCOUNTS', 'Accounts desk'],
      ] as const) {
        const id = `00000000-0000-4000-8000-00000000000${suffix}`;
        if (!this.one(sql`select id from users where id=${id}`)) {
          const salt = Buffer.from(randomUUID().replaceAll('-', ''), 'hex');
          const hash = scryptSync(randomUUID(), salt, 64, {
            N: 32768,
            r: 8,
            p: 1,
            maxmem: 67108864,
          });
          this.database.db.run(
            sql`insert into users(id,name,email,password_hash,role,active,created_at) values (${id},${name},${`sample-${role.toLowerCase()}@example.test`},${`scrypt$${salt.toString('hex')}$${hash.toString('hex')}`},${role},1,${c.now})`,
          );
        }
      }
      for (const [id, code, name, price, points] of [
        ['sku-a', 'SKU-A', 'Everyday blend', 10000, 1000],
        ['sku-b', 'SKU-B', 'Premium blend', 15000, 1200],
        ['sku-c', 'SKU-C', 'Reserve blend', 25000, 2000],
      ] as const)
        if (!this.one(sql`select id from skus where id=${id}`))
          this.add(c, 'skus', {
            id,
            code,
            name,
            price_paise: price,
            points_per_unit: points,
          });
      for (const [id, code, name] of [
        ['customer-north', 'NORTH-01', 'Northside Stores'],
        ['customer-river', 'RIVER-02', 'Riverside Retail'],
        ['customer-central', 'CENTRAL-03', 'Central Trading'],
      ] as const)
        if (!this.one(sql`select id from customers where id=${id}`))
          this.add(c, 'customers', { id, code, name, version: 0 });
    });
    return this.bootstrap(user);
  }

  reset(user: User, confirmation: string) {
    if (user.role !== 'ADMIN' || this.config.get('NODE_ENV') === 'production')
      throw new ForbiddenException(
        'Reset is available to local administrators',
      );
    if (confirmation !== 'RESET CRM DATA')
      throw new ForbiddenException('Confirm the reset explicitly');
    this.database.db.transaction(() => {
      this.database.db.run(sql`delete from action_requests`);
      this.database.db.run(sql`delete from customers`);
    });
    return this.seed(user);
  }

  createCustomer(user: User, input: { name: string; code: string }): Customer {
    if (!['ADMIN', 'SALES', 'ACCOUNTS'].includes(user.role))
      throw new ForbiddenException('This role cannot create customers');
    return this.database.db.transaction(
      () => {
        const c: Context = {
          id: randomUUID(),
          actor: user,
          requester: user,
          now: new Date().toISOString(),
          customerId: randomUUID(),
          effects: [],
          references: {},
        };
        if (this.one(sql`select id from customers where code=${input.code}`))
          throw new ConflictException('Customer code already exists');
        this.add(c, 'customers', {
          id: c.customerId,
          name: input.name,
          code: input.code,
          version: 0,
        });
        return this.one<Customer>(
          sql`select * from customers where id=${c.customerId}`,
        )!;
      },
      { behavior: 'immediate' },
    );
  }

  savedSamples(user: User): SavedWorkflow[] {
    if (user.role !== 'ADMIN' || this.config.get('NODE_ENV') === 'production')
      throw new ForbiddenException(
        'Sample workflows are available to local administrators',
      );
    return this.all<{
      id: string;
      scenario_id: string;
      customer_id: string;
      customer_name: string;
      complete: number;
      step_count: number;
      created_at: string;
    }>(
      sql`select s.*, c.name customer_name,
        (select count(*) from sample_steps t where t.run_id=s.id) step_count
        from sample_runs s join customers c on c.id=s.customer_id
        where s.requester_id=${user.id} order by s.created_at desc,s.rowid desc limit 50`,
    ).map((row) => ({
      id: row.id,
      scenarioId: row.scenario_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      complete: row.complete === 1,
      stepCount: row.step_count,
      createdAt: row.created_at,
    }));
  }

  sampleReport(runId: string, user: User): ScenarioReport {
    if (user.role !== 'ADMIN' || this.config.get('NODE_ENV') === 'production')
      throw new ForbiddenException(
        'Sample workflows are available to local administrators',
      );
    const sample = this.one<{
      id: string;
      scenario_id: string;
      customer_id: string;
      requester_id: string;
      complete: number;
    }>(sql`select * from sample_runs where id=${runId}`);
    if (!sample) throw new NotFoundException('Sample workflow not found');
    if (sample.requester_id !== user.id)
      throw new ForbiddenException(
        'This sample belongs to another staff member',
      );
    const steps = this.all<{ label: string; result: string }>(
      sql`select label,result from sample_steps where run_id=${runId} order by position`,
    ).map((row) => ({
      label: row.label,
      result: JSON.parse(row.result) as ActionResult,
    }));
    return {
      id: sample.scenario_id,
      runId: sample.id,
      customerId: sample.customer_id,
      complete: sample.complete === 1,
      steps,
      summary: this.summary(sample.customer_id),
    };
  }

  startSample(id: string, user: User): ScenarioReport {
    if (!SCENARIOS.some(([key]) => key === id))
      throw new NotFoundException('Sample workflow not found');
    this.seed(user);
    return this.database.db.transaction(() => {
      const customerId = randomUUID(),
        runId = randomUUID();
      this.database.db.run(
        sql`insert into customers(id,code,name,version) values (${customerId},${`CASE-${customerId.slice(0, 8)}`},${`Sample · ${id}`},0)`,
      );
      this.database.db.run(
        sql`insert into sample_runs(id,scenario_id,customer_id,requester_id,created_at) values (${runId},${id},${customerId},${user.id},${new Date().toISOString()})`,
      );
      return {
        id,
        runId,
        complete: false,
        customerId,
        steps: [],
        summary: this.summary(customerId),
      };
    });
  }

  advanceSample(runId: string, user: User, all = false): ScenarioReport {
    if (user.role !== 'ADMIN' || this.config.get('NODE_ENV') === 'production')
      throw new ForbiddenException(
        'Sample workflows are available to local administrators',
      );
    const sample = this.one<{ scenario_id: string; requester_id: string }>(
      sql`select * from sample_runs where id=${runId}`,
    );
    if (!sample) throw new NotFoundException('Sample workflow not found');
    if (sample.requester_id !== user.id)
      throw new ForbiddenException(
        'This sample belongs to another staff member',
      );
    return this.scenario(sample.scenario_id, user, runId, all ? Infinity : 1);
  }

  scenario(
    id: string,
    user: User,
    existingRunId?: string,
    limit = Infinity,
  ): ScenarioReport {
    const started = existingRunId ? null : this.startSample(id, user);
    const runId = existingRunId ?? started!.runId!;
    const sample = this.one<{ customer_id: string; complete: number }>(
      sql`select * from sample_runs where id=${runId}`,
    )!;
    const customerId = sample.customer_id;
    const actors = this.bootstrap(user).actors;
    const actor = (role: Role) =>
      actors.find((person) => person.role === role)?.id ?? user.id;
    const steps: ScenarioReport['steps'] = [];
    let added = 0;
    let complete = false;
    const run = (
      label: string,
      command: CrmCommand,
      role: Role = 'ADMIN',
      key: string = randomUUID(),
      fixedVersion?: number,
    ) => {
      const position = steps.length;
      const prior = this.one<{ result: string }>(
        sql`select * from sample_steps where run_id=${runId} and position=${position}`,
      );
      if (prior) {
        const result = JSON.parse(prior.result) as ActionResult;
        steps.push({ label, result });
        return result;
      }
      if (added >= limit) throw new StopAfterStep();
      const payload = command.payload;
      const version =
        fixedVersion ??
        ('orderId' in payload
          ? this.detail(payload.orderId).order.version
          : this.summary(payload.customerId).customer.version);
      const envelope = {
        command,
        actorId: actor(role),
        expectedVersion: version,
        idempotencyKey: key,
      };
      const result = this.database.db.transaction(
        () => {
          const result = this.execute(envelope, user);
          this.database.db.run(
            sql`insert into sample_steps(id,run_id,position,label,envelope,result) values (${randomUUID()},${runId},${position},${label},${JSON.stringify(envelope)},${JSON.stringify(result)})`,
          );
          return result;
        },
        { behavior: 'immediate' },
      );
      steps.push({ label, result });
      added++;
      return result;
    };
    const order = (qty = 1) => {
      const created = run(
        'Create order',
        {
          type: 'PUNCH_ORDER',
          payload: {
            customerId,
            items: [{ skuId: 'sku-a', qty, unitPricePaise: 10000 }],
          },
        },
        'SALES',
      );
      const orderId = created.references.orderId!;
      run(
        'Submit for approval',
        { type: 'SUBMIT_ORDER', payload: { orderId } },
        'SALES',
      );
      run(
        'Approve commercial revision',
        { type: 'APPROVE_ORDER', payload: { orderId, revision: 1 } },
        'KAM',
      );
      return orderId;
    };
    const ship = (orderId: string, quantities?: number[]) => {
      const detail = this.detail(orderId);
      const items = detail.lines
        .map((line, index) => ({
          lineKey: line.lineKey,
          qty: quantities?.[index] ?? line.open - line.loaded,
        }))
        .filter((item) => item.qty > 0);
      const loaded = run(
        'Start loading',
        { type: 'START_LOADING', payload: { orderId, items } },
        'WAREHOUSE',
      );
      const shipmentId = loaded.references.shipmentId!;
      run(
        'Dispatch shipment',
        { type: 'DISPATCH_SHIPMENT', payload: { orderId, shipmentId } },
        'WAREHOUSE',
      );
      const shipment = this.detail(orderId).shipments.find(
        (row) => row.id === shipmentId,
      )!;
      run(
        'Confirm delivery',
        {
          type: 'CONFIRM_DELIVERY',
          payload: {
            orderId,
            shipmentId,
            items: shipment.lines.map((line) => ({
              shipmentLineId: line.id,
              qty: line.dispatched_qty,
            })),
          },
        },
        'WAREHOUSE',
      );
      return shipmentId;
    };
    const payment = (amountPaise: number) =>
      run(
        'Receive customer payment',
        {
          type: 'RECEIVE_CUSTOMER_PAYMENT',
          payload: { customerId, amountPaise, reference: 'Bank transfer' },
        },
        'ACCOUNTS',
      );
    const returned = (orderId: string, feePaise = 0) =>
      run(
        'Receive returned goods',
        {
          type: 'RECORD_RETURN',
          payload: {
            orderId,
            items: this.detail(orderId)
              .shipments.filter((shipment) => shipment.status !== 'VOIDED')
              .flatMap((shipment) => shipment.lines)
              .filter((line) => line.delivered > line.returned)
              .map((line) => ({
                shipmentLineId: line.id,
                qty: line.delivered - line.returned,
              })),
            feePaise,
            reason: 'Customer return',
          },
        },
        'WAREHOUSE',
      );
    try {
      if (
        ['partial-delivery', 'second-delivery', 'cancel-remainder'].includes(id)
      ) {
        const created = run(
          'Create mixed order',
          {
            type: 'PUNCH_ORDER',
            payload: {
              customerId,
              items: [
                { skuId: 'sku-a', qty: 20, unitPricePaise: 10000 },
                { skuId: 'sku-b', qty: 15, unitPricePaise: 15000 },
              ],
            },
          },
          'SALES',
        );
        const orderId = created.references.orderId!;
        run(
          'Submit order',
          { type: 'SUBMIT_ORDER', payload: { orderId } },
          'SALES',
        );
        run(
          'Approve order',
          { type: 'APPROVE_ORDER', payload: { orderId, revision: 1 } },
          'KAM',
        );
        ship(orderId, [10, 10]);
        if (id === 'second-delivery') ship(orderId);
        if (id === 'cancel-remainder')
          run(
            'Cancel unshipped units',
            {
              type: 'CANCEL_REMAINDER',
              payload: {
                orderId,
                reason: 'Customer canceled the remaining units',
              },
            },
            'SALES',
          );
      } else if (id === 'reapproval') {
        const orderId = order();
        const loaded = run(
          'Start loading',
          {
            type: 'START_LOADING',
            payload: {
              orderId,
              items: [
                { lineKey: this.detail(orderId).lines[0]!.lineKey, qty: 1 },
              ],
            },
          },
          'WAREHOUSE',
        );
        run(
          'Revise approved order',
          {
            type: 'EDIT_ORDER',
            payload: {
              orderId,
              items: [{ skuId: 'sku-a', qty: 2, unitPricePaise: 11000 }],
              reason: 'Revised commercial terms',
            },
          },
          'SALES',
        );
        run(
          'Attempt dispatch of earlier loading document',
          {
            type: 'DISPATCH_SHIPMENT',
            payload: { orderId, shipmentId: loaded.references.shipmentId! },
          },
          'WAREHOUSE',
        );
        run(
          'Approve revised terms',
          { type: 'APPROVE_ORDER', payload: { orderId, revision: 2 } },
          'KAM',
        );
      } else if (id === 'dispatch-edit') {
        const orderId = order();
        ship(orderId);
        run(
          'Attempt ordinary edit after dispatch',
          {
            type: 'EDIT_ORDER',
            payload: {
              orderId,
              items: [{ skuId: 'sku-a', qty: 2, unitPricePaise: 10000 }],
              reason: 'Additional unit requested',
            },
          },
          'SALES',
        );
      } else if (id === 'cancel-order') {
        const orderId = order();
        run(
          'Cancel open order',
          {
            type: 'CANCEL_REMAINDER',
            payload: { orderId, reason: 'Customer cancellation' },
          },
          'SALES',
        );
      } else if (id === 'customer-payment') {
        ship(order());
        ship(order());
        payment(15000);
      } else if (
        [
          'paid-return',
          'redemption',
          'spent-return',
          'credit-settlement',
        ].includes(id)
      ) {
        const first = order();
        ship(first);
        payment(10000);
        if (id === 'paid-return') returned(first, 2000);
        if (id === 'redemption' || id === 'spent-return') {
          const second = order();
          ship(second);
          const charge = this.summary(customerId).charges.find(
            (row) => row.order_id === second,
          )!;
          run(
            'Redeem customer points',
            {
              type: 'REDEEM_POINTS',
              payload: { customerId, chargeId: charge.id, points: 1000 },
            },
            'ACCOUNTS',
          );
          if (id === 'spent-return') returned(first);
        }
        if (id === 'credit-settlement') {
          const credit = returned(first, 2000).references.creditNoteId!;
          const second = order();
          ship(second);
          const charge = this.summary(customerId).charges.find(
            (row) => row.order_id === second,
          )!;
          run(
            'Apply open credit',
            {
              type: 'APPLY_CREDIT_NOTE',
              payload: {
                customerId,
                creditNoteId: credit,
                chargeId: charge.id,
                amountPaise: 8000,
              },
            },
            'ACCOUNTS',
          );
        }
      } else if (id === 'shipment-correction') {
        const orderId = order();
        const shipmentId = ship(orderId);
        const payload: Payload<'CORRECT_DISPATCHED_ORDER'> = {
          orderId,
          items: [
            { skuId: 'sku-c', qty: 1, unitPricePaise: 25000, deliveredQty: 1 },
          ],
          reason: 'Unrecorded customer request',
          evidence: 'Signed delivery confirmation',
          authorizationReference: 'Commercial authorization',
        };
        run(
          'Request correction',
          { type: 'CORRECT_DISPATCHED_ORDER', payload },
          'KAM',
        );
        run(
          'Confirm original dispatch',
          {
            type: 'CORRECT_DISPATCHED_ORDER',
            payload: { ...payload, location: 'EXISTING_SHIPMENT', shipmentId },
          },
          'KAM',
        );
      } else if (id === 'receipt-retry') {
        const command: CrmCommand = {
          type: 'RECEIVE_CUSTOMER_PAYMENT',
          payload: {
            customerId,
            amountPaise: 10000,
            reference: 'Transfer reference',
          },
        };
        run(
          'Receive payment',
          command,
          'ACCOUNTS',
          `sample:${runId}:receipt`,
          0,
        );
        run(
          'Retry the same request',
          command,
          'ACCOUNTS',
          `sample:${runId}:receipt`,
          0,
        );
      } else if (id === 'competing-returns') {
        const orderId = order();
        ship(orderId);
        const detail = this.detail(orderId),
          line = detail.shipments[0]!.lines[0]!;
        const prior = this.one<{ envelope: string }>(
          sql`select envelope from sample_steps where run_id=${runId} and position=${steps.length}`,
        );
        const version = prior
          ? (JSON.parse(prior.envelope) as ActionEnvelope).expectedVersion
          : detail.order.version;
        const command: CrmCommand = {
          type: 'RECORD_RETURN',
          payload: {
            orderId,
            items: [{ shipmentLineId: line.id, qty: 1 }],
            feePaise: 0,
            reason: 'Return requested',
          },
        };
        run(
          'First return request',
          command,
          'WAREHOUSE',
          `sample:${runId}:return-1`,
          version,
        );
        run(
          'Second request using the earlier version',
          command,
          'WAREHOUSE',
          `sample:${runId}:return-2`,
          version,
        );
      } else throw new NotFoundException('Sample workflow not found');
      complete = true;
    } catch (error) {
      if (!(error instanceof StopAfterStep)) throw error;
    }
    this.database.db.run(
      sql`update sample_runs set complete=${complete ? 1 : 0} where id=${runId}`,
    );
    return {
      id,
      runId,
      complete,
      customerId,
      steps,
      summary: this.summary(customerId),
    };
  }
}
