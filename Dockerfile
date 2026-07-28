# syntax=docker/dockerfile:1

# ============================================================
# wacrm — production image for EasyPanel (Next.js 16 standalone)
# ============================================================
# Multi-stage build:
#   deps    -> install full dependencies (cached on lockfile)
#   builder -> next build (emits .next/standalone)
#   runner  -> minimal runtime, copies only the standalone output
#
# NOTE: NEXT_PUBLIC_* values are inlined into the client bundle at
# BUILD time, so they must be passed as --build-arg (see below), not
# only as runtime env vars. In EasyPanel set them under the service's
# "Build > Build Arguments". Server-only secrets (service-role key,
# ENCRYPTION_KEY, META_APP_SECRET, ...) are read at runtime — set them
# under "Environment" instead.

ARG NODE_VERSION=22-alpine

# ---------- deps ----------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# libc compat for some native deps
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

# ---------- builder ----------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

# Public (build-time-inlined) vars. Provide via --build-arg.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

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

# Run as an unprivileged user.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Static assets the standalone server.js serves itself.
COPY --from=builder /app/public ./public
# Standalone server + its traced node_modules (already minimal).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
