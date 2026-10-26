import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateUserInput,
  ListUsersInput,
  UpdateUserInput,
  User,
  UsersResponse,
} from '@crm/shared';
import { UsersRepository } from './users.repository.js';
import { PasswordService } from './password.service.js';

@Injectable()
export class UsersService {
  constructor(
    private readonly repository: UsersRepository,
    private readonly passwords: PasswordService,
  ) {}

  findForLogin(email: string) {
    return this.repository.findForLogin(email);
  }
  findById(id: string): User | undefined {
    return this.repository.findById(id);
  }

  async create(input: CreateUserInput): Promise<User> {
    const passwordHash = await this.passwords.hash(input.password);
    const user = this.repository.insert({
      id: randomUUID(),
      name: input.name,
      email: input.email,
      passwordHash,
      role: input.role,
      createdAt: new Date().toISOString(),
    });
    if (!user)
      throw new ConflictException('An account with this email already exists');
    return user;
  }

  list(input: ListUsersInput): UsersResponse {
    return this.repository.list(input);
  }

  update(id: string, input: UpdateUserInput, actorId: string): User {
    if (id === actorId)
      throw new BadRequestException(
        'Another admin must change your role or account status',
      );
    return this.repository.transaction(() => {
      const current = this.repository.findById(id);
      if (!current) throw new NotFoundException('User not found');
      if (
        current.role === 'ADMIN' &&
        current.active &&
        ((input.role && input.role !== 'ADMIN') || input.active === false)
      ) {
        if (this.repository.activeAdminCount() <= 1)
          throw new ConflictException('At least one active admin is required');
      }
      const updated = this.repository.update(id, input);
      if (!updated) throw new NotFoundException('User not found');
      this.repository.revokeSessions(id);
      return updated;
    });
  }
}
