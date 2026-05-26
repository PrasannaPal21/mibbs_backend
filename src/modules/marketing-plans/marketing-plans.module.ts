import { Module } from '@nestjs/common';
import { DecisionEngineModule } from '../decision-engine/decision-engine.module';
import { MarketingPlansController } from './marketing-plans.controller';
import { MarketingPlansService } from './marketing-plans.service';

@Module({
  imports: [DecisionEngineModule],
  controllers: [MarketingPlansController],
  providers: [MarketingPlansService],
  exports: [MarketingPlansService],
})
export class MarketingPlansModule {}
