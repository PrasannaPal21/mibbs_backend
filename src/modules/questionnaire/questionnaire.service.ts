import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CompetitionLevel,
  DigitalMaturity,
  Prisma,
  SalesChannel,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DecisionEngineService } from '../decision-engine/decision-engine.service';
import { MarketingPlansService } from '../marketing-plans/marketing-plans.service';
import {
  QUESTIONNAIRE_TOTAL_STEPS,
  STEP_TITLES,
  INDUSTRY_OPTIONS,
  YEARS_IN_BUSINESS_OPTIONS,
} from './questionnaire.constants';

/** Strict per-step allow-list. Any key not in this list is dropped — the
 *  client can never inject arbitrary fields into the session JSON. */
const STEP_FIELD_WHITELIST: Record<number, string[]> = {
  1: ['name', 'businessName', 'noBusinessName'],
  2: ['industry', 'location', 'yearsInBusiness', 'salesChannel', 'digitalMaturity'],
  3: ['monthlyRevenue', 'monthlyBudget'],
  4: ['targetAudience', 'competitionLevel', 'marketingGoal'],
  5: ['challenges'],
  6: ['objectives'],
  7: ['confirmed'],
  8: ['confirmed'],
};

const MAX_STRING_LEN = 200;

export interface QuestionnaireResponses {
  step1?: { name?: string; businessName?: string; noBusinessName?: boolean };
  step2?: {
    industry?: string;
    location?: string;
    yearsInBusiness?: string;
    salesChannel?: SalesChannel;
    digitalMaturity?: DigitalMaturity;
  };
  step3?: { monthlyRevenue?: number; monthlyBudget?: number };
  step4?: {
    targetAudience?: string;
    competitionLevel?: CompetitionLevel;
    marketingGoal?: string;
  };
  step5?: { challenges?: number[] };
  step6?: { objectives?: number[] };
  step7?: { confirmed?: boolean };
}

