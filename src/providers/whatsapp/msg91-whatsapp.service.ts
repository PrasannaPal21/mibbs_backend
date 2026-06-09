import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import type { Env } from '../../config/env.schema';
import { SendWhatsappInput, WhatsappProvider } from './whatsapp.interface';

@Injectable()
export class Msg91WhatsappService implements WhatsappProvider {
  private readonly logger = new Logger(Msg91WhatsappService.name);
  private authKey: string;
  private sender: string;
  private templateId: string;
  private apiUrl: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.authKey = this.config.get('MSG91_WHATSAPP_AUTH_KEY', { infer: true }) || '';
    this.sender = this.config.get('MSG91_WHATSAPP_SENDER', { infer: true }) || '';
    this.templateId = this.config.get('MSG91_WHATSAPP_TEMPLATE_ID', { infer: true }) || '';
    this.apiUrl = this.config.get('MSG91_WHATSAPP_API_URL', { infer: true }) || 'https://api.msg91.com/api/v5/whatsapp';
  }

  private normalizeNumber(n: string) {
    return typeof n === 'string' && n.startsWith('+') ? n.slice(1) : n;
  }

  async send(input: SendWhatsappInput) {
    const to = this.normalizeNumber(input.to);
    try {
      // Build a minimal payload compatible with common MSG91 WhatsApp endpoints.
      // Adjust fields/template format as needed for your MSG91 account.
      const useTemplate = Boolean(input.templateId || this.templateId);
      const payload: any = {
        sender: this.sender,
        to: [to],
      };

      if (useTemplate) {
        payload.type = 'template';
        payload.template_id = input.templateId || this.templateId;
        if (input.params) payload.template_params = input.params;
      } else {
        payload.type = 'text';
        payload.message = {
          text: input.body ?? '',
        };
      }

      this.logger.debug(`MSG91 WhatsApp send payload: to=${to} template=${payload.template_id ?? 'none'}`);
      const url = this.apiUrl.endsWith('/') ? `${this.apiUrl}send` : `${this.apiUrl}/send`;
      const response = await axios.post(url, payload, {
        headers: {
          authkey: this.authKey,
          'Content-Type': 'application/json',
        },
      });

      this.logger.debug(`MSG91 WhatsApp response: ${JSON.stringify(response.data)}`);
      return { success: true, data: response.data };
    } catch (error: unknown) {
      if (error instanceof AxiosError) {
        this.logger.error('MSG91 WhatsApp Error: ' + JSON.stringify(error.response?.data ?? error.message));
      } else if (error instanceof Error) {
        this.logger.error('MSG91 WhatsApp Error: ' + error.message);
      } else {
        this.logger.error('MSG91 WhatsApp Error: ' + String(error));
      }
      return { success: false, data: null };
    }
  }
}
