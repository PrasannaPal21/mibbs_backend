export interface SendSmsInput {
  to: string; // E.164 phone number (e.g. +91......)
  body: string; // message body (OtpService uses `body`)
  tag?: string; // optional analytics/observability tag
  // Optional named variables for MSG91 Flow API sends.
  // When omitted, the whole `body` is passed as the flow's `var` placeholder.
  params?: Record<string, string | number>;
}

export interface SmsProvider {
  send(input: SendSmsInput): Promise<{ success: boolean; data?: any }>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
