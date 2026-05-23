import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SmsProvider, SendSmsInput } from './sms.interface';
import type { Env } from '../../config/env.schema';

/**
 * Twilio REST adapter. Hits the API directly to avoid pulling the SDK in
 * before the client provides creds.
 */
@Injectable()
export class TwilioSmsProvider implements SmsProvider {
  private readonly logger = new Logger('Sms/Twilio');

  constructor(private readonly config: ConfigService<Env, true>) {}

  async send(input: SendSmsInput) {
    const accountSid = this.config.get('TWILIO_ACCOUNT_SID', { infer: true });
    const authToken = this.config.get('TWILIO_AUTH_TOKEN', { infer: true });
    const from = this.config.get('TWILIO_FROM', { infer: true });
    if (!accountSid || !authToken || !from) {
      this.logger.warn('Twilio creds missing — falling back to no-op');
      return { accepted: false };
    }
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const body = new URLSearchParams({ To: input.to, From: from, Body: input.body });
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Twilio ${res.status}: ${text}`);
      return { accepted: false };
    }
    const data = (await res.json()) as { sid?: string };
    return { id: data.sid, accepted: true };
  }
}
