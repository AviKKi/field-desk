import { it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

it('upgrades existing funded settlements without losing original records', () => {
  const directory = mkdtempSync(join(tmpdir(), 'crm-migration-'));
  const sqlite = new Database(join(directory, 'upgrade.db'));
  try {
    sqlite.pragma('foreign_keys = ON');
    const previous = join(directory, 'previous');
    mkdirSync(join(previous, 'meta'), { recursive: true });
    const journal = JSON.parse(
      readFileSync(resolve('drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };
    journal.entries = journal.entries.filter((entry) => entry.idx < 3);
    for (const entry of journal.entries)
      cpSync(
        resolve(`drizzle/${entry.tag}.sql`),
        join(previous, `${entry.tag}.sql`),
      );
    writeFileSync(
      join(previous, 'meta/_journal.json'),
      JSON.stringify(journal),
    );
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: previous });
    sqlite.exec(`
      insert into customers values ('c','UPGRADE','Existing customer',4);
      insert into orders values ('o','SO-OLD','c','APPROVED',1,4,'2026-10-01');
      insert into receivable_entries values ('charge','c','o',null,null,'RETURN_FEE',2000,null,'source','old-action','2026-10-01');
      insert into payment_receipts values ('receipt','c',10000,'BANK-ORIGINAL','old-action','2026-10-01');
      insert into credit_notes values ('note','c',null,5000,'Existing credit','old-action','2026-10-01');
      insert into credit_funds values ('fund','note','receipt',5000);
      insert into credit_applications values ('application','c','note','charge',1000,'old-action','2026-10-01');
      insert into credit_refunds values ('refund','c','note','receipt',2000,'BANK-REFUND','old-action','2026-10-01');
      insert into sample_runs values ('old-run','partial-delivery','c','previous-admin',0,'2026-10-01');
      insert into sample_steps values ('old-step','old-run',0,'Create order','{}','{}');
    `);
    const tables = [
      'customers',
      'orders',
      'payment_receipts',
      'credit_notes',
      'credit_funds',
      'credit_applications',
      'credit_refunds',
    ];
    const originals = new Map(
      tables.map((table) => [
        table,
        sqlite.prepare(`select * from ${table}`).all() as Record<
          string,
          unknown
        >[],
      ]),
    );
    migrate(db, { migrationsFolder: resolve('drizzle') });
    migrate(db, { migrationsFolder: resolve('drizzle') });
    for (const [table, rows] of originals) {
      const actual = sqlite.prepare(`select * from ${table}`).all() as Record<
        string,
        unknown
      >[];
      for (const row of rows) {
        const upgraded = actual.find((entry) => entry.id === row.id)!;
        for (const key of Object.keys(row))
          assert.deepEqual(upgraded[key], row[key], `${table}.${key}`);
      }
      assert.equal(actual.length, rows.length);
    }
    assert.equal(
      (
        sqlite.prepare('select reversal_of_id from credit_refunds').get() as {
          reversal_of_id: unknown;
        }
      ).reversal_of_id,
      null,
    );
    sqlite.exec(
      `insert into credit_refunds values ('reverse-refund','c','note','receipt',-500,'refund','Bank transfer returned','BANK-RETURN','new-action','2026-10-26')`,
    );
    assert.deepEqual(
      sqlite
        .prepare(
          "select name from sqlite_master where type='table' and name in ('sample_runs','sample_steps')",
        )
        .all(),
      [],
    );
    assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
    assert.equal(
      (
        sqlite
          .prepare('select sum(amount_paise) n from credit_refunds')
          .get() as { n: number }
      ).n,
      1500,
    );
  } finally {
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
