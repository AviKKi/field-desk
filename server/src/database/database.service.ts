import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import type { Environment } from '../config/environment.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly sqlite: Database.Database;
  readonly db;

  constructor(config: ConfigService<Environment, true>) {
    const path = config.get('DATABASE_PATH', { infer: true });
    if (path !== ':memory:')
      mkdirSync(dirname(resolve(path)), { recursive: true });
    this.sqlite = new Database(path);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.sqlite.pragma('busy_timeout = 5000');
    this.db = drizzle(this.sqlite, { schema });
  }

  onModuleDestroy() {
    this.sqlite.close();
  }
}
