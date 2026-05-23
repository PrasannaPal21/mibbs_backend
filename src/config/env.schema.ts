import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('v1'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),

  DATABASE_URL: z.string().url(),
  // Direct (non-pooled) database URL used by Prisma migrations + seed only.
  // Optional: when missing, Prisma falls back to DATABASE_URL.
  DIRECT_URL: z.string().url().optional(),

  // Either provide REDIS_URL (e.g. rediss://default:xxx@host:6379 from Upstash)
  // OR the host/port/password trio for local Docker Redis. URL takes priority.
  REDIS_URL: z.string().optional().default(''),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
  JWT_ACCESS_TTL: z.string().regex(/^\d+[smhd]$/, 'JWT_ACCESS_TTL must look like 15m / 1h / 7d').default('15m'),
  // Refresh tokens are opaque random strings (256-bit, SHA-256 in DB) — we
  // intentionally do NOT sign them as JWTs. The variable is kept for
  // backwards-compat and as a future toggle. Optional.
  JWT_REFRESH_SECRET: z.string().min(32).optional().default('unused-refresh-tokens-are-opaque-strings'),
  JWT_REFRESH_TTL: z.string().regex(/^\d+[smhd]$/, 'JWT_REFRESH_TTL must look like 7d / 30d').default('30d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  // Refresh-token cookie attributes — production deployments running the
  // frontend on a different origin (e.g. Vercel) must set SameSite=None +
  // Secure so the cookie is sent on cross-site fetches. When frontend and
  // backend share a registrable domain, COOKIE_DOMAIN=.yourdomain.com +
  // SameSite=lax is the safer choice.
  COOKIE_SECURE: z
    .union([z.literal('true'), z.literal('false'), z.literal('auto')])
    .default('auto'),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional().default(''),

  THROTTLE_TTL: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),

  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  WHATSAPP_PROVIDER: z.enum(['meta', 'stub']).default('stub'),
  WHATSAPP_META_PHONE_NUMBER_ID: z.string().optional().default(''),
  WHATSAPP_META_ACCESS_TOKEN: z.string().optional().default(''),

  EMAIL_PROVIDER: z.enum(['resend', 'stub']).default('stub'),
  RESEND_API_KEY: z.string().optional().default(''),
  EMAIL_FROM: z.string().default('MIBBS <no-reply@mibbs.app>'),

  SMS_PROVIDER: z.enum(['twilio', 'stub']).default('stub'),
  TWILIO_ACCOUNT_SID: z.string().optional().default(''),
  TWILIO_AUTH_TOKEN: z.string().optional().default(''),
  TWILIO_FROM: z.string().optional().default(''),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}
