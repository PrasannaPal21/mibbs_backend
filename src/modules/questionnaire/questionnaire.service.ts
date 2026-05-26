import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CompetitionLevel,
  DigitalMaturity,
  Prisma,
  SalesChannel,
} from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DecisionEngineService } from '../decision-engine/decision-engine.service';
import { MarketingPlansService } from '../marketing-plans/marketing-plans.service';
import {
  BusinessMode,
  BusinessOffering,
  BUSINESS_MODE_OPTIONS,
  BUSINESS_OFFERING_OPTIONS,
  CapitalRange,
  CAPITAL_RANGE_MIDPOINTS,
  CAPITAL_RANGE_OPTIONS,
  CHALLENGE_LABELS,
  DigitalPresence,
  DIGITAL_PRESENCE_LABELS,
  DIGITAL_PRESENCE_OPTIONS,
  EXISTING_BUDGET_PCT_OF_REVENUE,
  HelpNeeded,
  HELP_NEEDED_OPTIONS,
  HELP_TO_CHALLENGES,
  HELP_TO_OBJECTIVES,
  INDUSTRY_OPTIONS,
  isNewBusinessPath,
  MARKETING_GOAL_SEPARATOR,
  MAX_OBJECTIVES_SELECTED,
  MODE_TO_CHALLENGES,
  MonthlySpendBucket,
  MONTHLY_SPEND_BUCKET_MIDPOINTS,
  MONTHLY_SPEND_BUCKET_OPTIONS,
  NEW_BUDGET_PCT_OF_CAPITAL,
  OBJECTIVE_LABELS,
  OFFERING_TO_OBJECTIVES,
  ProductSegment,
  PRODUCT_SEGMENT_OPTIONS,
  QUESTIONNAIRE_TOTAL_STEPS,
  STAGE_OPTIONS,
  StageOption,
  STEP_TITLES,
  YEARS_IN_BUSINESS_OPTIONS,
} from './questionnaire.constants';

/**
 * Strict per-step allow-list. Any key not in this list is dropped — the
 * client can never inject arbitrary fields into the session JSON.
 *
 * The dual-path flow (new-business vs existing-business) means some steps
 * collect different fields depending on the user's `stage`. The whitelist
 * is the union of all possible keys for each step; sanitiser + validator
 * enforce the per-path semantics.
 */
const STEP_FIELD_WHITELIST: Record<number, string[]> = {
  1: ['name', 'businessName', 'noBusinessName', 'hasWebsite', 'websiteUrl', 'stage'],
  2: ['pincode', 'locality', 'location'],
  3: ['industry', 'businessOffering', 'productSegment'],
  4: ['capitalRange', 'yearsInBusiness'],
  5: ['businessMode', 'challenges'],
  6: ['helpNeeded', 'digitalPresence', 'digitalPresenceDetails', 'digitalRoi'],
  7: ['monthlyRevenue', 'monthlySpendBucket'],
  8: ['objectives'],
};

const MAX_STRING_LEN = 200;
/** Reasonable upper bound for website URL — long enough for query strings. */
const MAX_URL_LEN = 500;
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;

export interface QuestionnaireResponses {
  step1?: {
    name?: string;
    businessName?: string;
    noBusinessName?: boolean;
    hasWebsite?: boolean;
    websiteUrl?: string;
    stage?: StageOption;
  };
  step2?: { pincode?: string; locality?: string; location?: string };
  step3?: {
    industry?: string;
    businessOffering?: BusinessOffering;
    productSegment?: ProductSegment;
  };
  step4?: { capitalRange?: CapitalRange; yearsInBusiness?: string };
  step5?: { businessMode?: BusinessMode; challenges?: number[] };
  step6?: {
    helpNeeded?: HelpNeeded[];
    digitalPresence?: DigitalPresence;
    digitalPresenceDetails?: string[];
    digitalRoi?: number;
  };
  step7?: { monthlyRevenue?: number; monthlySpendBucket?: MonthlySpendBucket };
  step8?: { objectives?: number[] };
}

