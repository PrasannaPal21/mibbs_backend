# syntax=docker/dockerfile:1.7

# ---- base ----
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

# ---- deps ----
FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev

# ---- build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

# ---- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl libc6-compat tini && \
    addgroup -g 1001 -S nodejs && \
    adduser -S mibbs -u 1001 -G nodejs

COPY --from=build --chown=mibbs:nodejs /app/dist ./dist
COPY --from=build --chown=mibbs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=mibbs:nodejs /app/prisma ./prisma
COPY --from=build --chown=mibbs:nodejs /app/package.json ./package.json

USER mibbs
EXPOSE 4000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
