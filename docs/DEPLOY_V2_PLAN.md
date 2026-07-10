<!--
Criado em: 10/07/2026 13:00
Modificado em: 10/07/2026 13:00
-->

# Plano — Deploy v2 (correção dos bugs do primeiro deploy)

**Objetivo**: novo deploy reproduzível do zero, sem intervenção manual,
corrigindo os bugs documentados em
[bugs/2026-07-10-deploy-docker-bugs.md](bugs/2026-07-10-deploy-docker-bugs.md)
e incluindo a criação do usuário admin como etapa do fluxo.

## Mudanças a implementar

### 1. Init do banco — senhas dos roles internos (Bug 2)
Criar `deploy/supabase/init/00-align-role-passwords.sh`, montado em
`/docker-entrypoint-initdb.d/` no serviço `supabase-db`:
- No primeiro boot (data dir vazio), executa
  `ALTER USER supabase_auth_admin / authenticator /
  supabase_storage_admin WITH PASSWORD '${POSTGRES_PASSWORD}'`.
- Para bases já existentes o script não roda (comportamento padrão do
  entrypoint Postgres) — documentar o comando manual no README do deploy.

### 2. Migrations empacotadas e automáticas (Bugs 3 e 6)
- Copiar `supabase/migrations/` para `deploy/migrations/` no pacote de
  deploy (o servidor não tem o repo completo). Adicionar ao
  `build-push.sh` um aviso/cópia, ou sincronizar via `scp` documentado.
- Manter `apply-migrations.sh` (idempotente) como executor, chamado
  pelo bootstrap — nunca manualmente no caminho feliz.

### 3. Bootstrap único — ordem correta (Bugs 3 e 5)
Criar `deploy/scripts/bootstrap.sh` que orquestra:
1. `docker compose up -d supabase-db` e espera healthcheck;
2. (primeiro boot) senhas via init script — automático;
3. `docker compose up -d` (demais serviços);
4. Espera `supabase-auth` responder (`/auth/v1/health` via Kong);
5. `./scripts/apply-migrations.sh`;
6. **Criação do usuário admin**: `python3 scripts/create_admin_user.py`
   (lê `.secrets/create_account.json` + `.secrets/.env`) — agora
   DEPOIS das migrations, para o trigger `handle_new_user` criar o
   profile automaticamente (sem backfill);
7. Smoke test: `GET https://evolui-crm.vya.digital/login` → 200 e
   `POST /auth/v1/token` com as credenciais do admin → 200.

### 4. Higiene
- `kong.yml`: já corrigido (aspas simples) — sem ação, manter comentário.
- Versionar a imagem: publicar `0.0.2` com `build-push.sh` e fixar
  `APP_VERSION=0.0.2` no `.env` do servidor.
- Registrar o deploy em `docs/SESSIONS/2026-07-10/`.

## Sequência de execução no servidor

```bash
# 1. Atualizar pacote de deploy (deploy/ + migrations) no servidor
# 2. Conferir .env (APP_VERSION=0.0.2) e .secrets/ (create_account.json)
cd deploy
./scripts/bootstrap.sh
```

## Verificação (fim a fim)
1. `docker compose ps` — todos "Up", nenhum "Restarting".
2. Login no app com o admin criado; troca de senha funciona (Bug 3 era
   o bloqueio).
3. `docker compose exec supabase-db psql -U supabase_admin -d postgres
   -c "SELECT count(*) FROM public._migrations;"` → 35.
4. Certificados Let's Encrypt válidos nos 2 hosts (`openssl s_client`).
5. Backup: rodar `backup-db.sh` e conferir dump em
   `${DATA_DIR}/supabase-db-backups`.

## Fora deste deploy
- Evolution API (Fase 2 — `docker-compose.evolution.yml`).
- SMTP do GoTrue (hoje `GOTRUE_MAILER_AUTOCONFIRM=true`).
- Desativar página `/signup` na UI (cosmético; API já bloqueia).
