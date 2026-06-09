import { Module } from '@nestjs/common';
import { SpendController } from './spend.controller';
import { SpendService } from './spend.service';
import { NotificationModule } from '../../providers/notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [SpendController],
  providers: [SpendService],
  exports: [SpendService],
})
export class SpendModule {}
