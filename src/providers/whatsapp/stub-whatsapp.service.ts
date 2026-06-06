import { Injectable, Logger } from '@nestjs/common';
import { SendWhatsappInput, WhatsappProvider } from './whatsapp.interface';

@Injectable()
export class StubWhatsappService implements WhatsappProvider {
  private readonly logger = new Logger(StubWhatsappService.name);
  async send(input: SendWhatsappInput) {
    this.logger.debug(`StubWhatsapp send to=${input.to} body=${input.body ?? '<template>'}`);
    return { success: true, data: { stub: true } };
  }
}
