import { Injectable, Module } from '@nestjs/common';
import { count, eq, gt } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { insertionOrder } from '../database/query-order.js';
import { recordInsert } from '../common/domain.js';
import type { ActionContext } from '../common/domain.js';
import { crmBusinessEvents } from '../audit/audit.model.js';

@Injectable()
export class AuditRepository {
  constructor(private readonly database: DatabaseService) {}
  private get db() {
    return this.database.db;
  }
  eventsForOrder(orderId: string) {
    return this.db
      .select()
      .from(crmBusinessEvents)
      .where(eq(crmBusinessEvents.order_id, orderId))
      .orderBy(insertionOrder(crmBusinessEvents))
      .all();
  }
  duplicateEvents(customerId: string) {
    return this.db
      .select({ actionId: crmBusinessEvents.action_id })
      .from(crmBusinessEvents)
      .where(eq(crmBusinessEvents.customer_id, customerId))
      .groupBy(crmBusinessEvents.action_id)
      .having(gt(count(), 1))
      .all().length;
  }
  eventsForCustomer(customerId: string) {
    return this.db
      .select()
      .from(crmBusinessEvents)
      .where(eq(crmBusinessEvents.customer_id, customerId))
      .orderBy(insertionOrder(crmBusinessEvents))
      .all();
  }
  insertEvent(c: ActionContext, row: typeof crmBusinessEvents.$inferInsert) {
    this.db.insert(crmBusinessEvents).values(row).run();
    recordInsert(c, 'business_events', row, true);
  }
}
@Module({
  imports: [DatabaseModule],
  providers: [AuditRepository],
  exports: [AuditRepository],
})
export class AuditRepositoryModule {}
