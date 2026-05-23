import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose, type User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { TokensService, type IssuedTokens } from './tokens.service';
import { OtpService } from './otp.service';
import { EMAIL_PROVIDER, type EmailProvider } from '../../providers/email/email.interface';
import { SMS_PROVIDER, type SmsProvider } from '../../providers/sms/sms.interface';
import type { Env } from '../../config/env.schema';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/login.dto';
import type { OtpSendDto, OtpVerifyDto } from './dto/otp.dto';
import type { ForgotPasswordDto, ResetPasswordDto } from './dto/password.dto';

interface RequestMeta {
  userAgent?: string;
  ipAddress?: string;
}

export interface AuthResult {
  user: User;
  tokens: IssuedTokens;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokensService,
    private readonly otp: OtpService,
    private readonly config: ConfigService<Env, true>,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  async register(dto: RegisterDto, meta?: RequestMeta): Promise<AuthResult> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already registered');
    if (dto.phoneE164) {
      const dupePhone = await this.users.findByPhone(dto.phoneE164);
      if (dupePhone) throw new ConflictException('Phone already registered');
    }

    const rounds = this.config.get('BCRYPT_ROUNDS', { infer: true });
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    const user = await this.users.create({
      name: dto.name,
      email: dto.email,
      phoneE164: dto.phoneE164,
      passwordHash,
    });

    // Best-effort welcome (does not block registration)
    this.email
      .send({
        to: user.email,
        subject: 'Welcome to MIBBS',
        html: `<p>Hi ${user.name},</p><p>Welcome to MIBBS — let's build your first marketing plan.</p>`,
        text: `Hi ${user.name}, welcome to MIBBS.`,
        tag: 'welcome',
      })
      .catch(() => undefined);

    const tokens = await this.tokens.issueForUser(user.id, user.email, meta);
    await this.users.setLastLogin(user.id);
    return { user, tokens };
  }

  async login(dto: LoginDto, meta?: RequestMeta): Promise<AuthResult> {
    const user = await this.users.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (user.status === 'SUSPENDED') throw new UnauthorizedException('Account suspended');

    const tokens = await this.tokens.issueForUser(user.id, user.email, meta);
    await this.users.setLastLogin(user.id);
    return { user, tokens };
  }

  async sendOtp(dto: OtpSendDto) {
    // For login OTP, lookup user (optional — we still send for security UX)
    let userId: string | undefined;
    if (dto.purpose === OtpPurpose.LOGIN || dto.purpose === OtpPurpose.PASSWORD_RESET) {
      const u = await this.users.findByIdentifier(dto.identifier);
      userId = u?.id;
    }
    return this.otp.send({ identifier: dto.identifier, purpose: dto.purpose, userId });
  }

  async verifyOtpForLogin(dto: OtpVerifyDto, meta?: RequestMeta): Promise<AuthResult> {
    if (dto.purpose !== OtpPurpose.LOGIN) {
      throw new BadRequestException('Use the correct verify endpoint for this purpose');
    }
    await this.otp.verify({ identifier: dto.identifier, code: dto.code, purpose: dto.purpose });

    const user = await this.users.findByIdentifier(dto.identifier);
    if (!user) throw new UnauthorizedException('No account for this identifier');
    if (user.status === 'SUSPENDED') throw new UnauthorizedException('Account suspended');

    const tokens = await this.tokens.issueForUser(user.id, user.email, meta);
    await this.users.setLastLogin(user.id);
    return { user, tokens };
  }

  async refresh(refreshToken: string, meta?: RequestMeta): Promise<IssuedTokens> {
    return this.tokens.rotate(refreshToken, meta);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await this.tokens.revoke(refreshToken);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    // Same response whether the account exists or not (anti-enum).
    const user = await this.users.findByIdentifier(dto.identifier);
    await this.otp.send({
      identifier: dto.identifier,
      purpose: OtpPurpose.PASSWORD_RESET,
      userId: user?.id,
    });
    return { ok: true };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ ok: true }> {
    await this.otp.verify({
      identifier: dto.identifier,
      code: dto.code,
      purpose: OtpPurpose.PASSWORD_RESET,
    });
    const user = await this.users.findByIdentifier(dto.identifier);
    if (!user) throw new BadRequestException('Invalid request');

    const rounds = this.config.get('BCRYPT_ROUNDS', { infer: true });
    const passwordHash = await bcrypt.hash(dto.newPassword, rounds);
    await this.users.setPasswordHash(user.id, passwordHash);
    await this.tokens.revokeAllForUser(user.id);
    return { ok: true };
  }
}
