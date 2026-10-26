import 'reflect-metadata';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
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

  it('reopens saved workflows from a separate database connection without replaying actions', () => {
    const started = crm.startSample('credit-settlement', admin);
    let current = crm.advanceSample(started.runId!, admin);
    current = crm.advanceSample(started.runId!, admin);
    const before = crm.ledger(current.customerId);
    const versions = crm.summary(current.customerId).customer.version;
    const connection = new DatabaseService(app.get(ConfigService));
    try {
      const restored = new CrmService(connection, app.get(ConfigService));
      const report = restored.sampleReport(started.runId!, admin);
      assert.deepEqual(report, current);
      assert.deepEqual(restored.ledger(current.customerId), before);
      assert.equal(
        restored.summary(current.customerId).customer.version,
        versions,
      );
      const saved = restored
        .savedSamples(admin)
        .find((row) => row.id === started.runId);
      assert.equal(saved?.stepCount, 2);
      assert.equal(saved?.complete, false);
      const completed = restored.advanceSample(started.runId!, admin, true);
      assert.equal(completed.complete, true);
      assert.equal(completed.summary.outstandingPaise, 2000);
      assert.deepEqual(restored.sampleReport(started.runId!, admin), completed);
      check(crm.summary(current.customerId));
    } finally {
      connection.onModuleDestroy();
    }
  });

  it('restricts saved workflow access to its initiating administrator', async () => {
    const started = crm.startSample('receipt-retry', admin);
    const other = await app.get(UsersService).create({
      name: 'Other Admin',
      email: 'other-ops@example.test',
      password: 'other-operations-password',
      role: 'ADMIN',
    });
    assert.ok(!crm.savedSamples(other).some((row) => row.id === started.runId));
    assert.throws(
      () => crm.sampleReport(started.runId!, other),
      /another staff member/,
    );
    assert.throws(
      () => crm.advanceSample(started.runId!, other),
      /another staff member/,
    );
    const sales = crm
      .bootstrap(admin)
      .actors.find((row) => row.role === 'SALES')!;
    assert.throws(() => crm.savedSamples(sales), /local administrators/);
    assert.throws(
      () => crm.sampleReport(started.runId!, sales),
      /local administrators/,
    );
    assert.throws(() => crm.sampleReport(randomUUID(), admin), /not found/);
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'operations-test-password' })
      .expect(200);
    const cookie = (
      login.headers['set-cookie'] as unknown as string[]
    )[0]!.split(';')[0]!;
    await request(app.getHttpServer())
      .get('/api/crm/samples')
      .set('Cookie', cookie)
      .expect(200);
    const read = await request(app.getHttpServer())
      .get(`/api/crm/samples/${started.runId}`)
      .set('Cookie', cookie)
      .expect(200);
    assert.equal((read.body as ScenarioReport).steps.length, 0);
    await request(app.getHttpServer()).get('/api/crm/samples').expect(401);
  });
  it('conserves money, quantities, and points through varied delivery and settlement histories', () => {
    let seed = 1879461;
    const pick = (limit: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % limit;
    };
    let appliedCount = 0;
    for (let caseIndex = 0; caseIndex < 40; caseIndex++) {
      const customer = crm.createCustomer(admin, {
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
        const value = crm.summary(customer.id);
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
            ? crm.detail(payload.orderId).order.version
            : crm.summary(payload.customerId).customer.version;
        last = { command, expectedVersion, idempotencyKey: randomUUID() };
        const result = crm.execute(last, admin);
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
            { lineKey: crm.detail(first).lines[0]!.lineKey, qty: qty - 1 },
          ],
        },
      }).references.shipmentId!;
      apply({
        type: 'DISPATCH_SHIPMENT',
        payload: { orderId: first, shipmentId: loaded },
      });
      const shippedLine = crm.detail(first).shipments[0]!.lines[0]!;
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
          items: [{ lineKey: crm.detail(second).lines[0]!.lineKey, qty: 1 }],
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
              shipmentLineId: crm.detail(second).shipments[0]!.lines[0]!.id,
              qty: 1,
            },
          ],
        },
      });
      const summary = crm.summary(customer.id);
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
      const credited = crm.summary(customer.id);
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
      const before = crm.ledger(customer.id),
        detail = crm.detail(first),
        version = crm.summary(customer.id).customer.version;
      assert.equal(crm.execute(last!, admin).status, 'APPLIED');
      assert.deepEqual(crm.ledger(customer.id), before);
      assert.equal(crm.summary(customer.id).customer.version, version);
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
      assert.deepEqual(crm.ledger(customer.id), before);
      assert.deepEqual(crm.detail(first), detail);
      verify();
    }
    assert.ok(appliedCount >= 600);
  });
  it('reverses settlements with bounded compensating entries and retains original evidence', () => {
    const report = crm.scenario('credit-settlement', admin);
    const customerId = report.customerId;
    const original = crm
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
    const version = crm.summary(customerId).customer.version;
    const key = randomUUID();
    const reversed = run(command, admin, version, key);
    assert.equal(reversed.status, 'APPLIED');
    assert.deepEqual(run(command, admin, version, key), reversed);
    let summary = crm.summary(customerId);
    assert.equal(summary.creditsOpenPaise, 3000);
    assert.equal(summary.outstandingPaise, 5000);
    assert.deepEqual(
      crm
        .ledger(customerId)
        .creditApplications.find((row) => row.id === original.id),
      originalCopy,
    );
    const before = crm.ledger(customerId);
    assert.equal(
      run({ ...command, payload: { ...command.payload, amountPaise: 8000 } })
        .status,
      'REJECTED',
    );
    assert.deepEqual(crm.ledger(customerId), before);
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
    const refundRow = crm
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
    const refundedNet = crm.summary(customerId).netBalancePaise;
    assert.equal(run(reverseRefund).status, 'APPLIED');
    summary = crm.summary(customerId);
    assert.equal(summary.refundsPaise, 2000);
    assert.equal(summary.creditsOpenPaise, 1000);
    assert.equal(summary.netBalancePaise, refundedNet - 1000);
    assert.deepEqual(
      crm.ledger(customerId).refunds.find((row) => row.id === refundRow.id),
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
    assert.equal(crm.summary(customerId).refundsPaise, 0);
    assert.equal(run(reverseRefund).status, 'REJECTED');
    const otherCustomer = crm.createCustomer(admin, {
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
    const warehouse = crm
      .bootstrap(admin)
      .actors.find((user) => user.role === 'WAREHOUSE')!;
    assert.equal(run(command, warehouse).errors[0]?.code, 'FORBIDDEN');
    check(crm.summary(customerId));
  });

  it('cancels selected unshipped quantities and preserves other demand and dispatched history', () => {
    const report = crm.scenario('partial-delivery', admin);
    const customerId = report.customerId;
    const order = crm
      .bootstrap(admin)
      .orders.find((row) => row.customer_id === customerId)!;
    const before = crm.detail(order.id);
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
    const detail = crm.detail(order.id);
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
    assert.deepEqual(crm.detail(order.id), detail);
    check(crm.summary(customerId));
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
          items: [{ lineKey: crm.detail(id).lines[0]!.lineKey, qty: 2 }],
        },
      }).status,
      'APPLIED',
    );
    assert.equal(crm.detail(id).order.status, 'DRAFT');
    assert.equal(crm.detail(id).lines[0]!.open, 3);
    assert.equal(
      run({
        type: 'CANCEL_REMAINDER',
        payload: { orderId: id, reason: 'Cancel the remaining draft' },
      }).status,
      'APPLIED',
    );
    assert.equal(crm.detail(id).order.status, 'CANCELLED');
  });
  it('records causal posting evidence, snapshots, and checks without replaying activities', () => {
    const report = crm.scenario('paid-return', admin);
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
    const version = crm.summary(customerId).customer.version;
    const ledger = crm.ledger(customerId);
    const snapshot = crm.snapshot(customerId);
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
    assert.deepEqual(crm.ledger(customerId), ledger);
    assert.equal(crm.summary(customerId).customer.version, version);
    assert.deepEqual(crm.trace(last.actionId, admin), last);
  });

  it('reports inconsistent evidence and rolls back a subsequent activity atomically', () => {
    const report = crm.scenario('customer-payment', admin);
    const customerId = report.customerId;
    const charge = crm.summary(customerId).charges[0]!;
    const stop = new Error('Rollback the deliberately altered test record');
    assert.throws(
      () =>
        database.db.transaction(() => {
          database.db.run(
            sql`update receivable_entries set amount_paise=amount_paise+1 where id=${charge.id}`,
          );
          assert.ok(
            crm
              .review(customerId)
              .checks.some(
                (check) => !check.passed && check.id === 'recognized-value',
              ),
          );
          const before = crm.ledger(customerId);
          const summary = crm.summary(customerId);
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
          assert.deepEqual(crm.ledger(customerId), before);
          assert.deepEqual(crm.summary(customerId), summary);
          throw stop;
        }),
      (error) => error === stop,
    );
    assert.ok(crm.review(customerId).checks.every((check) => check.passed));
  });
});
