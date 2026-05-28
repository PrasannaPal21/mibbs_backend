import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { FeedbackService } from './feedback.service';

@ApiTags('feedback')
@ApiBearerAuth()
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @ApiOperation({ summary: 'Submit feedback (rating + optional comments)' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFeedbackDto) {
    return this.feedback.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List the current user\u2019s recent feedback entries' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.feedback.listForUser(user.id);
  }
}
