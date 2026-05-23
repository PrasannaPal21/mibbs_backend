import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { SaveQuestionnaireStepDto } from './dto/save-step.dto';
import { QuestionnaireService } from './questionnaire.service';

@ApiTags('questionnaire')
@ApiBearerAuth()
@Controller('questionnaire')
export class QuestionnaireController {
  constructor(private readonly questionnaire: QuestionnaireService) {}

  @Get('metadata')
  @ApiOperation({ summary: 'Challenges, objectives, and step config for the wizard' })
  getMetadata() {
    return this.questionnaire.getMetadata();
  }

  @Get('session')
  @ApiOperation({ summary: 'Get or create the active questionnaire session (save/resume)' })
  getSession(@CurrentUser() user: AuthenticatedUser) {
    return this.questionnaire.getOrCreateSession(user.id);
  }

  @Put('session')
  @ApiOperation({ summary: 'Save a step and merge responses' })
  saveStep(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveQuestionnaireStepDto) {
    return this.questionnaire.saveStep(user.id, dto.step, dto.data);
  }

  @Post('submit')
  @ApiOperation({ summary: 'Validate all steps, run decision engine, create marketing plan' })
  submit(@CurrentUser() user: AuthenticatedUser) {
    return this.questionnaire.submit(user.id);
  }
}
