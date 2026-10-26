import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { OrdersController } from './orders.controller.js';
import { CustomersRepositoryModule } from '../customers/customers.repository.js';
import { OrdersRepositoryModule } from '../orders/orders.repository.js';
import { CatalogRepositoryModule } from '../catalog/catalog.repository.js';
import { FulfillmentRepositoryModule } from '../fulfillment/fulfillment.repository.js';
import { RewardsRepositoryModule } from '../rewards/rewards.repository.js';
import { RewardsModule } from '../rewards/rewards.module.js';
import { ReturnsRepositoryModule } from '../returns/returns.repository.js';
import { AuditRepositoryModule } from '../audit/audit.repository.js';
@Module({
  imports: [
    CustomersRepositoryModule,
    OrdersRepositoryModule,
    CatalogRepositoryModule,
    FulfillmentRepositoryModule,
    RewardsRepositoryModule,
    RewardsModule,
    ReturnsRepositoryModule,
    AuditRepositoryModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
