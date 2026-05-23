import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';
import type { AccessTokenPayload } from '../tokens.service';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import type { Env } from '../../../config/env.schema';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<Env, true>,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedException('User no longer exists');
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('Account is not active');
    return { id: user.id, email: user.email, phone: user.phoneE164 ?? undefined };
  }
}
