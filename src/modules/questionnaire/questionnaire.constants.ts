/**
 * Questionnaire constants — labels, options, derivations.
 *
 * SOURCE OF TRUTH: assets/mibbs final questionnaire.pdf (client-supplied,
 * rendered to assets/tmp-pdf/out/page-*.png during the May 2026 review).
 *
 * The 10 challenges and 10 objectives line up 1:1 with the engine matrix
 * stored in the database (`ChallengeObjectiveMatrix.rowsChallenges` and
 * `colsObjectives`). The matrix carries the engineering-style short codes
 * (e.g. "C1 — Not enough customers" / "AWARENESS"). At the API layer we
 * replace those with the user-facing labels + descriptions from the PDF so
 * the questionnaire reads exactly like the client's spec.
 */

export const QUESTIONNAIRE_TOTAL_STEPS = 8;

/**
 * Step titles — match the client PDF "STEP n: Section name" headings.
 * Steps 4–8 vary slightly by path; we keep one canonical title per step
 * number and the wizard renders path-specific copy inside the step body.
 */
export const STEP_TITLES: Record<number, string> = {
  1: 'Basic Details',
  2: 'Business Location',
  3: 'Business Category',
  4: 'Capital / Experience',
  5: 'Business Mode / Challenges',
  6: 'Help Needed / Digital Presence',
  7: 'Revenue & Marketing Spend',
  8: 'Brand Objectives',
};

/**
 * Business stage — drives the dual-path flow.
 * NOT_STARTED → "New business path" (6 steps total)
 * EARLY / GROWING / ADVANCED → "Existing business path" (8 steps)
 */
export const STAGE_OPTIONS = [
  'NOT_STARTED', // Haven't started yet — I'm planning to start my business
  'EARLY',
  'GROWING',
  'ADVANCED',
] as const;
export type StageOption = (typeof STAGE_OPTIONS)[number];

export function isNewBusinessPath(stage: string | undefined): boolean {
  return stage === 'NOT_STARTED';
}

export const STAGE_LABELS: Record<StageOption, { label: string; helper: string }> = {
  NOT_STARTED: {
    label: "Haven't started yet",
    helper: "I'm planning to start my business",
  },
  EARLY: { label: 'Early', helper: 'My business is already running' },
  GROWING: { label: 'Growing', helper: 'My business is already running' },
  ADVANCED: { label: 'Advanced', helper: 'My business is already running' },
};

export const YEARS_IN_BUSINESS_OPTIONS = [
  'Less than 1 year',
  '1–3 years',
  '3–5 years',
  'More than 5 years',
] as const;

export const INDUSTRY_OPTIONS = [
  'Food & Beverage',
  'Fashion & Apparel',
  'Retail',
  'Services',
  'Manufacturing',
  'Technology',
  'Healthcare',
  'Education',
  'Other',
] as const;

export const BUSINESS_OFFERING_OPTIONS = ['PRODUCTS', 'SERVICES'] as const;
export type BusinessOffering = (typeof BUSINESS_OFFERING_OPTIONS)[number];
export const BUSINESS_OFFERING_LABELS: Record<BusinessOffering, string> = {
  PRODUCTS: 'Products — things people buy',
  SERVICES: 'Services — work you do for people',
};

export const PRODUCT_SEGMENT_OPTIONS = ['B2B', 'B2C', 'D2C'] as const;
export type ProductSegment = (typeof PRODUCT_SEGMENT_OPTIONS)[number];

export const CAPITAL_RANGE_OPTIONS = ['UNDER_1L', 'BETWEEN_1L_5L', 'OVER_5L'] as const;
export type CapitalRange = (typeof CAPITAL_RANGE_OPTIONS)[number];
export const CAPITAL_RANGE_LABELS: Record<CapitalRange, string> = {
  UNDER_1L: 'Less than ₹1,00,000',
  BETWEEN_1L_5L: '₹1,00,000 – ₹5,00,000',
  OVER_5L: 'More than ₹5,00,000',
};
/** Mid-point of each bucket in ₹ — used to derive a monthlyBudget for the
 *  new-business path (where there is no revenue yet to peg spend against). */
export const CAPITAL_RANGE_MIDPOINTS: Record<CapitalRange, number> = {
  UNDER_1L: 50_000,
  BETWEEN_1L_5L: 300_000,
  OVER_5L: 750_000,
};

export const BUSINESS_MODE_OPTIONS = ['OFFLINE', 'ONLINE'] as const;
export type BusinessMode = (typeof BUSINESS_MODE_OPTIONS)[number];
export const BUSINESS_MODE_LABELS: Record<BusinessMode, { label: string; helper: string }> = {
  OFFLINE: { label: 'Offline', helper: 'Shop, office, physical location' },
  ONLINE: { label: 'Online', helper: 'Website, Instagram, WhatsApp, apps' },
};

