import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { PlanGenerationResult } from '../decision-engine/decision-engine.types';

@Injectable()
export class MarketingPlansService {
  constructor(private readonly prisma: PrismaService) {}

  async createFromEvaluation(
    userId: string,
    evaluationId: string,
    result: PlanGenerationResult,
  ) {
    await this.prisma.marketingPlan.updateMany({
      where: { userId, isCurrent: true },
      data: { isCurrent: false },
    });

    return this.prisma.marketingPlan.create({
      data: {
        userId,
        evaluationId,
        monthlyBudget: result.monthlyBudget,
        annualBudget: result.annualBudget,
        allocations: result.allocations as unknown as Prisma.InputJsonValue,
        actionPlan: result.actionPlan as unknown as Prisma.InputJsonValue,
        isCurrent: true,
      },
    });
  }

  async getCurrent(userId: string) {
    const plan = await this.prisma.marketingPlan.findFirst({
      where: { userId, isCurrent: true },
      orderBy: { generatedAt: 'desc' },
      include: {
        evaluation: true,
        user: { include: { businessProfile: true } },
      },
    });
    if (!plan) throw new NotFoundException('No marketing plan found. Complete the questionnaire first.');
    return this.formatPlan(plan);
  }

  async getById(userId: string, planId: string) {
    const plan = await this.prisma.marketingPlan.findFirst({
      where: { id: planId, userId },
      include: {
        evaluation: true,
        user: { include: { businessProfile: true } },
      },
    });
    if (!plan) throw new NotFoundException('Marketing plan not found');
    return this.formatPlan(plan);
  }

  private formatPlan(plan: {
    id: string;
    monthlyBudget: Prisma.Decimal;
    annualBudget: Prisma.Decimal;
    allocations: unknown;
    actionPlan: unknown;
    generatedAt: Date;
    evaluation: { challengeVector: number[]; objectiveMask: number[] };
    user: {
      name: string;
      email: string;
      businessProfile: {
        businessName: string | null;
        industry: string | null;
        location: string | null;
        monthlyRevenue: Prisma.Decimal | null;
        monthlyBudget: Prisma.Decimal | null;
        targetAudience: string | null;
        competitionLevel: string | null;
        marketingGoal: string | null;
      } | null;
    };
  }) {
    const bp = plan.user.businessProfile;
    return {
      id: plan.id,
      generatedAt: plan.generatedAt,
      monthlyBudget: Number(plan.monthlyBudget),
      annualBudget: Number(plan.annualBudget),
      allocations: plan.allocations,
      actionPlan: plan.actionPlan,
      user: { name: plan.user.name, email: plan.user.email },
      businessProfile: bp
        ? {
            businessName: bp.businessName,
            industry: bp.industry,
            location: bp.location,
            monthlyRevenue: bp.monthlyRevenue ? Number(bp.monthlyRevenue) : null,
            monthlyBudget: bp.monthlyBudget ? Number(bp.monthlyBudget) : null,
            targetAudience: bp.targetAudience,
            competitionLevel: bp.competitionLevel,
            marketingGoal: bp.marketingGoal,
          }
        : null,
      evaluation: {
        challengeVector: plan.evaluation.challengeVector,
        objectiveMask: plan.evaluation.objectiveMask,
      },
    };
  }
}
