import { Injectable, Logger } from '@nestjs/common';
import type { SmsProvider, SendSmsInput } from './sms.interface';

@Injectable()
export class StubSmsProvider implements SmsProvider {
  private readonly logger = new Logger('Sms/Stub');

  async send(input: SendSmsInput) {
    this.logger.log(`[stub] -> ${input.to} | ${input.body}${input.tag ? ` | tag=${input.tag}` : ''}`);
    return { id: `stub-${Date.now()}`, accepted: true };
  }
}
