import { Module } from '@nestjs/common';
import { DecisionEngineModule } from '../decision-engine/decision-engine.module';
import { MarketingPlansController } from './marketing-plans.controller';
import { MarketingPlansService } from './marketing-plans.service';
import { NotificationModule } from '../../providers/notification/notification.module';

@Module({
  imports: [DecisionEngineModule, NotificationModule],
  controllers: [MarketingPlansController],
  providers: [MarketingPlansService],
  exports: [MarketingPlansService],
})
export class MarketingPlansModule {}
