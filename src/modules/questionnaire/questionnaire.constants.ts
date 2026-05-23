export const QUESTIONNAIRE_TOTAL_STEPS = 8;

export const STEP_TITLES: Record<number, string> = {
  1: 'Basic Details',
  2: 'Business Profile',
  3: 'Revenue & Budget',
  4: 'Goals & Audience',
  5: 'Your Challenges',
  6: 'Your Objectives',
  7: 'Review',
  8: 'Generate Plan',
};

export const YEARS_IN_BUSINESS_OPTIONS = [
  'Less than 1 year',
  '1–3 years',
  '3–5 years',
  '5+ years',
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
