<!--
Criado em: 10/07/2026 13:00
Modificado em: 10/07/2026 13:00
-->

# Bug Report — Primeiro deploy Docker (10/07/2026)

Bugs encontrados durante o primeiro deploy do stack (app + Supabase
self-hosted + Traefik) em `evolui-crm.vya.digital`, com causa raiz,
correção aplicada e prevenção para o próximo deploy.

| # | Severidade | Componente | Status |
|---|------------|------------|--------|
| 1 | 🔴 Alta | supabase-kong | ✅ Corrigido |
| 2 | 🔴 Alta | supabase-auth / rest / storage | ✅ Contornado manualmente — precisa correção definitiva |
| 3 | 🔴 Alta | banco (schema do CRM) | ✅ Contornado — precisa automação |
| 4 | 🟠 Média | Traefik (TLS) | ✅ Resolvido (consequência do #1) |
| 5 | 🟠 Média | usuário admin | ✅ Contornado — precisa reordenação no fluxo |
| 6 | 🟡 Baixa | scripts/apply-migrations.sh | ✅ Corrigido |
| 7 | 🟡 Baixa | .secrets/create_account.json | ✅ Corrigido pelo usuário |

---

## Bug 1 — Kong em crash-loop: `_format_version: expected a string`

- **Sintoma**: container `supabase-kong` reiniciando em loop;
  `init_by_lua error: error parsing declarative config ... in
  '_format_version': expected a string`.
- **Causa raiz**: o entrypoint interpola o template com
  `eval "echo \"$(cat temp.yml)\""`, que **remove aspas duplas** do
  arquivo. `_format_version: "2.1"` virava o número YAML `2.1`.
- **Correção**: aspas simples (`'2.1'`) em `deploy/supabase/kong.yml`
  (sobrevivem ao eval) + comentário explicando a restrição.
- **Prevenção**: nunca usar aspas duplas em valores do kong.yml;
  validado por simulação do eval no repositório.

## Bug 2 — GoTrue/PostgREST/Storage: `password authentication failed`

- **Sintoma**: `supabase-auth` em crash-loop com
  `FATAL: password authentication failed for user "supabase_auth_admin"`;
  Kong devolvia `503 name resolution failed` (o container caía e o DNS
  interno do Docker deixava de resolver o nome).
- **Causa raiz**: a imagem `supabase/postgres` cria os roles internos
  (`supabase_auth_admin`, `authenticator`, `supabase_storage_admin`)
  **sem alinhar as senhas** com `POSTGRES_PASSWORD`, que é o que as
  connection strings do compose usam.
- **Correção aplicada (manual)**: `ALTER USER ... WITH PASSWORD` para
  os três roles, executado como `supabase_admin` (o `postgres` da
  imagem NÃO é superuser — tentar com ele dá
  `"supabase_auth_admin" is a reserved role`).
- **Prevenção (deploy v2)**: script SQL de inicialização montado em
  `/docker-entrypoint-initdb.d/` que alinha as senhas no primeiro boot.

## Bug 3 — Tabelas do CRM inexistentes: `relation "public.profiles" does not exist`

- **Sintoma**: app logava `[getCurrentAccount] profile fetch error
  42P01`; nenhuma operação funcionava (inclusive troca de senha).
- **Causa raiz**: as 35 migrations de `supabase/migrations/*.sql`
  nunca foram aplicadas no Postgres self-hosted — era passo manual do
  plano e não havia automação.
- **Correção**: criado `deploy/scripts/apply-migrations.sh`
  (idempotente, registra em `public._migrations`, roda como
  `supabase_admin`).
- **Prevenção (deploy v2)**: migrations incluídas no fluxo de
  bootstrap, executadas antes de qualquer criação de usuário.

## Bug 4 — TLS servindo `TRAEFIK DEFAULT CERT`

- **Sintoma**: `create_admin_user.py` falhava com
  `CERTIFICATE_VERIFY_FAILED: self-signed certificate`.
- **Causa raiz**: consequência do Bug 1 — com o Kong em crash-loop o
  Traefik não tinha backend saudável, e o certificado Let's Encrypt
  não era servido para os hosts.
- **Correção**: resolvido com o Bug 1; HTTPS validado na sequência
  (a chamada seguinte à Admin API completou o TLS normalmente).

## Bug 5 — Usuário admin criado sem profile

- **Sintoma**: usuário existia em `auth.users`, mas sem linha em
  `public.profiles` (e portanto sem conta no CRM).
- **Causa raiz**: ordem invertida — o usuário foi criado **antes** de
  as migrations existirem; o trigger `handle_new_user` (que cria o
  profile) ainda não estava instalado.
- **Correção**: backfill manual
  (`INSERT INTO public.profiles ... SELECT ... FROM auth.users ON
  CONFLICT DO NOTHING`).
- **Prevenção (deploy v2)**: criação do admin passa a ser etapa
  **posterior** às migrations no bootstrap.

## Bug 6 — apply-migrations.sh não encontrava a pasta no servidor

- **Sintoma**: `pasta de migrations não encontrada` — no servidor só
  existe `deploy/`, sem o repositório completo.
- **Correção**: o script agora procura em múltiplos locais
  (`<repo>/supabase/migrations`, `deploy/migrations`,
  `deploy/supabase/migrations`) e aceita o caminho como argumento.

## Bug 7 — `create_account.json` com e-mail inválido

- **Sintoma**: `create_admin_user.py` rejeitava o JSON (`Campo 'email'
  ausente ou inválido`) — o valor não continha `@`.
- **Correção**: valor corrigido pelo usuário no `.secrets/`
  (validação do script funcionou como esperado).

---

## Lições para o deploy v2

1. **Ordem importa**: banco saudável → senhas dos roles → migrations →
   admin → app. Automatizar como sequência única (bootstrap).
2. **Nada manual no caminho crítico**: senhas de roles e migrations
   precisam ser automáticas (init script + runner idempotente).
3. **Superuser correto**: toda manutenção no Postgres da imagem
   Supabase usa `supabase_admin`, não `postgres`.
4. **Template do Kong é sensível a aspas** — documentado no próprio
   arquivo.
