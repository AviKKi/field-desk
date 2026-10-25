import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import type {
  CreateUserInput,
  ListUsersInput,
  UpdateUserInput,
  User,
  UsersResponse,
} from '@crm/shared';
import { DatabaseService } from '../database/database.service.js';
import { publicUserColumns, sessions, users } from '../database/schema.js';
import { PasswordService } from './password.service.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
  ) {}

  findForLogin(email: string) {
    return this.database.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .get();
  }

  findById(id: string): User | undefined {
    return this.database.db
      .select(publicUserColumns)
      .from(users)
      .where(eq(users.id, id))
      .get();
  }

  async create(input: CreateUserInput): Promise<User> {
    const passwordHash = await this.passwords.hash(input.password);
    const user = this.database.db
      .insert(users)
      .values({
        id: randomUUID(),
        name: input.name,
        email: input.email,
        passwordHash,
        role: input.role,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing({ target: users.email })
      .returning(publicUserColumns)
      .get();
    if (!user)
      throw new ConflictException('An account with this email already exists');
    return user;
  }

  list(input: ListUsersInput): UsersResponse {
    const term = input.search.toLowerCase();
    const filter = term
      ? sql`instr(lower(${users.name}), ${term}) > 0 or instr(${users.email}, ${term}) > 0`
      : undefined;
    const total =
      this.database.db
        .select({ value: count() })
        .from(users)
        .where(filter)
        .get()?.value ?? 0;
    const result = this.database.db
      .select(publicUserColumns)
      .from(users)
      .where(filter)
      .orderBy(asc(users.createdAt), asc(users.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize)
      .all();
    return { users: result, total, page: input.page, pageSize: input.pageSize };
  }

  update(id: string, input: UpdateUserInput, actorId: string): User {
    if (id === actorId)
      throw new BadRequestException(
        'Another admin must change your role or account status',
      );
    return this.database.db.transaction((tx) => {
      const current = tx
        .select(publicUserColumns)
        .from(users)
        .where(eq(users.id, id))
        .get();
      if (!current) throw new NotFoundException('User not found');
      if (
        current.role === 'ADMIN' &&
        current.active &&
        ((input.role && input.role !== 'ADMIN') || input.active === false)
      ) {
        const admins = tx
          .select({ value: count() })
          .from(users)
          .where(and(eq(users.role, 'ADMIN'), eq(users.active, true)))
          .get();
        if ((admins?.value ?? 0) <= 1)
          throw new ConflictException('At least one active admin is required');
      }
      const updated = tx
        .update(users)
        .set(input)
        .where(eq(users.id, id))
        .returning(publicUserColumns)
        .get();
      if (!updated) throw new NotFoundException('User not found');
      tx.delete(sessions).where(eq(sessions.userId, id)).run();
      return updated;
    });
  }
}
