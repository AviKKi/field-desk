import { randomUUID, scryptSync } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { User } from '@crm/shared';
import type { DatabaseService } from '../database/database.service.js';

export function seedReferenceData(database: DatabaseService, admin: User) {
  if (admin.role !== 'ADMIN' || process.env.NODE_ENV === 'production')
    throw new Error('Data seeding is available to local administrators only.');
  database.db.transaction(() => {
    const now = new Date().toISOString();
    for (const [suffix, role, name] of [
      ['1', 'SALES', 'Sales desk'],
      ['2', 'KAM', 'Commercial desk'],
      ['3', 'WAREHOUSE', 'Warehouse desk'],
      ['4', 'ACCOUNTS', 'Accounts desk'],
    ] as const) {
      const id = `00000000-0000-4000-8000-00000000000${suffix}`;
      if (!database.db.get(sql`select id from users where id=${id}`)) {
        const salt = Buffer.from(randomUUID().replaceAll('-', ''), 'hex');
        const hash = scryptSync(randomUUID(), salt, 64, {
          N: 32768,
          r: 8,
          p: 1,
          maxmem: 67108864,
        });
        database.db.run(
          sql`insert into users(id,name,email,password_hash,role,active,created_at) values (${id},${name},${`sample-${role.toLowerCase()}@example.test`},${`scrypt$${salt.toString('hex')}$${hash.toString('hex')}`},${role},1,${now})`,
        );
      }
    }
    for (const [id, code, name, price, points] of [
      ['sku-a', 'SKU-A', 'Everyday blend', 10000, 1000],
      ['sku-b', 'SKU-B', 'Premium blend', 15000, 1200],
      ['sku-c', 'SKU-C', 'Reserve blend', 25000, 2000],
    ] as const)
      if (!database.db.get(sql`select id from skus where id=${id}`))
        database.db.run(
          sql`insert into skus(id,code,name,price_paise,points_per_unit) values (${id},${code},${name},${price},${points})`,
        );
    for (const [id, code, name] of [
      ['customer-north', 'NORTH-01', 'Northside Stores'],
      ['customer-river', 'RIVER-02', 'Riverside Retail'],
      ['customer-central', 'CENTRAL-03', 'Central Trading'],
    ] as const)
      if (!database.db.get(sql`select id from customers where id=${id}`))
        database.db.run(
          sql`insert into customers(id,code,name,version) values (${id},${code},${name},0)`,
        );
  });
}
