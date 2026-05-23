#!/usr/bin/env node
/**
 * Dev helper: render a sample marketing-plan PDF using the same drawing code
 * as ReportsService, so we can inspect the visual layout without spinning up
 * Postgres / the full Nest app.
 *
 * Usage: node scripts/preview-pdf.mjs out.pdf
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = resolve(__dirname, '../src/modules/reports/fonts');

const PALETTE = {
  ink: '#1F1934',
  ink700: '#3D344F',
  ink500: '#67617D',
  border: '#E0DAD0',
  surface: '#FBF8F4',
  surfaceMuted: '#F4EFE6',
  accent: '#E04C7A',
  primary: '#6D28D9',
  chart: [
    '#6D28D9', '#D77450', '#5C8B73', '#D9A441',
    '#7E459E', '#D88FA6', '#4E7AA6', '#A38463',
  ],
};

const sample = {
  businessName: 'Aurelia Studio',
  industry: 'Interior design',
  location: 'Hyderabad',
  monthlyBudget: 120000,
  annualBudget: 1440000,
  generated: new Date('2026-05-22'),
  allocations: [
    {
      label: 'Enquiries',
      percent: 28,
      amount: 33600,
      channels: [
        { name: 'Digital brand campaigns', amount: 5600 },
        { name: 'Content marketing', amount: 5600 },
        { name: 'Social media marketing', amount: 5600 },
        { name: 'Influencer marketing', amount: 5600 },
        { name: 'PR & communications', amount: 5600 },
        { name: 'Offline marketing', amount: 5600 },
      ],
    },
    {
      label: 'Trust & credibility',
      percent: 25,
      amount: 30000,
      channels: [
        { name: 'Identity & design', amount: 6000 },
        { name: 'Content creation', amount: 6000 },
        { name: 'PR & communications', amount: 6000 },
        { name: 'Influencer marketing', amount: 6000 },
        { name: 'Print media', amount: 6000 },
      ],
    },
    {
      label: 'Customer retention',
      percent: 22,
      amount: 26400,
      channels: [
        { name: 'Email marketing', amount: 6600 },
        { name: 'CRM tools', amount: 6600 },
        { name: 'Loyalty programs', amount: 6600 },
        { name: 'WhatsApp marketing', amount: 6600 },
      ],
    },
    {
      label: 'Market understanding',
      percent: 15,
      amount: 18000,
      channels: [
        { name: 'Market research', amount: 9000 },
        { name: 'Analytics tools', amount: 9000 },
      ],
    },
    {
      label: 'Operational efficiency',
      percent: 10,
      amount: 12000,
      channels: [
        { name: 'Marketing automation', amount: 6000 },
        { name: 'Training & workshops', amount: 6000 },
      ],
    },
  ],
};

function formatINR(n) {
  return `\u20B9${n.toLocaleString('en-IN')}`;
}

function drawHairline(doc, x, y, w) {
  doc.save().moveTo(x, y).lineTo(x + w, y).lineWidth(0.5).strokeColor(PALETTE.border).stroke().restore();
}

function drawPie(doc, cx, cy, r, startRad, endRad, color) {
  const steps = Math.max(8, Math.floor(((endRad - startRad) * 180) / Math.PI / 4));
  doc.moveTo(cx, cy);
  for (let i = 0; i <= steps; i += 1) {
    const t = startRad + ((endRad - startRad) * i) / steps;
    doc.lineTo(cx + Math.cos(t) * r, cy + Math.sin(t) * r);
  }
  doc.closePath().fillColor(color).fill();
}

function drawBrandMark(doc, x, y, r) {
  doc.save();
  doc.circle(x + r, y + r, r).lineWidth(0.9).strokeColor(PALETTE.ink).stroke();
  drawPie(doc, x + r, y + r, r * 0.94, -Math.PI / 2, -Math.PI / 2 + Math.PI * 0.42, PALETTE.primary);
  drawPie(doc, x + r, y + r, r * 0.94, -Math.PI / 2 + Math.PI * 0.42, -Math.PI / 2 + Math.PI * 0.85, PALETTE.accent);
  doc.circle(x + r, y + r, r * 0.18).fillColor(PALETTE.ink).fill();
  doc.restore();
}

const outPath = resolve(process.argv[2] ?? 'preview.pdf');

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 56, bottom: 56, left: 56, right: 56 },
});
const chunks = [];
doc.on('data', (c) => chunks.push(c));
doc.on('end', async () => {
  await writeFile(outPath, Buffer.concat(chunks));
  console.log(`Wrote ${outPath}`);
});

doc.registerFont('Sans', join(FONT_DIR, 'Inter-Regular.ttf'));
doc.registerFont('Sans-Italic', join(FONT_DIR, 'Inter-Italic.ttf'));
doc.registerFont('Serif', join(FONT_DIR, 'Fraunces-Regular.ttf'));
doc.registerFont('Serif-Italic', join(FONT_DIR, 'Fraunces-Italic.ttf'));

const { width: pageW, height: pageH } = doc.page;
const left = doc.page.margins.left;
const right = pageW - doc.page.margins.right;
const contentW = right - left;

drawBrandMark(doc, left, 48, 14);
doc.font('Sans').fontSize(10).fillColor(PALETTE.ink).text('mibbs', left + 22, 51);
doc.font('Sans').fontSize(9).fillColor(PALETTE.ink500)
  .text(`Generated ${sample.generated.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    left, 51, { width: contentW, align: 'right' });

doc.font('Sans').fontSize(8.5).fillColor(PALETTE.ink500)
  .text(`MARKETING PLAN · ${sample.generated.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }).toUpperCase()}`,
    left, 110, { characterSpacing: 1.8 });

doc.font('Serif').fontSize(34).fillColor(PALETTE.ink)
  .text(sample.businessName, left, 128, { width: contentW, lineGap: 2 });

doc.moveDown(0.4)
  .font('Sans').fontSize(10.5).fillColor(PALETTE.ink500)
  .text(`${sample.industry} · ${sample.location}`, { width: contentW });

const dividerY = doc.y + 18;
drawHairline(doc, left, dividerY, contentW);
doc.y = dividerY + 22;

const statY = doc.y;
const statW = contentW / 3;
const stats = [
  { label: 'Monthly budget', value: formatINR(sample.monthlyBudget) },
  { label: 'Annual budget', value: formatINR(sample.annualBudget) },
  { label: 'Objectives', value: String(sample.allocations.length) },
];
stats.forEach((s, i) => {
  const x = left + statW * i;
  doc.font('Sans').fontSize(8).fillColor(PALETTE.ink500)
    .text(s.label.toUpperCase(), x, statY, { width: statW, characterSpacing: 1.4 });
  doc.font('Serif').fontSize(22).fillColor(PALETTE.ink)
    .text(s.value, x, statY + 16, { width: statW });
});
doc.y = statY + 60;
drawHairline(doc, left, doc.y, contentW);
doc.y += 24;

doc.font('Sans').fontSize(8.5).fillColor(PALETTE.ink500)
  .text('SECTION 01', left, doc.y, { characterSpacing: 1.8 });
doc.font('Serif').fontSize(22).fillColor(PALETTE.ink)
  .text('Budget allocation', left, doc.y + 4);
doc.font('Sans-Italic').fontSize(11).fillColor(PALETTE.ink500)
  .text('How your monthly spend distributes across objectives.', { width: contentW });
doc.y += 18;

const ROW_GAP = 22;
const BAR_H = 6;
const BAR_RADIUS = 3;

sample.allocations.forEach((row, i) => {
  const color = PALETTE.chart[i % PALETTE.chart.length];
  const y = doc.y;

  doc.roundedRect(left, y + 6, 6, 12, 1.5).fillColor(color).fill();
  doc.font('Sans').fontSize(12).fillColor(PALETTE.ink)
    .text(row.label, left + 16, y + 4, { width: contentW * 0.55 });

  const rightLabelW = 180;
  const rightLabelX = right - rightLabelW;
  doc.font('Sans').fontSize(9).fillColor(PALETTE.ink500)
    .text(`${row.percent}% of budget`, rightLabelX, y + 4, { width: rightLabelW, align: 'right' });
  doc.font('Serif').fontSize(15).fillColor(PALETTE.ink)
    .text(formatINR(row.amount), rightLabelX, y + 18, { width: rightLabelW, align: 'right' });

  const barY = y + 42;
  doc.roundedRect(left, barY, contentW, BAR_H, BAR_RADIUS).fillColor(PALETTE.surfaceMuted).fill();
  doc.roundedRect(left, barY, Math.max(2, (contentW * row.percent) / 100), BAR_H, BAR_RADIUS).fillColor(color).fill();

  let chipX = left;
  let chipY = barY + 14;
  const chipPadX = 8, chipH = 18, chipGap = 6, lineGap = 6;
  for (const ch of row.channels) {
    const chipText = `${ch.name} · ${formatINR(ch.amount)}`;
    const w = doc.font('Sans').fontSize(8.5).widthOfString(chipText) + chipPadX * 2;
    if (chipX + w > right) {
      chipX = left;
      chipY += chipH + lineGap;
    }
    doc.roundedRect(chipX, chipY, w, chipH, 9).lineWidth(0.6).strokeColor(PALETTE.border).fillColor(PALETTE.surface).fillAndStroke();
    doc.font('Sans').fontSize(8.5).fillColor(PALETTE.ink700)
      .text(chipText, chipX + chipPadX, chipY + 5, { lineBreak: false });
    chipX += w + chipGap;
  }
  doc.y = chipY + chipH + ROW_GAP;
});

const footerY = pageH - 40;
drawHairline(doc, left, footerY - 16, contentW);
doc.font('Sans').fontSize(8).fillColor(PALETTE.ink500)
  .text('Generated by mibbs · Track actual spend in the Spend tracker to compare against this plan.',
    left, footerY - 6, { width: contentW, align: 'center' });

doc.end();
