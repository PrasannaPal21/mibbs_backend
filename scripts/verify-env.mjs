#!/usr/bin/env node
/**
 * Validates DATABASE_URL and DIRECT_URL before Prisma runs on Render.
 * Fails fast with a readable error instead of opaque P1013 messages.
 */
const KEYS = ['DATABASE_URL', 'DIRECT_URL'];

function clean(value) {
  if (value == null) return '';
  let s = String(value).trim();
  // Render users sometimes paste values wrapped in quotes.
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function maskPostgresUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '****';
    return u.toString();
  } catch {
    return '(unparseable URL)';
  }
}

function assertPostgresUrl(name, url) {
  if (!url) {
    console.error(`\n❌ ${name} is missing or empty.`);
    console.error(`   Render → Environment → add ${name} with your Neon connection string.`);
    console.error(`   Paste ONLY the URL (no quotes, no "DATABASE_URL =" prefix).\n`);
    process.exit(1);
  }

  const scheme = url.split(':')[0]?.toLowerCase();
  if (scheme !== 'postgresql' && scheme !== 'postgres') {
    console.error(`\n❌ ${name} has invalid scheme "${scheme}".`);
    console.error(`   Expected postgresql://… (Neon Postgres), not redis:// or https://.`);
    console.error(`   Masked value: ${maskPostgresUrl(url)}\n`);
    if (scheme === 'rediss' || scheme === 'redis') {
      console.error('   Hint: REDIS_URL belongs in REDIS_URL, not DATABASE_URL.\n');
    }
    process.exit(1);
  }

  try {
    // eslint-disable-next-line no-new
    new URL(url);
  } catch (err) {
    console.error(`\n❌ ${name} is not a valid URL: ${err.message}`);
    console.error(`   Masked value: ${maskPostgresUrl(url)}\n`);
    process.exit(1);
  }
}

function warnNeonHints(databaseUrl, directUrl) {
  if (databaseUrl.includes('-pooler') === false && databaseUrl.includes('neon.tech')) {
    console.warn(
      '⚠️  DATABASE_URL does not contain "-pooler". For Neon, use the *pooled* connection string.',
    );
  }
  if (directUrl.includes('-pooler')) {
    console.error(
      '\n❌ DIRECT_URL must use Neon\'s *direct* host (no "-pooler" in hostname).\n',
    );
    process.exit(1);
  }
}

const databaseUrl = clean(process.env.DATABASE_URL);
const directUrl = clean(process.env.DIRECT_URL);

assertPostgresUrl('DATABASE_URL', databaseUrl);
assertPostgresUrl('DIRECT_URL', directUrl);
warnNeonHints(databaseUrl, directUrl);

// Write back trimmed values so child processes (prisma) see clean URLs.
process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_URL = directUrl;

console.log('✓ DATABASE_URL ok:', maskPostgresUrl(databaseUrl));
console.log('✓ DIRECT_URL ok:', maskPostgresUrl(directUrl));
