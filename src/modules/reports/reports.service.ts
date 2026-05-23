import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { join } from 'node:path';
import { PrismaService } from '../../common/prisma/prisma.service';

interface PlanAllocation {
  label: string;
  percent: number;
  amount: number;
  channels: Array<{ name: string; amount: number }>;
}

/**
 * Editorial palette — kept in sync with the web app (tailwind.config.ts and
 * the chart palette in `client-charts.tsx`).
 */
const PALETTE = {
  ink: '#1F1934',
  ink700: '#3D344F',
  ink500: '#67617D',
  ink300: '#A8A2B6',
  border: '#E0DAD0',
  surface: '#FBF8F4',
  surfaceMuted: '#F4EFE6',
  accent: '#E04C7A',
  primary: '#6D28D9',
  // Eight-tone chart palette — matches BudgetPieChart / PlanView
  chart: [
    '#6D28D9',
    '#D77450',
    '#5C8B73',
    '#D9A441',
    '#7E459E',
    '#D88FA6',
    '#4E7AA6',
    '#A38463',
  ],
} as const;

const FONT_DIR = join(__dirname, 'fonts');
const FONTS = {
  sans: join(FONT_DIR, 'Inter-Regular.ttf'),
  sansItalic: join(FONT_DIR, 'Inter-Italic.ttf'),
  serif: join(FONT_DIR, 'Fraunces-Regular.ttf'),
  serifItalic: join(FONT_DIR, 'Fraunces-Italic.ttf'),
} as const;

