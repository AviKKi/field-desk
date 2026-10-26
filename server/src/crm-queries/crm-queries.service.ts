import { Injectable } from '@nestjs/common';
import type { User } from '@crm/shared';
import type { CrmBootstrap, CustomerSnapshot } from '@crm/shared/crm';
import { DatabaseService } from '../database/database.service.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { CatalogRepository } from '../catalog/catalog.repository.js';
import { UsersRepository } from '../users/users.repository.js';
import { OrdersService } from '../orders/orders.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class CrmQueriesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly customers: CustomersRepository,
    private readonly catalog: CatalogRepository,
    private readonly users: UsersRepository,
    private readonly orders: OrdersService,
    private readonly accounts: AccountsService,
    private readonly audit: AuditService,
  ) {}

  bootstrap(user: User): CrmBootstrap {
    return this.database.db.transaction(() => ({
      customers: this.customers.list(),
      skus: this.catalog.list(),
      actors: user.role === 'ADMIN' ? this.users.listActive() : [user],
      orders: this.orders.list(),
    }));
  }

  snapshot(customerId: string): CustomerSnapshot {
    return this.database.db.transaction(() => ({
      summary: this.accounts.summary(customerId),
      orders: this.orders.forCustomer(customerId),
      ledger: this.accounts.ledger(customerId),
      timeline: this.audit.customerTimeline(customerId),
      review: this.audit.review(customerId),
    }));
  }
}
