import { Injectable, Module } from '@nestjs/common';
import { and, eq, sum } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { insertionOrder } from '../database/query-order.js';
import { safe, recordInsert } from '../common/domain.js';
import type { ActionContext } from '../common/domain.js';
import {
  crmRewardRedemptions,
  crmRewardLedger,
} from '../rewards/rewards.model.js';

@Injectable()
export class RewardsRepository {
  constructor(private readonly database: DatabaseService) {}
  private get db() {
    return this.database.db;
  }
  lockedForLine(lineKey: string) {
    return safe(
      this.db
        .select({ value: sum(crmRewardLedger.points_delta).mapWith(Number) })
        .from(crmRewardLedger)
        .where(
          and(
            eq(crmRewardLedger.line_key, lineKey),
            eq(crmRewardLedger.bucket, 'LOCKED'),
          ),
        )
        .get()?.value ?? 0,
    );
  }
  redeemedForCharge(chargeId: string) {
    return safe(
      this.db
        .select({ value: sum(crmRewardRedemptions.points).mapWith(Number) })
        .from(crmRewardRedemptions)
        .where(eq(crmRewardRedemptions.charge_id, chargeId))
        .get()?.value ?? 0,
    );
  }
  earnedForLine(lineKey: string) {
    return safe(
      this.db
        .select({ value: sum(crmRewardLedger.points_delta).mapWith(Number) })
        .from(crmRewardLedger)
        .where(
          and(
            eq(crmRewardLedger.line_key, lineKey),
            eq(crmRewardLedger.bucket, 'AVAILABLE'),
          ),
        )
        .get()?.value ?? 0,
    );
  }
  availableForCustomer(customerId: string) {
    return safe(
      this.db
        .select({ value: sum(crmRewardLedger.points_delta).mapWith(Number) })
        .from(crmRewardLedger)
        .where(
          and(
            eq(crmRewardLedger.customer_id, customerId),
            eq(crmRewardLedger.bucket, 'AVAILABLE'),
          ),
        )
        .get()?.value ?? 0,
    );
  }
  debtForCustomer(customerId: string) {
    return safe(
      this.db
        .select({ value: sum(crmRewardLedger.points_delta).mapWith(Number) })
        .from(crmRewardLedger)
        .where(
          and(
            eq(crmRewardLedger.customer_id, customerId),
            eq(crmRewardLedger.bucket, 'CLAWBACK_PENDING'),
          ),
        )
        .get()?.value ?? 0,
    );
  }
  redeemedForCustomer(customerId: string) {
    return safe(
      this.db
        .select({ value: sum(crmRewardRedemptions.points).mapWith(Number) })
        .from(crmRewardRedemptions)
        .where(eq(crmRewardRedemptions.customer_id, customerId))
        .get()?.value ?? 0,
    );
  }
  lockedForCustomer(customerId: string) {
    return safe(
      this.db
        .select({ value: sum(crmRewardLedger.points_delta).mapWith(Number) })
        .from(crmRewardLedger)
        .where(
          and(
            eq(crmRewardLedger.customer_id, customerId),
            eq(crmRewardLedger.bucket, 'LOCKED'),
          ),
        )
        .get()?.value ?? 0,
    );
  }
  spentForCustomer(customerId: string) {
    return safe(
      this.db
        .select({ value: sum(crmRewardLedger.points_delta).mapWith(Number) })
        .from(crmRewardLedger)
        .where(
          and(
            eq(crmRewardLedger.customer_id, customerId),
            eq(crmRewardLedger.bucket, 'REDEEMED'),
          ),
        )
        .get()?.value ?? 0,
    );
  }
  redemptionsForCustomer(customerId: string) {
    return this.db
      .select()
      .from(crmRewardRedemptions)
      .where(eq(crmRewardRedemptions.customer_id, customerId))
      .orderBy(insertionOrder(crmRewardRedemptions))
      .all();
  }
  entriesForCustomer(customerId: string) {
    return this.db
      .select()
      .from(crmRewardLedger)
      .where(eq(crmRewardLedger.customer_id, customerId))
      .orderBy(insertionOrder(crmRewardLedger))
      .all();
  }
  insertRedemption(
    c: ActionContext,
    row: typeof crmRewardRedemptions.$inferInsert,
  ) {
    this.db.insert(crmRewardRedemptions).values(row).run();
    recordInsert(c, 'reward_redemptions', row, true);
  }
  insertPosting(c: ActionContext, row: typeof crmRewardLedger.$inferInsert) {
    this.db.insert(crmRewardLedger).values(row).run();
    recordInsert(c, 'reward_ledger', row, true);
  }
}
@Module({
  imports: [DatabaseModule],
  providers: [RewardsRepository],
  exports: [RewardsRepository],
})
export class RewardsRepositoryModule {}
