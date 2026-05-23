import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SMS_PROVIDER } from './sms.interface';
import { StubSmsProvider } from './stub-sms.provider';
import { TwilioSmsProvider } from './twilio-sms.provider';
import type { Env } from '../../config/env.schema';

@Global()
@Module({
  providers: [
    StubSmsProvider,
    TwilioSmsProvider,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService, StubSmsProvider, TwilioSmsProvider],
      useFactory: (
        config: ConfigService<Env, true>,
        stub: StubSmsProvider,
        twilio: TwilioSmsProvider,
      ) => {
        const provider = config.get('SMS_PROVIDER', { infer: true });
        return provider === 'twilio' ? twilio : stub;
      },
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
