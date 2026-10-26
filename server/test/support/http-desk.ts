import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Role } from '@crm/shared';
import type {
  ActionEnvelope,
  ActionResult,
  CrmCommand,
  Customer,
  CustomerSnapshot,
  OrderDetail,
} from '@crm/shared/crm';

export class HttpDesk {
  readonly timings: Array<{
    type: string;
    status: string;
    durationMs: number;
  }> = [];
  constructor(
    private readonly app: INestApplication,
    private readonly cookie: string,
  ) {}
  async read<T>(path: string): Promise<T> {
    const response = await request(this.app.getHttpServer())
      .get(`/api/crm/${path}`)
      .set('Cookie', this.cookie)
      .expect(200);
    return response.body as T;
  }
  async post<T>(path: string, body: object): Promise<T> {
    const response = await request(this.app.getHttpServer())
      .post(`/api/crm/${path}`)
      .set('Cookie', this.cookie)
      .send(body)
      .expect(201);
    return response.body as T;
  }
  createCustomer() {
    return this.post<Customer>('customers', {
      name: 'Customer workflow',
      code: randomUUID(),
    });
  }
  snapshot(customerId: string) {
    return this.read<CustomerSnapshot>(`customers/${customerId}/snapshot`);
  }
  async envelope(
    command: CrmCommand,
    role: Role = 'ADMIN',
  ): Promise<ActionEnvelope> {
    const payload = command.payload;
    const version =
      'orderId' in payload
        ? (await this.read<OrderDetail>(`orders/${payload.orderId}`)).order
            .version
        : (await this.snapshot(payload.customerId)).summary.customer.version;
    const staff: Partial<Record<Role, string>> = {
      SALES: '00000000-0000-4000-8000-000000000001',
      KAM: '00000000-0000-4000-8000-000000000002',
      WAREHOUSE: '00000000-0000-4000-8000-000000000003',
      ACCOUNTS: '00000000-0000-4000-8000-000000000004',
    };
    return {
      command,
      expectedVersion: version,
      idempotencyKey: randomUUID(),
      ...(staff[role] ? { actorId: staff[role] } : {}),
    };
  }
  async submit(envelope: ActionEnvelope) {
    const started = performance.now();
    const result = await this.post<ActionResult>('actions', envelope);
    this.timings.push({
      type: envelope.command.type,
      status: result.status,
      durationMs: performance.now() - started,
    });
    return result;
  }
  async apply(command: CrmCommand, role: Role = 'ADMIN') {
    const result = await this.submit(await this.envelope(command, role));
    assert.equal(result.status, 'APPLIED', JSON.stringify(result.errors));
    assert.equal(result.termsVersion, '2026-10-26.1');
    assert.ok(result.review?.checks.length);
    assert.ok(result.review.checks.every((check) => check.passed));
    return result;
  }
  async order(
    customerId: string,
    items = [{ skuId: 'sku-a', qty: 1, unitPricePaise: 10000 }],
    approved = true,
  ) {
    const result = await this.apply(
      { type: 'PUNCH_ORDER', payload: { customerId, items } },
      'SALES',
    );
    const orderId = result.references.orderId!;
    if (approved) {
      await this.apply({ type: 'SUBMIT_ORDER', payload: { orderId } }, 'SALES');
      await this.apply(
        { type: 'APPROVE_ORDER', payload: { orderId, revision: 1 } },
        'KAM',
      );
    }
    return orderId;
  }
  async ship(orderId: string, quantities?: number[], delivered?: number[]) {
    const order = await this.read<OrderDetail>(`orders/${orderId}`);
    const items = order.lines
      .map((line, index) => ({
        lineKey: line.lineKey,
        qty: quantities?.[index] ?? line.open,
      }))
      .filter((line) => line.qty > 0);
    const loading = await this.apply(
      { type: 'START_LOADING', payload: { orderId, items } },
      'WAREHOUSE',
    );
    const shipmentId = loading.references.shipmentId!;
    await this.apply(
      { type: 'DISPATCH_SHIPMENT', payload: { orderId, shipmentId } },
      'WAREHOUSE',
    );
    const detail = await this.read<OrderDetail>(`orders/${orderId}`);
    const shipment = detail.shipments.find((row) => row.id === shipmentId)!;
    const confirmations = shipment.lines
      .map((line, index) => ({
        shipmentLineId: line.id,
        qty: delivered?.[index] ?? line.dispatched_qty,
      }))
      .filter((line) => line.qty > 0);
    if (confirmations.length)
      await this.apply(
        {
          type: 'CONFIRM_DELIVERY',
          payload: { orderId, shipmentId, items: confirmations },
        },
        'WAREHOUSE',
      );
    return shipment;
  }
  receive(customerId: string, amountPaise: number) {
    return this.apply(
      {
        type: 'RECEIVE_CUSTOMER_PAYMENT',
        payload: { customerId, amountPaise, reference: 'BANK-TEST-TRANSFER' },
      },
      'ACCOUNTS',
    );
  }
  async assertUnchanged(
    envelope: ActionEnvelope,
    customerId: string,
    status: ActionResult['status'],
  ) {
    const before = await this.snapshot(customerId);
    const result = await this.submit(envelope);
    assert.equal(result.status, status, JSON.stringify(result));
    assert.deepEqual(result.effects, []);
    const after = await this.snapshot(customerId);
    assert.deepEqual(after.summary, before.summary);
    assert.deepEqual(after.orders, before.orders);
    assert.deepEqual(after.ledger, before.ledger);
    assert.deepEqual(after.timeline, before.timeline);
    return result;
  }
}
