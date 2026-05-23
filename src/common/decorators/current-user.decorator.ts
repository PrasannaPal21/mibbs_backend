import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  email: string;
  phone?: string;
}

/**
 * Extracts the authenticated user from request.
 * Populated by JwtAuthGuard (see modules/auth).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    return req.user;
  },
);
