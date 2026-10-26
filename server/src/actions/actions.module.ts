import { Module } from '@nestjs/common';
import { ActionsService } from './actions.service.js';
import { ActionsController } from './actions.controller.js';
import { UsersRepositoryModule } from '../users/users.repository.js';
import { ActionsRepositoryModule } from '../actions/actions.repository.js';
import { OrdersRepositoryModule } from '../orders/orders.repository.js';
import { CustomersRepositoryModule } from '../customers/customers.repository.js';
import { CustomersModule } from '../customers/customers.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { ReturnsModule } from '../returns/returns.module.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { RewardsModule } from '../rewards/rewards.module.js';
import { CreditsModule } from '../credits/credits.module.js';
import { AuditRepositoryModule } from '../audit/audit.repository.js';
import { AuditModule } from '../audit/audit.module.js';
@Module({
  imports: [
    UsersRepositoryModule,
    ActionsRepositoryModule,
    OrdersRepositoryModule,
    CustomersRepositoryModule,
    CustomersModule,
    OrdersModule,
    FulfillmentModule,
    ReturnsModule,
    AccountsModule,
    RewardsModule,
    CreditsModule,
    AuditRepositoryModule,
    AuditModule,
  ],
  controllers: [ActionsController],
  providers: [ActionsService],
  exports: [ActionsService],
})
export class ActionsModule {}
