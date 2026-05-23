import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmailProvider, SendEmailInput } from './email.interface';
import type { Env } from '../../config/env.schema';

/**
 * Resend HTTP adapter. We hit the REST API directly so we don't add
 * an SDK dep until we're ready to commit to it.
 */
@Injectable()
export class ResendEmailProvider implements EmailProvider {
  private readonly logger = new Logger('Email/Resend');

  constructor(private readonly config: ConfigService<Env, true>) {}

  async send(input: SendEmailInput) {
    const apiKey = this.config.get('RESEND_API_KEY', { infer: true });
    const from = this.config.get('EMAIL_FROM', { infer: true });
    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY missing — falling back to no-op');
      return { accepted: false };
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        tags: input.tag ? [{ name: 'category', value: input.tag }] : undefined,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Resend ${res.status}: ${text}`);
      return { accepted: false };
    }
    const data = (await res.json()) as { id?: string };
    return { id: data.id, accepted: true };
  }
}
