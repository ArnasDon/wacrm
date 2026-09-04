# syntax=docker/dockerfile:1

# ============================================================
# wacrm — production image for EasyPanel (Next.js standalone)
# ============================================================
# Multi-stage build:
#   deps    -> install full dependencies
#   builder -> next build
#   runner  -> minimal runtime
#
# NEXT_PUBLIC_* values are inlined into the client bundle at
# BUILD time, so they must be passed as --build-arg.
# Server-only secrets are read at runtime.

ARG NODE_VERSION=22-alpine

# ---------- deps ----------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# libc compat for some native dependencies
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
RUN npm ci

# ---------- builder ----------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

# Public build-time variables
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_APP_LOCALE=en

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_APP_LOCALE=$NEXT_PUBLIC_APP_LOCALE

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ---------- runner ----------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as an unprivileged user
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Static assets
COPY --from=builder /app/public ./public

# Standalone server + traced node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]