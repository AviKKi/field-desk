import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { CustomersRepositoryModule } from '../customers/customers.repository.js';
import { CatalogRepositoryModule } from '../catalog/catalog.repository.js';
import { UsersRepositoryModule } from '../users/users.repository.js';
import { OrdersModule } from '../orders/orders.module.js';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { CrmQueriesController } from './crm-queries.controller.js';
import { CrmQueriesService } from './crm-queries.service.js';

@Module({
  imports: [
    DatabaseModule,
    CustomersRepositoryModule,
    CatalogRepositoryModule,
    UsersRepositoryModule,
    OrdersModule,
    AccountsModule,
    AuditModule,
  ],
  controllers: [CrmQueriesController],
  providers: [CrmQueriesService],
})
export class CrmQueriesModule {}
