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
  private flowId: string;
  private readonly logger = new Logger(SmsService.name);
  constructor(private readonly config: ConfigService<Env, true>) {
    this.authKey = this.config.get('MSG91_AUTH_KEY', { infer: true }) || '';
    this.sender = this.config.get('MSG91_SENDER', { infer: true }) || 'GROIPL';
    this.flowId = this.config.get('MSG91_FLOW_ID', { infer: true }) || '';

    if (this.flowId) {
      this.logger.log(`MSG91 SMS: using Flow API (flow_id=${this.flowId})`);
    } else {
      this.logger.warn(
        'MSG91 SMS: MSG91_FLOW_ID not set — falling back to legacy /api/v2/sendsms endpoint',
      );
    }
  }

  async sendSms(
    mobile: string,
    message: string,
    params?: Record<string, string | number>,
  ) {
    try {
      if (this.flowId) {
        return await this.sendViaFlow(mobile, message, params);
      }
      return await this.sendViaLegacy(mobile, message);
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

  /**
   * MSG91 Flow API (v5): POST https://api.msg91.com/api/v5/flow/
   *
   * Body:
   * {
   *   "flow_id": "<MSG91_FLOW_ID>",
   *   "sender": "<MSG91_SENDER>",
   *   "recipients": [
   *     { "mobiles": "9198...", "var": "message text" }
   *   ]
   * }
   *
   * The flow's approved template is defined in the MSG91 panel. The message
   * text is passed as the `var` placeholder (or via named `params` when the
   * caller provides them, matching the template's variable names).
   */
  private async sendViaFlow(
    mobile: string,
    message: string,
    params?: Record<string, string | number>,
  ) {
    const recipient: Record<string, string | number> = { mobiles: mobile };
    if (params && Object.keys(params).length > 0) {
      Object.assign(recipient, params);
    } else {
      recipient.var = message;
    }

    const payload = {
      flow_id: this.flowId,
      sender: this.sender,
      recipients: [recipient],
    };

    this.logger.debug(`MSG91 Flow send payload: flow_id=${this.flowId} sender=${this.sender} to=${mobile}`);
    const response = await axios.post('https://api.msg91.com/api/v5/flow/', payload, {
      headers: {
        authkey: this.authKey,
        'Content-Type': 'application/json',
      },
    });

    this.logger.debug(`MSG91 Flow response: ${JSON.stringify(response.data)}`);

    // MSG91 returns { "message": "...", "type": "error" } for API-level failures
    if (response.data && response.data.type === 'error') {
      this.logger.error(`MSG91 Flow API error: ${JSON.stringify(response.data)}`);
      return null;
    }

    return response.data;
  }

  private async sendViaLegacy(mobile: string, message: string) {
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
  }

  async send(input: SendSmsInput) {
    // MSG91 expects numbers without a leading '+', e.g. 919876543210
    const to = typeof input.to === 'string' && input.to.startsWith('+') ? input.to.slice(1) : input.to;
    const data = await this.sendSms(to, input.body, input.params);
    if (data) return { success: true, data };
    return { success: false, data: null };
  }
}
