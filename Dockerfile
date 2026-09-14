# syntax=docker/dockerfile:1
# ============================================================
# Production image for the CRM (Next.js 16, standalone output).
#
# Multi-stage: deps → build → runtime. The final image ships only the
# standalone server + static assets, no node_modules, no source.
#
# IMPORTANT — NEXT_PUBLIC_* are inlined into the CLIENT bundle at BUILD
# time, so they must be passed as --build-arg with the REAL values (the
# Supabase URL/anon key are public by design). Server-only secrets
# (service-role key, ENCRYPTION_KEY, Evolution creds, webhook secret) are
# read at RUNTIME and are injected by the stack env, never baked in.
# ============================================================

# ⚠️ A major do Node vive AQUI e no `.nvmrc` — e os dois têm de bater. O
# `FROM` não lê arquivo do contexto de build, então não há como derivar um do
# outro; é o único número duplicado que sobrou. Divergir volta a pôr CI e
# produção em majors diferentes, que é o que já custou um vermelho (ver a
# nota do `setup-node` em .github/workflows/pipeline.yml).
ARG NODE_VERSION=22

# ---- deps: install production + build deps ----
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: compile the standalone server ----
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Public build-time config — inlined into the client bundle.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_APP_LOCALE=pt-BR
# Nome, nome curto (o de baixo do ícone no celular) e logo do produto. Sem
# valor, o app se chama "CRM" e usa o símbolo padrão (src/lib/marca.ts) —
# instalação nova não precisa definir nada.
ARG NEXT_PUBLIC_APP_NAME
ARG NEXT_PUBLIC_APP_SHORT_NAME
ARG NEXT_PUBLIC_APP_LOGO_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_APP_LOCALE=$NEXT_PUBLIC_APP_LOCALE \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_PUBLIC_APP_SHORT_NAME=$NEXT_PUBLIC_APP_SHORT_NAME \
    NEXT_PUBLIC_APP_LOGO_URL=$NEXT_PUBLIC_APP_LOGO_URL \
    NEXT_TELEMETRY_DISABLED=1

# Dummy server secrets so module-load doesn't throw during build's page
# data collection. These are NOT baked into the output — the real values
# come from the runtime env. The dummy ENCRYPTION_KEY is a valid 64-hex
# string only to satisfy format checks that may run at build time.
ENV ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 \
    META_APP_SECRET=build-dummy \
    SUPABASE_SERVICE_ROLE_KEY=build-dummy

RUN npm run build

# ---- runner: minimal runtime ----
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as a non-root user.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# The standalone server, plus static assets it must serve itself
# (Traefik fronts them but does not host files).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# Lightweight healthcheck for the Swarm scheduler.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
