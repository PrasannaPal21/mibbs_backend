import { Module } from '@nestjs/common';
import { SmsService } from './sms.service';
import { SMS_PROVIDER } from './sms.interface';

@Module({
  providers: [
    SmsService,
    {
      provide: SMS_PROVIDER,
      useClass: SmsService,
    },
  ],
  exports: [SMS_PROVIDER, SmsService],
})
export class SmsModule {}