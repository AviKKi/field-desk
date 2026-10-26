import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { and, asc, eq } from 'drizzle-orm';
import { users } from '../users/users.model.js';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../database/database.service.js';
import { UsersService } from '../users/users.service.js';
import { ActionsService } from '../actions/actions.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AuditService } from '../audit/audit.service.js';
import { UsersRepository } from '../users/users.repository.js';
import { CatalogRepository } from '../catalog/catalog.repository.js';
import { seedDevelopmentData } from './seed-data.js';

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error', 'warn'],
});
try {
  const account = app
    .get(DatabaseService)
    .db.select({ id: users.id })
    .from(users)
    .where(and(eq(users.active, true), eq(users.role, 'ADMIN')))
    .orderBy(asc(users.createdAt))
    .limit(1)
    .get();
  if (!account)
    throw new Error('Create an admin with pnpm admin:create first.');
  const user = app.get(UsersService).findById(account.id)!;
  const data = seedDevelopmentData(
    app.get(DatabaseService),
    {
      actions: app.get(ActionsService),
      customers: app.get(CustomersService),
      orders: app.get(OrdersService),
      accounts: app.get(AccountsService),
      audit: app.get(AuditService),
      users: app.get(UsersRepository),
      catalog: app.get(CatalogRepository),
    },
    user,
  );
  const seededIds = new Set(data.orders.map((order) => order.id));
  const states: Record<string, number> = {};
  for (const order of app
    .get(OrdersService)
    .list()
    .filter((row) => seededIds.has(row.id))) {
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
