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
  ScenarioReport,
} from '@crm/shared/crm';
import { SCENARIOS } from '@crm/shared/crm';
import { DatabaseService } from '../src/database/database.service.js';
import { CrmService } from '../src/crm/crm.service.js';
import { UsersService } from '../src/users/users.service.js';
import { configureApp } from '../src/configure-app.js';

const directory = mkdtempSync(join(tmpdir(), 'crm-operations-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = join(directory, 'crm.db');
process.env.JWT_SECRET = 'crm-test-secret-'.repeat(4);
process.env.CLIENT_ORIGIN = 'http://localhost:5173';

describe('CRM operations', { concurrency: false }, () => {
  let app: INestApplication,
    crm: CrmService,
    database: DatabaseService,
    admin: User;
  const reports = new Map<string, ScenarioReport>();
  before(async () => {
    const { AppModule } = await import('../src/app.module.js');
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    database = app.get(DatabaseService);
    migrate(database.db, { migrationsFolder: resolve('drizzle') });
    crm = app.get(CrmService);
    admin = await app.get(UsersService).create({
      name: 'Operations Admin',
      email: 'ops@example.test',
      password: 'operations-test-password',
      role: 'ADMIN',
    });
    await app.init();
    crm.seed(admin);
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
    for (const order of crm
      .bootstrap(admin)
      .orders.filter((row) => row.customer_id === summary.customer.id)) {
      for (const line of crm.detail(order.id).lines) {
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
        ? crm.detail(payload.orderId).order.version
        : crm.summary(payload.customerId).customer.version);
    return crm.execute(
      { command, actorId: actor.id, idempotencyKey: key, expectedVersion },
      admin,
    );
  };
  for (const [id, label] of SCENARIOS)
    it(label, () => {
      const report = crm.scenario(id, admin);
      reports.set(id, report);
      check(report.summary);
      const expectedSpecial =
        id === 'reapproval' || id === 'dispatch-edit'
          ? 'REJECTED'
          : id === 'shipment-correction'
            ? 'NEEDS_DECISION'
            : id === 'competing-returns'
              ? 'CONFLICT'
              : null;
      for (const step of report.steps)
        assert.ok(
          step.result.status === 'APPLIED' ||
            step.result.status === expectedSpecial,
          `${step.label}: ${JSON.stringify(step.result.errors)}`,
        );
      const summary = report.summary;
      const orders = crm
        .bootstrap(admin)
        .orders.filter((row) => row.customer_id === report.customerId);
      const order = orders[0]!;
      if (id === 'partial-delivery') {
        assert.deepEqual(
          crm.detail(order.id).lines.map((line) => [line.delivered, line.open]),
          [
            [10, 10],
            [10, 5],
          ],
        );
        assert.equal(summary.netBalancePaise, 250000);
      }
      if (id === 'second-delivery') {
        assert.equal(summary.netBalancePaise, 425000);
        assert.ok(crm.detail(order.id).lines.every((line) => line.open === 0));
        assert.equal(crm.detail(order.id).shipments.length, 2);
      }
      if (id === 'reapproval') {
        assert.equal(order.current_revision, 2);
        assert.equal(order.status, 'APPROVED');
        assert.equal(crm.detail(order.id).shipments[0]?.status, 'VOIDED');
        assert.equal(summary.points.locked, 2000);
      }
      if (id === 'dispatch-edit') assert.equal(order.current_revision, 1);
      if (id === 'cancel-order') {
        assert.equal(order.status, 'CANCELLED');
        assert.equal(summary.points.locked, 0);
        assert.equal(summary.netBalancePaise, 0);
      }
      if (id === 'cancel-remainder') {
        assert.deepEqual(
          crm.detail(order.id).lines.map((line) => line.canceled),
          [10, 5],
        );
        assert.equal(summary.netBalancePaise, 250000);
        assert.equal(summary.points.locked, 22000);
      }
      if (id === 'paid-return') {
        assert.equal(summary.netBalancePaise, -8000);
        assert.equal(summary.creditsOpenPaise, 8000);
        assert.equal(summary.outstandingPaise, 0);
        assert.equal(summary.points.available, 0);
      }
      if (id === 'customer-payment') {
        assert.equal(summary.receivedPaise, 15000);
        assert.deepEqual(
          summary.charges.map((charge) => charge.cashPaidPaise),
          [10000, 5000],
        );
        assert.equal(summary.points.available, 1500);
      }
      if (id === 'redemption') {
        assert.equal(summary.points.redeemed, 1000);
        assert.equal(summary.outstandingPaise, 9000);
      }
      if (id === 'spent-return') {
        assert.equal(summary.points.clawbackPending, 1000);
        assert.equal(summary.points.available, 0);
        assert.equal(summary.creditsOpenPaise, 10000);
      }
      if (id === 'credit-settlement') {
        assert.equal(summary.creditsOpenPaise, 0);
        assert.equal(summary.outstandingPaise, 2000);
        assert.equal(summary.points.available, 0);
      }
      if (id === 'shipment-correction') {
        const detail = crm.detail(order.id);
        assert.equal(detail.revisions.length, 2);
        assert.equal(detail.shipments[0]?.lines.length, 1);
        assert.equal(detail.shipments[0]?.lines[0]?.dispatched_qty, 1);
        assert.equal(
          detail.shipments[1]?.original_shipment_id,
          detail.shipments[0]?.id,
        );
        assert.equal(summary.netBalancePaise, 35000);
      }
      if (id === 'receipt-retry') {
        assert.equal(summary.receivedPaise, 10000);
        assert.deepEqual(report.steps[0]?.result, report.steps[1]?.result);
      }
      if (id === 'competing-returns') {
        assert.equal(crm.detail(order.id).lines[0]?.returned, 1);
        assert.equal(report.steps.at(-1)?.result.status, 'CONFLICT');
      }
    });

  it('accepts advances without charges and allocates them at delivery', () => {
    const customer = crm.createCustomer(admin, {
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
    assert.equal(crm.summary(customer.id).unappliedCashPaise, 15000);
    assert.equal(crm.summary(customer.id).charges.length, 0);
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
        items: [{ lineKey: crm.detail(orderId).lines[0]!.lineKey, qty: 1 }],
      },
    });
    const shipmentId = loaded.references.shipmentId!;
    run({ type: 'DISPATCH_SHIPMENT', payload: { orderId, shipmentId } });
    const line = crm.detail(orderId).shipments[0]!.lines[0]!;
    run({
      type: 'CONFIRM_DELIVERY',
      payload: {
        orderId,
        shipmentId,
        items: [{ shipmentLineId: line.id, qty: 1 }],
      },
    });
    const summary = crm.summary(customer.id);
    check(summary);
    assert.equal(summary.unappliedCashPaise, 5000);
    assert.equal(summary.points.available, 1000);
  });

  it('handles partial payments, partial returns, refund limits, and credit reversals', () => {
    const report = crm.scenario('customer-payment', admin);
    const customerId = report.customerId;
    const first = crm
      .bootstrap(admin)
      .orders.filter((order) => order.customer_id === customerId)
      .at(-1)!;
    const line = crm.detail(first.id).shipments[0]!.lines[0]!;
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
    const note = crm
      .summary(customerId)
      .credits.find((row) => row.id === credit)!;
    assert.equal(note.amount_paise, 8000);
    const before = crm.summary(customerId);
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
    assert.deepEqual(crm.summary(customerId), before);
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
    check(crm.summary(customerId));
    assert.equal(crm.summary(customerId).creditsOpenPaise, 5000);
  });

  it('rejects over-delivery, over-return, loading too many units, duplicate lines and stale approval without mutation', () => {
    const report = reports.get('partial-delivery')!;
    const order = crm
      .bootstrap(admin)
      .orders.find((row) => row.customer_id === report.customerId)!;
    const detail = crm.detail(order.id);
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
      const before = crm.detail(order.id),
        ledger = crm.ledger(report.customerId);
      const result = run(command);
      assert.equal(result.status, 'REJECTED');
      assert.deepEqual(crm.detail(order.id), before);
      assert.deepEqual(crm.ledger(report.customerId), ledger);
      assert.equal(result.effects.length, 0);
    }
  });

  it('serializes two HTTP return requests and rejects forged actors', async () => {
    const report = crm.scenario('second-delivery', admin);
    const order = crm
      .bootstrap(admin)
      .orders.find((row) => row.customer_id === report.customerId)!;
    const line = crm.detail(order.id).shipments[0]!.lines[0]!;
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
    const sales = crm
      .bootstrap(admin)
      .actors.find((actor) => actor.role === 'SALES')!;
    assert.throws(() =>
      crm.execute(
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
    const report = reports.get('shipment-correction')!;
    const customerId = report.customerId;
    const key = randomUUID();
    const version = crm.summary(customerId).customer.version;
    const one = crm.execute(
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
    const two = crm.execute(
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
    const result = crm.execute(
      {
        command: { type: 'ALLOCATE_PAYMENT', payload: { customerId } },
        idempotencyKey: randomUUID(),
      },
      admin,
    );
    assert.equal(result.errors[0]?.code, 'VERSION_REQUIRED');
    const dangling = database.db.all(sql`pragma foreign_key_check`);
    assert.deepEqual(dangling, []);
    check(crm.summary(customerId));
  });
  for (const [id, label] of SCENARIOS)
    it(`steps through ${label}`, () => {
      let report = crm.startSample(id, admin);
      assert.equal(report.steps.length, 0);
      for (let count = 0; count < 30 && !report.complete; count++) {
        const previous = report.steps.length;
        report = crm.advanceSample(report.runId!, admin);
        assert.ok(report.steps.length <= previous + 1);
        check(report.summary);
      }
      assert.equal(report.complete, true);
      const before = crm.ledger(report.customerId);
      const repeated = crm.advanceSample(report.runId!, admin, true);
      assert.equal(repeated.steps.length, report.steps.length);
      assert.deepEqual(crm.ledger(report.customerId), before);
    });
  it('restores an applied credit when the later goods are returned', () => {
    const report = crm.scenario('credit-settlement', admin);
    const newer = crm
      .bootstrap(admin)
      .orders.find((order) => order.customer_id === report.customerId)!;
    const line = crm.detail(newer.id).shipments[0]!.lines[0]!;
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
    const value = crm.summary(report.customerId);
    check(value);
    assert.equal(value.creditsOpenPaise, 8000);
    assert.equal(value.outstandingPaise, 0);
    assert.equal(value.receivedPaise, 10000);
    assert.equal(value.points.available, 0);
    assert.ok(
      crm
        .ledger(report.customerId)
        .creditApplications.some((row) => Number(row.amount_paise) < 0),
    );
  });

  it('restores redeemed points when their settlement charge is returned', () => {
    const report = crm.scenario('redemption', admin);
    const newer = crm
      .bootstrap(admin)
      .orders.find((order) => order.customer_id === report.customerId)!;
    const line = crm.detail(newer.id).shipments[0]!.lines[0]!;
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
    const value = crm.summary(report.customerId);
    check(value);
    assert.equal(value.points.available, 1000);
    assert.equal(value.points.redeemed, 0);
    assert.equal(value.creditsOpenPaise, 0);
    assert.equal(value.netBalancePaise, 0);
    assert.ok(
      crm
        .ledger(report.customerId)
        .redemptions.some((row) => Number(row.points) < 0),
    );
  });

  it('keeps exact paise and rounds proportional awards down for partial returns', () => {
    const customer = crm.createCustomer(admin, {
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
        items: [{ lineKey: crm.detail(orderId).lines[0]!.lineKey, qty: 2 }],
      },
    }).references.shipmentId!;
    run({ type: 'DISPATCH_SHIPMENT', payload: { orderId, shipmentId } });
    const line = crm.detail(orderId).shipments[0]!.lines[0]!;
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
    const first = crm.summary(customer.id);
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
    const second = crm.summary(customer.id);
    check(second);
    assert.equal(second.netBalancePaise, -100);
    assert.equal(second.creditsOpenPaise, 100);
    assert.equal(second.points.available, 0);
    assert.equal(crm.detail(orderId).lines[0]?.delivered, 2);
  });

  it('voids pending loading documents after a correction and keeps original dispatch evidence', () => {
    const report = crm.scenario('partial-delivery', admin);
    const order = crm
      .bootstrap(admin)
      .orders.find((row) => row.customer_id === report.customerId)!;
    const detail = crm.detail(order.id);
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
    const changed = crm.detail(order.id);
    assert.equal(JSON.stringify(changed.shipments[0]), old);
    assert.equal(
      changed.shipments.find((row) => row.id === loading)?.status,
      'VOIDED',
    );
    assert.equal(crm.summary(report.customerId).netBalancePaise, 250000);
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
    check(crm.summary(report.customerId));
  });
});
