import { UsersRepositoryModule } from './users.repository.js';
import { Module } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { PasswordService } from './password.service.js';
import { UsersController } from './users.controller.js';

@Module({
  imports: [UsersRepositoryModule],
  controllers: [UsersController],
  providers: [UsersService, PasswordService],
  exports: [UsersService, PasswordService],
})
export class UsersModule {}
