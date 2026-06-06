export interface SendWhatsappInput {
  to: string; // E.164 phone number (e.g. +91...)
  body?: string; // plain text fallback
  templateId?: string; // optional template id for template sends
  params?: Array<string | number> | Record<string, unknown>; // template params
  tag?: string;
}

export interface WhatsappProvider {
  send(input: SendWhatsappInput): Promise<{ success: boolean; data?: any }>;
}

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');
