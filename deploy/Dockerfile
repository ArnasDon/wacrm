# Criado em: 10/07/2026 00:40
# Modificado em: 10/07/2026 01:30
#
# Build multi-stage do enterprise-evolui-crm (Next.js 16, output standalone).
# Contexto de build = raiz do repositório:
#   docker build -f deploy/Dockerfile .
#
# A imagem é GENÉRICA: o build usa PLACEHOLDERS nas NEXT_PUBLIC_* e o
# docker-entrypoint.sh os substitui em runtime pelos valores do .env do
# compose. Nenhuma configuração fica embutida na imagem.

# ---------- 1. Dependências ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ---------- 2. Build (com placeholders) ----------
FROM node:22-alpine AS builder
WORKDIR /app

ENV NEXT_PUBLIC_SUPABASE_URL=https://supabase-placeholder.invalid \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=NEXT_PUBLIC_SUPABASE_ANON_KEY_PLACEHOLDER \
    NEXT_PUBLIC_SITE_URL=https://site-placeholder.invalid \
    NEXT_PUBLIC_APP_LOCALE=pt-BR \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- 3. Runtime ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001 -G nodejs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --chown=nextjs:nodejs deploy/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

USER nextjs
EXPOSE 3000
ENTRYPOINT ["/docker-entrypoint.sh"]