@Injectable()
export class QuestionnaireService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly decisionEngine: DecisionEngineService,
    private readonly marketingPlans: MarketingPlansService,
  ) {}

  async getMetadata() {
    return {
      totalSteps: QUESTIONNAIRE_TOTAL_STEPS,
      stepTitles: STEP_TITLES,
      maxObjectives: MAX_OBJECTIVES_SELECTED,
      industries: INDUSTRY_OPTIONS,
      yearsInBusiness: YEARS_IN_BUSINESS_OPTIONS,
      salesChannels: Object.values(SalesChannel),
      digitalMaturityLevels: Object.values(DigitalMaturity),
      competitionLevels: Object.values(CompetitionLevel),
      stages: STAGE_OPTIONS,
      businessOfferings: BUSINESS_OFFERING_OPTIONS,
      productSegments: PRODUCT_SEGMENT_OPTIONS,
      capitalRanges: CAPITAL_RANGE_OPTIONS,
      businessModes: BUSINESS_MODE_OPTIONS,
      helpNeeded: HELP_NEEDED_OPTIONS,
      digitalPresenceLevels: DIGITAL_PRESENCE_OPTIONS,
      digitalPresenceSubOptions: Object.fromEntries(
        DIGITAL_PRESENCE_OPTIONS.map((k) => [k, DIGITAL_PRESENCE_LABELS[k].subOptions]),
      ),
      monthlySpendBuckets: MONTHLY_SPEND_BUCKET_OPTIONS,
      // Client-friendly challenge / objective wording from the questionnaire PDF
      challenges: CHALLENGE_LABELS.map((c, index) => ({
        index,
        label: c.label,
        description: c.description,
      })),
      objectives: OBJECTIVE_LABELS.map((o, index) => ({
        index,
        key: o.key,
        label: o.label,
        description: o.description,
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

    const totalSteps = this.totalStepsForResponses(responses);
    const nextStep = Math.min(totalSteps, Math.max(session.currentStep, step + 1));

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
    // Step 1
    if (step === 1 && key === 'noBusinessName') return Boolean(raw);
    if (step === 1 && key === 'hasWebsite') return Boolean(raw);
    if (step === 1 && key === 'websiteUrl' && typeof raw === 'string') {
      return raw.trim().slice(0, MAX_URL_LEN);
    }
    if (step === 1 && key === 'stage' && typeof raw === 'string') {
      return (STAGE_OPTIONS as readonly string[]).includes(raw) ? raw : undefined;
    }
    // Step 2
    if (step === 2 && key === 'pincode' && typeof raw === 'string') {
      const trimmed = raw.trim();
      return PINCODE_REGEX.test(trimmed) ? trimmed : undefined;
    }
    // Step 3
    if (step === 3 && key === 'businessOffering' && typeof raw === 'string') {
      return (BUSINESS_OFFERING_OPTIONS as readonly string[]).includes(raw) ? raw : undefined;
    }
    if (step === 3 && key === 'productSegment' && typeof raw === 'string') {
      return (PRODUCT_SEGMENT_OPTIONS as readonly string[]).includes(raw) ? raw : undefined;
    }
    // Step 4
    if (step === 4 && key === 'capitalRange' && typeof raw === 'string') {
      return (CAPITAL_RANGE_OPTIONS as readonly string[]).includes(raw) ? raw : undefined;
    }
    if (step === 4 && key === 'yearsInBusiness' && typeof raw === 'string') {
      return (YEARS_IN_BUSINESS_OPTIONS as readonly string[]).includes(raw) ? raw : undefined;
    }
    // Step 5
    if (step === 5 && key === 'businessMode' && typeof raw === 'string') {
      return (BUSINESS_MODE_OPTIONS as readonly string[]).includes(raw) ? raw : undefined;
    }
    if (step === 5 && key === 'challenges') {
      return this.cleanIndexArray(raw);
    }
    // Step 6
    if (step === 6 && key === 'helpNeeded') {
      if (!Array.isArray(raw)) return [];
      const seen = new Set<HelpNeeded>();
      for (const v of raw) {
        if (typeof v === 'string' && (HELP_NEEDED_OPTIONS as readonly string[]).includes(v)) {
          seen.add(v as HelpNeeded);
        }
      }
      return [...seen];
    }
    if (step === 6 && key === 'digitalPresence' && typeof raw === 'string') {
      return (DIGITAL_PRESENCE_OPTIONS as readonly string[]).includes(raw) ? raw : undefined;
    }
    if (step === 6 && key === 'digitalPresenceDetails') {
      if (!Array.isArray(raw)) return [];
      const out: string[] = [];
      for (const v of raw) {
        if (typeof v === 'string') out.push(v.trim().slice(0, MAX_STRING_LEN));
      }
      return out;
    }
    if (step === 6 && key === 'digitalRoi') {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < -100 || n > 10000) return undefined;
      return n;
    }
    // Step 7
    if (step === 7 && key === 'monthlyRevenue') {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 1e12) return undefined;
      return n;
    }
    if (step === 7 && key === 'monthlySpendBucket' && typeof raw === 'string') {
      return (MONTHLY_SPEND_BUCKET_OPTIONS as readonly string[]).includes(raw) ? raw : undefined;
    }
    // Step 8
    if (step === 8 && key === 'objectives') {
      return this.cleanIndexArray(raw, MAX_OBJECTIVES_SELECTED);
    }
    // Default: strings get trimmed + length-capped, everything else is dropped
    if (typeof raw === 'string') return raw.trim().slice(0, MAX_STRING_LEN);
    return undefined;
  }

  /** Dedupe + sort + clamp an indices array, optionally capping its length. */
  private cleanIndexArray(raw: unknown, maxLen?: number): number[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<number>();
    for (const v of raw) {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0 && n < 10) seen.add(n);
    }
    const sorted = [...seen].sort((a, b) => a - b);
    return maxLen ? sorted.slice(0, maxLen) : sorted;
  }

  /** New-business path has 6 steps; existing has 8. */
  private totalStepsForResponses(r: QuestionnaireResponses): number {
    return isNewBusinessPath(r.step1?.stage) ? 6 : 8;
  }

  async submit(userId: string) {
    const session = await this.getOrCreateSessionRecord(userId);
    const r = session.responses as QuestionnaireResponses;
    this.validateComplete(r);

    const newPath = isNewBusinessPath(r.step1?.stage);
    const challengeVector = newPath
      ? this.deriveChallengesForNew(r)
      : this.toBinaryVector(r.step5?.challenges ?? [], 10);
    const objectiveMask = newPath
      ? this.deriveObjectivesForNew(r)
      : this.toBinaryVector(r.step8?.objectives ?? [], 10);
    const monthlyBudget = newPath
      ? this.deriveBudgetForNew(r)
      : this.deriveBudgetForExisting(r);

    if (!monthlyBudget || monthlyBudget <= 0) {
      throw new BadRequestException(
        'Could not compute a monthly marketing budget from your answers.',
      );
    }

    await this.syncProfileFromResponses(userId, r, monthlyBudget);

    // Pure compute happens outside the transaction (no DB calls).
    const planResult = await this.decisionEngine.generatePlan({
      challengeVector,
      objectiveMask,
      monthlyBudget,
    });

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
          currentStep: this.totalStepsForResponses(r),
        },
      });

      return { evaluationId: evaluation.id, plan: created };
    });

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
    const responses = session.responses as QuestionnaireResponses;
    return {
      id: session.id,
      currentStep: session.currentStep,
      totalSteps: this.totalStepsForResponses(responses),
      isCompleted: session.isCompleted,
      stepTitle: STEP_TITLES[session.currentStep] ?? '',
      stage: responses.step1?.stage ?? null,
      isNewBusinessPath: isNewBusinessPath(responses.step1?.stage),
      responses,
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
    // Step 1 — common
    if (!r.step1?.name?.trim()) throw new BadRequestException('Step 1: please enter your name.');
    if (!r.step1.noBusinessName && !r.step1.businessName?.trim()) {
      throw new BadRequestException('Step 1: please enter your business name.');
    }
    if (typeof r.step1.hasWebsite !== 'boolean') {
      throw new BadRequestException('Step 1: please tell us whether you have a website.');
    }
    if (!r.step1.stage) {
      throw new BadRequestException('Step 1: please choose what stage your business is in.');
    }

    // Step 2 — common (pincode required; locality optional, auto-detected)
    if (!r.step2?.pincode) throw new BadRequestException('Step 2: please enter a 6-digit pincode.');

    // Step 3 — common
    if (!r.step3?.industry) throw new BadRequestException('Step 3: please choose an industry.');
    if (!r.step3.businessOffering) {
      throw new BadRequestException('Step 3: please tell us if you sell products or services.');
    }
    if (r.step3.businessOffering === 'PRODUCTS' && !r.step3.productSegment) {
      throw new BadRequestException('Step 3: please choose B2B, B2C or D2C.');
    }

    const newPath = isNewBusinessPath(r.step1.stage);
    if (newPath) {
      if (!r.step4?.capitalRange) {
        throw new BadRequestException('Step 4: please choose a starting capital range.');
      }
      if (!r.step5?.businessMode) {
        throw new BadRequestException('Step 5: please choose offline or online.');
      }
      if (!r.step6?.helpNeeded?.length) {
        throw new BadRequestException('Step 6: please pick at least one area you need help with.');
      }
    } else {
      if (!r.step4?.yearsInBusiness) {
        throw new BadRequestException('Step 4: please tell us how long you have been running this business.');
      }
      if (!r.step5?.challenges?.length) {
        throw new BadRequestException('Step 5: please pick at least one challenge that feels true.');
      }
      if (!r.step6?.digitalPresence) {
        throw new BadRequestException('Step 6: please tell us how active your business is online.');
      }
      if (!r.step7?.monthlyRevenue || r.step7.monthlyRevenue <= 0) {
        throw new BadRequestException('Step 7: please enter your average monthly revenue.');
      }
      if (!r.step7.monthlySpendBucket) {
        throw new BadRequestException('Step 7: please pick how much you spend on marketing each month.');
      }
      if (!r.step8?.objectives?.length) {
        throw new BadRequestException('Step 8: please pick at least one brand objective.');
      }
      if (r.step8.objectives.length > MAX_OBJECTIVES_SELECTED) {
        throw new BadRequestException(`Step 8: please pick at most ${MAX_OBJECTIVES_SELECTED} objectives.`);
      }
    }
  }

  private deriveChallengesForNew(r: QuestionnaireResponses): number[] {
    const set = new Set<number>();
    for (const h of r.step6?.helpNeeded ?? []) {
      for (const i of HELP_TO_CHALLENGES[h]) set.add(i);
    }
    if (r.step5?.businessMode) {
      for (const i of MODE_TO_CHALLENGES[r.step5.businessMode]) set.add(i);
    }
    // Fallback — flag a couple of broad challenges so the engine has signal.
    if (set.size === 0) {
      set.add(0); // not enough customers
      set.add(9); // no clear direction
    }
    return this.toBinaryVector([...set], 10);
  }

  private deriveObjectivesForNew(r: QuestionnaireResponses): number[] {
    const set = new Set<number>();
    if (r.step3?.businessOffering) {
      for (const i of OFFERING_TO_OBJECTIVES[r.step3.businessOffering]) set.add(i);
    }
    for (const h of r.step6?.helpNeeded ?? []) {
      for (const i of HELP_TO_OBJECTIVES[h]) set.add(i);
    }
    if (set.size === 0) {
      // Safe default: awareness, enquiries, online presence
      set.add(0).add(1).add(8);
    }
    return this.toBinaryVector([...set], 10);
  }

  private deriveBudgetForNew(r: QuestionnaireResponses): number {
    const range = r.step4?.capitalRange;
    if (!range) return 0;
    return Math.round(CAPITAL_RANGE_MIDPOINTS[range] * NEW_BUDGET_PCT_OF_CAPITAL);
  }

  private deriveBudgetForExisting(r: QuestionnaireResponses): number {
    const revenue = Number(r.step7?.monthlyRevenue ?? 0);
    if (revenue > 0) return Math.round(revenue * EXISTING_BUDGET_PCT_OF_REVENUE);
    // Fall back to the mid-point of the declared spend bucket
    const bucket = r.step7?.monthlySpendBucket;
    if (bucket) return MONTHLY_SPEND_BUCKET_MIDPOINTS[bucket];
    return 0;
  }

  private async syncStep1ToProfile(
    userId: string,
    step1?: QuestionnaireResponses['step1'],
  ) {
    if (!step1) return;
    if (step1.name?.trim()) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { name: step1.name.trim() },
      });
    }
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

  private async syncProfileFromResponses(
    userId: string,
    r: QuestionnaireResponses,
    monthlyBudget: number,
  ) {
    await this.syncStep1ToProfile(userId, r.step1);
    const profileData: PrismaTypes.BusinessProfileUncheckedUpdateInput = {
      industry: r.step3?.industry,
      location: this.formatLocation(r.step2),
      yearsInBusiness: this.deriveYearsInBusiness(r),
      monthlyRevenue: r.step7?.monthlyRevenue,
      monthlyBudget,
      marketingGoal: this.deriveMarketingGoalLabels(r).join(MARKETING_GOAL_SEPARATOR),
      digitalMaturity: this.deriveDigitalMaturity(r),
      salesChannel: this.deriveSalesChannel(r),
      targetAudience: this.deriveTargetAudience(r),
    };
    await this.prisma.businessProfile.upsert({
      where: { userId },
      create: { userId, ...profileData } as PrismaTypes.BusinessProfileUncheckedCreateInput,
      update: profileData,
    });
  }

  /** Map our questionnaire's digital-presence enum onto Prisma's DigitalMaturity. */
  private deriveDigitalMaturity(r: QuestionnaireResponses): DigitalMaturity | undefined {
    const dp = r.step6?.digitalPresence;
    if (!dp) return undefined;
    if (dp === 'NONE' || dp === 'BASIC') return DigitalMaturity.BASIC;
    if (dp === 'GROWING') return DigitalMaturity.INTERMEDIATE;
    if (dp === 'ADVANCED') return DigitalMaturity.ADVANCED;
    return undefined;
  }

  /** Map businessMode (new path) onto Prisma's SalesChannel; infer for existing. */
  private deriveSalesChannel(r: QuestionnaireResponses): SalesChannel | undefined {
    const mode = r.step5?.businessMode;
    if (mode === 'ONLINE') return SalesChannel.ONLINE;
    if (mode === 'OFFLINE') return SalesChannel.RETAIL;
    const dp = r.step6?.digitalPresence;
    if (dp === 'ADVANCED' || dp === 'GROWING') return SalesChannel.ONLINE_AND_RETAIL;
    return undefined;
  }

  /** Stage / years-in-business cell — falls back to "Just starting" for new businesses. */
  private deriveYearsInBusiness(r: QuestionnaireResponses): string | undefined {
    if (r.step4?.yearsInBusiness) return r.step4.yearsInBusiness;
    if (isNewBusinessPath(r.step1?.stage)) return 'Just starting';
    return undefined;
  }

  /** Target audience cell — synthesised from offering + segment. */
  private deriveTargetAudience(r: QuestionnaireResponses): string | undefined {
    const offering = r.step3?.businessOffering;
    const segment = r.step3?.productSegment;
    if (offering === 'PRODUCTS' && segment) return `Products · ${segment}`;
    if (offering === 'PRODUCTS') return 'Product customers';
    if (offering === 'SERVICES') return 'Service customers';
    return undefined;
  }

  private formatLocation(step2?: QuestionnaireResponses['step2']): string | undefined {
    if (!step2) return undefined;
    const parts = [step2.locality, step2.pincode].filter(Boolean) as string[];
    return parts.length > 0 ? parts.join(' · ') : step2.location;
  }

  /** All user-facing objective labels selected (or derived) at submit time. */
  private deriveMarketingGoalLabels(r: QuestionnaireResponses): string[] {
    if (!isNewBusinessPath(r.step1?.stage)) {
      return (r.step8?.objectives ?? [])
        .map((i) => OBJECTIVE_LABELS[i]?.label)
        .filter((l): l is string => Boolean(l));
    }
    const set = new Set<number>();
    if (r.step3?.businessOffering) {
      for (const i of OFFERING_TO_OBJECTIVES[r.step3.businessOffering]) set.add(i);
    }
    for (const h of r.step6?.helpNeeded ?? []) {
      for (const i of HELP_TO_OBJECTIVES[h]) set.add(i);
    }
    if (set.size === 0) {
      set.add(0).add(1).add(8);
    }
    return [...set]
      .sort((a, b) => a - b)
      .map((i) => OBJECTIVE_LABELS[i]?.label)
      .filter((l): l is string => Boolean(l));
  }
}
