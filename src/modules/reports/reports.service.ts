import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { join } from 'node:path';
import { PrismaService } from '../../common/prisma/prisma.service';
import { resolveMarketingGoals } from '../questionnaire/questionnaire.constants';

interface PlanAllocation {
  label: string;
  intent: string;
  percent: number;
  amount: number;
  channels: Array<{ name: string; amount: number; percent?: number }>;
}

/**
 * Palette aligned with the client's report mock + the web app's KPI badges.
 * Kept locally so the PDF can render even without web build assets present.
 */
const PALETTE = {
  ink: '#1F1934',
  ink700: '#3D344F',
  ink500: '#67617D',
  ink300: '#A8A2B6',
  border: '#E0DAD0',
  surface: '#FBF8F4',
  surfaceMuted: '#F4EFE6',
  primary: '#6D28D9', // brand violet
  callout: '#5B2D8C', // deeper violet for WHY MIBBS callout
  accent: '#E04C7A',
  green: '#10B981',
  greenSoft: '#ECFDF5',
  // Channel-list ramp — matches PlanView's CHANNEL_COLORS so the report and
  // web view read the same.
  channel: [
    '#0EA5E9',
    '#7C3AED',
    '#F59E0B',
    '#EF4444',
    '#8B5CF6',
    '#EC4899',
    '#10B981',
    '#F97316',
  ],
  // Four category top-borders, mirrors PlanView.CATEGORY_TONES
  category: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444'],
} as const;

const FONT_DIR = join(__dirname, 'fonts');
const ASSET_DIR = join(__dirname, 'assets');
const FONTS = {
  sans: join(FONT_DIR, 'Inter-Regular.ttf'),
  sansItalic: join(FONT_DIR, 'Inter-Italic.ttf'),
  serif: join(FONT_DIR, 'Fraunces-Regular.ttf'),
  serifItalic: join(FONT_DIR, 'Fraunces-Italic.ttf'),
} as const;
// Client-supplied brand mark (534 × 130) embedded as a raster image so the
// PDF cover matches the web header pixel-for-pixel.
const BRAND_LOGO = join(ASSET_DIR, 'mibbs-logo.png');

function formatINR(amount: number): string {
  return `\u20B9${Math.round(Number(amount)).toLocaleString('en-IN')}`;
}

