import { Injectable, Logger } from '@nestjs/common';
import type { EmailProvider, SendEmailInput } from './email.interface';

@Injectable()
export class StubEmailProvider implements EmailProvider {
  private readonly logger = new Logger('Email/Stub');

  async send(input: SendEmailInput) {
    this.logger.log(`[stub] -> ${input.to} | ${input.subject}${input.tag ? ` | tag=${input.tag}` : ''}`);
    if (process.env.NODE_ENV !== 'production') {
      this.logger.debug(`text: ${input.text ?? '(no text)'}`);
    }
    return { id: `stub-${Date.now()}`, accepted: true };
  }
}
