import { Injectable } from '@nestjs/common';
import type { User } from '@crm/shared';
import { DatabaseService } from '../database/database.service.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { CatalogRepository } from '../catalog/catalog.repository.js';
import { UsersRepository } from '../users/users.repository.js';
@Injectable()
export class CrmRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly customers: CustomersRepository,
    private readonly catalog: CatalogRepository,
    private readonly users: UsersRepository,
  ) {}
  referenceData(user: User) {
    return {
      customers: this.customers.list(),
      skus: this.catalog.list(),
      actors: user.role === 'ADMIN' ? this.users.listActive() : [user],
    };
  }
  read<T>(work: () => T) {
    return this.database.db.transaction(work);
  }
}