// Map each engine intent into the four category buckets the client mock
// shows on its report. Keeps the report layout fixed (always four cards).
const INTENT_TO_CATEGORY: Record<string, 0 | 1 | 2 | 3> = {
  Growth: 0,
  Learning: 0,
  Control: 1,
  Stability: 2,
  Relationship: 3,
};
const CATEGORY_LABELS = [
  'Digital Marketing',
  'Brand & Creative',
  'Traditional Media',
  'Events & PR',
] as const;
const CATEGORY_TAGLINES = [
  'Recommended annual budget for digital marketing activities.',
  'Recommended annual budget for brand & creative activities.',
  'Recommended annual budget for traditional media activities.',
  'Recommended annual budget for events & pr activities.',
] as const;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async generatePlanPdf(userId: string, planId: string): Promise<Buffer> {
    const plan = await this.prisma.marketingPlan.findFirst({
      where: { id: planId, userId },
      include: {
        evaluation: true,
        user: { include: { businessProfile: true } },
      },
    });
    if (!plan) throw new NotFoundException('Marketing plan not found');

    const bp = plan.user.businessProfile;
    const marketingGoals = resolveMarketingGoals(
      bp?.marketingGoal,
      plan.evaluation?.objectiveMask,
    );
    const allocations = plan.allocations as unknown as PlanAllocation[];
    const businessName = bp?.businessName ?? plan.user.name;
    const monthlyBudget = Number(plan.monthlyBudget);
    const annualBudget = Number(plan.annualBudget);
    const monthlyRevenue = bp?.monthlyRevenue ? Number(bp.monthlyRevenue) : null;

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 48, bottom: 48, left: 48, right: 48 },
        info: {
          Title: `${businessName} — Brand Budget Recommendation Report`,
          Author: 'MIBBS',
          Subject: 'Marketing budget allocation',
        },
      });

      doc.registerFont('Sans', FONTS.sans);
      doc.registerFont('Sans-Italic', FONTS.sansItalic);
      doc.registerFont('Serif', FONTS.serif);
      doc.registerFont('Serif-Italic', FONTS.serifItalic);

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const { width: pageW, height: pageH } = doc.page;
      const left = doc.page.margins.left;
      const right = pageW - doc.page.margins.right;
      const contentW = right - left;

      // ============================================================
      // 1. Header — client logo image + title + tagline
      // ============================================================
      // Logo aspect is 534×130 (~4.1 : 1). Render at a 32 px height for the
      // header band so the mark is legible without crowding the title.
      const logoH = 32;
      const logoW = Math.round((logoH * 534) / 130);
      doc.image(BRAND_LOGO, left, 36, { width: logoW, height: logoH });

      const titleX = left + logoW + 14;
      // Reserve space on the right for the brand block-art motif (~60 px wide)
      const motifW = 60;
      const titleW = contentW - logoW - 14 - motifW - 12;
      doc
        .font('Sans')
        .fontSize(14)
        .fillColor(PALETTE.ink)
        .text('Brand Budget Recommendation Report', titleX, 40, { width: titleW });
      doc
        .font('Sans-Italic')
        .fontSize(9)
        .fillColor(PALETTE.ink500)
        .text(
          'Generated by MIBBS — India\u2019s First Intelligent Brand Budgeting System',
          titleX,
          58,
          { width: titleW },
        );
      // Block-art motif — same composition as /public/brand/mibbs-svg.svg
      drawBrandMotif(doc, right - motifW, 36, motifW, 36);
      drawHairline(doc, left, 86, contentW);

      // ============================================================
      // 2. WHY MIBBS? callout — deep-violet block
      // ============================================================
      const calloutY = 100;
      const calloutH = 86;
      doc
        .roundedRect(left, calloutY, contentW, calloutH, 4)
        .fillColor(PALETTE.callout)
        .fill();
      doc
        .font('Sans')
        .fontSize(11)
        .fillColor('#FFFFFF')
        .text('WHY MIBBS?', left, calloutY + 12, {
          width: contentW,
          align: 'center',
          characterSpacing: 1.6,
        });
      doc
        .font('Sans')
        .fontSize(8.5)
        .fillColor('#FFFFFFE6')
        .text(
          'At Magsmen, we\u2019ve seen brands struggle not because they lacked ideas, but because they lacked intelligent budget planning. MIBBS is India\u2019s first intelligent brand budgeting system, a structured, data-driven model crafted to align your brand ambitions with financial discipline, helping you invest smarter, grow faster, and build a stronger market position.',
          left + 32,
          calloutY + 32,
          { width: contentW - 64, align: 'center', lineGap: 2 },
        );

      // ============================================================
      // 3. Business name + Early-Stage pill
      // ============================================================
      doc.y = calloutY + calloutH + 22;
      const nameY = doc.y as number;
      doc
        .font('Serif')
        .fontSize(22)
        .fillColor(PALETTE.ink)
        .text(businessName, left, nameY);
      // Stage pill aligned right
      const pillText = 'Early Stage';
      const pillW = doc.font('Sans').fontSize(9).widthOfString(pillText) + 24;
      doc
        .roundedRect(right - pillW, nameY + 4, pillW, 18, 9)
        .fillColor(PALETTE.greenSoft)
        .fill();
      doc
        .font('Sans')
        .fontSize(9)
        .fillColor(PALETTE.green)
        .text(`+ ${pillText}`, right - pillW + 6, nameY + 8, {
          width: pillW - 12,
          align: 'center',
          lineBreak: false,
        });
      doc.y = nameY + 36;

      // ============================================================
      // 4. Profile table — 4 columns × 2 rows
      // ============================================================
      const profile = [
        { label: 'INDUSTRY', value: bp?.industry ?? '—', color: PALETTE.ink },
        { label: 'LOCATION', value: bp?.location ?? '—', color: PALETTE.ink },
        { label: 'YEARS IN BUSINESS', value: 'Less than 1 year', color: PALETTE.ink },
        { label: 'DIGITAL MATURITY', value: 'Basic', color: PALETTE.ink },
        {
          label: 'TARGET AUDIENCE',
          value: bp?.targetAudience ?? '—',
          color: '#7C3AED',
        },
        {
          label: 'COMPETITION LEVEL',
          value: bp?.competitionLevel ?? '—',
          color: PALETTE.ink,
        },
        {
          label: marketingGoals.length > 1 ? 'MARKETING GOALS' : 'MARKETING GOAL',
          value: marketingGoals.length > 0 ? marketingGoals.join('\n') : '—',
          color: '#EA580C',
          multiline: true,
        },
        { label: 'SALES CHANNEL', value: 'Online & Retail', color: '#7C3AED' },
      ];
      const tableY = doc.y as number;
      const cellW = contentW / 4;
      const cellH = 44;
      profile.forEach((cell, i) => {
        const row = Math.floor(i / 4);
        const col = i % 4;
        const x = left + cellW * col;
        const y = tableY + cellH * row;
        // Cell border (use a thin grid)
        doc
          .rect(x, y, cellW, cellH)
          .lineWidth(0.6)
          .strokeColor(PALETTE.border)
          .stroke();
        doc
          .font('Sans')
          .fontSize(7)
          .fillColor(PALETTE.ink500)
          .text(cell.label, x + 8, y + 7, {
            width: cellW - 16,
            characterSpacing: 1,
          });
        doc
          .font('Sans')
          .fontSize('multiline' in cell && cell.multiline ? 8 : 10)
          .fillColor(cell.color)
          .text(cell.value, x + 8, y + 22, {
            width: cellW - 16,
            ellipsis: !('multiline' in cell && cell.multiline),
            lineBreak: Boolean('multiline' in cell && cell.multiline),
          });
      });
      doc.y = tableY + cellH * 2 + 24;

      // ============================================================
      // 5. Recommended Brand Budget — eyebrow + monthly revenue pill
      // ============================================================
      doc
        .font('Sans')
        .fontSize(9)
        .fillColor(PALETTE.ink500)
        .text('RECOMMENDED BRAND BUDGET', left, doc.y, {
          width: contentW,
          align: 'center',
          characterSpacing: 2,
        });

      if (monthlyRevenue) {
        const pillW2 = 220;
        const pillX2 = left + (contentW - pillW2) / 2;
        const pillY2 = (doc.y as number) + 8;
        doc
          .roundedRect(pillX2, pillY2, pillW2, 38, 4)
          .lineWidth(1)
          .strokeColor('#A7F3D0')
          .fillColor(PALETTE.greenSoft)
          .fillAndStroke();
        doc
          .font('Sans')
          .fontSize(7)
          .fillColor('#047857')
          .text('ESTIMATED MONTHLY REVENUE', pillX2, pillY2 + 6, {
            width: pillW2,
            align: 'center',
            characterSpacing: 1.4,
          });
        doc
          .font('Serif')
          .fontSize(14)
          .fillColor('#065F46')
          .text(formatINR(monthlyRevenue), pillX2, pillY2 + 18, {
            width: pillW2,
            align: 'center',
          });
        doc.y = pillY2 + 50;
      } else {
        doc.y = (doc.y as number) + 20;
      }

      // Two budget cards side-by-side
      const budgetCardY = doc.y as number;
      const bcW = (contentW - 12) / 2;
      // Monthly
      doc
        .roundedRect(left, budgetCardY, bcW, 58, 4)
        .lineWidth(1)
        .strokeColor(PALETTE.border)
        .fillColor(PALETTE.surface)
        .fillAndStroke();
      doc
        .font('Sans')
        .fontSize(7)
        .fillColor(PALETTE.ink500)
        .text('MONTHLY BRAND BUDGET', left, budgetCardY + 12, {
          width: bcW,
          align: 'center',
          characterSpacing: 1.4,
        });
      doc
        .font('Serif')
        .fontSize(20)
        .fillColor(PALETTE.ink)
        .text(formatINR(monthlyBudget), left, budgetCardY + 26, {
          width: bcW,
          align: 'center',
        });
      // Annual (violet tint)
      doc
        .roundedRect(left + bcW + 12, budgetCardY, bcW, 58, 4)
        .lineWidth(1)
        .strokeColor('#DDD6FE')
        .fillColor('#F5F3FF')
        .fillAndStroke();
      doc
        .font('Sans')
        .fontSize(7)
        .fillColor('#6D28D9')
        .text('ANNUAL BUDGET (12 MONTHS)', left + bcW + 12, budgetCardY + 12, {
          width: bcW,
          align: 'center',
          characterSpacing: 1.4,
        });
      doc
        .font('Serif')
        .fontSize(20)
        .fillColor('#4C1D95')
        .text(formatINR(annualBudget), left + bcW + 12, budgetCardY + 26, {
          width: bcW,
          align: 'center',
        });
      doc.y = budgetCardY + 78;

      // ============================================================
      // 6. Budget Allocation & Channel Performance
      // ============================================================
      ensureSpace(doc, 280);
      doc
        .font('Serif')
        .fontSize(15)
        .fillColor(PALETTE.ink)
        .text('Budget Allocation & Channel Performance', left, doc.y);
      doc.y = (doc.y as number) + 10;

      const sectionTop = doc.y as number;
      const colW = (contentW - 24) / 2;

      // Left column: donut chart
      doc
        .font('Sans')
        .fontSize(10)
        .fillColor(PALETTE.primary)
        .text('Budget Distribution', left, sectionTop);
      drawDonut(
        doc,
        left + colW / 2,
        sectionTop + 90,
        56,
        28,
        allocations.map((a, i) => ({
          value: a.percent,
          color: PALETTE.channel[i % PALETTE.channel.length],
        })),
      );
      doc
        .font('Sans')
        .fontSize(11)
        .fillColor(PALETTE.ink)
        .text('100%', left + colW / 2 - 18, sectionTop + 84, {
          width: 36,
          align: 'center',
        });
      doc
        .font('Sans')
        .fontSize(7)
        .fillColor(PALETTE.ink500)
        .text('Allocated', left + colW / 2 - 24, sectionTop + 100, {
          width: 48,
          align: 'center',
          characterSpacing: 0.4,
        });

      // Right column: channel performance list
      const rightX = left + colW + 24;
      doc
        .font('Sans-Italic')
        .fontSize(10)
        .fillColor(PALETTE.primary)
        .text('Industry Channel Focus', rightX, sectionTop);

      const allChannels = allocations.flatMap((a) =>
        a.channels.map((ch) => ({
          name: ch.name,
          percent: ch.percent ?? Math.round((ch.amount / monthlyBudget) * 100),
          amount: ch.amount,
        })),
      );
      // Show up to 7 to mirror the mock — collapse the rest into "Other"
      const topChannels = allChannels.slice(0, 7);
      let chY = sectionTop + 20;
      topChannels.forEach((ch, i) => {
        const color = PALETTE.channel[i % PALETTE.channel.length];
        // Dot + name
        doc.circle(rightX + 4, chY + 4, 2.5).fillColor(color).fill();
        doc
          .font('Sans')
          .fontSize(9)
          .fillColor(PALETTE.ink)
          .text(ch.name, rightX + 14, chY, {
            width: colW - 130,
            ellipsis: true,
            lineBreak: false,
          });
        // Percent (coloured) + amount (muted)
        doc
          .font('Sans')
          .fontSize(9)
          .fillColor(color)
          .text(`${ch.percent}%`, rightX + colW - 80, chY, {
            width: 36,
            align: 'right',
            lineBreak: false,
          });
        doc
          .font('Sans')
          .fontSize(9)
          .fillColor(PALETTE.ink500)
          .text(formatINR(ch.amount), rightX + colW - 40, chY, {
            width: 40,
            align: 'right',
            lineBreak: false,
          });
        // Bar
        const barW = colW - 8;
        doc
          .roundedRect(rightX, chY + 14, barW, 3, 1.5)
          .fillColor('#E5E7EB')
          .fill();
        doc
          .roundedRect(rightX, chY + 14, (barW * Math.min(ch.percent, 100)) / 100, 3, 1.5)
          .fillColor(color)
          .fill();
        chY += 26;
      });

      doc.y = Math.max(sectionTop + 200, chY + 18);
      drawHairline(doc, left, doc.y, contentW);
      doc.y = (doc.y as number) + 18;

      // ============================================================
      // 7. Four category cards
      // ============================================================
      ensureSpace(doc, 180);
      const categoryAmounts = bucketCategories(allocations, annualBudget);
      const catTop = doc.y as number;
      const catW = (contentW - 12) / 2;
      const catH = 78;
      categoryAmounts.forEach((cat, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const cx = left + (catW + 12) * col;
        const cy = catTop + (catH + 12) * row;
        // Card body
        doc
          .roundedRect(cx, cy, catW, catH, 4)
          .lineWidth(0.8)
          .strokeColor(PALETTE.border)
          .fillColor(PALETTE.surface)
          .fillAndStroke();
        // Coloured top border (4px stripe)
        doc
          .rect(cx, cy, catW, 4)
          .fillColor(PALETTE.category[i])
          .fill();
        // Label + percent
        doc
          .font('Sans')
          .fontSize(10)
          .fillColor(PALETTE.ink)
          .text(cat.label, cx + 14, cy + 14, {
            width: catW - 80,
            lineBreak: false,
          });
        doc
          .font('Sans')
          .fontSize(10)
          .fillColor(PALETTE.category[i])
          .text(`${cat.percent}%`, cx + catW - 60, cy + 14, {
            width: 46,
            align: 'right',
            lineBreak: false,
          });
        // Amount
        doc
          .font('Serif')
          .fontSize(16)
          .fillColor(PALETTE.ink)
          .text(formatINR(cat.amount), cx + 14, cy + 30);
        // Tagline
        doc
          .font('Sans')
          .fontSize(7.5)
          .fillColor(PALETTE.ink500)
          .text(cat.tagline, cx + 14, cy + 54, {
            width: catW - 28,
            lineGap: 1,
          });
      });
      doc.y = catTop + (catH + 12) * 2;

      // ============================================================
      // 8. Footer
      // ============================================================
      const footerY = pageH - 32;
      drawHairline(doc, left, footerY - 12, contentW);
      doc
        .font('Sans')
        .fontSize(7.5)
        .fillColor(PALETTE.ink500)
        .text(
          'Generated by MIBBS \u00B7 Track actual spend in the Spend Tracker to compare against this plan.',
          left,
          footerY - 4,
          { width: contentW, align: 'center' },
        );

      doc.end();
    });
  }
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
}

