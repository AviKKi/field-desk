import 'reflect-metadata';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { sql } from 'drizzle-orm';
import type { User } from '@crm/shared';
import type {
  ActionEnvelope,
  ActionResult,
  CrmCommand,
  CustomerSummary,
  CustomerSnapshot,
} from '@crm/shared/crm';
import { DatabaseService } from '../src/database/database.service.js';
import { ActionsService } from '../src/actions/actions.service.js';
import { CustomersService } from '../src/customers/customers.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { AccountsService } from '../src/accounts/accounts.service.js';
import { AuditService } from '../src/audit/audit.service.js';
import { UsersRepository } from '../src/users/users.repository.js';
import { CrmQueriesService } from '../src/crm-queries/crm-queries.service.js';
import { UsersService } from '../src/users/users.service.js';
import { configureApp } from '../src/configure-app.js';
import { seedReferenceData } from '../src/scripts/seed-reference-data.js';
import { createCrmFixture } from './support/crm-fixtures.js';

const directory = mkdtempSync(join(tmpdir(), 'crm-operations-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = join(directory, 'crm.db');
process.env.JWT_SECRET = 'crm-test-secret-'.repeat(4);
process.env.CLIENT_ORIGIN = 'http://localhost:5173';

describe('CRM operations', { concurrency: false }, () => {
  let app: INestApplication,
    actions: ActionsService,
    customers: CustomersService,
    orders: OrdersService,
    accounts: AccountsService,
    audit: AuditService,
    users: UsersRepository,
    queries: CrmQueriesService,
    database: DatabaseService,
    admin: User;
  const fixture = (kind: Parameters<typeof createCrmFixture>[2]) =>
    createCrmFixture(
      { actions, customers, orders, accounts, users },
      admin,
      kind,
    );
  before(async () => {
    const { AppModule } = await import('../src/app.module.js');
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    database = app.get(DatabaseService);
    migrate(database.db, { migrationsFolder: resolve('drizzle') });
    actions = app.get(ActionsService);
    customers = app.get(CustomersService);
    orders = app.get(OrdersService);
    accounts = app.get(AccountsService);
    audit = app.get(AuditService);
    users = app.get(UsersRepository);
    queries = app.get(CrmQueriesService);
    admin = await app.get(UsersService).create({
      name: 'Operations Admin',
      email: 'ops@example.test',
      password: 'operations-test-password',
      role: 'ADMIN',
    });
    await app.init();
    seedReferenceData(database, admin);
  });
  after(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  function check(summary: CustomerSummary) {
    assert.equal(
      summary.netBalancePaise,
      summary.outstandingPaise -
        summary.unappliedCashPaise -
        summary.creditsOpenPaise,
    );
    for (const charge of summary.charges) {
      assert.ok(charge.remainingPaise >= 0);
      assert.ok(charge.outstandingPaise >= 0);
      assert.ok(charge.cashPaidPaise >= 0);
    }
    for (const credit of summary.credits) assert.ok(credit.availablePaise >= 0);
    for (const value of Object.values(summary.points)) assert.ok(value >= 0);
    for (const order of orders
      .list()
      .filter((row) => row.customer_id === summary.customer.id)) {
      for (const line of orders.detail(order.id).lines) {
        assert.ok(line.open >= 0);
        assert.ok(line.returned <= line.delivered);
        assert.ok(line.delivered <= line.dispatched);
        assert.equal(line.qty, line.canceled + line.dispatched + line.open);
      }
    }
  }
  const run = (
    command: CrmCommand,
    actor: User = admin,
    version?: number,
    key = randomUUID(),
  ): ActionResult => {
    const payload = command.payload;
    const expectedVersion =
      version ??
      ('orderId' in payload
        ? orders.detail(payload.orderId).order.version
        : accounts.summary(payload.customerId).customer.version);
    return actions.execute(
      { command, actorId: actor.id, idempotencyKey: key, expectedVersion },
      admin,
    );
  };
  it('accepts advances without charges and allocates them at delivery', () => {
    const customer = customers.createCustomer(admin, {
      name: 'Advance customer',
      code: randomUUID(),
    });
    assert.equal(
      run({
        type: 'RECEIVE_CUSTOMER_PAYMENT',
        payload: {
          customerId: customer.id,
          amountPaise: 15000,
          reference: 'Advance',
        },
      }).status,
      'APPLIED',
    );
    assert.equal(accounts.summary(customer.id).unappliedCashPaise, 15000);
    assert.equal(accounts.summary(customer.id).charges.length, 0);
    const created = run({
      type: 'PUNCH_ORDER',
      payload: {
        customerId: customer.id,
        items: [{ skuId: 'sku-a', qty: 1, unitPricePaise: 10000 }],
      },
    });
    const orderId = created.references.orderId!;
    run({ type: 'SUBMIT_ORDER', payload: { orderId } });
    run({ type: 'APPROVE_ORDER', payload: { orderId, revision: 1 } });
    const loaded = run({
      type: 'START_LOADING',
      payload: {
        orderId,
        items: [{ lineKey: orders.detail(orderId).lines[0]!.lineKey, qty: 1 }],
      },
    });
    const shipmentId = loaded.references.shipmentId!;
    run({ type: 'DISPATCH_SHIPMENT', payload: { orderId, shipmentId } });
    const line = orders.detail(orderId).shipments[0]!.lines[0]!;
    run({
      type: 'CONFIRM_DELIVERY',
      payload: {
        orderId,
        shipmentId,
        items: [{ shipmentLineId: line.id, qty: 1 }],
      },
    });
    const summary = accounts.summary(customer.id);
    check(summary);
    assert.equal(summary.unappliedCashPaise, 5000);
    assert.equal(summary.points.available, 1000);
  });

  it('handles partial payments, partial returns, refund limits, and credit reversals', () => {
    const report = fixture('customer-payment');
    const customerId = report.customerId;
    const first = orders
      .list()
      .filter((order) => order.customer_id === customerId)
      .at(-1)!;
    const line = orders.detail(first.id).shipments[0]!.lines[0]!;
    const returned = run({
      type: 'RECORD_RETURN',
      payload: {
        orderId: first.id,
        items: [{ shipmentLineId: line.id, qty: 1 }],
        feePaise: 2000,
        reason: 'Return with fee',
      },
    });
    assert.equal(returned.status, 'APPLIED');
    const credit = returned.references.creditNoteId!;
    const note = accounts
      .summary(customerId)
      .credits.find((row) => row.id === credit)!;
    assert.equal(note.amount_paise, 8000);
    const before = accounts.summary(customerId);
    const bad = run({
      type: 'REFUND_CREDIT_NOTE',
      payload: {
        customerId,
        creditNoteId: credit,
        amountPaise: 9000,
        reference: 'Refund requested',
      },
    });
    assert.equal(bad.status, 'REJECTED');
    assert.deepEqual(accounts.summary(customerId), before);
    assert.equal(
      run({
        type: 'REFUND_CREDIT_NOTE',
        payload: {
          customerId,
          creditNoteId: credit,
          amountPaise: 3000,
          reference: 'Refund transfer',
        },
      }).status,
      'APPLIED',
    );
    check(accounts.summary(customerId));
    assert.equal(accounts.summary(customerId).creditsOpenPaise, 5000);
  });

  it('rejects over-delivery, over-return, loading too many units, duplicate lines and stale approval without mutation', () => {
    const report = fixture('partial-delivery');
    const order = orders
      .list()
      .find((row) => row.customer_id === report.customerId)!;
    const detail = orders.detail(order.id);
    const line = detail.shipments[0]!.lines[0]!;
    for (const command of [
      {
        type: 'RECORD_RETURN',
        payload: {
          orderId: order.id,
          items: [{ shipmentLineId: line.id, qty: 11 }],
          feePaise: 0,
          reason: 'Too many units',
        },
      },
      {
        type: 'START_LOADING',
        payload: {
          orderId: order.id,
          items: [{ lineKey: detail.lines[0]!.lineKey, qty: 11 }],
        },
      },
      {
        type: 'START_LOADING',
        payload: {
          orderId: order.id,
          items: [
            { lineKey: detail.lines[0]!.lineKey, qty: 1 },
            { lineKey: detail.lines[0]!.lineKey, qty: 1 },
          ],
        },
      },
      {
        type: 'CONFIRM_DELIVERY',
        payload: {
          orderId: order.id,
          shipmentId: detail.shipments[0]!.id,
          items: [{ shipmentLineId: line.id, qty: 1 }],
        },
      },
    ] satisfies CrmCommand[]) {
      const before = orders.detail(order.id),
        ledger = accounts.ledger(report.customerId);
      const result = run(command);
      assert.equal(result.status, 'REJECTED');
      assert.deepEqual(orders.detail(order.id), before);
      assert.deepEqual(accounts.ledger(report.customerId), ledger);
      assert.equal(result.effects.length, 0);
    }
  });

  it('serializes two HTTP return requests and rejects forged actors', async () => {
    const report = fixture('second-delivery');
    const order = orders
      .list()
      .find((row) => row.customer_id === report.customerId)!;
    const line = orders.detail(order.id).shipments[0]!.lines[0]!;
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'operations-test-password' })
      .expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    const cookie = cookies[0]!.split(';')[0]!;
    const envelope: ActionEnvelope = {
      command: {
        type: 'RECORD_RETURN',
        payload: {
          orderId: order.id,
          items: [{ shipmentLineId: line.id, qty: 10 }],
          feePaise: 0,
          reason: 'Returned shipment',
        },
      },
      expectedVersion: order.version,
      idempotencyKey: randomUUID(),
    };
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/api/crm/actions')
        .set('Cookie', cookie)
        .send(envelope),
      request(app.getHttpServer())
        .post('/api/crm/actions')
        .set('Cookie', cookie)
        .send({ ...envelope, idempotencyKey: randomUUID() }),
    ]);
    assert.deepEqual(
      responses
        .map((response) => (response.body as ActionResult).status)
        .sort(),
      ['APPLIED', 'CONFLICT'],
    );
    const sales = users.listActive().find((actor) => actor.role === 'SALES')!;
    assert.throws(() =>
      actions.execute(
        { ...envelope, actorId: admin.id, idempotencyKey: randomUUID() },
        sales,
      ),
    );
    const denied = run(
      {
        type: 'RECEIVE_CUSTOMER_PAYMENT',
        payload: {
          customerId: report.customerId,
          amountPaise: 100,
          reference: 'Unauthorized',
        },
      },
      sales,
    );
    assert.equal(denied.errors[0]?.code, 'FORBIDDEN');
    await request(app.getHttpServer()).get('/api/crm/bootstrap').expect(401);
    const bad = await request(app.getHttpServer())
      .post('/api/crm/actions')
      .set('Cookie', cookie)
      .send({
        ...envelope,
        command: {
          type: 'RECEIVE_CUSTOMER_PAYMENT',
          payload: {
            customerId: report.customerId,
            amountPaise: 1.5,
            reference: 'Fraction',
          },
        },
      })
      .expect(400);
    assert.ok(bad.body.issues);
  });

  it('detects key reuse, preserves correction evidence, and requires fresh versions', () => {
    const report = fixture('shipment-correction');
    const customerId = report.customerId;
    const key = randomUUID();
    const version = accounts.summary(customerId).customer.version;
    const one = actions.execute(
      {
        command: {
          type: 'RECEIVE_CUSTOMER_PAYMENT',
          payload: { customerId, amountPaise: 100, reference: 'First' },
        },
        expectedVersion: version,
        idempotencyKey: key,
      },
      admin,
    );
    assert.equal(one.status, 'APPLIED');
    const two = actions.execute(
      {
        command: {
          type: 'RECEIVE_CUSTOMER_PAYMENT',
          payload: { customerId, amountPaise: 200, reference: 'Changed' },
        },
        expectedVersion: version,
        idempotencyKey: key,
      },
      admin,
    );
    assert.equal(two.errors[0]?.code, 'IDEMPOTENCY_CONFLICT');
    const result = actions.execute(
      {
        command: { type: 'ALLOCATE_PAYMENT', payload: { customerId } },
        idempotencyKey: randomUUID(),
      },
      admin,
    );
    assert.equal(result.errors[0]?.code, 'VERSION_REQUIRED');
    const dangling = database.db.all(sql`pragma foreign_key_check`);
    assert.deepEqual(dangling, []);
    check(accounts.summary(customerId));
  });
  it('restores an applied credit when the later goods are returned', () => {
    const report = fixture('credit-settlement');
    const newer = orders
      .list()
      .find((order) => order.customer_id === report.customerId)!;
    const line = orders.detail(newer.id).shipments[0]!.lines[0]!;
    assert.equal(
      run({
        type: 'RECORD_RETURN',
        payload: {
          orderId: newer.id,
          items: [{ shipmentLineId: line.id, qty: 1 }],
          feePaise: 0,
          reason: 'Second delivery returned',
        },
      }).status,
      'APPLIED',
    );
    const value = accounts.summary(report.customerId);
    check(value);
    assert.equal(value.creditsOpenPaise, 8000);
    assert.equal(value.outstandingPaise, 0);
    assert.equal(value.receivedPaise, 10000);
    assert.equal(value.points.available, 0);
    assert.ok(
      accounts
        .ledger(report.customerId)
        .creditApplications.some((row) => Number(row.amount_paise) < 0),
    );
  });

  it('restores redeemed points when their settlement charge is returned', () => {
    const report = fixture('redemption');
    const newer = orders
      .list()
      .find((order) => order.customer_id === report.customerId)!;
    const line = orders.detail(newer.id).shipments[0]!.lines[0]!;
    assert.equal(
      run({
        type: 'RECORD_RETURN',
        payload: {
          orderId: newer.id,
          items: [{ shipmentLineId: line.id, qty: 1 }],
          feePaise: 0,
          reason: 'Returned goods bought with points',
        },
      }).status,
      'APPLIED',
    );
    const value = accounts.summary(report.customerId);
    check(value);
    assert.equal(value.points.available, 1000);
    assert.equal(value.points.redeemed, 0);
    assert.equal(value.creditsOpenPaise, 0);
    assert.equal(value.netBalancePaise, 0);
    assert.ok(
      accounts
        .ledger(report.customerId)
        .redemptions.some((row) => Number(row.points) < 0),
    );
  });

  it('keeps exact paise and rounds proportional awards down for partial returns', () => {
    const customer = customers.createCustomer(admin, {
      name: 'Paise account',
      code: randomUUID(),
    });
    const orderId = run({
      type: 'PUNCH_ORDER',
      payload: {
        customerId: customer.id,
        items: [{ skuId: 'sku-a', qty: 2, unitPricePaise: 333 }],
      },
    }).references.orderId!;
    run({ type: 'SUBMIT_ORDER', payload: { orderId } });
    run({ type: 'APPROVE_ORDER', payload: { orderId, revision: 1 } });
    const shipmentId = run({
      type: 'START_LOADING',
      payload: {
        orderId,
        items: [{ lineKey: orders.detail(orderId).lines[0]!.lineKey, qty: 2 }],
      },
    }).references.shipmentId!;
    run({ type: 'DISPATCH_SHIPMENT', payload: { orderId, shipmentId } });
    const line = orders.detail(orderId).shipments[0]!.lines[0]!;
    run({
      type: 'CONFIRM_DELIVERY',
      payload: {
        orderId,
        shipmentId,
        items: [{ shipmentLineId: line.id, qty: 2 }],
      },
    });
    run({
      type: 'RECEIVE_CUSTOMER_PAYMENT',
      payload: {
        customerId: customer.id,
        amountPaise: 100,
        reference: 'Partial receipt',
      },
    });
    run({
      type: 'RECORD_RETURN',
      payload: {
        orderId,
        items: [{ shipmentLineId: line.id, qty: 1 }],
        feePaise: 0,
        reason: 'One unit returned',
      },
    });
    const first = accounts.summary(customer.id);
    check(first);
    assert.equal(first.outstandingPaise, 233);
    assert.equal(first.points.available, 300);
    assert.equal(first.points.locked, 700);
    assert.equal(first.creditsOpenPaise, 0);
    run({
      type: 'RECORD_RETURN',
      payload: {
        orderId,
        items: [{ shipmentLineId: line.id, qty: 1 }],
        feePaise: 0,
        reason: 'Remaining unit returned',
      },
    });
    const second = accounts.summary(customer.id);
    check(second);
    assert.equal(second.netBalancePaise, -100);
    assert.equal(second.creditsOpenPaise, 100);
    assert.equal(second.points.available, 0);
    assert.equal(orders.detail(orderId).lines[0]?.delivered, 2);
  });

  it('voids pending loading documents after a correction and keeps original dispatch evidence', () => {
    const report = fixture('partial-delivery');
    const order = orders
      .list()
      .find((row) => row.customer_id === report.customerId)!;
    const detail = orders.detail(order.id);
    const old = JSON.stringify(detail.shipments[0]);
    const loading = run({
      type: 'START_LOADING',
      payload: {
        orderId: order.id,
        items: [{ lineKey: detail.lines[0]!.lineKey, qty: 1 }],
      },
    }).references.shipmentId!;
    const corrected = run({
      type: 'CORRECT_DISPATCHED_ORDER',
      payload: {
        orderId: order.id,
        items: [
          { skuId: 'sku-c', qty: 1, unitPricePaise: 25000, deliveredQty: 0 },
        ],
        reason: 'Additional unit was dispatched',
        evidence: 'Signed supplemental dispatch document',
        authorizationReference: 'KAM approval 22',
        location: 'EXISTING_SHIPMENT',
        shipmentId: detail.shipments[0]!.id,
      },
    });
    assert.equal(corrected.status, 'APPLIED');
    const changed = orders.detail(order.id);
    assert.equal(JSON.stringify(changed.shipments[0]), old);
    assert.equal(
      changed.shipments.find((row) => row.id === loading)?.status,
      'VOIDED',
    );
    assert.equal(accounts.summary(report.customerId).netBalancePaise, 250000);
    assert.equal(
      run({
        type: 'START_LOADING',
        payload: {
          orderId: order.id,
          items: [{ lineKey: detail.lines[0]!.lineKey, qty: 1 }],
        },
      }).status,
      'APPLIED',
    );
    check(accounts.summary(report.customerId));
  });

  it('conserves money, quantities, and points through varied delivery and settlement histories', () => {
    let seed = 1879461;
    const pick = (limit: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % limit;
    };
    let appliedCount = 0;
    for (let caseIndex = 0; caseIndex < 40; caseIndex++) {
      const customer = customers.createCustomer(admin, {
        name: `History ${caseIndex}`,
        code: randomUUID(),
      });
      const qty = 2 + pick(4),
        price = [101, 333, 999, 10000][pick(4)]!;
      let deliveredValue = 0,
        returnedValue = 0,
        fees = 0,
        cash = 0,
        refunds = 0,
        spent = 0;
      let firstApproved = false,
        secondApproved = false,
        canceled = 0,
        returnedQty = 0;
      let last: ActionEnvelope | undefined;
      const verify = () => {
        const value = accounts.summary(customer.id);
        check(value);
        assert.equal(
          value.netBalancePaise,
          deliveredValue - returnedValue + fees - cash + refunds - spent,
          `money in history ${caseIndex}`,
        );
        const entitled =
          (firstApproved ? qty - canceled - returnedQty : 0) * 1000 +
          (secondApproved ? 1000 : 0);
        assert.equal(
          value.points.locked +
            value.points.available +
            value.points.redeemed -
            value.points.clawbackPending,
          entitled,
          `points in history ${caseIndex}`,
        );
      };
      const apply = (command: CrmCommand) => {
        const payload = command.payload;
        const expectedVersion =
          'orderId' in payload
            ? orders.detail(payload.orderId).order.version
            : accounts.summary(payload.customerId).customer.version;
        last = { command, expectedVersion, idempotencyKey: randomUUID() };
        const result = actions.execute(last, admin);
        assert.equal(result.status, 'APPLIED', JSON.stringify(result.errors));
        appliedCount++;
        verify();
        return result;
      };
      const first = apply({
        type: 'PUNCH_ORDER',
        payload: {
          customerId: customer.id,
          items: [{ skuId: 'sku-a', qty, unitPricePaise: price }],
        },
      }).references.orderId!;
      apply({ type: 'SUBMIT_ORDER', payload: { orderId: first } });
      firstApproved = true;
      apply({
        type: 'APPROVE_ORDER',
        payload: { orderId: first, revision: 1 },
      });
      if (caseIndex % 2 === 0) {
        const advance = price + pick(price);
        cash += advance;
        apply({
          type: 'RECEIVE_CUSTOMER_PAYMENT',
          payload: {
            customerId: customer.id,
            amountPaise: advance,
            reference: 'Advance',
          },
        });
      }
      const loaded = apply({
        type: 'START_LOADING',
        payload: {
          orderId: first,
          items: [
            { lineKey: orders.detail(first).lines[0]!.lineKey, qty: qty - 1 },
          ],
        },
      }).references.shipmentId!;
      apply({
        type: 'DISPATCH_SHIPMENT',
        payload: { orderId: first, shipmentId: loaded },
      });
      const shippedLine = orders.detail(first).shipments[0]!.lines[0]!;
      deliveredValue += price;
      apply({
        type: 'CONFIRM_DELIVERY',
        payload: {
          orderId: first,
          shipmentId: loaded,
          items: [{ shipmentLineId: shippedLine.id, qty: 1 }],
        },
      });
      const partial = 1 + pick(price * 2);
      cash += partial;
      apply({
        type: 'RECEIVE_CUSTOMER_PAYMENT',
        payload: {
          customerId: customer.id,
          amountPaise: partial,
          reference: 'Part receipt',
        },
      });
      if (qty > 2) {
        deliveredValue += (qty - 2) * price;
        apply({
          type: 'CONFIRM_DELIVERY',
          payload: {
            orderId: first,
            shipmentId: loaded,
            items: [{ shipmentLineId: shippedLine.id, qty: qty - 2 }],
          },
        });
      }
      const second = apply({
        type: 'PUNCH_ORDER',
        payload: {
          customerId: customer.id,
          items: [{ skuId: 'sku-a', qty: 1, unitPricePaise: 10000 }],
        },
      }).references.orderId!;
      apply({ type: 'SUBMIT_ORDER', payload: { orderId: second } });
      secondApproved = true;
      apply({
        type: 'APPROVE_ORDER',
        payload: { orderId: second, revision: 1 },
      });
      const secondShipment = apply({
        type: 'START_LOADING',
        payload: {
          orderId: second,
          items: [{ lineKey: orders.detail(second).lines[0]!.lineKey, qty: 1 }],
        },
      }).references.shipmentId!;
      apply({
        type: 'DISPATCH_SHIPMENT',
        payload: { orderId: second, shipmentId: secondShipment },
      });
      deliveredValue += 10000;
      apply({
        type: 'CONFIRM_DELIVERY',
        payload: {
          orderId: second,
          shipmentId: secondShipment,
          items: [
            {
              shipmentLineId: orders.detail(second).shipments[0]!.lines[0]!.id,
              qty: 1,
            },
          ],
        },
      });
      const summary = accounts.summary(customer.id);
      const charge = summary.charges.find((row) => row.order_id === second)!;
      const points = Math.min(
        summary.points.available,
        charge.outstandingPaise,
        500 + pick(500),
      );
      if (points) {
        spent += points;
        apply({
          type: 'REDEEM_POINTS',
          payload: { customerId: customer.id, chargeId: charge.id, points },
        });
      }
      returnedQty = 1 + pick(qty - 1);
      const gross = returnedQty * price;
      const fee = pick(Math.floor(gross / 4) + 1);
      returnedValue += gross;
      fees += fee;
      apply({
        type: 'RECORD_RETURN',
        payload: {
          orderId: first,
          items: [{ shipmentLineId: shippedLine.id, qty: returnedQty }],
          feePaise: fee,
          reason: 'Returned shipment units',
        },
      });
      canceled = 1;
      apply({
        type: 'CANCEL_REMAINDER',
        payload: { orderId: first, reason: 'Cancel the unshipped unit' },
      });
      const credited = accounts.summary(customer.id);
      const credit = credited.credits.find((row) => row.availablePaise > 0);
      const due = credited.charges.find((row) => row.outstandingPaise > 0);
      if (credit && due && caseIndex % 2 === 0) {
        apply({
          type: 'APPLY_CREDIT_NOTE',
          payload: {
            customerId: customer.id,
            creditNoteId: credit.id,
            chargeId: due.id,
            amountPaise: Math.min(credit.availablePaise, due.outstandingPaise),
          },
        });
      } else if (credit) {
        const amount = 1 + pick(credit.availablePaise);
        refunds += amount;
        apply({
          type: 'REFUND_CREDIT_NOTE',
          payload: {
            customerId: customer.id,
            creditNoteId: credit.id,
            amountPaise: amount,
            reference: 'Refund transfer',
          },
        });
      }
      const finalReceipt = 1 + pick(999);
      cash += finalReceipt;
      apply({
        type: 'RECEIVE_CUSTOMER_PAYMENT',
        payload: {
          customerId: customer.id,
          amountPaise: finalReceipt,
          reference: 'Later receipt',
        },
      });
      const before = accounts.ledger(customer.id),
        detail = orders.detail(first),
        version = accounts.summary(customer.id).customer.version;
      assert.equal(actions.execute(last!, admin).status, 'APPLIED');
      assert.deepEqual(accounts.ledger(customer.id), before);
      assert.equal(accounts.summary(customer.id).customer.version, version);
      const rejected = run({
        type: 'RECORD_RETURN',
        payload: {
          orderId: first,
          items: [{ shipmentLineId: shippedLine.id, qty: qty }],
          feePaise: 0,
          reason: 'Excess return requested',
        },
      });
      assert.equal(rejected.status, 'REJECTED');
      assert.deepEqual(accounts.ledger(customer.id), before);
      assert.deepEqual(orders.detail(first), detail);
      verify();
    }
    assert.ok(appliedCount >= 600);
  });
  it('reverses settlements with bounded compensating entries and retains original evidence', () => {
    const report = fixture('credit-settlement');
    const customerId = report.customerId;
    const original = accounts
      .ledger(customerId)
      .creditApplications.find((row) => Number(row.amount_paise) > 0)!;
    const originalCopy = { ...original };
    const command: CrmCommand = {
      type: 'REVERSE_CREDIT_APPLICATION',
      payload: {
        customerId,
        applicationId: String(original.id),
        amountPaise: 3000,
        reason: 'Correct settlement attribution',
      },
    };
    const version = accounts.summary(customerId).customer.version;
    const key = randomUUID();
    const reversed = run(command, admin, version, key);
    assert.equal(reversed.status, 'APPLIED');
    assert.deepEqual(run(command, admin, version, key), reversed);
    let summary = accounts.summary(customerId);
    assert.equal(summary.creditsOpenPaise, 3000);
    assert.equal(summary.outstandingPaise, 5000);
    assert.deepEqual(
      accounts
        .ledger(customerId)
        .creditApplications.find((row) => row.id === original.id),
      originalCopy,
    );
    const before = accounts.ledger(customerId);
    assert.equal(
      run({ ...command, payload: { ...command.payload, amountPaise: 8000 } })
        .status,
      'REJECTED',
    );
    assert.deepEqual(accounts.ledger(customerId), before);
    const note = summary.credits[0]!;
    const refund = run({
      type: 'REFUND_CREDIT_NOTE',
      payload: {
        customerId,
        creditNoteId: note.id,
        amountPaise: 3000,
        reference: 'Transfer sent',
      },
    });
    assert.equal(refund.status, 'APPLIED');
    const refundRow = accounts
      .ledger(customerId)
      .refunds.find((row) => row.action_id === refund.actionId)!;
    const refundCopy = { ...refundRow };
    const reverseRefund: CrmCommand = {
      type: 'REVERSE_CREDIT_REFUND',
      payload: {
        customerId,
        refundId: String(refundRow.id),
        amountPaise: 1000,
        reason: 'Bank transfer partially returned',
        reference: 'BANK-RETURN-01',
      },
    };
    const refundedNet = accounts.summary(customerId).netBalancePaise;
    assert.equal(run(reverseRefund).status, 'APPLIED');
    summary = accounts.summary(customerId);
    assert.equal(summary.refundsPaise, 2000);
    assert.equal(summary.creditsOpenPaise, 1000);
    assert.equal(summary.netBalancePaise, refundedNet - 1000);
    assert.deepEqual(
      accounts
        .ledger(customerId)
        .refunds.find((row) => row.id === refundRow.id),
      refundCopy,
    );
    assert.equal(
      run({
        ...reverseRefund,
        payload: { ...reverseRefund.payload, amountPaise: 2001 },
      }).status,
      'REJECTED',
    );
    assert.equal(
      run({
        ...reverseRefund,
        payload: { ...reverseRefund.payload, amountPaise: 2000 },
      }).status,
      'APPLIED',
    );
    assert.equal(accounts.summary(customerId).refundsPaise, 0);
    assert.equal(run(reverseRefund).status, 'REJECTED');
    const otherCustomer = customers.createCustomer(admin, {
      name: 'Other customer',
      code: randomUUID(),
    });
    assert.equal(
      run({
        ...reverseRefund,
        payload: { ...reverseRefund.payload, customerId: otherCustomer.id },
      }).status,
      'REJECTED',
    );
    const warehouse = users
      .listActive()
      .find((user) => user.role === 'WAREHOUSE')!;
    assert.equal(run(command, warehouse).errors[0]?.code, 'FORBIDDEN');
    check(accounts.summary(customerId));
  });

  it('cancels selected unshipped quantities and preserves other demand and dispatched history', () => {
    const report = fixture('partial-delivery');
    const customerId = report.customerId;
    const order = orders.list().find((row) => row.customer_id === customerId)!;
    const before = orders.detail(order.id);
    const first = before.lines[0]!;
    const canceled = run({
      type: 'CANCEL_REMAINDER',
      payload: {
        orderId: order.id,
        reason: 'Reduce the first line only',
        items: [{ lineKey: first.lineKey, qty: 3 }],
      },
    });
    assert.equal(canceled.status, 'APPLIED');
    const detail = orders.detail(order.id);
    assert.equal(detail.lines[0]!.canceled, 3);
    assert.equal(detail.lines[0]!.open, 7);
    assert.equal(detail.lines[1]!.open, 5);
    assert.deepEqual(detail.shipments, before.shipments);
    const bad = run({
      type: 'CANCEL_REMAINDER',
      payload: {
        orderId: order.id,
        reason: 'Invalid cancellation',
        items: [{ lineKey: first.lineKey, qty: 8 }],
      },
    });
    assert.equal(bad.errors[0]?.code, 'CANCEL_EXCEEDED');
    assert.deepEqual(orders.detail(order.id), detail);
    check(accounts.summary(customerId));
    const created = run({
      type: 'PUNCH_ORDER',
      payload: {
        customerId,
        items: [{ skuId: 'sku-a', qty: 5, unitPricePaise: 10000 }],
      },
    });
    const id = created.references.orderId!;
    assert.equal(
      run({
        type: 'CANCEL_REMAINDER',
        payload: {
          orderId: id,
          reason: 'Partly cancel a draft',
          items: [{ lineKey: orders.detail(id).lines[0]!.lineKey, qty: 2 }],
        },
      }).status,
      'APPLIED',
    );
    assert.equal(orders.detail(id).order.status, 'DRAFT');
    assert.equal(orders.detail(id).lines[0]!.open, 3);
    assert.equal(
      run({
        type: 'CANCEL_REMAINDER',
        payload: { orderId: id, reason: 'Cancel the remaining draft' },
      }).status,
      'APPLIED',
    );
    assert.equal(orders.detail(id).order.status, 'CANCELLED');
  });
  it('records causal posting evidence, snapshots, and checks without replaying activities', () => {
    const report = fixture('paid-return');
    const customerId = report.customerId;
    const last = report.steps.at(-1)!.result;
    assert.equal(last.termsVersion, '2026-10-26.1');
    assert.ok(last.review!.checks.every((check) => check.passed));
    for (const effect of last.effects) {
      assert.ok(effect.reason && effect.sourceReference);
      assert.equal(effect.provenance!.actionId, last.actionId);
      assert.equal(effect.provenance!.requestedBy, admin.id);
    }
    const adjustment = last.effects.find(
      (effect) => effect.entity === 'receivable_entries',
    )!;
    assert.match(adjustment.reason!, /reduce charge/);
    assert.ok(adjustment.provenance!.revision);
    const version = accounts.summary(customerId).customer.version;
    const ledger = accounts.ledger(customerId);
    const snapshot = queries.snapshot(customerId);
    assert.equal(snapshot.summary.netBalancePaise, -8000);
    assert.ok(
      snapshot.timeline.some(
        (event) => event.type === 'RECEIVE_CUSTOMER_PAYMENT',
      ),
    );
    assert.ok(
      snapshot.timeline.some((event) => event.type === 'RECORD_RETURN'),
    );
    assert.ok(snapshot.review.checks.every((check) => check.passed));
    assert.deepEqual(accounts.ledger(customerId), ledger);
    assert.equal(accounts.summary(customerId).customer.version, version);
    assert.deepEqual(audit.trace(last.actionId, admin), last);
  });

  it('reports inconsistent evidence and rolls back a subsequent activity atomically', () => {
    const report = fixture('customer-payment');
    const customerId = report.customerId;
    const charge = accounts.summary(customerId).charges[0]!;
    const stop = new Error('Rollback the deliberately altered test record');
    assert.throws(
      () =>
        database.db.transaction(() => {
          database.db.run(
            sql`update receivable_entries set amount_paise=amount_paise+1 where id=${charge.id}`,
          );
          assert.ok(
            audit
              .review(customerId)
              .checks.some(
                (check) => !check.passed && check.id === 'recognized-value',
              ),
          );
          const before = accounts.ledger(customerId);
          const summary = accounts.summary(customerId);
          const result = run({
            type: 'RECEIVE_CUSTOMER_PAYMENT',
            payload: {
              customerId,
              amountPaise: 1,
              reference: 'Must roll back',
            },
          });
          assert.equal(result.errors[0]?.code, 'ACCOUNT_INCONSISTENT');
          assert.deepEqual(result.effects, []);
          assert.deepEqual(result.references, {});
          assert.deepEqual(accounts.ledger(customerId), before);
          assert.deepEqual(accounts.summary(customerId), summary);
          throw stop;
        }),
      (error) => error === stop,
    );
    assert.ok(audit.review(customerId).checks.every((check) => check.passed));
  });
  it('updates customer details with role, version, uniqueness, and audit enforcement', () => {
    const customer = customers.createCustomer(admin, {
      name: 'Before edit',
      code: randomUUID(),
    });
    const other = customers.createCustomer(admin, {
      name: 'Another account',
      code: randomUUID(),
    });
    const sales = users.listActive().find((row) => row.role === 'SALES')!;
    const warehouse = users
      .listActive()
      .find((row) => row.role === 'WAREHOUSE')!;
    const command: CrmCommand = {
      type: 'UPDATE_CUSTOMER',
      payload: {
        customerId: customer.id,
        name: 'After edit',
        code: 'EDIT-' + randomUUID().slice(0, 8),
      },
    };
    const result = run(command, sales, 0);
    assert.equal(result.status, 'APPLIED');
    assert.equal(accounts.summary(customer.id).customer.name, 'After edit');
    assert.equal(
      audit.customerTimeline(customer.id).at(-1)!.type,
      'UPDATE_CUSTOMER',
    );
    assert.equal(run(command, sales, 0).status, 'CONFLICT');
    assert.equal(run(command, warehouse).errors[0]?.code, 'FORBIDDEN');
    assert.equal(
      run(
        { ...command, payload: { ...command.payload, code: other.code } },
        sales,
      ).errors[0]?.code,
      'CUSTOMER_CODE_EXISTS',
    );
    assert.equal(
      accounts.summary(customer.id).customer.code,
      command.payload.code,
    );
    const change = result.effects.find(
      (effect) =>
        effect.entity === 'customers' &&
        (effect.after as { name?: string }).name === 'After edit',
    )!;
    assert.equal((change.before as { name: string }).name, 'Before edit');
  });

  it('serves account balances through the authenticated account table endpoint', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'operations-test-password' })
      .expect(200);
    const cookies = login.headers['set-cookie'] as unknown as string[];
    for (const order of orders.list()) {
      assert.equal(
        order.totalPaise,
        orders
          .detail(order.id)
          .lines.reduce((sum, line) => sum + line.qty * line.unitPricePaise, 0),
      );
    }
    const response = await request(app.getHttpServer())
      .get('/api/crm/accounts')
      .set('Cookie', cookies[0]!.split(';')[0]!)
      .expect(200);
    const rows = response.body as Array<{
      customer: { id: string };
      netBalancePaise: number;
      outstandingPaise: number;
      unappliedCashPaise: number;
      creditsOpenPaise: number;
    }>;
    for (const row of rows) {
      const summary = accounts.summary(row.customer.id);
      assert.equal(row.netBalancePaise, summary.netBalancePaise);
      assert.equal(row.outstandingPaise, summary.outstandingPaise);
      assert.equal(row.unappliedCashPaise, summary.unappliedCashPaise);
      assert.equal(row.creditsOpenPaise, summary.creditsOpenPaise);
    }
    await request(app.getHttpServer()).get('/api/crm/accounts').expect(401);
  });
  it('does not expose development runners, saved cases, seed, or reset HTTP endpoints', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'operations-test-password' })
      .expect(200);
    const cookie = (
      login.headers['set-cookie'] as unknown as string[]
    )[0]!.split(';')[0]!;
    for (const path of ['/api/crm/samples', '/api/crm/samples/old-run'])
      await request(app.getHttpServer())
        .get(path)
        .set('Cookie', cookie)
        .expect(404);
    for (const path of [
      '/api/crm/samples',
      '/api/crm/samples/old-run/step',
      '/api/crm/samples/old-run/run',
      '/api/crm/scenarios/partial-delivery/run',
      '/api/crm/seed',
      '/api/crm/reset',
    ])
      await request(app.getHttpServer())
        .post(path)
        .set('Cookie', cookie)
        .send({})
        .expect(404);
  });
  it('serves domain read routes consistently with the customer and order views', async () => {
    const prepared = fixture('paid-return');
    const order = orders
      .list()
      .find((row) => row.customer_id === prepared.customerId)!;
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'operations-test-password' })
      .expect(200);
    const cookie = (
      login.headers['set-cookie'] as unknown as string[]
    )[0]!.split(';')[0]!;
    const read = async (path: string) =>
      (
        await request(app.getHttpServer())
          .get(`/api/crm/${path}`)
          .set('Cookie', cookie)
          .expect(200)
      ).body as unknown;
    assert.deepEqual(
      await read(`customers/${prepared.customerId}`),
      accounts.summary(prepared.customerId).customer,
    );
    assert.deepEqual(
      await read(`orders/${order.id}/shipments`),
      orders.detail(order.id).shipments,
    );
    assert.deepEqual(
      await read(`customers/${prepared.customerId}/returns`),
      accounts.ledger(prepared.customerId).returns,
    );
    const credits = (await read(
      `customers/${prepared.customerId}/credits`,
    )) as Array<{ id: string; availablePaise: number }>;
    assert.equal(credits[0]!.availablePaise, 8000);
    const rewards = (await read(
      `customers/${prepared.customerId}/rewards`,
    )) as { points: unknown; entries: unknown };
    assert.deepEqual(
      rewards.points,
      accounts.summary(prepared.customerId).points,
    );
    assert.deepEqual(
      rewards.entries,
      accounts.ledger(prepared.customerId).rewards,
    );
    assert.deepEqual(await read('catalog'), queries.bootstrap(admin).skus);
    assert.deepEqual(await read('bootstrap'), queries.bootstrap(admin));
    const snapshot = (await read(
      `customers/${prepared.customerId}/snapshot`,
    )) as CustomerSnapshot;
    const expected = queries.snapshot(prepared.customerId);
    assert.deepEqual(
      { ...snapshot, review: { ...snapshot.review, checkedAt: '' } },
      { ...expected, review: { ...expected.review, checkedAt: '' } },
    );
    const sales = users.listActive().find((user) => user.role === 'SALES')!;
    assert.deepEqual(queries.bootstrap(sales).actors, [sales]);
  });
});
