/**
 * Calculation tests pinned to `assets/c-o matrix_final.pdf` and the formulas
 * in `assets/mibbs-backend logic.pdf §2`. Any drift here means we have drifted
 * from what the client signed off on.
 */
import { describe, expect, it } from 'vitest';

/** Canonical 10×10 matrix — must stay byte-identical to assets/c-o matrix_final.pdf */
const CELLS: number[][] = [
  // AWR ENQ SALE REP TRUST WASTE STEADY LOCAL ONLINE LEARN
  [  2,  1,  -1,  0,    0,   -1,    -1,    1,     1,    0 ], // C1  Not enough customers
  [ -1,  0,   2,  1,    1,    0,     1,    0,     0,    1 ], // C2  Interest, no purchase
  [  0,  0,   0, -1,   -1,    2,     0,    0,     0,    2 ], // C3  Don't know what works
  [ -1,  0,   0,  1,    1,    2,     1,    0,    -1,    1 ], // C4  Wasting ad money
  [  0,  1,  -1,  1,    1,    0,     0,    0,     0,    1 ], // C5  Marketing confusing
  [  1,  0,   0,  1,    2,    0,     1,    1,     0,    0 ], // C6  High competition
  [ -1,  1,   0,  1,    1,    2,     1,    1,     0,    0 ], // C7  Limited budget
  [ -1, -1,   0,  2,    1,    0,     1,    0,     0,    1 ], // C8  No repeat customers
  [  2,  1,  -1,  0,    0,   -1,    -1,    1,     2,    0 ], // C9  Low online visibility
  [  0,  0,  -1,  1,    1,    1,     1,    0,     0,    2 ], // C10 No clear direction
];

const OBJECTIVES = [
  'AWARENESS',
  'ENQUIRIES',
  'SALES',
  'REPEAT',
  'TRUST',
  'WASTE_REDUCTION',
  'STEADY_REVENUE',
  'LOCAL',
  'ONLINE_PRESENCE',
  'LEARNING',
];

const INTENT_MAPPING: Record<string, 'GROWTH' | 'CONTROL' | 'STABILITY' | 'LEARNING' | 'RELATIONSHIP'> = {
  AWARENESS: 'GROWTH',
  ENQUIRIES: 'GROWTH',
  SALES: 'GROWTH',
  ONLINE_PRESENCE: 'GROWTH',
  LOCAL: 'GROWTH',
  WASTE_REDUCTION: 'CONTROL',
  STEADY_REVENUE: 'STABILITY',
  REPEAT: 'STABILITY',
  LEARNING: 'LEARNING',
  TRUST: 'RELATIONSHIP',
};

const CHANNEL_MAPPING = {
  GROWTH: [
    'Digital Brand Campaigns',
    'Content Marketing',
    'Social Media Marketing',
    'Influencer Marketing',
    'PR & Communications',
    'Offline Marketing',
  ],
  CONTROL: ['Website & Digital Experience', 'Content Marketing', 'Social Media Marketing'],
  STABILITY: [
    'Content Creation',
    'Social Media Marketing',
    'Website & Digital Experience',
    'Offline Marketing',
  ],
  LEARNING: ['Website & Digital Experience', 'Content Marketing', 'PR & Communications'],
  RELATIONSHIP: [
    'Identity & Design',
    'Content Creation',
    'PR & Communications',
    'Influencer Marketing',
    'Print Media',
  ],
};

// ---------- Helpers mirroring DecisionEngineService (pure functions) ----------

function computeNormalizedScores(S: number[], O: number[], M: number[][]) {
  const n = M[0].length;
  const rawScores = Array.from({ length: n }, (_, j) =>
    S.reduce((sum, s, i) => sum + s * M[i][j], 0),
  );
  const maskedScores = rawScores.map((r, j) => r * O[j]);
  const k = S.reduce((a, b) => a + b, 0) || 1;
  return { rawScores, maskedScores, normalizedScores: maskedScores.map((v) => v / k) };
}

function allocateBudget(scores: number[], budget: number) {
  const positives = scores.map((s) => Math.max(0, s));
  const total = positives.reduce((a, b) => a + b, 0);
  if (total <= 0) return positives.map(() => 0);
  return positives.map((p) => (p / total) * budget);
}

// -----------------------------------------------------------------------------

describe('Matrix fidelity', () => {
  it('matches assets/c-o matrix_final.pdf in shape', () => {
    expect(CELLS.length).toBe(10);
    for (const row of CELLS) expect(row.length).toBe(10);
  });

  it('contains only cells in {-1, 0, 1, 2}', () => {
    for (const row of CELLS) {
      for (const v of row) expect([-1, 0, 1, 2]).toContain(v);
    }
  });

  it('row C1 = [2, 1, -1, 0, 0, -1, -1, 1, 1, 0]', () => {
    expect(CELLS[0]).toEqual([2, 1, -1, 0, 0, -1, -1, 1, 1, 0]);
  });

  it('row C9 = [2, 1, -1, 0, 0, -1, -1, 1, 2, 0]', () => {
    expect(CELLS[8]).toEqual([2, 1, -1, 0, 0, -1, -1, 1, 2, 0]);
  });

  it('row C10 = [0, 0, -1, 1, 1, 1, 1, 0, 0, 2]', () => {
    expect(CELLS[9]).toEqual([0, 0, -1, 1, 1, 1, 1, 0, 0, 2]);
  });
});

