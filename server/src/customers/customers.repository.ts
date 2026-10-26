import { Injectable, Module } from '@nestjs/common';
import { and, asc, eq, ne } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { recordInsert, recordUpdate, fail } from '../common/domain.js';
import type { ActionContext } from '../common/domain.js';
import { crmCustomers } from '../customers/customers.model.js';

@Injectable()
export class CustomersRepository {
  constructor(private readonly database: DatabaseService) {}
  private get db() {
    return this.database.db;
  }
  findById(id: string) {
    return this.db
      .select()
      .from(crmCustomers)
      .where(eq(crmCustomers.id, id))
      .get();
  }
  findOtherByCode(code: string, id: string) {
    return this.db
      .select()
      .from(crmCustomers)
      .where(and(eq(crmCustomers.code, code), ne(crmCustomers.id, id)))
      .get();
  }
  list() {
    return this.db
      .select()
      .from(crmCustomers)
      .orderBy(asc(crmCustomers.name))
      .all();
  }
  findByCode(code: string) {
    return this.db
      .select()
      .from(crmCustomers)
      .where(eq(crmCustomers.code, code))
      .get();
  }
  insertCustomer(c: ActionContext, row: typeof crmCustomers.$inferInsert) {
    this.db.insert(crmCustomers).values(row).run();
    recordInsert(c, 'customers', row, false);
  }
  updateCustomer(
    c: ActionContext,
    id: string,
    patch: Partial<Omit<typeof crmCustomers.$inferInsert, 'id'>>,
  ) {
    const before = this.db
      .select()
      .from(crmCustomers)
      .where(eq(crmCustomers.id, id))
      .get();
    if (!before) fail('NOT_FOUND', 'Record not found');
    this.db
      .update(crmCustomers)
      .set(patch)
      .where(eq(crmCustomers.id, id))
      .run();
    recordUpdate(c, 'customers', before, { ...before, ...patch });
  }
}
@Module({
  imports: [DatabaseModule],
  providers: [CustomersRepository],
  exports: [CustomersRepository],
})
export class CustomersRepositoryModule {}
