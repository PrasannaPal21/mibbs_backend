import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMAIL_PROVIDER } from './email.interface';
import { StubEmailProvider } from './stub-email.provider';
import { ResendEmailProvider } from './resend-email.provider';
import type { Env } from '../../config/env.schema';

@Global()
@Module({
  providers: [
    StubEmailProvider,
    ResendEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService, StubEmailProvider, ResendEmailProvider],
      useFactory: (
        config: ConfigService<Env, true>,
        stub: StubEmailProvider,
        resend: ResendEmailProvider,
      ) => {
        const provider = config.get('EMAIL_PROVIDER', { infer: true });
        return provider === 'resend' ? resend : stub;
      },
    },
  ],
  exports: [EMAIL_PROVIDER],
})
export class EmailModule {}
