import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':planId/pdf')
  @ApiOperation({ summary: 'Download marketing plan as PDF' })
  @ApiProduces('application/pdf')
  async downloadPdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('planId') planId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const buffer = await this.reports.generatePlanPdf(user.id, planId);
    const filename = `mibbs-plan-${planId.slice(0, 8)}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    return new StreamableFile(buffer);
  }
}
