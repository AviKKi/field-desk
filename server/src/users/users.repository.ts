import { Injectable, Module } from '@nestjs/common';
import { and, asc, count, eq, or, sql } from 'drizzle-orm';
import type { ListUsersInput, UpdateUserInput } from '@crm/shared';
import { DatabaseService } from '../database/database.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { users, publicUserColumns } from './users.model.js';
import { sessions } from '../auth/auth.model.js';

@Injectable()
export class UsersRepository {
  constructor(private readonly database: DatabaseService) {}
  findForLogin(email: string) {
    return this.database.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .get();
  }
  findById(id: string) {
    return this.database.db
      .select(publicUserColumns)
      .from(users)
      .where(eq(users.id, id))
      .get();
  }
  listActive() {
    return this.database.db
      .select(publicUserColumns)
      .from(users)
      .where(eq(users.active, true))
      .orderBy(asc(users.name))
      .all();
  }
  insert(input: typeof users.$inferInsert) {
    return this.database.db
      .insert(users)
      .values(input)
      .onConflictDoNothing({ target: users.email })
      .returning(publicUserColumns)
      .get();
  }
  list(input: ListUsersInput) {
    const term = input.search.toLowerCase();
    const filter = term
      ? or(
          sql<boolean>`instr(lower(${users.name}), ${term}) > 0`,
          sql<boolean>`instr(${users.email}, ${term}) > 0`,
        )
      : undefined;
    const total =
      this.database.db
        .select({ value: count() })
        .from(users)
        .where(filter)
        .get()?.value ?? 0;
    const records = this.database.db
      .select(publicUserColumns)
      .from(users)
      .where(filter)
      .orderBy(asc(users.createdAt), asc(users.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize)
      .all();
    return {
      users: records,
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }
  activeAdminCount() {
    return (
      this.database.db
        .select({ value: count() })
        .from(users)
        .where(and(eq(users.role, 'ADMIN'), eq(users.active, true)))
        .get()?.value ?? 0
    );
  }
  update(id: string, input: UpdateUserInput) {
    return this.database.db
      .update(users)
      .set(input)
      .where(eq(users.id, id))
      .returning(publicUserColumns)
      .get();
  }
  revokeSessions(userId: string) {
    this.database.db.delete(sessions).where(eq(sessions.userId, userId)).run();
  }
  transaction<T>(work: () => T) {
    return this.database.db.transaction(work, { behavior: 'immediate' });
  }
}
@Module({
  imports: [DatabaseModule],
  providers: [UsersRepository],
  exports: [UsersRepository],
})
export class UsersRepositoryModule {}
