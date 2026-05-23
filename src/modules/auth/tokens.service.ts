import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { Env } from '../../config/env.schema';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  /** Issued-at (seconds) — auto-injected by jwt sign */
  iat?: number;
  exp?: number;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  /** Refresh expiry in ms (for cookie maxAge) */
  refreshExpiresMs: number;
  accessExpiresIn: string;
}

@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private generateRefreshToken(): string {
    // 256 bits of entropy, url-safe-ish base64
    return randomBytes(48).toString('base64url');
  }

  private parseTtlMs(ttl: string): number {
    const m = ttl.match(/^(\d+)([smhd])$/);
    if (!m) return 30 * 24 * 60 * 60 * 1000;
    const n = Number(m[1]);
    const unit = m[2];
    const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return n * mult;
  }

  async issueForUser(
    userId: string,
    email: string,
    meta?: { userAgent?: string; ipAddress?: string },
  ): Promise<IssuedTokens> {
    const accessTtl = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const refreshTtl = this.config.get('JWT_REFRESH_TTL', { infer: true });
    const refreshExpiresMs = this.parseTtlMs(refreshTtl);

    const accessToken = await this.jwt.signAsync(
      { sub: userId, email } satisfies AccessTokenPayload,
      {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: accessTtl,
      },
    );

    const refreshRaw = this.generateRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshRaw),
        userAgent: meta?.userAgent?.slice(0, 256),
        ipAddress: meta?.ipAddress,
        expiresAt: new Date(Date.now() + refreshExpiresMs),
      },
    });

    return { accessToken, refreshToken: refreshRaw, refreshExpiresMs, accessExpiresIn: accessTtl };
  }

  /**
   * Validates a refresh token, rotates it (revokes old, issues new), and returns the new pair.
   * Throws UnauthorizedException if the token is missing, unknown, revoked or expired.
   */
  async rotate(
    refreshToken: string,
    meta?: { userAgent?: string; ipAddress?: string },
  ): Promise<IssuedTokens> {
    if (!refreshToken) throw new UnauthorizedException('Refresh token missing');
    const tokenHash = this.hashToken(refreshToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }
    const user = await this.prisma.user.findUnique({ where: { id: record.userId } });
    if (!user) throw new UnauthorizedException('User no longer exists');

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    return this.issueForUser(user.id, user.email, meta);
  }

  async revoke(refreshToken: string): Promise<void> {
    if (!refreshToken) return;
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken
      .update({ where: { tokenHash }, data: { revokedAt: new Date() } })
      .catch(() => undefined);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
