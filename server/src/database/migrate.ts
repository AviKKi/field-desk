import 'reflect-metadata';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { validateEnvironment } from '../config/environment.js';
import { DatabaseModule } from './database.module.js';
import { DatabaseService } from './database.service.js';

export const migrationsFolder = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    DatabaseModule,
  ],
})
class MigrationModule {}

export async function runMigrations() {
  const app = await NestFactory.createApplicationContext(MigrationModule, {
    logger: ['error', 'warn'],
  });
  try {
    migrate(app.get(DatabaseService).db, { migrationsFolder });
    console.log('Database migrations applied.');
  } finally {
    await app.close();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runMigrations();
}