@Injectable()
export class QuestionnaireService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly decisionEngine: DecisionEngineService,
    private readonly marketingPlans: MarketingPlansService,
  ) {}

  async getMetadata() {
    const matrix = await this.decisionEngine.loadActiveMatrix();
    return {
      totalSteps: QUESTIONNAIRE_TOTAL_STEPS,
      stepTitles: STEP_TITLES,
      industries: INDUSTRY_OPTIONS,
      yearsInBusiness: YEARS_IN_BUSINESS_OPTIONS,
      salesChannels: Object.values(SalesChannel),
      digitalMaturityLevels: Object.values(DigitalMaturity),
      competitionLevels: Object.values(CompetitionLevel),
      challenges: matrix.challenges.map((label, index) => ({ index, label })),
      objectives: matrix.objectives.map((key, index) => ({
        index,
        key,
        label: key.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
      })),
    };
  }

  async getOrCreateSession(userId: string) {
    let session = await this.prisma.questionnaireSession.findFirst({
      where: { userId, isCompleted: false },
      orderBy: { updatedAt: 'desc' },
    });
    if (!session) {
      session = await this.prisma.questionnaireSession.create({
        data: { userId, currentStep: 1, responses: {} },
      });
    }
    return this.formatSession(session);
  }

  async saveStep(userId: string, step: number, data: Record<string, unknown>) {
    const sanitized = this.sanitizeStepPayload(step, data);
    const session = await this.getOrCreateSessionRecord(userId);
    const responses = (session.responses as QuestionnaireResponses) ?? {};
    const key = `step${step}` as keyof QuestionnaireResponses;
    responses[key] = { ...(responses[key] as object), ...sanitized } as never;

    if (step === 1) await this.syncStep1ToProfile(userId, responses.step1);

    const nextStep = Math.min(QUESTIONNAIRE_TOTAL_STEPS, Math.max(session.currentStep, step + 1));

    const updated = await this.prisma.questionnaireSession.update({
      where: { id: session.id },
      data: {
        responses: responses as Prisma.InputJsonValue,
        currentStep: step >= session.currentStep ? nextStep : session.currentStep,
      },
    });
    return this.formatSession(updated);
  }

  /**
   * Strict per-step input shaping. Drops any keys not in the allow-list and
   * coerces / clamps values into safe types so we never store unbounded user
   * input in the responses JSON.
   */
  private sanitizeStepPayload(step: number, data: Record<string, unknown>): Record<string, unknown> {
    const allowed = STEP_FIELD_WHITELIST[step];
    if (!allowed) throw new BadRequestException(`Invalid step: ${step}`);
    const out: Record<string, unknown> = {};
    for (const key of allowed) {
      if (!(key in data)) continue;
      const raw = data[key];
      out[key] = this.coerceField(step, key, raw);
    }
    return out;
  }

  private coerceField(step: number, key: string, raw: unknown): unknown {
    // Enum-y string fields — pin to the Prisma enums where possible
    if (step === 2 && key === 'salesChannel' && typeof raw === 'string') {
      return Object.values(SalesChannel).includes(raw as SalesChannel) ? raw : undefined;
    }
    if (step === 2 && key === 'digitalMaturity' && typeof raw === 'string') {
      return Object.values(DigitalMaturity).includes(raw as DigitalMaturity) ? raw : undefined;
    }
    if (step === 4 && key === 'competitionLevel' && typeof raw === 'string') {
      return Object.values(CompetitionLevel).includes(raw as CompetitionLevel) ? raw : undefined;
    }
    if (step === 5 && key === 'challenges') {
      return this.cleanIndexArray(raw);
    }
    if (step === 6 && key === 'objectives') {
      return this.cleanIndexArray(raw);
    }
    if (step === 3 && (key === 'monthlyRevenue' || key === 'monthlyBudget')) {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 1e12) return undefined;
      return n;
    }
    if (step === 1 && key === 'noBusinessName') return Boolean(raw);
    if ((step === 7 || step === 8) && key === 'confirmed') return Boolean(raw);
    // Default: strings get trimmed + length-capped, everything else is dropped
    if (typeof raw === 'string') return raw.trim().slice(0, MAX_STRING_LEN);
    return undefined;
  }

  private cleanIndexArray(raw: unknown): number[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<number>();
    for (const v of raw) {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0 && n < 10) seen.add(n);
    }
    return [...seen].sort((a, b) => a - b);
  }

  async submit(userId: string) {
    const session = await this.getOrCreateSessionRecord(userId);
    const r = session.responses as QuestionnaireResponses;
    this.validateComplete(r);

    const challengeVector = this.toBinaryVector(r.step5!.challenges!, 10);
    const objectiveMask = this.toBinaryVector(r.step6!.objectives!, 10);
    const monthlyBudget = Number(r.step3!.monthlyBudget);

    await this.syncProfileFromResponses(userId, r);

    // Pure compute happens outside the transaction (no DB calls).
    const planResult = await this.decisionEngine.generatePlan({
      challengeVector,
      objectiveMask,
      monthlyBudget,
    });

    // Evaluation + Plan create + session-close run atomically — partial
    // failure mid-way cannot leave orphan rows.
    const { evaluationId, plan } = await this.prisma.$transaction(async (tx) => {
      const evaluation = await tx.evaluation.create({
        data: {
          userId,
          sessionId: session.id,
          matrixVersion: planResult.matrixVersion,
          challengeVector,
          objectiveMask,
          rawScores: planResult.rawScores,
          normalizedScores: planResult.normalizedScores,
        },
      });

      // Mark prior plans as historical
      await tx.marketingPlan.updateMany({
        where: { userId, isCurrent: true },
        data: { isCurrent: false },
      });

      const created = await tx.marketingPlan.create({
        data: {
          userId,
          evaluationId: evaluation.id,
          monthlyBudget: planResult.monthlyBudget,
          annualBudget: planResult.annualBudget,
          allocations: planResult.allocations as unknown as Prisma.InputJsonValue,
          actionPlan: planResult.actionPlan as unknown as Prisma.InputJsonValue,
          isCurrent: true,
        },
      });

      await tx.questionnaireSession.update({
        where: { id: session.id },
        data: {
          isCompleted: true,
          completedAt: new Date(),
          currentStep: QUESTIONNAIRE_TOTAL_STEPS,
        },
      });

      return { evaluationId: evaluation.id, plan: created };
    });

    // Format the plan with full nested relations for the response — read-only,
    // outside the transaction so we keep the write transaction tight.
    const formatted = await this.marketingPlans.getById(userId, plan.id);
    return { evaluationId, planId: plan.id, plan: formatted };
  }

  private async getOrCreateSessionRecord(userId: string) {
    const existing = await this.prisma.questionnaireSession.findFirst({
      where: { userId, isCompleted: false },
      orderBy: { updatedAt: 'desc' },
    });
    if (existing) return existing;
    return this.prisma.questionnaireSession.create({
      data: { userId, currentStep: 1, responses: {} },
    });
  }

  private formatSession(session: {
    id: string;
    currentStep: number;
    totalSteps: number;
    isCompleted: boolean;
    responses: unknown;
    startedAt: Date;
    completedAt: Date | null;
  }) {
    return {
      id: session.id,
      currentStep: session.currentStep,
      totalSteps: session.totalSteps,
      isCompleted: session.isCompleted,
      stepTitle: STEP_TITLES[session.currentStep] ?? '',
      responses: session.responses as QuestionnaireResponses,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
    };
  }

  private toBinaryVector(indices: number[], size: number): number[] {
    const vec = Array(size).fill(0);
    for (const i of indices) {
      if (i >= 0 && i < size) vec[i] = 1;
    }
    return vec;
  }

  private validateComplete(r: QuestionnaireResponses) {
    if (!r.step1?.name?.trim()) throw new BadRequestException('Step 1: name is required');
    if (!r.step1.noBusinessName && !r.step1.businessName?.trim()) {
      throw new BadRequestException('Step 1: business name is required');
    }
    if (!r.step2?.industry) throw new BadRequestException('Step 2: industry is required');
    if (!r.step2?.location?.trim()) throw new BadRequestException('Step 2: location is required');
    if (!r.step3?.monthlyBudget || r.step3.monthlyBudget <= 0) {
      throw new BadRequestException('Step 3: monthly marketing budget is required');
    }
    if (!r.step5?.challenges?.length) {
      throw new BadRequestException('Step 5: select at least one challenge');
    }
    if (!r.step6?.objectives?.length) {
      throw new BadRequestException('Step 6: select at least one objective');
    }
  }

  private async syncStep1ToProfile(
    userId: string,
    step1?: QuestionnaireResponses['step1'],
  ) {
    if (!step1) return;
    await this.prisma.user.update({
      where: { id: userId },
      data: { name: step1.name?.trim() ?? undefined },
    });
    await this.prisma.businessProfile.upsert({
      where: { userId },
      create: {
        userId,
        businessName: step1.noBusinessName ? null : step1.businessName?.trim(),
      },
      update: {
        businessName: step1.noBusinessName ? null : step1.businessName?.trim(),
      },
    });
  }

  private async syncProfileFromResponses(userId: string, r: QuestionnaireResponses) {
    await this.syncStep1ToProfile(userId, r.step1);
    await this.prisma.businessProfile.upsert({
      where: { userId },
      create: {
        userId,
        industry: r.step2?.industry,
        location: r.step2?.location,
        yearsInBusiness: r.step2?.yearsInBusiness,
        salesChannel: r.step2?.salesChannel,
        digitalMaturity: r.step2?.digitalMaturity,
        monthlyRevenue: r.step3?.monthlyRevenue,
        monthlyBudget: r.step3?.monthlyBudget,
        targetAudience: r.step4?.targetAudience,
        competitionLevel: r.step4?.competitionLevel,
        marketingGoal: r.step4?.marketingGoal,
      },
      update: {
        industry: r.step2?.industry,
        location: r.step2?.location,
        yearsInBusiness: r.step2?.yearsInBusiness,
        salesChannel: r.step2?.salesChannel,
        digitalMaturity: r.step2?.digitalMaturity,
        monthlyRevenue: r.step3?.monthlyRevenue,
        monthlyBudget: r.step3?.monthlyBudget,
        targetAudience: r.step4?.targetAudience,
        competitionLevel: r.step4?.competitionLevel,
        marketingGoal: r.step4?.marketingGoal,
      },
    });
  }
}
