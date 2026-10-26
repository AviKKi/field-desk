import { Injectable, Module } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { crmActionRequests } from '../actions/actions.model.js';

@Injectable()
export class ActionsRepository {
  constructor(private readonly database: DatabaseService) {}
  private get db() {
    return this.database.db;
  }
  findRequest(requesterId: string, key: string) {
    return this.db
      .select()
      .from(crmActionRequests)
      .where(
        and(
          eq(crmActionRequests.requester_id, requesterId),
          eq(crmActionRequests.idempotency_key, key),
        ),
      )
      .get();
  }
  findAction(id: string) {
    return this.db
      .select()
      .from(crmActionRequests)
      .where(eq(crmActionRequests.id, id))
      .get();
  }
  saveRequest(row: typeof crmActionRequests.$inferInsert) {
    this.db.insert(crmActionRequests).values(row).run();
  }
}
@Module({
  imports: [DatabaseModule],
  providers: [ActionsRepository],
  exports: [ActionsRepository],
})
export class ActionsRepositoryModule {}