export const HELP_NEEDED_OPTIONS = [
  'PAPERWORK_LEGAL',
  'MONEY_PLANNING',
  'FINDING_CUSTOMERS',
  'SKILLS_KNOWLEDGE',
  'ONLINE_SETUP',
  'EVERYTHING',
] as const;
export type HelpNeeded = (typeof HELP_NEEDED_OPTIONS)[number];
export const HELP_NEEDED_LABELS: Record<HelpNeeded, { label: string; helper: string }> = {
  PAPERWORK_LEGAL: { label: 'Paperwork / Legal', helper: 'Licenses, registrations' },
  MONEY_PLANNING: { label: 'Money Planning', helper: 'How much to spend where' },
  FINDING_CUSTOMERS: { label: 'Finding Customers', helper: 'First few clients' },
  SKILLS_KNOWLEDGE: { label: 'Skills / Knowledge', helper: 'How to do the work' },
  ONLINE_SETUP: { label: 'Online Setup', helper: 'Website, social media' },
  EVERYTHING: { label: 'Everything', helper: 'Complete guidance' },
};

export const DIGITAL_PRESENCE_OPTIONS = ['NONE', 'BASIC', 'GROWING', 'ADVANCED'] as const;
export type DigitalPresence = (typeof DIGITAL_PRESENCE_OPTIONS)[number];
export const DIGITAL_PRESENCE_LABELS: Record<DigitalPresence, { label: string; subOptions: string[] }> = {
  NONE: { label: 'No digital presence', subOptions: [] },
  BASIC: { label: 'Basic', subOptions: ['Facebook', 'Instagram', 'WhatsApp'] },
  GROWING: {
    label: 'Growing',
    subOptions: ['Ad campaigns', 'Content creation', 'Brand marketing', 'Influencer marketing'],
  },
  ADVANCED: {
    label: 'Advanced',
    subOptions: [
      'Ad campaigns',
      'Content creation',
      'Brand marketing',
      'Influencer marketing',
      'E-commerce websites',
    ],
  },
};

export const MONTHLY_SPEND_BUCKET_OPTIONS = ['UNDER_10K', 'BETWEEN_10K_1L', 'OVER_1L'] as const;
export type MonthlySpendBucket = (typeof MONTHLY_SPEND_BUCKET_OPTIONS)[number];
export const MONTHLY_SPEND_BUCKET_LABELS: Record<MonthlySpendBucket, string> = {
  UNDER_10K: 'Less than ₹10,000',
  BETWEEN_10K_1L: '₹10,000 – ₹1,00,000',
  OVER_1L: 'More than ₹1,00,000',
};
/** Mid-point of each bucket in ₹ — fall-back monthly budget if revenue is 0. */
export const MONTHLY_SPEND_BUCKET_MIDPOINTS: Record<MonthlySpendBucket, number> = {
  UNDER_10K: 5_000,
  BETWEEN_10K_1L: 55_000,
  OVER_1L: 150_000,
};

/**
 * The 10 challenges, with the client's user-facing label and a short
 * description that appears below each option. Index positions MUST match
 * the matrix rows (C1..C10) seeded in the database.
 */
export const CHALLENGE_LABELS: Array<{ label: string; description: string }> = [
  { label: 'Not enough people are coming to us', description: 'We want more customers, but footfall or enquiries feel low.' },
  { label: "People ask, but don't buy", description: "Customers show interest, but most don't go ahead and purchase." },
  { label: "We don't know what's actually working", description: "We try different ways to promote, but can't tell what brings customers." },
  { label: 'Promotions feel like wasted money', description: "We spend money to promote our business, but the results aren't clear." },
  { label: 'Marketing feels confusing', description: "We're unsure how to promote our business in the right way." },
  { label: 'Too many businesses like ours', description: 'There are many similar businesses fighting for the same customers.' },
  { label: 'We have to be very careful with spending', description: 'Our marketing budget is limited, so mistakes are costly.' },
  { label: "Customers don't come back", description: 'People buy once, but rarely return again.' },
  { label: 'Hardly anyone finds us online', description: 'Few people see or discover our business on the internet.' },
  { label: "We're not sure what to do next", description: "We want to grow, but don't have a clear direction." },
];

/**
 * The 10 brand objectives, in the same column order as the matrix.
 * `key` is the matrix column code; `label` + `description` come from the
 * client PDF (Step 8: Brand Objectives).
 */
