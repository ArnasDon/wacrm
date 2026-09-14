# syntax=docker/dockerfile:1

# ---------------------------------------------------------------
# Stage 1 — install dependencies (cached until package*.json change)
# ---------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------
# Stage 2 — build
#
# NEXT_PUBLIC_* values are inlined into the client bundle at build
# time, so they must be provided as build args (docker-compose.yml
# forwards them from .env.local). Server-only secrets (service role
# key, ENCRYPTION_KEY, META_APP_SECRET, ...) are read at runtime and
# must NOT be baked into the image.
# ---------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_APP_LOCALE=en
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
NEXT_PUBLIC_APP_LOCALE=$NEXT_PUBLIC_APP_LOCALE \
NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---------------------------------------------------------------
# Stage 3 — minimal runtime (standalone output)
# ---------------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
NEXT_TELEMETRY_DISABLED=1 \
PORT=3000 \
HOSTNAME=0.0.0.0

RUN addgroup -S nextjs && adduser -S nextjs -G nextjs

COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public

USER nextjs
EXPOSE 3000

# Hits /api/health, not `/`: that route (a) is excluded from *all*
# middleware logic in src/proxy.ts — not just the canonical-host
# redirect (see the early-return there for this exact path) — so this
# check can't be caught by a regression in that logic again, on top of
# the loopback-host guard the redirect itself now applies, and (b)
# reports actual liveness (DB reachable, required secrets present)
# instead of "did some page render a response under 500".
HEALTHCHECK --interval=30s --timeout=8s --start-period=15s --retries=3 \
CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]