/**
 * Render the brand block-art motif — a direct port of /public/brand/mibbs-svg.svg
 * (viewBox 500 × 300) into PDFKit primitives so the PDF cover carries the same
 * decorative element used on the auth left panel. No SVG parser required.
 *
 * `boxW` × `boxH` defines the rendered size; the five shapes are scaled
 * proportionally from the original 500 × 300 viewBox.
 */
function drawBrandMotif(
  doc: InstanceType<typeof PDFDocument>,
  x: number,
  y: number,
  boxW: number,
  boxH: number,
) {
  const sx = boxW / 500;
  const sy = boxH / 300;
  // 1. pink square, bottom-left
  doc.rect(x + 0 * sx, y + 200 * sy, 100 * sx, 100 * sy).fillColor('#E495BE').fill();
  // 2. plum L-shape: M100,100 H300 V300 H200 V200 H100 Z
  doc
    .moveTo(x + 100 * sx, y + 100 * sy)
    .lineTo(x + 300 * sx, y + 100 * sy)
    .lineTo(x + 300 * sx, y + 300 * sy)
    .lineTo(x + 200 * sx, y + 300 * sy)
    .lineTo(x + 200 * sx, y + 200 * sy)
    .lineTo(x + 100 * sx, y + 200 * sy)
    .closePath()
    .fillColor('#9868AC')
    .fill();
  // 3. deep violet square, top-mid-right
  doc.rect(x + 300 * sx, y + 0 * sy, 100 * sx, 100 * sy).fillColor('#5C4798').fill();
  // 4. hot pink square, top-right
  doc.rect(x + 400 * sx, y + 0 * sy, 100 * sx, 100 * sy).fillColor('#EB64A5').fill();
  // 5. deep violet tall rectangle, right
  doc.rect(x + 400 * sx, y + 100 * sy, 100 * sx, 200 * sy).fillColor('#5C4798').fill();
}

