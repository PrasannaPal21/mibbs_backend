import { Controller, Post, Req, Logger } from '@nestjs/common';

@Controller('webhook/msg91')
export class Msg91WebhookController {
  private readonly logger = new Logger(Msg91WebhookController.name);

  @Post()
  async handle(@Req() req: any) {
    this.logger.debug('MSG91 webhook payload: ' + JSON.stringify(req.body));
    // Keep the handler minimal: log the entire payload for inspection.
    return { received: true };
  }
}
