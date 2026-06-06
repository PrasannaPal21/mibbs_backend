export interface SendSmsInput {
  to: string; // E.164 phone number (e.g. +91......)
  body: string; // message body (OtpService uses `body`)
  tag?: string; // optional analytics/observability tag
}

export interface SmsProvider {
  send(input: SendSmsInput): Promise<{ success: boolean; data?: any }>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
