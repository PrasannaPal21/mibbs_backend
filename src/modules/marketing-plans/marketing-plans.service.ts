import { BadRequestException, Injectable, NotFoundException, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DecisionEngineService } from '../decision-engine/decision-engine.service';
import type { PlanGenerationResult } from '../decision-engine/decision-engine.types';
import { resolveMarketingGoals } from '../questionnaire/questionnaire.constants';
import { NotificationService } from '../../providers/notification/notification.service';

@Injectable()
export class MarketingPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly decisionEngine: DecisionEngineService,
    private readonly notifications: NotificationService,
  ) {}

  async createFromEvaluation(
    userId: string,
    evaluationId: string,
    result: PlanGenerationResult,
  ) {
    await this.prisma.marketingPlan.updateMany({
      where: { userId, isCurrent: true },
      data: { isCurrent: false },
    });

    const plan = await this.prisma.marketingPlan.create({
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

    // Best-effort notification; do not block plan creation
    try {
      await this.notifications.notifyPlanGenerated(userId, {
        monthlyBudget: Number(result.monthlyBudget),
        annualBudget: Number(result.annualBudget),
      });
    } catch (err) {
      // ignore notification errors
    }

    return plan;
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

  /**
   * Let the user change their monthly budget without re-running the full
   * questionnaire. We keep the same challenge/objective vectors from the
   * original evaluation and re-run only the allocator step.
   */
  async updateBudget(userId: string, planId: string, monthlyBudget: number) {
    if (!Number.isFinite(monthlyBudget) || monthlyBudget <= 0) {
      throw new BadRequestException('monthlyBudget must be a positive number');
    }

    const plan = await this.prisma.marketingPlan.findFirst({
      where: { id: planId, userId },
      include: { evaluation: true },
    });
    if (!plan) throw new NotFoundException('Marketing plan not found');

    const ev = plan.evaluation;
    const result = await this.decisionEngine.generatePlan({
      challengeVector: ev.challengeVector,
      objectiveMask: ev.objectiveMask,
      monthlyBudget,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.marketingPlan.update({
        where: { id: planId },
        data: {
          monthlyBudget: result.monthlyBudget,
          annualBudget: result.annualBudget,
          allocations: result.allocations as unknown as Prisma.InputJsonValue,
          actionPlan: result.actionPlan as unknown as Prisma.InputJsonValue,
        },
        include: {
          evaluation: true,
          user: { include: { businessProfile: true } },
        },
      });
      await tx.businessProfile.updateMany({
        where: { userId },
        data: { monthlyBudget: result.monthlyBudget },
      });
      return row;
    });

    // Notify user about budget update (best-effort)
    try {
      await this.notifications.notifyPlanUpdated(userId, { monthlyBudget: Number(updated.monthlyBudget) });
    } catch (err) {
      // ignore notification errors
    }

    return this.formatPlan(updated);
  }

  /**
   * Returned business-profile shape — kept loose (string | null) so the
   * frontend doesn't have to know about Prisma enums.
   */
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
        yearsInBusiness: string | null;
        digitalMaturity: string | null;
        salesChannel: string | null;
        monthlyRevenue: Prisma.Decimal | null;
        monthlyBudget: Prisma.Decimal | null;
        targetAudience: string | null;
        competitionLevel: string | null;
        marketingGoal: string | null;
      } | null;
    };
  }) {
    const bp = plan.user.businessProfile;
    const fallbackGoals = (() => {
      const top = deriveTopAllocationLabel(plan.allocations);
      return top ? [top] : [];
    })();
    const marketingGoals = bp
      ? resolveMarketingGoals(bp.marketingGoal, plan.evaluation.objectiveMask)
      : resolveMarketingGoals(null, plan.evaluation.objectiveMask);
    const goals =
      marketingGoals.length > 0 ? marketingGoals : fallbackGoals;
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
            yearsInBusiness: bp.yearsInBusiness,
            digitalMaturity: bp.digitalMaturity,
            salesChannel: bp.salesChannel,
            monthlyRevenue: bp.monthlyRevenue ? Number(bp.monthlyRevenue) : null,
            monthlyBudget: bp.monthlyBudget ? Number(bp.monthlyBudget) : null,
            targetAudience: bp.targetAudience,
            competitionLevel: bp.competitionLevel,
            marketingGoal: goals[0] ?? null,
            marketingGoals: goals,
          }
        : null,
      evaluation: {
        challengeVector: plan.evaluation.challengeVector,
        objectiveMask: plan.evaluation.objectiveMask,
      },
    };
  }
}

/** Best-effort fallback: the allocation with the largest amount becomes the
 *  headline marketing goal when the profile has no explicit value yet. */
function deriveTopAllocationLabel(allocations: unknown): string | null {
  if (!Array.isArray(allocations) || allocations.length === 0) return null;
  const rows = allocations as Array<{ label?: string; amount?: number }>;
  const top = [...rows].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0];
  return top?.label ?? null;
}
