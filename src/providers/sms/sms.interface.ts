export interface SendSmsInput {
  to: string; // E.164
  body: string;
  tag?: string;
}

export interface SmsProvider {
  send(input: SendSmsInput): Promise<{ id?: string; accepted: boolean }>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
