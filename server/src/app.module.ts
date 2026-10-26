import { HealthModule } from './health/health.module.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { AuthGuard, RolesGuard } from './auth/auth.guards.js';
import { validateEnvironment } from './config/environment.js';
import { DatabaseModule } from './database/database.module.js';
import { UsersModule } from './users/users.module.js';
import { WorkspaceModule } from './workspace/workspace.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { FulfillmentModule } from './fulfillment/fulfillment.module.js';
import { ReturnsModule } from './returns/returns.module.js';
import { AccountsModule } from './accounts/accounts.module.js';
import { CreditsModule } from './credits/credits.module.js';
import { RewardsModule } from './rewards/rewards.module.js';
import { AuditModule } from './audit/audit.module.js';
import { ActionsModule } from './actions/actions.module.js';
import { CrmQueriesModule } from './crm-queries/crm-queries.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    DatabaseModule,
    UsersModule,
    AuthModule,
    WorkspaceModule,
    CustomersModule,
    CatalogModule,
    OrdersModule,
    FulfillmentModule,
    ReturnsModule,
    AccountsModule,
    CreditsModule,
    RewardsModule,
    AuditModule,
    ActionsModule,
    CrmQueriesModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