function formatINR(amount: number): string {
  return `\u20B9${Number(amount).toLocaleString('en-IN')}`;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async generatePlanPdf(userId: string, planId: string): Promise<Buffer> {
    const plan = await this.prisma.marketingPlan.findFirst({
      where: { id: planId, userId },
      include: { user: { include: { businessProfile: true } } },
    });
    if (!plan) throw new NotFoundException('Marketing plan not found');

    const bp = plan.user.businessProfile;
    const allocations = plan.allocations as unknown as PlanAllocation[];
    const businessName = bp?.businessName ?? plan.user.name;
    const monthlyBudget = Number(plan.monthlyBudget);
    const annualBudget = Number(plan.annualBudget);
    const generated = plan.generatedAt.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const monthLabel = plan.generatedAt.toLocaleDateString('en-IN', {
      month: 'long',
      year: 'numeric',
    });

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 56, bottom: 56, left: 56, right: 56 },
        info: {
          Title: `${businessName} — Marketing plan`,
          Author: 'mibbs',
          Subject: 'Marketing budget allocation',
        },
      });

      // Register all four fonts up front.
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

      // ──────────────────────────────────────────────────────────────────
      // Header band — brand mark + meta
      // ──────────────────────────────────────────────────────────────────
      drawBrandMark(doc, left, 48, 14);
      doc
        .font('Sans')
        .fontSize(10)
        .fillColor(PALETTE.ink)
        .text('mibbs', left + 22, 51);

      doc
        .font('Sans')
        .fontSize(9)
        .fillColor(PALETTE.ink500)
        .text(`Generated ${generated}`, left, 51, {
          width: contentW,
          align: 'right',
        });

      // Eyebrow + display title
      doc
        .font('Sans')
        .fontSize(8.5)
        .fillColor(PALETTE.ink500)
        .text(`MARKETING PLAN · ${monthLabel.toUpperCase()}`, left, 110, {
          characterSpacing: 1.8,
        });

      doc
        .font('Serif')
        .fontSize(34)
        .fillColor(PALETTE.ink)
        .text(businessName, left, 128, { width: contentW, lineGap: 2 });

      const metaParts = [bp?.industry, bp?.location].filter(Boolean) as string[];
      if (metaParts.length > 0) {
        doc
          .moveDown(0.4)
          .font('Sans')
          .fontSize(10.5)
          .fillColor(PALETTE.ink500)
          .text(metaParts.join(' · '), { width: contentW });
      }

      // ──────────────────────────────────────────────────────────────────
      // Hairline divider
      // ──────────────────────────────────────────────────────────────────
      const dividerY = (doc.y as number) + 18;
      drawHairline(doc, left, dividerY, contentW);
      doc.y = dividerY + 22;

      // ──────────────────────────────────────────────────────────────────
      // Stats row — three columns
      // ──────────────────────────────────────────────────────────────────
      const statY = doc.y as number;
      const statW = contentW / 3;
      const stats = [
        { label: 'Monthly budget', value: formatINR(monthlyBudget) },
        { label: 'Annual budget', value: formatINR(annualBudget) },
        {
          label: 'Objectives',
          value: allocations.length > 0 ? String(allocations.length) : '—',
        },
      ];
      stats.forEach((stat, i) => {
        const x = left + statW * i;
        doc
          .font('Sans')
          .fontSize(8)
          .fillColor(PALETTE.ink500)
          .text(stat.label.toUpperCase(), x, statY, {
            width: statW,
            characterSpacing: 1.4,
          });
        doc
          .font('Serif')
          .fontSize(22)
          .fillColor(PALETTE.ink)
          .text(stat.value, x, statY + 16, { width: statW });
      });
      doc.y = statY + 60;

      drawHairline(doc, left, doc.y, contentW);
      doc.y += 24;

      // ──────────────────────────────────────────────────────────────────
      // Section heading
      // ──────────────────────────────────────────────────────────────────
      doc
        .font('Sans')
        .fontSize(8.5)
        .fillColor(PALETTE.ink500)
        .text('SECTION 01', left, doc.y, { characterSpacing: 1.8 });

      doc
        .font('Serif')
        .fontSize(22)
        .fillColor(PALETTE.ink)
        .text('Budget allocation', left, (doc.y as number) + 4);

      doc
        .font('Sans-Italic')
        .fontSize(11)
        .fillColor(PALETTE.ink500)
        .text('How your monthly spend distributes across objectives.', {
          width: contentW,
        });

      doc.y = (doc.y as number) + 18;

      // ──────────────────────────────────────────────────────────────────
      // Allocation rows
      // ──────────────────────────────────────────────────────────────────
      const ROW_GAP = 22;
      const BAR_H = 6;
      const BAR_RADIUS = 3;

      allocations.forEach((row, i) => {
        const color = PALETTE.chart[i % PALETTE.chart.length];
        ensureSpace(doc, 110);
        const y = doc.y as number;

        // Color swatch + label
        doc
          .roundedRect(left, y + 6, 6, 12, 1.5)
          .fillColor(color)
          .fill();

        doc
          .font('Sans')
          .fontSize(12)
          .fillColor(PALETTE.ink)
          .text(row.label, left + 16, y + 4, { width: contentW * 0.55 });

        // Right side: percent + amount stacked
        const rightLabelW = 180;
        const rightLabelX = right - rightLabelW;
        doc
          .font('Sans')
          .fontSize(9)
          .fillColor(PALETTE.ink500)
          .text(`${row.percent}% of budget`, rightLabelX, y + 4, {
            width: rightLabelW,
            align: 'right',
          });
        doc
          .font('Serif')
          .fontSize(15)
          .fillColor(PALETTE.ink)
          .text(formatINR(row.amount), rightLabelX, y + 18, {
            width: rightLabelW,
            align: 'right',
          });

        // Progress bar (track + filled)
        const barY = y + 42;
        doc
          .roundedRect(left, barY, contentW, BAR_H, BAR_RADIUS)
          .fillColor(PALETTE.surfaceMuted)
          .fill();
        const filledW = Math.max(2, (contentW * row.percent) / 100);
        doc
          .roundedRect(left, barY, filledW, BAR_H, BAR_RADIUS)
          .fillColor(color)
          .fill();

        // Channel chips — wrap onto multiple lines when they overflow
        const chipPadX = 8;
        const chipH = 18;
        const chipGap = 6;
        const lineGap = 6;
        let chipX = left;
        let chipY = barY + 14;
        for (const ch of row.channels) {
          const chipText = `${ch.name} · ${formatINR(ch.amount)}`;
          const w =
            doc.font('Sans').fontSize(8.5).widthOfString(chipText) + chipPadX * 2;
          if (chipX + w > right) {
            chipX = left;
            chipY += chipH + lineGap;
          }
          doc
            .roundedRect(chipX, chipY, w, chipH, 9)
            .lineWidth(0.6)
            .strokeColor(PALETTE.border)
            .fillColor(PALETTE.surface)
            .fillAndStroke();
          doc
            .font('Sans')
            .fontSize(8.5)
            .fillColor(PALETTE.ink700)
            .text(chipText, chipX + chipPadX, chipY + 5, {
              lineBreak: false,
            });
          chipX += w + chipGap;
        }

        doc.y = chipY + chipH + ROW_GAP;
      });

      // ──────────────────────────────────────────────────────────────────
      // Footer
      // ──────────────────────────────────────────────────────────────────
      const footerY = pageH - 40;
      drawHairline(doc, left, footerY - 16, contentW);
      doc
        .font('Sans')
        .fontSize(8)
        .fillColor(PALETTE.ink500)
        .text(
          'Generated by mibbs · Track actual spend in the Spend tracker to compare against this plan.',
          left,
          footerY - 6,
          { width: contentW, align: 'center' },
        );

      doc.end();
    });
  }
}

