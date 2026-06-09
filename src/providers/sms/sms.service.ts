import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { AxiosError } from 'axios';
import axios from 'axios';
import { SmsProvider, SendSmsInput } from './sms.interface';

@Injectable()
export class SmsService implements SmsProvider {
  private authKey: string;
  private sender: string;
  private readonly logger = new Logger(SmsService.name);
  constructor(private readonly config: ConfigService<Env, true>) {
    this.authKey = this.config.get('MSG91_AUTH_KEY', { infer: true }) || '';
    this.sender = this.config.get('MSG91_SENDER', { infer: true }) || 'TXTIND';
  }

  async sendSms(mobile: string, message: string) {
    try {
      const payload = {
        sender: this.sender,
        route: '4',
        country: '91',
        sms: [
          {
            message: message,
            to: [mobile],
          },
        ],
      };
      this.logger.debug(`MSG91 send payload: sender=${this.sender} to=${mobile}`);
      const response = await axios.post('https://api.msg91.com/api/v2/sendsms', payload, {
        headers: {
          authkey: this.authKey,
          'Content-Type': 'application/json',
        },
      });

      this.logger.debug(`MSG91 response: ${JSON.stringify(response.data)}`);
      return response.data;
    } catch (error: unknown) {
      if (error instanceof AxiosError) {
        this.logger.error('MSG91 Error: ' + JSON.stringify(error.response?.data ?? error.message));
      } else if (error instanceof Error) {
        this.logger.error('MSG91 Error: ' + error.message);
      } else {
        this.logger.error('MSG91 Error: ' + String(error));
      }
      return null;
    }
  }

  async send(input: SendSmsInput) {
    // MSG91 expects numbers without a leading '+', e.g. 919876543210
    const to = typeof input.to === 'string' && input.to.startsWith('+') ? input.to.slice(1) : input.to;
    const data = await this.sendSms(to, input.body);
    if (data) return { success: true, data };
    return { success: false, data: null };
  }
}
