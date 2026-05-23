import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CreateSpendDto } from './dto/create-spend.dto';
import { SpendService } from './spend.service';

@ApiTags('spend')
@ApiBearerAuth()
@Controller('spend')
export class SpendController {
  constructor(private readonly spend: SpendService) {}

  @Post()
  @ApiOperation({ summary: 'Log marketing spend for a plan channel' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSpendDto) {
    return this.spend.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List spend logs for a plan (default: current plan)' })
  @ApiQuery({ name: 'planId', required: false })
  list(@CurrentUser() user: AuthenticatedUser, @Query('planId') planId?: string) {
    return this.spend.list(user.id, planId);
  }

  @Get('compliance')
  @ApiOperation({ summary: 'Planned vs actual spend + compliance score (0–100)' })
  @ApiQuery({ name: 'planId', required: false })
  @ApiQuery({ name: 'month', required: false, description: 'YYYY-MM (default: current month)' })
  compliance(
    @CurrentUser() user: AuthenticatedUser,
    @Query('planId') planId?: string,
    @Query('month') month?: string,
  ) {
    return this.spend.getCompliance(user.id, planId, month);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a spend log entry' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.spend.remove(user.id, id);
  }
}
