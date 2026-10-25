import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createUserSchema,
  listUsersSchema,
  updateUserSchema,
} from '@crm/shared/schemas';
import type {
  CreateUserInput,
  ListUsersInput,
  UpdateUserInput,
  User,
} from '@crm/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators.js';
import { ZodValidationPipe } from '../common/validation.pipe.js';
import { UsersService } from './users.service.js';

@Roles('ADMIN')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query(new ZodValidationPipe(listUsersSchema)) query: ListUsersInput) {
    return this.users.list(query);
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createUserSchema)) input: CreateUserInput,
  ) {
    return { user: await this.users.create(input) };
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) input: UpdateUserInput,
    @CurrentUser() actor: User,
  ) {
    return { user: this.users.update(id, input, actor.id) };
  }
}
