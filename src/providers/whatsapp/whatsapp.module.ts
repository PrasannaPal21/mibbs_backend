import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappProvider, WHATSAPP_PROVIDER } from './whatsapp.interface';
import { Msg91WhatsappService } from './msg91-whatsapp.service';
import { StubWhatsappService } from './stub-whatsapp.service';
import { MetaWhatsappService } from './meta-whatsapp.service';
import { Msg91WebhookController } from './msg91-webhook.controller';
import { WhatsAppEmbeddedSignupService } from './whatsapp-embedded-signup.service';
import { WhatsAppEmbeddedSignupController } from './whatsapp-embedded-signup.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';

const whatsappProviderFactory: Provider = {
  provide: WHATSAPP_PROVIDER,
  useFactory: (config: ConfigService) => {
    const provider = config.get('WHATSAPP_PROVIDER', { infer: true }) as string;
    if (provider === 'msg91') {
      return new Msg91WhatsappService(config as any);
    }
    if (provider === 'meta') {
      return new MetaWhatsappService(config as any);
    }
    return new StubWhatsappService();
  },
  inject: [ConfigService],
};

@Module({
  imports: [PrismaModule],
  controllers: [Msg91WebhookController, WhatsAppEmbeddedSignupController],
  providers: [
    Msg91WhatsappService,
    MetaWhatsappService,
    StubWhatsappService,
    WhatsAppEmbeddedSignupService,
    whatsappProviderFactory,
  ],
  exports: [WHATSAPP_PROVIDER, WhatsAppEmbeddedSignupService],
})
export class WhatsappModule {}
