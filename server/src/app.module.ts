import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import { AuthModule } from './auth/auth.module.js';
import { Public } from './auth/auth.decorators.js';
import { AuthGuard, RolesGuard } from './auth/auth.guards.js';
import { validateEnvironment } from './config/environment.js';
import { DatabaseModule } from './database/database.module.js';
import { DatabaseService } from './database/database.service.js';
import { UsersModule } from './users/users.module.js';
import { WorkspaceModule } from './workspace/workspace.module.js';
import { CrmModule } from './crm/crm.module.js';

@Controller('health')
class HealthController {
  constructor(private readonly database: DatabaseService) {}
  @Public()
  @Get()
  health() {
    this.database.db.get(sql`select 1`);
    return { status: 'ok' };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    DatabaseModule,
    UsersModule,
    AuthModule,
    WorkspaceModule,
    CrmModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