export const OBJECTIVE_LABELS: Array<{ key: string; label: string; description: string }> = [
  { key: 'AWARENESS', label: 'More people should know about my business', description: "Right now, many people don't know we exist — we want to be seen and recognised." },
  { key: 'ENQUIRIES', label: 'I want more calls, messages, or enquiries', description: 'I want more people to reach out and ask about what we offer.' },
  { key: 'SALES', label: 'I want to increase online sales', description: 'More people should buy from us through the internet.' },
  { key: 'REPEAT', label: 'I want customers to come back again', description: 'Getting repeat customers is more important than just one-time sales.' },
  { key: 'TRUST', label: 'I want people to trust my brand', description: 'When customers see us, they should feel confident choosing us.' },
  { key: 'WASTE_REDUCTION', label: 'I want to stop wasting money on marketing', description: 'I want my money to be spent wisely, not blindly.' },
  { key: 'STEADY_REVENUE', label: 'I want steady income every month', description: 'I want predictable, stable sales — not ups and downs.' },
  { key: 'LOCAL', label: 'I want to be well-known in my local area', description: 'People nearby should think of us first when they need this service or product.' },
  { key: 'ONLINE_PRESENCE', label: 'I want my business to look strong online', description: 'My website or social media should look active, clear, and professional.' },
  { key: 'LEARNING', label: 'I want to know what is actually working', description: 'I want clarity on what brings results, so I can do more of it.' },
];

/** Hard cap on selectable objectives — PDF: "Choose up to 4 that matter most right now." */
export const MAX_OBJECTIVES_SELECTED = 4;

/** Stored in `BusinessProfile.marketingGoal` — one label per line. */
export const MARKETING_GOAL_SEPARATOR = '\n';

/** Parse stored goals; fall back to evaluation mask for older profiles. */
export function resolveMarketingGoals(
  marketingGoal: string | null | undefined,
  objectiveMask?: number[],
): string[] {
  const fromMask =
    objectiveMask?.length ?
      objectiveMask
        .map((on, i) => (on ? OBJECTIVE_LABELS[i]?.label : null))
        .filter((l): l is string => Boolean(l))
    : [];

  if (marketingGoal?.includes(MARKETING_GOAL_SEPARATOR)) {
    return marketingGoal
      .split(MARKETING_GOAL_SEPARATOR)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const single = marketingGoal?.trim() ? [marketingGoal.trim()] : [];

  // Profiles saved before multi-goal support only stored the first label —
  // prefer the evaluation mask when it has more objectives selected.
  if (fromMask.length > single.length) return fromMask;
  if (single.length > 0) return single;
  return fromMask;
}

// ───────────────────────────────────────────────────────────────────────
// Derivation maps for the NEW-BUSINESS path.
//
// New businesses don't fill out challenges/objectives directly, but the
// decision engine still needs vectors. We derive them deterministically
// from the questionnaire answers so the engine produces a sensible plan.
//
// Indices below are 0-based and refer to the 10-element vectors.
// ───────────────────────────────────────────────────────────────────────

/** Which challenge indices each "Help Needed" item flags. */
export const HELP_TO_CHALLENGES: Record<HelpNeeded, number[]> = {
  PAPERWORK_LEGAL: [],
  MONEY_PLANNING: [3, 6], // C4: wasting ad money + C7: limited budget
  FINDING_CUSTOMERS: [0, 8], // C1: not enough customers + C9: low online visibility
  SKILLS_KNOWLEDGE: [2, 4], // C3: don't know what works + C5: marketing confusing
  ONLINE_SETUP: [8], // C9: low online visibility
  EVERYTHING: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
};

/** Which challenge indices each "Business Mode" choice flags (additive). */
export const MODE_TO_CHALLENGES: Record<BusinessMode, number[]> = {
  OFFLINE: [],
  ONLINE: [8], // C9: low online visibility
};

/** Default objective mask for new businesses, by business offering. */
export const OFFERING_TO_OBJECTIVES: Record<BusinessOffering, number[]> = {
  PRODUCTS: [0, 2, 8], // AWARENESS + SALES + ONLINE_PRESENCE
  SERVICES: [1, 4, 7], // ENQUIRIES + TRUST + LOCAL
};

/** Additional objective hints derived from "Help Needed". */
export const HELP_TO_OBJECTIVES: Record<HelpNeeded, number[]> = {
  PAPERWORK_LEGAL: [],
  MONEY_PLANNING: [5, 6], // WASTE_REDUCTION + STEADY_REVENUE
  FINDING_CUSTOMERS: [0, 1, 7], // AWARENESS + ENQUIRIES + LOCAL
  SKILLS_KNOWLEDGE: [9], // LEARNING
  ONLINE_SETUP: [8], // ONLINE_PRESENCE
  EVERYTHING: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
};

/**
 * Recommended monthly marketing budget for an existing business — a flat
 * 7 % of declared monthly revenue, matching the ratio shown on the client's
 * "report reference_2" mock (₹50,000 revenue → ₹3,500 monthly brand budget).
 */
export const EXISTING_BUDGET_PCT_OF_REVENUE = 0.07;

/**
 * For new businesses with no revenue, take 5 % of mid-point starting capital
 * as the monthly marketing budget. This is a deliberately conservative
 * starting point — the user can override later from the dashboard.
 */
export const NEW_BUDGET_PCT_OF_CAPITAL = 0.05;
