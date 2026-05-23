export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Optional template tag for analytics/observability */
  tag?: string;
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<{ id?: string; accepted: boolean }>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
