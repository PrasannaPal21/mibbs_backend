#!/usr/bin/env node
/**
 * Dev helper: render a sample marketing-plan PDF using the same drawing code
 * as ReportsService, so we can inspect the visual layout without spinning up
 * Postgres / the full Nest app.
 *
 * Usage: node scripts/preview-pdf.mjs [out.pdf]
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = resolve(__dirname, '../src/modules/reports/fonts');
const ASSET_DIR = resolve(__dirname, '../src/modules/reports/assets');
const BRAND_LOGO = join(ASSET_DIR, 'mibbs-logo.png');

const PALETTE = {
  ink: '#1F1934',
  ink500: '#67617D',
  border: '#E0DAD0',
  surface: '#FBF8F4',
  primary: '#6D28D9',
  callout: '#5B2D8C',
  accent: '#E04C7A',
  green: '#10B981',
  greenSoft: '#ECFDF5',
  channel: [
    '#0EA5E9', '#7C3AED', '#F59E0B', '#EF4444',
    '#8B5CF6', '#EC4899', '#10B981', '#F97316',
  ],
  category: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444'],
};

const FONTS = {
  sans: join(FONT_DIR, 'Inter-Regular.ttf'),
  sansItalic: join(FONT_DIR, 'Inter-Italic.ttf'),
  serif: join(FONT_DIR, 'Fraunces-Regular.ttf'),
};

const CATEGORY_LABELS = [
  'Digital Marketing', 'Brand & Creative', 'Traditional Media', 'Events & PR',
];
const CATEGORY_TAGLINES = [
  'Recommended annual budget for digital marketing activities.',
  'Recommended annual budget for brand & creative activities.',
  'Recommended annual budget for traditional media activities.',
  'Recommended annual budget for events & pr activities.',
];

function formatINR(n) {
  return `\u20B9${Math.round(n).toLocaleString('en-IN')}`;
}

function drawHairline(doc, x, y, w) {
  doc.save().moveTo(x, y).lineTo(x + w, y).lineWidth(0.5).strokeColor(PALETTE.border).stroke().restore();
}

function drawBrandMotif(doc, x, y, boxW, boxH) {
  const sx = boxW / 500;
  const sy = boxH / 300;
  doc.rect(x, y + 200 * sy, 100 * sx, 100 * sy).fillColor('#E495BE').fill();
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
  doc.rect(x + 300 * sx, y, 100 * sx, 100 * sy).fillColor('#5C4798').fill();
  doc.rect(x + 400 * sx, y, 100 * sx, 100 * sy).fillColor('#EB64A5').fill();
  doc.rect(x + 400 * sx, y + 100 * sy, 100 * sx, 200 * sy).fillColor('#5C4798').fill();
}

function drawArcSegment(doc, cx, cy, outerR, innerR, startRad, endRad, color) {
  const steps = Math.max(8, Math.floor(((endRad - startRad) * 180) / Math.PI / 3));
  const outerPts = [];
  const innerPts = [];
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

function drawDonut(doc, cx, cy, outerR, innerR, segments) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let startAngle = -Math.PI / 2;
  for (const seg of segments) {
    const angle = (seg.value / total) * Math.PI * 2;
    drawArcSegment(doc, cx, cy, outerR, innerR, startAngle, startAngle + angle, seg.color);
    startAngle += angle;
  }
}

function ensureSpace(doc, needed) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) doc.addPage();
}

function truncate(s, max) {
  return s.length > max ? `${s.slice(0, max - 1)}\u2026` : s;
}

const sample = {
  businessName: 'veda',
  monthlyBudget: 3500,
  annualBudget: 42000,
  bp: {
    industry: 'Fashion & Apparel',
    location: 'A.Gs. Staff Quarters, Telangana',
    targetAudience: 'Youth (18-35)',
    competitionLevel: 'Medium',
    marketingGoal: 'More people should know about us',
    monthlyRevenue: 50000,
  },
  allocations: [
    { label: 'Digital', intent: 'Growth', percent: 23, amount: 798, channels: [{ name: 'Instagram', amount: 400, percent: 12 }, { name: 'Google Ads', amount: 398, percent: 11 }] },
    { label: 'Influencer', intent: 'Growth', percent: 23, amount: 802, channels: [{ name: 'Influencer marketing', amount: 410, percent: 12 }] },
    { label: 'Print', intent: 'Stability', percent: 6, amount: 218, channels: [{ name: 'Local prints', amount: 218, percent: 6 }] },
    { label: 'OOH', intent: 'Stability', percent: 16, amount: 558, channels: [{ name: 'Hoardings', amount: 558, percent: 16 }] },
    { label: 'New launches', intent: 'Learning', percent: 8, amount: 287, channels: [{ name: 'Sampling', amount: 287, percent: 8 }] },
    { label: 'Influencer marketing', intent: 'Relationship', percent: 12, amount: 410, channels: [{ name: 'Reels', amount: 410, percent: 12 }] },
    { label: 'Visual branding', intent: 'Control', percent: 12, amount: 428, channels: [{ name: 'Logo system', amount: 428, percent: 12 }] },
  ],
};

const out = process.argv[2] ?? 'preview.pdf';

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 48, bottom: 48, left: 48, right: 48 },
});
const chunks = [];
doc.on('data', (c) => chunks.push(c));
doc.on('end', async () => {
  await writeFile(out, Buffer.concat(chunks));
  console.log(`Wrote ${resolve(out)}`);
});

doc.registerFont('Sans', FONTS.sans);
doc.registerFont('Sans-Italic', FONTS.sansItalic);
doc.registerFont('Serif', FONTS.serif);

const { width: pageW, height: pageH } = doc.page;
const left = doc.page.margins.left;
const right = pageW - doc.page.margins.right;
const contentW = right - left;

// Header
const logoH = 32;
const logoW = Math.round((logoH * 534) / 130);
doc.image(BRAND_LOGO, left, 36, { width: logoW, height: logoH });
const titleX = left + logoW + 14;
const motifW = 60;
const titleW = contentW - logoW - 14 - motifW - 12;
doc.font('Sans').fontSize(14).fillColor(PALETTE.ink)
  .text('Brand Budget Recommendation Report', titleX, 40, { width: titleW });
doc.font('Sans-Italic').fontSize(9).fillColor(PALETTE.ink500)
  .text('Generated by MIBBS — India\u2019s First Intelligent Brand Budgeting System', titleX, 58, { width: titleW });
drawBrandMotif(doc, right - motifW, 36, motifW, 36);
drawHairline(doc, left, 86, contentW);

// WHY MIBBS callout
const calloutY = 100;
doc.roundedRect(left, calloutY, contentW, 86, 4).fillColor(PALETTE.callout).fill();
doc.font('Sans').fontSize(11).fillColor('#FFFFFF')
  .text('WHY MIBBS?', left, calloutY + 12, { width: contentW, align: 'center', characterSpacing: 1.6 });
doc.font('Sans').fontSize(8.5).fillColor('#FFFFFFE6')
  .text('At Magsmen, we\u2019ve seen brands struggle not because they lacked ideas, but because they lacked intelligent budget planning. MIBBS is India\u2019s first intelligent brand budgeting system, a structured, data-driven model crafted to align your brand ambitions with financial discipline, helping you invest smarter, grow faster, and build a stronger market position.',
    left + 32, calloutY + 32, { width: contentW - 64, align: 'center', lineGap: 2 });

// Name + pill
doc.y = calloutY + 86 + 22;
const nameY = doc.y;
doc.font('Serif').fontSize(22).fillColor(PALETTE.ink).text(sample.businessName, left, nameY);
const pillW = doc.font('Sans').fontSize(9).widthOfString('Early Stage') + 24;
doc.roundedRect(right - pillW, nameY + 4, pillW, 18, 9).fillColor(PALETTE.greenSoft).fill();
doc.font('Sans').fontSize(9).fillColor(PALETTE.green)
  .text('+ Early Stage', right - pillW + 6, nameY + 8, { width: pillW - 12, align: 'center', lineBreak: false });
doc.y = nameY + 36;

// Profile table
const profile = [
  { label: 'INDUSTRY', value: sample.bp.industry, color: PALETTE.ink },
  { label: 'LOCATION', value: sample.bp.location, color: PALETTE.ink },
  { label: 'YEARS IN BUSINESS', value: 'Less than 1 year', color: PALETTE.ink },
  { label: 'DIGITAL MATURITY', value: 'Basic', color: PALETTE.ink },
  { label: 'TARGET AUDIENCE', value: sample.bp.targetAudience, color: '#7C3AED' },
  { label: 'COMPETITION LEVEL', value: sample.bp.competitionLevel, color: PALETTE.ink },
  { label: 'MARKETING GOAL', value: truncate(sample.bp.marketingGoal, 22), color: '#EA580C' },
  { label: 'SALES CHANNEL', value: 'Online & Retail', color: '#7C3AED' },
];
const tableY = doc.y;
const cellW = contentW / 4;
const cellH = 44;
profile.forEach((cell, i) => {
  const x = left + cellW * (i % 4);
  const y = tableY + cellH * Math.floor(i / 4);
  doc.rect(x, y, cellW, cellH).lineWidth(0.6).strokeColor(PALETTE.border).stroke();
  doc.font('Sans').fontSize(7).fillColor(PALETTE.ink500)
    .text(cell.label, x + 8, y + 7, { width: cellW - 16, characterSpacing: 1 });
  doc.font('Sans').fontSize(10).fillColor(cell.color)
    .text(cell.value, x + 8, y + 22, { width: cellW - 16, ellipsis: true, lineBreak: false });
});
doc.y = tableY + cellH * 2 + 24;

// Recommended budget
doc.font('Sans').fontSize(9).fillColor(PALETTE.ink500)
  .text('RECOMMENDED BRAND BUDGET', left, doc.y, { width: contentW, align: 'center', characterSpacing: 2 });
const pillW2 = 220;
const pillX2 = left + (contentW - pillW2) / 2;
const pillY2 = doc.y + 8;
doc.roundedRect(pillX2, pillY2, pillW2, 38, 4).lineWidth(1).strokeColor('#A7F3D0').fillColor(PALETTE.greenSoft).fillAndStroke();
doc.font('Sans').fontSize(7).fillColor('#047857')
  .text('ESTIMATED MONTHLY REVENUE', pillX2, pillY2 + 6, { width: pillW2, align: 'center', characterSpacing: 1.4 });
doc.font('Serif').fontSize(14).fillColor('#065F46')
  .text(formatINR(sample.bp.monthlyRevenue), pillX2, pillY2 + 18, { width: pillW2, align: 'center' });
doc.y = pillY2 + 50;

const budgetCardY = doc.y;
const bcW = (contentW - 12) / 2;
doc.roundedRect(left, budgetCardY, bcW, 58, 4).lineWidth(1).strokeColor(PALETTE.border).fillColor(PALETTE.surface).fillAndStroke();
doc.font('Sans').fontSize(7).fillColor(PALETTE.ink500)
  .text('MONTHLY BRAND BUDGET', left, budgetCardY + 12, { width: bcW, align: 'center', characterSpacing: 1.4 });
doc.font('Serif').fontSize(20).fillColor(PALETTE.ink)
  .text(formatINR(sample.monthlyBudget), left, budgetCardY + 26, { width: bcW, align: 'center' });
doc.roundedRect(left + bcW + 12, budgetCardY, bcW, 58, 4).lineWidth(1).strokeColor('#DDD6FE').fillColor('#F5F3FF').fillAndStroke();
doc.font('Sans').fontSize(7).fillColor('#6D28D9')
  .text('ANNUAL BUDGET (12 MONTHS)', left + bcW + 12, budgetCardY + 12, { width: bcW, align: 'center', characterSpacing: 1.4 });
doc.font('Serif').fontSize(20).fillColor('#4C1D95')
  .text(formatINR(sample.annualBudget), left + bcW + 12, budgetCardY + 26, { width: bcW, align: 'center' });
doc.y = budgetCardY + 78;

// Allocation section
ensureSpace(doc, 280);
doc.font('Serif').fontSize(15).fillColor(PALETTE.ink)
  .text('Budget Allocation & Channel Performance', left, doc.y);
doc.y += 10;
const sectionTop = doc.y;
const colW = (contentW - 24) / 2;

doc.font('Sans').fontSize(10).fillColor(PALETTE.primary).text('Budget Distribution', left, sectionTop);
drawDonut(doc, left + colW / 2, sectionTop + 90, 56, 28,
  sample.allocations.map((a, i) => ({ value: a.percent, color: PALETTE.channel[i % PALETTE.channel.length] })));
doc.font('Sans').fontSize(11).fillColor(PALETTE.ink)
  .text('100%', left + colW / 2 - 18, sectionTop + 84, { width: 36, align: 'center' });
doc.font('Sans').fontSize(7).fillColor(PALETTE.ink500)
  .text('Allocated', left + colW / 2 - 24, sectionTop + 100, { width: 48, align: 'center' });

const rightX = left + colW + 24;
doc.font('Sans-Italic').fontSize(10).fillColor(PALETTE.primary)
  .text('Industry Channel Focus', rightX, sectionTop);

const allChannels = sample.allocations.slice(0, 7);
let chY = sectionTop + 20;
allChannels.forEach((ch, i) => {
  const color = PALETTE.channel[i % PALETTE.channel.length];
  doc.circle(rightX + 4, chY + 4, 2.5).fillColor(color).fill();
  doc.font('Sans').fontSize(9).fillColor(PALETTE.ink)
    .text(ch.label, rightX + 14, chY, { width: colW - 130, ellipsis: true, lineBreak: false });
  doc.font('Sans').fontSize(9).fillColor(color)
    .text(`${ch.percent}%`, rightX + colW - 80, chY, { width: 36, align: 'right', lineBreak: false });
  doc.font('Sans').fontSize(9).fillColor(PALETTE.ink500)
    .text(formatINR(ch.amount), rightX + colW - 40, chY, { width: 40, align: 'right', lineBreak: false });
  doc.roundedRect(rightX, chY + 14, colW - 8, 3, 1.5).fillColor('#E5E7EB').fill();
  doc.roundedRect(rightX, chY + 14, (colW - 8) * Math.min(ch.percent, 100) / 100, 3, 1.5).fillColor(color).fill();
  chY += 26;
});

doc.y = Math.max(sectionTop + 200, chY + 18);
drawHairline(doc, left, doc.y, contentW);
doc.y += 18;

// Category cards
ensureSpace(doc, 180);
const catTop = doc.y;
const catW = (contentW - 12) / 2;
const catH = 78;
const samples = [
  { label: 'Digital Marketing', amount: 12899, percent: 31, tagline: CATEGORY_TAGLINES[0] },
  { label: 'Brand & Creative', amount: 9238, percent: 22, tagline: CATEGORY_TAGLINES[1] },
  { label: 'Traditional Media', amount: 8937, percent: 21, tagline: CATEGORY_TAGLINES[2] },
  { label: 'Events & PR', amount: 10927, percent: 26, tagline: CATEGORY_TAGLINES[3] },
];
samples.forEach((cat, i) => {
  const cx = left + (catW + 12) * (i % 2);
  const cy = catTop + (catH + 12) * Math.floor(i / 2);
  doc.roundedRect(cx, cy, catW, catH, 4).lineWidth(0.8).strokeColor(PALETTE.border).fillColor(PALETTE.surface).fillAndStroke();
  doc.rect(cx, cy, catW, 4).fillColor(PALETTE.category[i]).fill();
  doc.font('Sans').fontSize(10).fillColor(PALETTE.ink)
    .text(cat.label, cx + 14, cy + 14, { width: catW - 80, lineBreak: false });
  doc.font('Sans').fontSize(10).fillColor(PALETTE.category[i])
    .text(`${cat.percent}%`, cx + catW - 60, cy + 14, { width: 46, align: 'right', lineBreak: false });
  doc.font('Serif').fontSize(16).fillColor(PALETTE.ink)
    .text(formatINR(cat.amount), cx + 14, cy + 30);
  doc.font('Sans').fontSize(7.5).fillColor(PALETTE.ink500)
    .text(cat.tagline, cx + 14, cy + 54, { width: catW - 28, lineGap: 1 });
});

// Footer
const footerY = pageH - 32;
drawHairline(doc, left, footerY - 12, contentW);
doc.font('Sans').fontSize(7.5).fillColor(PALETTE.ink500)
  .text('Generated by MIBBS \u00B7 Track actual spend in the Spend Tracker to compare against this plan.',
    left, footerY - 4, { width: contentW, align: 'center' });

doc.end();
