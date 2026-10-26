import { Injectable, Module } from '@nestjs/common';
import { eq, sum } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { insertionOrder } from '../database/query-order.js';
import { safe, recordInsert } from '../common/domain.js';
import type { ActionContext } from '../common/domain.js';
import { crmShipmentLines } from '../fulfillment/fulfillment.model.js';
import { crmReturns, crmReturnLines } from '../returns/returns.model.js';

@Injectable()
export class ReturnsRepository {
  constructor(private readonly database: DatabaseService) {}
  private get db() {
    return this.database.db;
  }
  returnedForLine(lineKey: string) {
    return safe(
      this.db
        .select({ value: sum(crmReturnLines.qty).mapWith(Number) })
        .from(crmReturnLines)
        .innerJoin(
          crmShipmentLines,
          eq(crmShipmentLines.id, crmReturnLines.shipment_line_id),
        )
        .where(eq(crmShipmentLines.line_key, lineKey))
        .get()?.value ?? 0,
    );
  }
  returnedForShipmentLine(lineId: string) {
    return safe(
      this.db
        .select({ value: sum(crmReturnLines.qty).mapWith(Number) })
        .from(crmReturnLines)
        .where(eq(crmReturnLines.shipment_line_id, lineId))
        .get()?.value ?? 0,
    );
  }
  grossForCustomer(customerId: string) {
    return safe(
      this.db
        .select({ value: sum(crmReturns.gross_paise).mapWith(Number) })
        .from(crmReturns)
        .where(eq(crmReturns.customer_id, customerId))
        .get()?.value ?? 0,
    );
  }
  feesForCustomer(customerId: string) {
    return safe(
      this.db
        .select({ value: sum(crmReturns.fee_paise).mapWith(Number) })
        .from(crmReturns)
        .where(eq(crmReturns.customer_id, customerId))
        .get()?.value ?? 0,
    );
  }
  forCustomer(customerId: string) {
    return this.db
      .select()
      .from(crmReturns)
      .where(eq(crmReturns.customer_id, customerId))
      .orderBy(insertionOrder(crmReturns))
      .all();
  }
  insertReturn(c: ActionContext, row: typeof crmReturns.$inferInsert) {
    this.db.insert(crmReturns).values(row).run();
    recordInsert(c, 'returns', row, false);
  }
  insertReturnLine(c: ActionContext, row: typeof crmReturnLines.$inferInsert) {
    this.db.insert(crmReturnLines).values(row).run();
    recordInsert(c, 'return_lines', row, false);
  }
}
@Module({
  imports: [DatabaseModule],
  providers: [ReturnsRepository],
  exports: [ReturnsRepository],
})
export class ReturnsRepositoryModule {}