// ──────────────────────────────────────────────────────────────────────
// Drawing helpers
// ──────────────────────────────────────────────────────────────────────

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
 * The mibbs symbol drawn in PDF primitives — a hairline outer ring with two
 * arc wedges (violet + coral) and a small ink core dot. Matches the SVG mark
 * used on the web.
 */
function drawBrandMark(
  doc: InstanceType<typeof PDFDocument>,
  cx: number,
  cy: number,
  r: number,
) {
  const ringX = cx;
  const ringY = cy;
  const radius = r;
  doc.save();
  // outer ring
  doc
    .circle(ringX + radius, ringY + radius, radius)
    .lineWidth(0.9)
    .strokeColor(PALETTE.ink)
    .stroke();
  // top-right violet wedge: 12 o'clock to ~3.5 o'clock
  drawPie(
    doc,
    ringX + radius,
    ringY + radius,
    radius * 0.94,
    -Math.PI / 2,
    -Math.PI / 2 + Math.PI * 0.42,
    PALETTE.primary,
  );
  // bottom-right coral wedge
  drawPie(
    doc,
    ringX + radius,
    ringY + radius,
    radius * 0.94,
    -Math.PI / 2 + Math.PI * 0.42,
    -Math.PI / 2 + Math.PI * 0.85,
    PALETTE.accent,
  );
  // center dot
  doc
    .circle(ringX + radius, ringY + radius, radius * 0.18)
    .fillColor(PALETTE.ink)
    .fill();
  doc.restore();
}

function drawPie(
  doc: InstanceType<typeof PDFDocument>,
  cx: number,
  cy: number,
  r: number,
  startRad: number,
  endRad: number,
  color: string,
) {
  // Approximate the arc with line segments — small angle so it stays smooth.
  const steps = Math.max(8, Math.floor(((endRad - startRad) * 180) / Math.PI / 4));
  doc.moveTo(cx, cy);
  for (let i = 0; i <= steps; i += 1) {
    const t = startRad + ((endRad - startRad) * i) / steps;
    const x = cx + Math.cos(t) * r;
    const y = cy + Math.sin(t) * r;
    doc.lineTo(x, y);
  }
  doc.closePath().fillColor(color).fill();
}

function ensureSpace(doc: InstanceType<typeof PDFDocument>, needed: number) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if ((doc.y as number) + needed > bottom) {
    doc.addPage();
  }
}
