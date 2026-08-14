# syntax=docker/dockerfile:1

# ---------------------------------------------------------------
# Stage 1 — install dependencies (cached until package*.json change)
# ---------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

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

# La raíz orquesta el pipeline completo (DAD §3): build:god → landing
# Astro (public/landing/) → next build. `--filter landing` usa deps del
# workspace ya instaladas en el stage deps. Same command Git-deploy de
# Hostinger corre en sus Web Apps Node — experiencia consistente.
RUN corepack enable && pnpm run build

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

# Page editor + LIVE UPDATE: la landing completa (source de Astro) vive en
# el runner para poder recompilar en runtime cuando el dashboard guarda un
# JSON (edit → guardar → `astro build` de solo la landing → public/landing
# actualiza, sin recompilar Next ni reiniciar). Ver src/lib/landing-build.ts
# y el bind mount de landing/src/data/landings en docker-compose.yml.
COPY --from=builder --chown=nextjs:nextjs /app/landing ./landing

# Entorno Astro dedicado para el live build (no toca el node_modules de
# Next). astro se instala aquí en build time y lo usa landing-build.ts.
USER root
RUN corepack enable && mkdir -p /app/astro-env && cd /app/astro-env && \
    printf 'onlyBuiltDependencies:\n  - esbuild\n' > pnpm-workspace.yaml && \
    pnpm add astro@^7.1.6 && \
    # La landing (COPY de /app/landing, con un node_modules vacío del builder)
    # resuelve astro/config y astro:content desde el astro-env vía symlink.
    rm -rf /app/landing/node_modules && \
    ln -sfn /app/astro-env/node_modules /app/landing/node_modules && \
    # Vite escribe node_modules/.vite (cache de deps) durante el build: el
    # runtime (USER nextjs) necesita escribir en el astro-env.
    chown -R nextjs:nextjs /app/astro-env /app/landing/node_modules
USER nextjs

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