function drawHairline(
  doc: InstanceType<typeof PDFDocument>,
  x: number,
  y: number,
  w: number,
) {
  doc
    .save()
    .moveTo(x, y)
    .lineTo(x + w, y)
    .lineWidth(0.5)
    .strokeColor(PALETTE.border)
    .stroke()
    .restore();
}

/**
 * Draw a donut chart at (cx, cy) with the given outer/inner radii.
 * Each segment is a coloured wedge whose angular size is proportional to
 * its `value`. Values are summed and normalised so partial inputs still
 * produce a closed ring.
 */
function drawDonut(
  doc: InstanceType<typeof PDFDocument>,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  segments: Array<{ value: number; color: string }>,
) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let startAngle = -Math.PI / 2;
  for (const seg of segments) {
    const angle = (seg.value / total) * Math.PI * 2;
    const endAngle = startAngle + angle;
    drawArcSegment(doc, cx, cy, outerR, innerR, startAngle, endAngle, seg.color);
    startAngle = endAngle;
  }
}

function drawArcSegment(
  doc: InstanceType<typeof PDFDocument>,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startRad: number,
  endRad: number,
  color: string,
) {
  const steps = Math.max(8, Math.floor(((endRad - startRad) * 180) / Math.PI / 3));
  const outerPts: Array<[number, number]> = [];
  const innerPts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = startRad + ((endRad - startRad) * i) / steps;
    outerPts.push([cx + Math.cos(t) * outerR, cy + Math.sin(t) * outerR]);
    innerPts.push([cx + Math.cos(t) * innerR, cy + Math.sin(t) * innerR]);
  }
  doc.moveTo(outerPts[0][0], outerPts[0][1]);
  for (const p of outerPts.slice(1)) doc.lineTo(p[0], p[1]);
  for (const p of innerPts.reverse()) doc.lineTo(p[0], p[1]);
  doc.closePath().fillColor(color).fill();
}

function bucketCategories(allocations: PlanAllocation[], annualBudget: number) {
  const amounts = [0, 0, 0, 0];
  for (const a of allocations) {
    const idx = INTENT_TO_CATEGORY[a.intent] ?? 0;
    amounts[idx] += Number(a.amount) * 12;
  }
  // Floor each bucket at 5 % of annual so the four-card layout never collapses
  const floor = Math.round(annualBudget * 0.05);
  for (let i = 0; i < amounts.length; i += 1) {
    if (amounts[i] < floor) amounts[i] = floor;
  }
  const sum = amounts.reduce((s, x) => s + x, 0) || 1;
  return amounts.map((amount, i) => ({
    label: CATEGORY_LABELS[i],
    tagline: CATEGORY_TAGLINES[i],
    amount,
    percent: Math.round((amount / sum) * 100),
  }));
}

function ensureSpace(doc: InstanceType<typeof PDFDocument>, needed: number) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if ((doc.y as number) + needed > bottom) {
    doc.addPage();
  }
}
