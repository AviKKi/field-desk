import { Injectable, Module } from '@nestjs/common';
import { and, eq, gt, lte } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { sessions } from './auth.model.js';
@Injectable()
export class AuthRepository {
  constructor(private readonly database: DatabaseService) {}
  createSession(record: typeof sessions.$inferInsert, now: number) {
    this.database.db.transaction((tx) => {
      tx.delete(sessions).where(lte(sessions.expiresAt, now)).run();
      tx.insert(sessions).values(record).run();
    });
  }
  validSession(id: string, userId: string, now: number) {
    return this.database.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.id, id),
          eq(sessions.userId, userId),
          gt(sessions.expiresAt, now),
        ),
      )
      .get();
  }
  deleteSession(id: string) {
    this.database.db.delete(sessions).where(eq(sessions.id, id)).run();
  }
}
@Module({
  imports: [DatabaseModule],
  providers: [AuthRepository],
  exports: [AuthRepository],
})
export class AuthRepositoryModule {}
