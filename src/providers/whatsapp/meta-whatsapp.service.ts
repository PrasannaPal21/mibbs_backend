import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import type { Env } from '../../config/env.schema';
import { SendWhatsappInput, WhatsappProvider } from './whatsapp.interface';

@Injectable()
export class MetaWhatsappService implements WhatsappProvider {
  private readonly logger = new Logger(MetaWhatsappService.name);
  private phoneNumberId: string;
  private accessToken: string;
  private apiBase = 'https://graph.facebook.com';

  constructor(private readonly config: ConfigService<Env, true>) {
    this.phoneNumberId = this.config.get('WHATSAPP_META_PHONE_NUMBER_ID', { infer: true }) || '';
    this.accessToken = this.config.get('WHATSAPP_META_ACCESS_TOKEN', { infer: true }) || '';
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
            language: { code: 'en_US' },
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

      const url = `${this.apiBase}/v17.0/${this.phoneNumberId}/messages`;
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
