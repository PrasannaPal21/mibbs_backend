import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CreateFeedbackDto } from './dto/create-feedback.dto';

@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a feedback entry. `planId` is validated against the user's own
   * plans so we never let a user attach feedback to someone else's plan.
   */
  async create(userId: string, dto: CreateFeedbackDto) {
    let planId: string | null = null;
    if (dto.planId) {
      const owned = await this.prisma.marketingPlan.findFirst({
        where: { id: dto.planId, userId },
        select: { id: true },
      });
      if (owned) planId = owned.id;
    }
    const row = await this.prisma.feedback.create({
      data: {
        userId,
        planId,
        rating: dto.rating,
        comments: dto.comments?.trim() || null,
      },
    });
    return this.format(row);
  }

  /** List the most recent 20 feedback entries for the current user. */
  async listForUser(userId: string) {
    const rows = await this.prisma.feedback.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((r) => this.format(r));
  }

  private format(row: {
    id: string;
    rating: number;
    comments: string | null;
    planId: string | null;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      rating: row.rating,
      comments: row.comments,
      planId: row.planId,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
