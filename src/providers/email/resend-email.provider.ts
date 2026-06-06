import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { EmailProvider, SendEmailInput } from './email.interface';
import type { Env } from '../../config/env.schema';

@Injectable()
export class ResendEmailProvider implements EmailProvider {
  private readonly logger = new Logger('Email/Resend');
  private resend: Resend | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {
    const apiKey = this.config.get('RESEND_API_KEY', { infer: true });
    if (apiKey) {
      this.resend = new Resend(apiKey);
    }
  }

  async send(input: SendEmailInput) {
    if (!this.resend) {
      this.logger.warn('RESEND_API_KEY missing — falling back to no-op');
      return { accepted: false };
    }
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.config.get('EMAIL_FROM', { infer: true }),
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(input.tag ? { tags: [{ name: 'category', value: input.tag }] } : {}),
      });
      if (error) {
        this.logger.error(`Resend error: ${error.message}`);
        return { accepted: false };
      }
      return { id: data?.id, accepted: true };
    } catch (err) {
      this.logger.error(`Resend send failed: ${(err as Error).message}`);
      return { accepted: false };
    }
  }
}
