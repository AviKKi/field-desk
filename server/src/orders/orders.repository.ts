import { Injectable, Module } from '@nestjs/common';
import { and, asc, count, desc, eq, getTableColumns, sum } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { insertionOrder } from '../database/query-order.js';
import { safe, recordInsert, recordUpdate, fail } from '../common/domain.js';
import type { ActionContext } from '../common/domain.js';
import {
  crmOrders,
  crmOrderRevisions,
  crmOrderLines,
  crmApprovals,
  crmCancellations,
} from '../orders/orders.model.js';
import {
  crmShipments,
  crmShipmentLines,
  crmDeliveries,
} from '../fulfillment/fulfillment.model.js';

@Injectable()
export class OrdersRepository {
  constructor(private readonly database: DatabaseService) {}
  private get db() {
    return this.database.db;
  }
  latestLine(lineKey: string) {
    return this.db
      .select()
      .from(crmOrderLines)
      .where(eq(crmOrderLines.line_key, lineKey))
      .orderBy(desc(insertionOrder(crmOrderLines)))
      .get();
  }
  findRevision(id: string) {
    return this.db
      .select()
      .from(crmOrderRevisions)
      .where(eq(crmOrderRevisions.id, id))
      .get();
  }
  findById(id: string) {
    return this.db.select().from(crmOrders).where(eq(crmOrders.id, id)).get();
  }
  currentLines(orderId: string, revision: number) {
    return this.db
      .select(getTableColumns(crmOrderLines))
      .from(crmOrderLines)
      .innerJoin(
        crmOrderRevisions,
        eq(crmOrderRevisions.id, crmOrderLines.revision_id),
      )
      .where(
        and(
          eq(crmOrderRevisions.order_id, orderId),
          eq(crmOrderRevisions.revision, revision),
        ),
      )
      .orderBy(insertionOrder(crmOrderLines))
      .all();
  }
  forCustomer(customerId: string) {
    return this.db
      .select()
      .from(crmOrders)
      .where(eq(crmOrders.customer_id, customerId))
      .orderBy(insertionOrder(crmOrders))
      .all();
  }
  cancellationCount(orderId: string) {
    return (
      this.db
        .select({ value: count() })
        .from(crmCancellations)
        .where(eq(crmCancellations.order_id, orderId))
        .get()?.value ?? 0
    );
  }
  canceledForLine(lineKey: string) {
    return safe(
      this.db
        .select({ value: sum(crmCancellations.qty).mapWith(Number) })
        .from(crmCancellations)
        .where(eq(crmCancellations.line_key, lineKey))
        .get()?.value ?? 0,
    );
  }
  approvalCount(orderId: string, revision: number) {
    return (
      this.db
        .select({ value: count() })
        .from(crmApprovals)
        .where(
          and(
            eq(crmApprovals.order_id, orderId),
            eq(crmApprovals.revision, revision),
            eq(crmApprovals.decision, 'APPROVED'),
          ),
        )
        .get()?.value ?? 0
    );
  }
  progressRows() {
    const orders = this.db
      .select()
      .from(crmOrders)
      .orderBy(desc(crmOrders.created_at), desc(insertionOrder(crmOrders)))
      .all();
    const lines = this.db
      .select(getTableColumns(crmOrderLines))
      .from(crmOrderLines)
      .innerJoin(
        crmOrderRevisions,
        eq(crmOrderRevisions.id, crmOrderLines.revision_id),
      )
      .innerJoin(
        crmOrders,
        and(
          eq(crmOrders.id, crmOrderRevisions.order_id),
          eq(crmOrders.current_revision, crmOrderRevisions.revision),
        ),
      )
      .all();
    const cancellations = this.db
      .select(getTableColumns(crmCancellations))
      .from(crmCancellations)
      .all();
    const shipping = this.db
      .select({
        orderId: crmShipmentLines.order_id,
        loaded: crmShipmentLines.loaded_qty,
        dispatched: crmShipmentLines.dispatched_qty,
        status: crmShipments.status,
      })
      .from(crmShipmentLines)
      .innerJoin(
        crmShipments,
        eq(crmShipments.id, crmShipmentLines.shipment_id),
      )
      .all();
    const deliveries = this.db.select().from(crmDeliveries).all();
    return orders.map((order) => {
      const current = lines.filter((line) => line.order_id === order.id);
      const keys = new Set(current.map((line) => line.line_key));
      return {
        ...order,
        totalPaise: safe(
          current.reduce(
            (sum, line) => sum + line.qty * line.unit_price_paise,
            0,
          ),
        ),
        orderedQty: current.reduce((sum, line) => sum + line.qty, 0),
        canceledQty: cancellations
          .filter(
            (line) => line.order_id === order.id && keys.has(line.line_key),
          )
          .reduce((sum, line) => sum + line.qty, 0),
        loadingQty: shipping
          .filter(
            (line) => line.orderId === order.id && line.status === 'LOADING',
          )
          .reduce((sum, line) => sum + line.loaded, 0),
        dispatchedQty: shipping
          .filter((line) => line.orderId === order.id)
          .reduce((sum, line) => sum + line.dispatched, 0),
        deliveredQty: deliveries
          .filter((line) => line.order_id === order.id)
          .reduce((sum, line) => sum + line.qty, 0),
      };
    });
  }
  revisionsForOrder(orderId: string) {
    return this.db
      .select()
      .from(crmOrderRevisions)
      .where(eq(crmOrderRevisions.order_id, orderId))
      .orderBy(asc(crmOrderRevisions.revision))
      .all();
  }
  linesForRevision(revisionId: string) {
    return this.db
      .select()
      .from(crmOrderLines)
      .where(eq(crmOrderLines.revision_id, revisionId))
      .orderBy(insertionOrder(crmOrderLines))
      .all();
  }
  approvalsForOrder(orderId: string) {
    return this.db
      .select()
      .from(crmApprovals)
      .where(eq(crmApprovals.order_id, orderId))
      .orderBy(insertionOrder(crmApprovals))
      .all();
  }
  insertOrder(c: ActionContext, row: typeof crmOrders.$inferInsert) {
    this.db.insert(crmOrders).values(row).run();
    recordInsert(c, 'orders', row, false);
  }
  updateOrder(
    c: ActionContext,
    id: string,
    patch: Partial<Omit<typeof crmOrders.$inferInsert, 'id'>>,
  ) {
    const before = this.db
      .select()
      .from(crmOrders)
      .where(eq(crmOrders.id, id))
      .get();
    if (!before) fail('NOT_FOUND', 'Record not found');
    this.db.update(crmOrders).set(patch).where(eq(crmOrders.id, id)).run();
    recordUpdate(c, 'orders', before, { ...before, ...patch });
  }
  insertRevision(c: ActionContext, row: typeof crmOrderRevisions.$inferInsert) {
    this.db.insert(crmOrderRevisions).values(row).run();
    recordInsert(c, 'order_revisions', row, false);
  }
  insertLine(c: ActionContext, row: typeof crmOrderLines.$inferInsert) {
    this.db.insert(crmOrderLines).values(row).run();
    recordInsert(c, 'order_lines', row, false);
  }
  insertApproval(c: ActionContext, row: typeof crmApprovals.$inferInsert) {
    this.db.insert(crmApprovals).values(row).run();
    recordInsert(c, 'approvals', row, false);
  }
  insertCancellation(
    c: ActionContext,
    row: typeof crmCancellations.$inferInsert,
  ) {
    this.db.insert(crmCancellations).values(row).run();
    recordInsert(c, 'cancellations', row, false);
  }
}
@Module({
  imports: [DatabaseModule],
  providers: [OrdersRepository],
  exports: [OrdersRepository],
})
export class OrdersRepositoryModule {}
