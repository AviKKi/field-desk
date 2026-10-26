import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller.js';
import { CrmService } from './crm.service.js';
import { CrmRepository } from './crm.repository.js';
import { ActionsModule } from '../actions/actions.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { ReturnsModule } from '../returns/returns.module.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { CreditsModule } from '../credits/credits.module.js';
import { RewardsModule } from '../rewards/rewards.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { CustomersRepositoryModule } from '../customers/customers.repository.js';
import { CatalogRepositoryModule } from '../catalog/catalog.repository.js';
import { UsersRepositoryModule } from '../users/users.repository.js';
@Module({
  imports: [
    ActionsModule,
    CustomersModule,
    OrdersModule,
    FulfillmentModule,
    ReturnsModule,
    AccountsModule,
    CreditsModule,
    RewardsModule,
    CatalogModule,
    AuditModule,
    CustomersRepositoryModule,
    CatalogRepositoryModule,
    UsersRepositoryModule,
  ],
  controllers: [CrmController],
  providers: [CrmService, CrmRepository],
  exports: [CrmService],
})
export class CrmModule {}
