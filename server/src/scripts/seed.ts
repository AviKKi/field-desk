import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../database/database.service.js';
import { UsersService } from '../users/users.service.js';
import { CrmService } from '../crm/crm.service.js';
import { seedDevelopmentData } from './seed-data.js';

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
try {
  const account = app
    .get(DatabaseService)
    .db.get<{ id: string }>(
      sql`select id from users where active=1 and role='ADMIN' order by created_at limit 1`,
    );
  if (!account)
    throw new Error('Create an admin with pnpm admin:create first.');
  const user = app.get(UsersService).findById(account.id)!;
  const crm = app.get(CrmService);
  const data = seedDevelopmentData(app.get(DatabaseService), crm, user);
  const seededIds = new Set(data.orders.map((order) => order.id));
  const states: Record<string, number> = {};
  for (const order of crm
    .bootstrap(user)
    .orders.filter((row) => seededIds.has(row.id))) {
    const state = `${order.status} / ${order.fulfillmentStatus}`;
    states[state] = (states[state] ?? 0) + 1;
  }
  console.log(
    `Local CRM data ${data.alreadyPresent ? 'already present' : 'created'}: ${data.customers.length} customers, ${data.orders.length} orders. Existing transactions were kept.`,
  );
  console.table(states);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Could not load sample data',
  );
  process.exitCode = 1;
} finally {
  await app.close();
}
