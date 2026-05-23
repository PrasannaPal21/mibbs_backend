import { Module } from '@nestjs/common';
import { MarketingPlansController } from './marketing-plans.controller';
import { MarketingPlansService } from './marketing-plans.service';

@Module({
  controllers: [MarketingPlansController],
  providers: [MarketingPlansService],
  exports: [MarketingPlansService],
})
export class MarketingPlansModule {}
