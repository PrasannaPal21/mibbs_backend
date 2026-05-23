import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as publicly accessible (bypasses JwtAuthGuard).
 * Apply with @Public() at the controller or handler level.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
