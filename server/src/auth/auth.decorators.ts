import { createParamDecorator, SetMetadata } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Role, User } from '@crm/shared';

export const PUBLIC_ROUTE = 'auth:public';
export const ALLOWED_ROLES = 'auth:roles';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const Roles = (...roles: Role[]) => SetMetadata(ALLOWED_ROLES, roles);

export interface AuthenticatedRequest extends Request {
  user: User;
  sessionId: string;
}
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
