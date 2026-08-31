import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import type { Env } from '../../config/env.schema';
import { SendWhatsappInput, WhatsappProvider } from './whatsapp.interface';

/**
 * Credentials for sending WhatsApp messages.
 * Can come from either env vars (static) or the database (Embedded Signup).
 */
interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
}

@Injectable()
export class MetaWhatsappService implements WhatsappProvider {
  private readonly logger = new Logger(MetaWhatsappService.name);
  private phoneNumberId: string;
  private accessToken: string;
  private apiBase = 'https://graph.facebook.com';

  constructor(private readonly config: ConfigService<Env, true>) {
    this.phoneNumberId = this.config.get('WHATSAPP_META_PHONE_NUMBER_ID', { infer: true }) || '';
    this.accessToken = this.config.get('WHATSAPP_META_ACCESS_TOKEN', { infer: true }) || '';

    if (!this.phoneNumberId || !this.accessToken) {
      this.logger.warn(
        `Meta WhatsApp: missing env vars (phoneNumberId=${this.phoneNumberId ? '✓' : '✗'} accessToken=${
          this.accessToken ? '✓' : '✗'
        }). WhatsApp will not work unless configured via Embedded Signup.`,
      );
    }
  }

  /**
   * Get credentials for sending messages.
   * Prioritizes database-stored credentials (from Embedded Signup) over env vars.
   * Pass userId to use Embedded Signup credentials; otherwise falls back to env vars.
   */
  getCredentials(userId?: string): WhatsAppCredentials {
    // If no userId provided, use env vars (backward compatible)
    if (!userId) {
      return {
        phoneNumberId: this.phoneNumberId,
        accessToken: this.accessToken,
      };
    }
    // When userId is provided, the caller should have already resolved
    // credentials from the database. This method returns the env vars as fallback.
    return {
      phoneNumberId: this.phoneNumberId,
      accessToken: this.accessToken,
    };
  }

  /**
   * Send a WhatsApp message using specific credentials.
   * This method is used by the notification service which resolves
   * the user's stored credentials before calling this.
   */
  async sendWithCredentials(input: SendWhatsappInput, credentials: WhatsAppCredentials) {
    const to = this.normalizeNumber(input.to);
    try {
      let payload: any;
      if (input.templateId) {
        const templateParams = Array.isArray(input.params) ? input.params : [];
        const components = templateParams.length
          ? [
              {
                type: 'body',
                parameters: templateParams.map((p) => ({ type: 'text', text: String(p) })),
              },
            ]
          : [];

        payload = {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: input.templateId,
            language: { code: 'en' },
            components: components,
          },
        };
      } else {
        payload = {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: input.body ?? '' },
        };
      }

      const url = `${this.apiBase}/v21.0/${credentials.phoneNumberId}/messages`;
      this.logger.debug(`Meta WhatsApp send to=${to} template=${input.templateId ?? 'none'}`);
      const response = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      this.logger.debug(`Meta WhatsApp response: ${JSON.stringify(response.data)}`);
      return { success: true, data: response.data };
    } catch (error: unknown) {
      if (error instanceof AxiosError) {
        this.logger.error('Meta WhatsApp Error: ' + JSON.stringify(error.response?.data ?? error.message));
      } else if (error instanceof Error) {
        this.logger.error('Meta WhatsApp Error: ' + error.message);
      } else {
        this.logger.error('Meta WhatsApp Error: ' + String(error));
      }
      return { success: false, data: null };
    }
  }

  private normalizeNumber(n: string) {
    return typeof n === 'string' && n.startsWith('+') ? n.slice(1) : n;
  }

  async send(input: SendWhatsappInput) {
    const to = this.normalizeNumber(input.to);
    try {
      let payload: any;
      if (input.templateId) {
        // Build template payload
        const templateParams = Array.isArray(input.params) ? input.params : [];
        const components = templateParams.length
          ? [
              {
                type: 'body',
                parameters: templateParams.map((p) => ({ type: 'text', text: String(p) })),
              },
            ]
          : [];

        payload = {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: input.templateId,
            language: { code: 'en' },
            components: components,
          },
        };
      } else {
        payload = {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: input.body ?? '' },
        };
      }

      const url = `${this.apiBase}/v21.0/${this.phoneNumberId}/messages`;
      this.logger.debug(`Meta WhatsApp send to=${to} template=${input.templateId ?? 'none'}`);
      const response = await axios.post(url, payload, {
        headers: { Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
      });
      this.logger.debug(`Meta WhatsApp response: ${JSON.stringify(response.data)}`);
      return { success: true, data: response.data };
    } catch (error: unknown) {
      if (error instanceof AxiosError) {
        this.logger.error('Meta WhatsApp Error: ' + JSON.stringify(error.response?.data ?? error.message));
      } else if (error instanceof Error) {
        this.logger.error('Meta WhatsApp Error: ' + error.message);
      } else {
        this.logger.error('Meta WhatsApp Error: ' + String(error));
      }
      return { success: false, data: null };
    }
  }
}
