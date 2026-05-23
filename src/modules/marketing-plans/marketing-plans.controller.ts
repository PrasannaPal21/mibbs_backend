import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { MarketingPlansService } from './marketing-plans.service';

@ApiTags('marketing-plans')
@ApiBearerAuth()
@Controller('marketing-plans')
export class MarketingPlansController {
  constructor(private readonly plans: MarketingPlansService) {}

  @Get('current')
  @ApiOperation({ summary: 'Get the current marketing plan for the authenticated user' })
  getCurrent(@CurrentUser() user: AuthenticatedUser) {
    return this.plans.getCurrent(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a marketing plan by id' })
  getById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.plans.getById(user.id, id);
  }
}
