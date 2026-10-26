import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { users } from '../users/users.model.js';

@Injectable()
export class HealthService {
  constructor(private readonly database: DatabaseService) {}

  status(): { status: 'ok' } {
    this.database.db.select({ id: users.id }).from(users).limit(1).get();
    return { status: 'ok' };
  }
}
