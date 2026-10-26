import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { users } from '../users/users.model.js';
@Injectable()
export class HealthRepository {
  constructor(private readonly database: DatabaseService) {}
  checkConnection() {
    this.database.db.select({ id: users.id }).from(users).limit(1).get();
  }
}
