<!-- Criado em: 13/07/2026 11:17 -->
<!-- Modificado em: 13/07/2026 11:17 -->

# Atividades — 13/07/2026

## Admin padrão no boot, SMTP no-reply e flag de signup

- **Horário/Status**: 11:00–11:20 — concluído (aguardando PR).
- **Objetivo**: (1) criar usuário admin padrão no início do stack; (2) configurar envio de e-mail via SMTP com conta no-reply; (3) variável de ambiente para desativar a auto-criação de usuários (signup público).
- **Contexto**: auth é Supabase/GoTrue self-hosted (`deploy/docker-compose.yml`). O admin era criado manualmente por `scripts/create_admin_user.py`; `GOTRUE_DISABLE_SIGNUP` e `GOTRUE_MAILER_AUTOCONFIRM` estavam hard-coded; nenhum SMTP configurado; a página `/signup` continuava visível mesmo com signup bloqueado no backend.
- **Passos/Resultado**:
  - Novo serviço one-shot `admin-bootstrap` no compose (imagem `curlimages/curl`, rede interna) executando `deploy/scripts/bootstrap-admin.sh`: espera o `/health` do GoTrue, cria o usuário via Admin API (`POST /admin/users`, ignora o bloqueio de signup); idempotente (HTTP 422 = já existe); desativado se `ADMIN_EMAIL`/`ADMIN_PASSWORD` vazios; token e senha nunca em argv (arquivos temporários).
  - SMTP no GoTrue: `GOTRUE_SMTP_HOST/PORT/USER/PASS/ADMIN_EMAIL/SENDER_NAME` vindos de `SMTP_*` do `.env`; `GOTRUE_MAILER_AUTOCONFIRM` agora configurável (padrão `true` enquanto não houver SMTP). Somente envio — sem IMAP (decisão do usuário).
  - Signup público: `GOTRUE_DISABLE_SIGNUP: ${DISABLE_SIGNUP:-true}` (backend) + `NEXT_PUBLIC_SIGNUP_ENABLED` (frontend, padrão `false`): middleware redireciona `/signup` → `/login` (exceto com `?invite=`), link "criar conta" oculto no `/login`; placeholder novo no `Dockerfile` + substituição no `docker-entrypoint.sh`.
- **Decisões**: bootstrap como serviço one-shot no compose (escolha do usuário) em vez de etapa no entrypoint do app; signup desabilitado por padrão; e-mail apenas via GoTrue (nenhum mailer no app Next.js).
- **Arquivos modificados**: `deploy/docker-compose.yml`, `deploy/env.example`, `deploy/Dockerfile`, `deploy/docker-entrypoint.sh`, `deploy/scripts/bootstrap-admin.sh` (novo), `src/middleware.ts`, `src/app/(auth)/login/page.tsx`, `src/lib/auth/signup-flag.ts` (novo), `.env.local.example`.
- **Verificação**: `docker compose --env-file env.example config` OK; `sh -n` nos scripts OK; `npm run lint` sem erros novos (26 pré-existentes na main); `tsc --noEmit` limpo.
- **Commits**: branch `359-admin-bootstrap-smtp-signup-flag` (PR a abrir).
