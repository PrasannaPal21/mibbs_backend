import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { EMAIL_PROVIDER, type EmailProvider } from '../../providers/email/email.interface';
import { SMS_PROVIDER, type SmsProvider } from '../../providers/sms/sms.interface';
import { WHATSAPP_PROVIDER, type WhatsappProvider } from '../../providers/whatsapp/whatsapp.interface';
import type { Env } from '../../config/env.schema';

const OTP_TTL_SEC = 5 * 60;
const MAX_ATTEMPTS = 5;
const SEND_COOLDOWN_SEC = 30;
const MAX_SENDS_PER_HOUR = 5;

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsapp: WhatsappProvider,
  ) {}

  private isEmail(identifier: string): boolean {
    return identifier.includes('@');
  }

  private generateCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  private cooldownKey(identifier: string, purpose: OtpPurpose) {
    return `otp:cooldown:${purpose}:${identifier}`;
  }

  private rateKey(identifier: string, purpose: OtpPurpose) {
    return `otp:rate:${purpose}:${identifier}`;
  }

  async send(input: {
    identifier: string;
    purpose: OtpPurpose;
    userId?: string;
  }): Promise<{ sentTo: string; cooldownSec: number; expiresInSec: number }> {
    const identifier = input.identifier.trim().toLowerCase();
    const rounds = this.config.get('BCRYPT_ROUNDS', { infer: true });

    // Cooldown gate
    const cooldownKey = this.cooldownKey(identifier, input.purpose);
    const ttl = await this.redis.client.ttl(cooldownKey);
    if (ttl > 0) {
      throw new HttpException(
        `Please wait ${ttl}s before requesting a new code`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Hourly send-limit gate
    const rateKey = this.rateKey(identifier, input.purpose);
    const sends = await this.redis.client.incr(rateKey);
    if (sends === 1) await this.redis.client.expire(rateKey, 60 * 60);
    if (sends > MAX_SENDS_PER_HOUR) {
      throw new HttpException(
        'Too many OTP requests. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = this.generateCode();
    const codeHash = await bcrypt.hash(code, rounds);

    // Invalidate any previously-issued unconsumed codes for the same target.
    // Without this, multiple in-flight OTPs would be simultaneously valid.
    await this.prisma.$transaction([
      this.prisma.otpCode.updateMany({
        where: {
          identifier,
          purpose: input.purpose,
          consumedAt: null,
        },
        data: { consumedAt: new Date() },
      }),
      this.prisma.otpCode.create({
        data: {
          userId: input.userId ?? null,
          identifier,
          purpose: input.purpose,
          codeHash,
          expiresAt: new Date(Date.now() + OTP_TTL_SEC * 1000),
        },
      }),
    ]);

    if (this.isEmail(identifier)) {
      await this.email.send({
        to: identifier,
        subject: this.subjectFor(input.purpose),
        html: this.emailBody(code, input.purpose),
        text: `Your MIBBS code is ${code}. It expires in ${OTP_TTL_SEC / 60} minutes.`,
        tag: `otp_${input.purpose.toLowerCase()}`,
      });
    } else {
      // When sending via the MSG91 Flow API, the approved template already
      // contains the message text (e.g. "Your OTP for password reset is ##OTP##"),
      // so only the code is passed as a named variable matching the template.
      const otpVar = this.config.get('MSG91_OTP_VAR', { infer: true }) || 'OTP';
      await this.sms.send({
        to: identifier,
        body: `Your MIBBS code is ${code}. Expires in ${OTP_TTL_SEC / 60} min.`,
        params: { [otpVar]: code },
        tag: `otp_${input.purpose.toLowerCase()}`,
      });
      // Attempt WhatsApp send as a best-effort additional channel.
      try {
        await this.whatsapp.send({
          to: identifier,
          body: `Your MIBBS code is ${code}. Expires in ${OTP_TTL_SEC / 60} min.`,
          tag: `otp_${input.purpose.toLowerCase()}`,
        });
      } catch (err) {
        // ignore whatsapp errors; OTP already sent via SMS
      }
    }

    await this.redis.client.set(cooldownKey, '1', 'EX', SEND_COOLDOWN_SEC);

    return {
      sentTo: this.maskIdentifier(identifier),
      cooldownSec: SEND_COOLDOWN_SEC,
      expiresInSec: OTP_TTL_SEC,
    };
  }

  async verify(input: { identifier: string; code: string; purpose: OtpPurpose }): Promise<true> {
    const identifier = input.identifier.trim().toLowerCase();
    const record = await this.prisma.otpCode.findFirst({
      where: {
        identifier,
        purpose: input.purpose,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) throw new BadRequestException('Invalid or expired code');

    if (record.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException('Too many failed attempts — request a new code');
    }

    const ok = await bcrypt.compare(input.code, record.codeHash);
    if (!ok) {
      await this.prisma.otpCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Invalid or expired code');
    }

    await this.prisma.otpCode.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    return true;
  }

  private subjectFor(purpose: OtpPurpose): string {
    switch (purpose) {
      case OtpPurpose.LOGIN:
        return 'Your MIBBS login code';
      case OtpPurpose.SIGNUP:
        return 'Verify your MIBBS account';
      case OtpPurpose.PASSWORD_RESET:
        return 'Reset your MIBBS password';
      case OtpPurpose.PHONE_VERIFY:
        return 'Verify your phone number';
    }
  }

  private emailBody(code: string, purpose: OtpPurpose): string {
    return `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 12px">MIBBS</h2>
  <p>Your verification code is:</p>
  <div style="font-size:28px;letter-spacing:8px;font-weight:700;padding:16px 0;color:#6D28D9">${code}</div>
  <p style="color:#555">This code expires in ${OTP_TTL_SEC / 60} minutes. If you didn't request it (${purpose.toLowerCase()}), you can ignore this email.</p>
</body></html>`;
  }

  private maskIdentifier(identifier: string): string {
    if (this.isEmail(identifier)) {
      const [name, domain] = identifier.split('@');
      const masked = name.length <= 2 ? name[0] + '*' : name[0] + '*'.repeat(name.length - 2) + name.slice(-1);
      return `${masked}@${domain}`;
    }
    // phone
    return identifier.length <= 4 ? identifier : '*'.repeat(identifier.length - 4) + identifier.slice(-4);
  }
}
