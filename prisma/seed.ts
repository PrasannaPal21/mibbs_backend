/**
 * Seed script — bootstraps the canonical Challenges × Objectives matrix
 * from `assets/c-o matrix_final.pdf` and `assets/mibbs-backend logic.pdf`.
 *
 * Run with: `npm run db:seed`
 */
import { PrismaClient, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/** Demo account for client walkthrough / screen recording */
const DEMO_EMAIL = 'demo@mibbs.app';
const DEMO_PASSWORD = 'Demo@12345';

const CHALLENGES = [
  'C1 — Not enough customers',
  'C2 — Interest but no purchase',
  'C3 — Don’t know what works',
  'C4 — Wasting ad money',
  'C5 — Marketing is confusing',
  'C6 — High competition',
  'C7 — Limited budget',
  'C8 — No repeat customers',
  'C9 — Low online visibility',
  'C10 — No clear direction',
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

// -----------------------------------------------------------------------------
// Canonical 10×10 matrix.
// SOURCE OF TRUTH: assets/c-o matrix_final.pdf  (filename says "final" — and is
// the cleanly tabulated, signed-off version).
//
// IMPORTANT — the matrix embedded in assets/mibbs-backend logic.pdf differs
// from the final version on rows C2, C4, C5, C6, C7, C8 (six cells flip from
// 0 → 1).  We use the FINAL pdf; if the client confirms otherwise, only the
// numbers below need to change — no code changes required.
//
// Rows = challenges (C1..C10) in CHALLENGES order
// Cols = objectives (AWR, ENQ, SALE, REP, TRUST, WASTE, STEADY, LOCAL, ONLINE, LEARN)
// -----------------------------------------------------------------------------
const CELLS: number[][] = [
  // AWR ENQ SALE REP TRUST WASTE STEADY LOCAL ONLINE LEARN
  [  2,  1,  -1,  0,    0,   -1,    -1,    1,     1,    0 ], // C1
  [ -1,  0,   2,  1,    1,    0,     1,    0,     0,    1 ], // C2
  [  0,  0,   0, -1,   -1,    2,     0,    0,     0,    2 ], // C3
  [ -1,  0,   0,  1,    1,    2,     1,    0,    -1,    1 ], // C4
  [  0,  1,  -1,  1,    1,    0,     0,    0,     0,    1 ], // C5
  [  1,  0,   0,  1,    2,    0,     1,    1,     0,    0 ], // C6
  [ -1,  1,   0,  1,    1,    2,     1,    1,     0,    0 ], // C7
  [ -1, -1,   0,  2,    1,    0,     1,    0,     0,    1 ], // C8
  [  2,  1,  -1,  0,    0,   -1,    -1,    1,     2,    0 ], // C9
  [  0,  0,  -1,  1,    1,    1,     1,    0,     0,    2 ], // C10
];

// -----------------------------------------------------------------------------
// Objective → Intent group mapping.
// SOURCE: "Intent" sections of assets/mibbs-backend logic.pdf — note that the
// asset describes 5 intents and their channel lists but does NOT explicitly
// tie each of the 10 objectives to one intent.  The mapping below is the
// product team's reading of the intent descriptions:
//
//   GROWTH       — "I want more new customers"      → AWARENESS, ENQUIRIES,
//                                                     SALES, ONLINE_PRESENCE,
//                                                     LOCAL
//   CONTROL      — "I don't want to waste money"    → WASTE_REDUCTION
//   STABILITY    — "I want regular income"          → STEADY_REVENUE, REPEAT
//   LEARNING     — "I want to know what works"      → LEARNING
//   RELATIONSHIP — "I want trust and loyalty"       → TRUST
//
// If the client wants a different grouping, change ONLY this map.
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Intent → Channels.
// SOURCE: assets/mibbs-backend logic.pdf "Intent" sections.  Channel names
// must remain byte-identical to the asset — they appear in the user-facing
// plan output.
// -----------------------------------------------------------------------------
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

async function main() {
  console.log('Seeding Challenge×Objective matrix v1…');

  await prisma.$transaction([
    prisma.challengeObjectiveMatrix.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    }),
    prisma.challengeObjectiveMatrix.upsert({
      where: { version: 1 },
      update: {
        isActive: true,
        rowsChallenges: CHALLENGES,
        colsObjectives: OBJECTIVES,
        cells: CELLS,
        intentMapping: INTENT_MAPPING,
        channelMapping: CHANNEL_MAPPING,
        notes: 'Initial canonical matrix from assets/c-o matrix_final.pdf',
      },
      create: {
        version: 1,
        isActive: true,
        rowsChallenges: CHALLENGES,
        colsObjectives: OBJECTIVES,
        cells: CELLS,
        intentMapping: INTENT_MAPPING,
        channelMapping: CHANNEL_MAPPING,
        notes: 'Initial canonical matrix from assets/c-o matrix_final.pdf',
      },
    }),
  ]);

  console.log('Seeding demo user…');
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { passwordHash, status: UserStatus.ACTIVE, name: 'Lakshmi' },
    create: {
      name: 'Lakshmi',
      email: DEMO_EMAIL,
      phoneE164: '+919876543210',
      passwordHash,
      status: UserStatus.ACTIVE,
      emailVerified: new Date(),
      phoneVerified: new Date(),
      businessProfile: {
        create: {
          businessName: 'Homemade pickle manufacturer',
          industry: 'Food & Beverage',
          location: 'Addanki, Andhra Pradesh',
          monthlyRevenue: 45000,
          monthlyBudget: 10000,
        },
      },
    },
  });

  console.log('Seed complete.');
  console.log(`  Demo login → ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
