import { randomUUID, scryptSync } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { users } from '../users/users.model.js';
import { crmSkus } from '../catalog/catalog.model.js';
import { crmCustomers } from '../customers/customers.model.js';
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
      if (
        !database.db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, id))
          .get()
      ) {
        const salt = Buffer.from(randomUUID().replaceAll('-', ''), 'hex');
        const hash = scryptSync(randomUUID(), salt, 64, {
          N: 32768,
          r: 8,
          p: 1,
          maxmem: 67108864,
        });
        database.db
          .insert(users)
          .values({
            id,
            name,
            email: `sample-${role.toLowerCase()}@example.test`,
            passwordHash: `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`,
            role,
            active: true,
            createdAt: now,
          })
          .run();
      }
    }
    for (const [id, code, name, price, points] of [
      ['sku-a', 'SKU-A', 'Everyday blend', 10000, 1000],
      ['sku-b', 'SKU-B', 'Premium blend', 15000, 1200],
      ['sku-c', 'SKU-C', 'Reserve blend', 25000, 2000],
    ] as const)
      if (
        !database.db
          .select({ id: crmSkus.id })
          .from(crmSkus)
          .where(eq(crmSkus.id, id))
          .get()
      )
        database.db
          .insert(crmSkus)
          .values({
            id,
            code,
            name,
            price_paise: price,
            points_per_unit: points,
          })
          .run();
    for (const [id, code, name] of [
      ['customer-north', 'NORTH-01', 'Northside Stores'],
      ['customer-river', 'RIVER-02', 'Riverside Retail'],
      ['customer-central', 'CENTRAL-03', 'Central Trading'],
    ] as const)
      if (
        !database.db
          .select({ id: crmCustomers.id })
          .from(crmCustomers)
          .where(eq(crmCustomers.id, id))
          .get()
      )
        database.db
          .insert(crmCustomers)
          .values({ id, code, name, version: 0 })
          .run();
  });
}
