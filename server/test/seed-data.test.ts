import 'reflect-metadata';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplicationContext } from '@nestjs/common';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { sql } from 'drizzle-orm';
import type { User } from '@crm/shared';
import { DatabaseService } from '../src/database/database.service.js';
import { UsersService } from '../src/users/users.service.js';
import { CrmService } from '../src/crm/crm.service.js';
import { seedDevelopmentData } from '../src/scripts/seed-data.js';
import type { SeedSummary } from '../src/scripts/seed-data.js';

const directory = mkdtempSync(join(tmpdir(), 'crm-seed-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = join(directory, 'seed.db');
process.env.JWT_SECRET = 'seed-test-secret-'.repeat(4);
process.env.CLIENT_ORIGIN = 'http://localhost:5173';

describe('Local CRM dataset', { concurrency: false }, () => {
  let app: INestApplicationContext,
    database: DatabaseService,
    crm: CrmService,
    admin: User;
  let seeded: SeedSummary;
  before(async () => {
    const { AppModule } = await import('../src/app.module.js');
    app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await app.init();
    database = app.get(DatabaseService);
    migrate(database.db, { migrationsFolder: resolve('drizzle') });
    crm = app.get(CrmService);
    admin = await app.get(UsersService).create({
      name: 'Seed Administrator',
      email: 'seed@example.test',
      password: 'seed-test-passphrase',
      role: 'ADMIN',
    });
  });
  after(async () => {
    if (app) await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  function counts() {
    return Object.fromEntries(
      [
        'customers',
        'orders',
        'order_revisions',
        'approvals',
        'shipments',
        'shipment_lines',
        'deliveries',
        'returns',
        'payment_receipts',
        'credit_notes',
        'credit_applications',
        'credit_refunds',
        'reward_ledger',
        'business_events',
        'action_requests',
        'seed_history',
      ]
        .map((table) => [
          table,
          database.sqlite.prepare(`select count(*) n from ${table}`).get() as {
            n: number;
          },
        ])
        .map(([table, row]) => [table, (row as { n: number }).n]),
    );
  }
  it('populates ordinary records covering approval, fulfillment, finance, and rewards states', () => {
    const result = seedDevelopmentData(database, crm, admin);
    seeded = result;
    assert.equal(result.alreadyPresent, false);
    assert.equal(result.customers.length, 10);
    assert.equal(result.orders.length, 24);
    const ids = new Set(result.orders.map((order) => order.id));
    const orders = crm
      .bootstrap(admin)
      .orders.filter((order) => ids.has(order.id));
    assert.deepEqual([...new Set(orders.map((order) => order.status))].sort(), [
      'APPROVED',
      'CANCELLED',
      'DRAFT',
      'PENDING',
      'REAPPROVAL_REQUIRED',
      'REJECTED',
    ]);
    assert.deepEqual(
      [...new Set(orders.map((order) => order.fulfillmentStatus))].sort(),
      [
        'CANCELLED',
        'DELIVERED',
        'DISPATCHED',
        'LOADING',
        'PARTIALLY_DELIVERED',
        'PARTIALLY_DISPATCHED',
        'UNFULFILLED',
      ],
    );
    for (const order of orders) {
      const lines = crm.detail(order.id).lines;
      const active = lines.reduce(
        (sum, line) => sum + line.qty - line.canceled,
        0,
      );
      const delivered = lines.reduce((sum, line) => sum + line.delivered, 0);
      if (order.fulfillmentStatus === 'DELIVERED')
        assert.equal(delivered, active);
      if (order.fulfillmentStatus === 'PARTIALLY_DELIVERED')
        assert.ok(delivered > 0 && delivered < active);
      if (order.fulfillmentStatus === 'LOADING')
        assert.ok(lines.some((line) => line.loaded > 0));
      if (order.fulfillmentStatus === 'DISPATCHED')
        assert.equal(
          lines.reduce((sum, line) => sum + line.dispatched, 0),
          active,
        );
    }
    const accounts = result.customers.map((customer) =>
      crm.summary(customer.id),
    );
    assert.ok(accounts.some((account) => account.unappliedCashPaise > 0));
    assert.ok(accounts.some((account) => account.outstandingPaise > 0));
    assert.ok(accounts.some((account) => account.creditsOpenPaise > 0));
    assert.ok(accounts.some((account) => account.points.available > 0));
    assert.ok(accounts.some((account) => account.points.locked > 0));
    assert.ok(accounts.some((account) => account.points.redeemed > 0));
    assert.ok(accounts.some((account) => account.points.clawbackPending > 0));
    for (const customer of result.customers)
      assert.ok(
        crm.review(customer.id).checks.every((check) => check.passed),
        customer.code,
      );
    const tables = counts();
    for (const table of [
      'returns',
      'credit_notes',
      'credit_applications',
      'credit_refunds',
    ])
      assert.ok(tables[table]! > 0, table);
    assert.deepEqual(
      database.sqlite
        .prepare(
          "select name from sqlite_master where type='table' and name in ('sample_runs','sample_steps')",
        )
        .all(),
      [],
    );
    assert.deepEqual(database.sqlite.pragma('foreign_key_check'), []);
  });

  it('does not duplicate data or rewind user changes when seeded again by another administrator', async () => {
    const customerId = seeded.customers[0]!.id;
    const result = crm.execute(
      {
        command: {
          type: 'UPDATE_CUSTOMER',
          payload: {
            customerId,
            name: 'Updated after seeding',
            code: seeded.customers[0]!.code,
          },
        },
        expectedVersion: crm.summary(customerId).customer.version,
        idempotencyKey: 'seed-customer-edit',
      },
      admin,
    );
    assert.equal(result.status, 'APPLIED');
    const added = crm.createCustomer(admin, {
      name: 'User-created account',
      code: 'MANUAL-ACCOUNT',
    });
    const other = await app.get(UsersService).create({
      name: 'Another Administrator',
      email: 'another-seed@example.test',
      password: 'another-test-passphrase',
      role: 'ADMIN',
    });
    const before = counts();
    const ledgers = seeded.customers.map((row) => crm.ledger(row.id));
    const again = seedDevelopmentData(database, crm, other);
    assert.equal(again.alreadyPresent, true);
    assert.deepEqual(again.orders, seeded.orders);
    assert.deepEqual(counts(), before);
    assert.equal(
      crm.summary(customerId).customer.name,
      'Updated after seeding',
    );
    assert.equal(crm.summary(added.id).customer.name, 'User-created account');
    assert.deepEqual(
      seeded.customers.map((row) => crm.ledger(row.id)),
      ledgers,
    );
  });

  it('rolls back incomplete seeding and can seed again after a deliberate local reset', () => {
    database.db.transaction(() => {
      database.db.run(sql`delete from action_requests`);
      database.db.run(sql`delete from customers`);
      database.db.run(sql`delete from seed_history`);
    });
    assert.equal(counts().seed_history, 0);
    database.db.run(sql`update users set active=0 where role='KAM'`);
    const before = counts();
    assert.throws(
      () => seedDevelopmentData(database, crm, admin),
      /active KAM/,
    );
    assert.deepEqual(counts(), before);
    database.db.run(sql`update users set active=1 where role='KAM'`);
    const result = seedDevelopmentData(database, crm, admin);
    assert.equal(result.alreadyPresent, false);
    assert.equal(result.orders.length, 24);
    assert.equal(counts().orders, 24);
    assert.equal(counts().seed_history, 1);
  });

  it('rejects production use and non-administrator callers without changes', () => {
    const previousEnvironment = process.env.NODE_ENV;
    const before = counts();
    process.env.NODE_ENV = 'production';
    try {
      assert.throws(
        () => seedDevelopmentData(database, crm, admin),
        /local administrators/,
      );
    } finally {
      process.env.NODE_ENV = previousEnvironment;
    }
    const sales = crm
      .bootstrap(admin)
      .actors.find((row) => row.role === 'SALES')!;
    assert.throws(
      () => seedDevelopmentData(database, crm, sales),
      /local administrators/,
    );
    assert.deepEqual(counts(), before);
  });
});
