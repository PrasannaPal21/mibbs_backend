#!/usr/bin/env node
/**
 * Downloads the font files used by the PDF report generator.
 *
 * The PDF reports embed Inter (sans) and Fraunces (serif). Both have full
 * Unicode coverage including the Indian Rupee glyph (₹) which PDFKit's
 * built-in Helvetica lacks.
 *
 * Run once after fresh install:
 *   node scripts/fetch-pdf-fonts.mjs
 *
 * The resulting files are committed under src/modules/reports/fonts/.
 */
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:https';
import { pipeline } from 'node:stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_DIR = resolve(__dirname, '../src/modules/reports/fonts');

// Inter on google/fonts is published as a variable TTF (opsz + wght axes).
// fontkit (PDFKit's underlying parser) reads the default instance, which is
// Inter Regular — exactly what we want for body copy.
const INTER_VAR =
  'https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf';
const INTER_ITALIC_VAR =
  'https://github.com/google/fonts/raw/main/ofl/inter/Inter-Italic%5Bopsz%2Cwght%5D.ttf';
// Fraunces variable TTF — used for display headlines in the report.
const FRAUNCES_VAR =
  'https://github.com/google/fonts/raw/main/ofl/fraunces/Fraunces%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf';
const FRAUNCES_ITALIC_VAR =
  'https://github.com/google/fonts/raw/main/ofl/fraunces/Fraunces-Italic%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf';

const FILES = [
  { url: INTER_VAR, name: 'Inter-Regular.ttf' },
  { url: INTER_ITALIC_VAR, name: 'Inter-Italic.ttf' },
  { url: FRAUNCES_VAR, name: 'Fraunces-Regular.ttf' },
  { url: FRAUNCES_ITALIC_VAR, name: 'Fraunces-Italic.ttf' },
];

function download(url) {
  return new Promise((resolveFn, rejectFn) => {
    const doRequest = (target, redirectsLeft = 5) => {
      const req = request(target, { method: 'GET' }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) {
            rejectFn(new Error(`Too many redirects fetching ${url}`));
            return;
          }
          res.resume();
          const next = new URL(res.headers.location, target).toString();
          doRequest(next, redirectsLeft - 1);
          return;
        }
        if (res.statusCode !== 200) {
          rejectFn(new Error(`HTTP ${res.statusCode} fetching ${target}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolveFn(Buffer.concat(chunks)));
        res.on('error', rejectFn);
      });
      req.on('error', rejectFn);
      req.end();
    };
    doRequest(url);
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const { url, name } of FILES) {
    const target = join(OUT_DIR, name);
    try {
      const existing = await stat(target);
      if (existing.size > 10_000) {
        console.log(`✓ ${name} (cached, ${(existing.size / 1024).toFixed(0)} KB)`);
        continue;
      }
    } catch {
      // not present, fall through
    }
    process.stdout.write(`↓ ${name}… `);
    const buf = await download(url);
    await writeFile(target, buf);
    console.log(`${(buf.length / 1024).toFixed(0)} KB`);
  }
  console.log(`\nDone. Fonts saved to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
