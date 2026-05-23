# MIBBS Backend

NestJS 10 + TypeScript + Prisma 5 + PostgreSQL 16 + Redis 7.

## Prerequisites

- Node.js 20 LTS
- Docker Desktop (for Postgres + Redis)

## First-time setup

```bash
cd mibbs/backend
cp .env.example .env

# Start Postgres + Redis only (api runs locally with hot reload)
docker compose up -d

# Install + generate Prisma client
npm install
npm run prisma:generate

# Apply schema + seed the Challenge×Objective matrix
npm run prisma:migrate
npm run db:seed

# Run dev server
npm run dev
```

API: <http://localhost:4000/v1>
Swagger: <http://localhost:4000/v1/docs>
Health: <http://localhost:4000/v1/health>
Readiness: <http://localhost:4000/v1/health/ready>

## Useful scripts

| Command | What |
| --- | --- |
| `npm run dev` | Start API with watch mode |
| `npm run build` | Production build |
| `npm test` | Run unit tests |
| `npm run prisma:migrate` | Create + apply a new migration |
| `npm run prisma:studio` | Open Prisma Studio UI |
| `npm run db:seed` | Re-seed canonical data |
| `docker compose --profile full up --build` | Run everything in containers |

## Layout

```
src/
  config/           env validation (Zod)
  common/           prisma, redis, filters, interceptors, decorators
  modules/          feature modules (health, auth, questionnaire, ...)
  providers/        pluggable external integrations (AI, WhatsApp, Email, SMS)
prisma/
  schema.prisma     full data model
  seed.ts           Challenge × Objective matrix seed
```
