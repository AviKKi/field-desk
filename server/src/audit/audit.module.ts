import { Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { AuditController } from './audit.controller.js';
import { AccountsRepositoryModule } from '../accounts/accounts.repository.js';
import { OrdersRepositoryModule } from '../orders/orders.repository.js';
import { FulfillmentRepositoryModule } from '../fulfillment/fulfillment.repository.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { RewardsRepositoryModule } from '../rewards/rewards.repository.js';
import { ReturnsRepositoryModule } from '../returns/returns.repository.js';
import { CreditsRepositoryModule } from '../credits/credits.repository.js';
import { AuditRepositoryModule } from '../audit/audit.repository.js';
import { ActionsRepositoryModule } from '../actions/actions.repository.js';
@Module({
  imports: [
    AccountsRepositoryModule,
    OrdersRepositoryModule,
    FulfillmentRepositoryModule,
    AccountsModule,
    OrdersModule,
    RewardsRepositoryModule,
    ReturnsRepositoryModule,
    CreditsRepositoryModule,
    AuditRepositoryModule,
    ActionsRepositoryModule,
  ],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
