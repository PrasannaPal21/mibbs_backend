import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import type { Env } from '../../config/env.schema';
import { SendWhatsappInput, WhatsappProvider } from './whatsapp.interface';

/**
 * WAHA (WhatsApp HTTP API) provider.
 *
 * WAHA runs as a Docker container exposing a REST API. This provider
 * communicates with it to send WhatsApp messages. Since WAHA uses a
 * personal WhatsApp account (via web.js), there is no concept of
 * pre-approved Business templates — all messages are sent as plain text.
 *
 * When a templateId is provided (e.g. "mibbs_plan_generated"), the
 * provider renders a human-readable text message from the template
 * name + params so the recipient still gets useful information.
 *
 * Required env vars (WHATSAPP_PROVIDER=waha):
 *   WAHA_BASE_URL  — Base URL of the WAHA instance (e.g. http://localhost:3000)
 *   WAHA_SESSION   — Session name to use (default: "default")
 *   WAHA_API_KEY   — Optional API key if WAHA is configured with authentication
 */
@Injectable()
export class WahaWhatsappService implements WhatsappProvider {
  private readonly logger = new Logger(WahaWhatsappService.name);
  private baseUrl: string;
  private session: string;
  private apiKey: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.baseUrl = (this.config.get('WAHA_BASE_URL', { infer: true }) || 'http://localhost:3000').replace(/\/+$/, '');
    this.session = this.config.get('WAHA_SESSION', { infer: true }) || 'default';
    this.apiKey = this.config.get('WAHA_API_KEY', { infer: true }) || '';

    this.logger.log(
      `WAHA WhatsApp: baseUrl=${this.baseUrl} session=${this.session} apiKey=${this.apiKey ? '✓' : '✗'}`,
    );
  }

  async send(input: SendWhatsappInput): Promise<{ success: boolean; data?: any }> {
    const chatId = this.toChatId(input.to);

    // WAHA doesn't support Business templates — render a text message instead
    const text = input.templateId
      ? this.renderTemplateMessage(input.templateId, input.params)
      : input.body ?? '';

    if (!text) {
      this.logger.warn(`WAHA send: empty message for ${chatId}, skipping`);
      return { success: false, data: { error: 'empty-message' } };
    }

    try {
      this.logger.debug(`WAHA send to=${chatId} template=${input.templateId ?? 'none'}`);

      const payload: Record<string, unknown> = {
        chatId,
        text,
        session: this.session,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers['X-Api-Key'] = this.apiKey;
      }

      const response = await axios.post(`${this.baseUrl}/api/sendText`, payload, { headers });

      this.logger.debug(`WAHA response: ${JSON.stringify(response.data)}`);
      return { success: true, data: response.data };
    } catch (error: unknown) {
      if (error instanceof AxiosError) {
        this.logger.error(
          `WAHA Error (${error.response?.status ?? 'unknown'}): ${JSON.stringify(error.response?.data ?? error.message)}`,
        );
      } else if (error instanceof Error) {
        this.logger.error('WAHA Error: ' + error.message);
      } else {
        this.logger.error('WAHA Error: ' + String(error));
      }
      return { success: false, data: null };
    }
  }

  /**
   * Convert an E.164 phone number (e.g. "+919840228021") to WAHA's chatId
   * format: "919840228021@c.us"
   */
  private toChatId(phone: string): string {
    const digits = phone.replace(/[^0-9]/g, '');
    return `${digits}@c.us`;
  }

  /**
   * Render a template-based notification as a readable text message.
   * This maps internal template names to user-friendly messages.
   */
  private renderTemplateMessage(
    templateId: string,
    params?: Array<string | number> | Record<string, unknown>,
  ): string {
    const p = Array.isArray(params) ? params : [];
    switch (templateId) {
      case 'mibbs_plan_generated':
        return (
          `🎉 *Your MIBBS Marketing Plan is Ready!*\n\n` +
          `Hi ${p[0] ?? 'there'}, your personalised marketing plan has been generated.\n\n` +
          `📊 *Monthly Budget:* ₹${p[1] ?? '—'}\n` +
          `📅 *Annual Budget:* ₹${p[2] ?? '—'}\n\n` +
          `Log in to your dashboard to view the full channel allocation and action plan.`
        );

      case 'mibbs_plan_created':
        return (
          `✅ *MIBBS Plan Created*\n\n` +
          `Hi ${p[0] ?? 'there'}, your marketing plan has been created successfully.\n` +
          `Monthly budget: ₹${p[1] ?? '—'}`
        );

      case 'mibbs_plan_updated':
        return (
          `🔄 *Budget Updated*\n\n` +
          `Your marketing budget has been revised to *₹${p[0] ?? '—'}*/month.*\n` +
          `All channel allocations have been recalculated.`
        );

      case 'mibbs_spend_logs':
        return (
          `✅ *Spend Recorded*\n\n` +
          `A new marketing expense has been logged:\n` +
          `Amount: *₹${p[0] ?? '—'}*\n` +
          `Channel: ${p[1] ?? '—'}`
        );

      case 'mibbs_spend_remove':
        return (
          `🗑️ *Spend Entry Removed*\n\n` +
          `A previously recorded expense has been removed:\n` +
          `Amount: ₹${p[0] ?? '—'}\n` +
          `Channel: ${p[1] ?? '—'}`
        );

      default:
        // Fallback: just return the template name + params as text
        return `[MIBBS] ${templateId}${p.length ? ': ' + p.join(', ') : ''}`;
    }
  }
}