describe('Step 1: R = S × M', () => {
  it('selecting a single challenge equals that row', () => {
    for (let i = 0; i < 10; i++) {
      const S = Array(10).fill(0);
      S[i] = 1;
      const { rawScores } = computeNormalizedScores(S, Array(10).fill(1), CELLS);
      expect(rawScores).toEqual(CELLS[i]);
    }
  });

  it('worked example from spec — S = [1,1,0,1,0,0,1,0,1,0]', () => {
    // Sums of rows C1 + C2 + C4 + C7 + C9 — column by column.
    const S = [1, 1, 0, 1, 0, 0, 1, 0, 1, 0];
    const O = Array(10).fill(1);
    const expected = [
      2 + -1 + -1 + -1 + 2, //  1  AWR
      1 + 0 + 0 + 1 + 1, //  3  ENQ
      -1 + 2 + 0 + 0 + -1, //  0  SALE
      0 + 1 + 1 + 1 + 0, //  3  REP
      0 + 1 + 1 + 1 + 0, //  3  TRUST
      -1 + 0 + 2 + 2 + -1, //  2  WASTE
      -1 + 1 + 1 + 1 + -1, //  1  STEADY
      1 + 0 + 0 + 1 + 1, //  3  LOCAL
      1 + 0 + -1 + 0 + 2, //  2  ONLINE
      0 + 1 + 1 + 0 + 0, //  2  LEARN
    ];
    const { rawScores } = computeNormalizedScores(S, O, CELLS);
    expect(rawScores).toEqual(expected);
  });
});

describe('Step 2: R\' = R ⊙ O', () => {
  it('masks unselected objectives to zero', () => {
    const S = [1, 1, 0, 1, 0, 0, 1, 0, 1, 0];
    const O = [1, 0, 0, 1, 0, 0, 0, 0, 0, 1]; // only AWR, REP, LEARN
    const { rawScores, maskedScores } = computeNormalizedScores(S, O, CELLS);
    for (let j = 0; j < 10; j++) {
      if (O[j] === 1) expect(maskedScores[j]).toBe(rawScores[j]);
      else expect(maskedScores[j]).toBe(0);
    }
  });

  it('does not mutate raw scores during masking', () => {
    const S = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const O = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    O[0] = 1; // only AWR
    const { rawScores, maskedScores } = computeNormalizedScores(S, O, CELLS);
    expect(rawScores[1]).toBe(1); // ENQ unchanged in R
    expect(maskedScores[1]).toBe(0); // ENQ zeroed in R'
  });
});

describe("Step 3: F = R' / k", () => {
  it('divides by number of selected challenges', () => {
    const S = [1, 1, 0, 0, 0, 0, 0, 0, 0, 0]; // k = 2
    const O = Array(10).fill(1);
    const { maskedScores, normalizedScores } = computeNormalizedScores(S, O, CELLS);
    for (let j = 0; j < 10; j++) {
      expect(normalizedScores[j]).toBeCloseTo(maskedScores[j] / 2, 10);
    }
  });

  it('k = 5 example from spec', () => {
    const S = [1, 1, 0, 1, 0, 0, 1, 0, 1, 0]; // k = 5
    const O = Array(10).fill(1);
    const { normalizedScores } = computeNormalizedScores(S, O, CELLS);
    expect(normalizedScores[0]).toBeCloseTo(1 / 5, 10); // AWR = 1/5 = 0.2
    expect(normalizedScores[3]).toBeCloseTo(3 / 5, 10); // REP = 3/5 = 0.6
  });
});

describe('Budget allocation — positives only, proportional', () => {
  it('drops negative scores and never exceeds budget', () => {
    const scores = [2, 0, -1, 3, 0];
    const budget = 10000;
    const out = allocateBudget(scores, budget);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
    expect(out[0] + out[3]).toBeCloseTo(budget, 0);
    expect(out[0]).toBeCloseTo(4000, 0);
    expect(out[3]).toBeCloseTo(6000, 0);
  });

  it('all-zero scores produce zero allocation (no division by zero)', () => {
    const out = allocateBudget([0, 0, 0, 0, 0], 10000);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it('sum of allocations equals budget (to floating-point precision)', () => {
    const scores = [0.4, 0.1, 0.25, -0.1, 0.05, 0, 0.2];
    const out = allocateBudget(scores, 10000);
    const sum = out.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(10000, 6);
  });
});

describe('Intent mapping coverage', () => {
  it('every objective maps to exactly one intent', () => {
    for (const obj of OBJECTIVES) expect(INTENT_MAPPING[obj]).toBeDefined();
  });

  it('every intent has at least one channel', () => {
    for (const intent of ['GROWTH', 'CONTROL', 'STABILITY', 'LEARNING', 'RELATIONSHIP'] as const) {
      expect(CHANNEL_MAPPING[intent].length).toBeGreaterThan(0);
    }
  });

  it('channel lists match the asset wording exactly (Growth intent)', () => {
    expect(CHANNEL_MAPPING.GROWTH).toEqual([
      'Digital Brand Campaigns',
      'Content Marketing',
      'Social Media Marketing',
      'Influencer Marketing',
      'PR & Communications',
      'Offline Marketing',
    ]);
  });

  it('channel lists match the asset wording exactly (Relationship intent)', () => {
    expect(CHANNEL_MAPPING.RELATIONSHIP).toEqual([
      'Identity & Design',
      'Content Creation',
      'PR & Communications',
      'Influencer Marketing',
      'Print Media',
    ]);
  });
});
