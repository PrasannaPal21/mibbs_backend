import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import type { Env } from '../../config/env.schema';
import { SendWhatsappInput, WhatsappProvider } from './whatsapp.interface';

/**
 * MSG91 WhatsApp v5 provider.
 *
 * Uses the MSG91 WhatsApp Outbound Message API to send template-based
 * WhatsApp messages (required for business-initiated conversations).
 *
 * Endpoint: POST https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/
 *
 * Required env vars (WHATSAPP_PROVIDER=msg91):
 *   MSG91_WHATSAPP_AUTH_KEY
 *   MSG91_WHATSAPP_INTEGRATED_NUMBER
 *   MSG91_WHATSAPP_NAMESPACE
 *
 * Optional:
 *   MSG91_WHATSAPP_API_URL — custom base URL (default: https://api.msg91.com/api/v5/whatsapp)
 */
@Injectable()
export class Msg91WhatsappService implements WhatsappProvider {
  private readonly logger = new Logger(Msg91WhatsappService.name);
  private authKey: string;
  private integratedNumber: string;
  private namespace: string;
  private apiBase: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.authKey = this.config.get('MSG91_WHATSAPP_AUTH_KEY', { infer: true }) || '';
    this.integratedNumber = this.normalizeNumber(this.config.get('MSG91_WHATSAPP_INTEGRATED_NUMBER', { infer: true }) || '');
    this.namespace = this.config.get('MSG91_WHATSAPP_NAMESPACE', { infer: true }) || '';
    this.apiBase =
      this.config.get('MSG91_WHATSAPP_API_URL', { infer: true }) ||
      'https://api.msg91.com/api/v5/whatsapp';

    if (!this.authKey || !this.integratedNumber || !this.namespace) {
      this.logger.warn(
        `MSG91 WhatsApp: missing env vars (authKey=${this.authKey ? '✓' : '✗'} integratedNumber=${
          this.integratedNumber ? '✓' : '✗'
        } namespace=${this.namespace ? '✓' : '✗'}). WhatsApp will not work.`,
      );
    }
  }

  private normalizeNumber(n: string): string {
    return typeof n === 'string' && n.startsWith('+') ? n.slice(1) : n;
  }

  async send(input: SendWhatsappInput) {
    const to = this.normalizeNumber(input.to);

    // Template ID is required for business-initiated WhatsApp messages
    if (!input.templateId) {
      this.logger.warn(`No templateId provided for ${to} — WhatsApp requires a template for outbound messages`);
      return { success: false, data: { error: 'templateId is required for WhatsApp outbound messages' } };
    }

    try {
      // Build components using MSG91 key-value format
      //
      // Named params (object format):
      //   { "amount": 2000, "channel": "Google Ads" }
      //   → "body_amount": { "type": "text", "value": "2000", "parameter_name": "amount" }
      //   → "body_channel": { "type": "text", "value": "Google Ads", "parameter_name": "channel" }
      //
      // Positional params (array format, fallback):
      //   ["2000", "Google Ads"]
      //   → "body_1": { "type": "text", "value": "2000" }
      //   → "body_2": { "type": "text", "value": "Google Ads" }
      const components: Record<string, { type: string; value: string; parameter_name?: string }> = {};
      if (input.params && typeof input.params === 'object' && !Array.isArray(input.params)) {
        // Named parameters — use param name as the component key prefix
        for (const [key, value] of Object.entries(input.params)) {
          components[`body_${key}`] = {
            type: 'text',
            value: String(value),
            parameter_name: key,
          };
        }
      } else if (Array.isArray(input.params)) {
        // Positional parameters — fallback for backward compatibility
        for (let i = 0; i < input.params.length; i++) {
          components[`body_${i + 1}`] = {
            type: 'text',
            value: String(input.params[i]),
          };
        }
      }

      const payload = {
        integrated_number: this.integratedNumber,
        content_type: 'template',
        payload: {
          messaging_product: 'whatsapp',
          type: 'template',
          template: {
            name: input.templateId,
            language: {
              code: 'en_US',
              policy: 'deterministic',
            },
            namespace: this.namespace,
            to_and_components: [
              {
                to: [to],
                components,
              },
            ],
          },
        },
      };

      const url = this.apiBase.endsWith('/')
        ? `${this.apiBase}whatsapp-outbound-message/bulk/`
        : `${this.apiBase}/whatsapp-outbound-message/bulk/`;

      this.logger.log(
        `MSG91 WhatsApp v5 send: url=${url} to=${to} template=${input.templateId}`,
      );
      this.logger.debug(`MSG91 WhatsApp v5 payload: ${JSON.stringify(payload)}`);

      const response = await axios.post(url, payload, {
        headers: {
          authkey: this.authKey,
          'Content-Type': 'application/json',
        },
      });

      this.logger.log(`MSG91 WhatsApp v5 response: ${JSON.stringify(response.data)}`);
      return { success: true, data: response.data };
    } catch (error: unknown) {
      if (error instanceof AxiosError) {
        this.logger.error(
          'MSG91 WhatsApp v5 Error: ' + JSON.stringify(error.response?.data ?? error.message),
        );
      } else if (error instanceof Error) {
        this.logger.error('MSG91 WhatsApp v5 Error: ' + error.message);
      } else {
        this.logger.error('MSG91 WhatsApp v5 Error: ' + String(error));
      }
      return { success: false, data: null };
    }
  }
}
