import type { Intent } from '@prisma/client';

export interface ObjectiveAllocation {
  key: string;
  label: string;
  intent: Intent;
  score: number;
  percent: number;
  amount: number;
  channels: ChannelAllocation[];
}

export interface ChannelAllocation {
  name: string;
  percent: number;
  amount: number;
}

/**
 * Mirror of `mibbs-backend logic.pdf §2`:
 *   rawScores       = R  = S × M           (before mask)
 *   maskedScores    = R' = R ⊙ O           (after objective mask)
 *   normalizedScores = F  = R' / k         (k = Σ S)
 */
export interface PlanGenerationResult {
  matrixVersion: number;
  challengeVector: number[];
  objectiveMask: number[];
  rawScores: number[];
  maskedScores: number[];
  normalizedScores: number[];
  monthlyBudget: number;
  annualBudget: number;
  allocations: ObjectiveAllocation[];
  actionPlan: Record<string, string[]>;
}

export interface MatrixConfig {
  version: number;
  challenges: string[];
  objectives: string[];
  cells: number[][];
  intentMapping: Record<string, Intent>;
  channelMapping: Record<Intent, string[]>;
}
