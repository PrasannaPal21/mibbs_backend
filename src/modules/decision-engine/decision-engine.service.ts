import { BadRequestException, Injectable } from '@nestjs/common';
import type { Intent } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type {
  ChannelAllocation,
  MatrixConfig,
  ObjectiveAllocation,
  PlanGenerationResult,
} from './decision-engine.types';

/**
 * Objective short-labels — wording is the canonical wording from
 * `assets/c-o matrix_final.pdf` (AWR, ENQ, SALE, REP, TRUST, WASTE, STEADY,
 * LOCAL, ONLINE, LEARN). Do not paraphrase: client signed off on these.
 */
const OBJECTIVE_LABELS: Record<string, string> = {
  AWARENESS: 'Awareness',
  ENQUIRIES: 'Enquiries',
  SALES: 'Online sales',
  REPEAT: 'Retention',
  TRUST: 'Trust',
  WASTE_REDUCTION: 'Reduce waste',
  STEADY_REVENUE: 'Steady revenue',
  LOCAL: 'Local',
  ONLINE_PRESENCE: 'Online presence',
  LEARNING: 'Understand',
};

@Injectable()
export class DecisionEngineService {
  constructor(private readonly prisma: PrismaService) {}

  async loadActiveMatrix(): Promise<MatrixConfig> {
    const row = await this.prisma.challengeObjectiveMatrix.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });
    if (!row) throw new BadRequestException('Challenge×Objective matrix not configured');
    return {
      version: row.version,
      challenges: row.rowsChallenges as string[],
      objectives: row.colsObjectives as string[],
      cells: row.cells as number[][],
      intentMapping: row.intentMapping as Record<string, Intent>,
      channelMapping: row.channelMapping as Record<Intent, string[]>,
    };
  }

  /**
   * Implements the three-step computation from `assets/mibbs-backend logic.pdf`:
   *
   *   Step 1: R[j]  = Σᵢ S[i] · M[i][j]            (raw column sum of selected rows)
   *   Step 2: R'[j] = R[j] · O[j]                  (objective mask, element-wise)
   *   Step 3: F[j]  = R'[j] / k     where k = Σ S  (fairness normalisation)
   *
   * Returns R, R' and F as separate vectors so callers can audit each step.
   */
  computeNormalizedScores(
    challengeVector: number[],
    objectiveMask: number[],
    cells: number[][],
  ): { rawScores: number[]; maskedScores: number[]; normalizedScores: number[] } {
    const n = cells[0]?.length ?? 0;

    // Step 1: R = S × M
    const rawScores = Array.from({ length: n }, (_, j) =>
      challengeVector.reduce((sum, s, i) => sum + s * (cells[i]?.[j] ?? 0), 0),
    );

    // Step 2: R' = R ⊙ O
    const maskedScores = rawScores.map((r, j) => r * (objectiveMask[j] ?? 0));

    // Step 3: F = R' / k.  k is guaranteed ≥ 1 by upstream validation
    // (generatePlan rejects all-zero challenge vectors).
    const k = challengeVector.reduce((a, b) => a + b, 0) || 1;
    const normalizedScores = maskedScores.map((v) => v / k);

    return { rawScores, maskedScores, normalizedScores };
  }

  /**
   * Implements "Budget Allocation Logic" from `assets/mibbs-backend logic.pdf`:
   *
   *   Step 1: keep only positive normalized scores
   *   Step 2: Total = Σ EffectiveScore
   *   Step 3: Budget_i = (EffectiveScore_i / Total) × B
   *   Step 4: Internal allocation across channels of the objective's intent group
   *           (spec lists the channels but not weights — we use equal split and
   *            roll the rounding remainder into the last channel of the last
   *            objective so Σ amounts == B exactly).
   */
  allocateBudget(
    normalizedScores: number[],
    objectives: string[],
    monthlyBudget: number,
    intentMapping: Record<string, Intent>,
    channelMapping: Record<Intent, string[]>,
  ): { allocations: ObjectiveAllocation[]; actionPlan: Record<string, string[]> } {
    // Step 1
    const positives = normalizedScores.map((s) => Math.max(0, s));
    // Step 2
    const total = positives.reduce((a, b) => a + b, 0);

    // If all scores are ≤ 0 (extremely unusual: only happens when every
    // selected challenge has non-positive impact on every selected objective)
    // we cannot recommend any spend — return empty allocations.
    if (total <= 0) {
      return { allocations: [], actionPlan: {} };
    }

    const allocations: ObjectiveAllocation[] = [];
    const actionPlan: Record<string, string[]> = {};

    // Step 3: proportional budget per objective
    objectives.forEach((key, idx) => {
      const score = positives[idx];
      if (score <= 0) return;

      const percent = (score / total) * 100;
      const amount = Math.round((score / total) * monthlyBudget);
      const intent = intentMapping[key] ?? 'GROWTH';
      const channelNames = channelMapping[intent] ?? [];

      // Step 4: equal split inside this objective's intent group
      const channels = this.splitChannels(channelNames, amount);

      allocations.push({
        key,
        label: OBJECTIVE_LABELS[key] ?? key,
        intent,
        score,
        percent: Math.round(percent * 10) / 10,
        amount,
        channels,
      });

      if (!actionPlan[intent]) actionPlan[intent] = [];
      actionPlan[intent].push(
        ...channels.map((c) => `${c.name}: allocate ₹${c.amount.toLocaleString('en-IN')}/month`),
      );
    });

    // Reconcile rounding drift on the last positive allocation so the
    // per-objective amounts sum exactly to monthlyBudget (rupee-perfect).
    const allocated = allocations.reduce((s, a) => s + a.amount, 0);
    const drift = monthlyBudget - allocated;
    if (allocations.length > 0 && drift !== 0) {
      const last = allocations[allocations.length - 1];
      last.amount += drift;
      // Push the drift into the last channel of the last objective too,
      // so channel amounts sum exactly to last.amount.
      if (last.channels.length > 0) {
        last.channels[last.channels.length - 1].amount += drift;
      }
    }

    return { allocations, actionPlan };
  }

  private splitChannels(names: string[], totalAmount: number): ChannelAllocation[] {
    if (names.length === 0) return [];
    const each = Math.floor(totalAmount / names.length);
    const remainder = totalAmount - each * names.length;
    return names.map((name, i) => ({
      name,
      percent: Math.round((100 / names.length) * 10) / 10,
      amount: each + (i === names.length - 1 ? remainder : 0),
    }));
  }

  async generatePlan(input: {
    challengeVector: number[];
    objectiveMask: number[];
    monthlyBudget: number;
  }): Promise<PlanGenerationResult> {
    const { challengeVector, objectiveMask, monthlyBudget } = input;

    if (challengeVector.length !== 10 || objectiveMask.length !== 10) {
      throw new BadRequestException('challengeVector and objectiveMask must be length 10');
    }
    if (!challengeVector.every((v) => v === 0 || v === 1)) {
      throw new BadRequestException('challengeVector must be binary (0/1)');
    }
    if (!objectiveMask.every((v) => v === 0 || v === 1)) {
      throw new BadRequestException('objectiveMask must be binary (0/1)');
    }
    if (challengeVector.every((v) => v === 0)) {
      throw new BadRequestException('Select at least one business challenge');
    }
    if (objectiveMask.every((v) => v === 0)) {
      throw new BadRequestException('Select at least one marketing objective');
    }
    if (!Number.isFinite(monthlyBudget) || monthlyBudget <= 0) {
      throw new BadRequestException('monthlyBudget must be a positive number');
    }

    const matrix = await this.loadActiveMatrix();
    const { rawScores, maskedScores, normalizedScores } = this.computeNormalizedScores(
      challengeVector,
      objectiveMask,
      matrix.cells,
    );
    const { allocations, actionPlan } = this.allocateBudget(
      normalizedScores,
      matrix.objectives,
      monthlyBudget,
      matrix.intentMapping,
      matrix.channelMapping,
    );

    return {
      matrixVersion: matrix.version,
      challengeVector,
      objectiveMask,
      rawScores,
      maskedScores,
      normalizedScores,
      monthlyBudget,
      annualBudget: monthlyBudget * 12,
      allocations,
      actionPlan,
    };
  }
}
