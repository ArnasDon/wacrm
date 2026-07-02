# syntax=docker/dockerfile:1
#
# Imagem de produção do wacrm (Next.js 16) para deploy na VPS.
# Build simples baseado em `next start` — sem mudanças no código do app.
#
# IMPORTANTE: as variáveis NEXT_PUBLIC_* são inlinadas no bundle do cliente
# durante o `next build`. Por isso o `.env.local` PRECISA estar presente no
# contexto de build (ele NÃO é ignorado pelo .dockerignore de propósito).
# As variáveis server-side (SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY,
# META_APP_SECRET, ...) são lidas em runtime do mesmo .env.local.

# 1) Dependências completas (inclui devDeps p/ buildar)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# 2) Build do Next + prune das devDeps
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build \
 && npm prune --omit=dev

# 3) Runtime enxuto
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next        ./.next
COPY --from=builder /app/public       ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/.env.local   ./.env.local
EXPOSE 3000
CMD ["npm", "start"]
