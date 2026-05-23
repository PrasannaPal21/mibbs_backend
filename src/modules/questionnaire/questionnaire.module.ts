import { Module } from '@nestjs/common';
import { DecisionEngineModule } from '../decision-engine/decision-engine.module';
import { MarketingPlansModule } from '../marketing-plans/marketing-plans.module';
import { QuestionnaireController } from './questionnaire.controller';
import { QuestionnaireService } from './questionnaire.service';

@Module({
  imports: [DecisionEngineModule, MarketingPlansModule],
  controllers: [QuestionnaireController],
  providers: [QuestionnaireService],
  exports: [QuestionnaireService],
})
export class QuestionnaireModule {}
