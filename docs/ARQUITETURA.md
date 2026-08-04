# Arquitetura — wacrm

> Referência técnica do projeto. Para o estado atual e pendências, ver `STATUS_PROJETO.md`. Para o porquê de cada escolha, ver `DECISOES_TECNICAS.md`.

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16.2.12 (App Router, Turbopack) |
| UI | React 19.2.4, Tailwind CSS v4, componentes baseados em `@base-ui/react` |
| Linguagem | TypeScript 6 |
| i18n | next-intl (locales: `en`, `ko`, `pt-BR` — `pt-BR` é o padrão desta instalação, `NEXT_PUBLIC_APP_LOCALE=pt-BR`) |
| Backend | Supabase (Postgres + Auth + Storage + Realtime), acessado via `@supabase/ssr` / `@supabase/supabase-js` |
| Push notifications | Web Push API padrão (VAPID), biblioteca `web-push`, Service Worker próprio (`public/sw.js`) |
| Fluxos visuais | `@xyflow/react` + `@dagrejs/dagre` (editor de Flows) |
| Gráficos | `recharts` (dashboard) |
| Hospedagem | Hostinger — Node.js Web App com deploy automático via Git (branch `main`) |
| Testes | Vitest |

## Estrutura do projeto

```
wacrm/
├── docs/                      # Documentação (este conjunto de arquivos)
├── docker/                    # Dockerfile + docker-compose (opcional, não usado no deploy Hostinger)
├── messages/                  # Catálogos de tradução: en.json, ko.json, pt-BR.json
├── public/
│   └── sw.js                  # Service Worker (push + notificationclick)
├── supabase/
│   └── migrations/            # 42 migrations SQL, numeradas e sequenciais (001 → 042)
└── src/
    ├── app/
    │   ├── (auth)/            # Login, signup, forgot-password
    │   ├── (dashboard)/       # Área logada: contacts, inbox, pipelines, broadcasts,
    │   │                      #   automations, flows, agents, notifications, settings
    │   ├── api/                # Route handlers (ver "Integrações" abaixo)
    │   ├── manifest.ts         # PWA manifest
    │   ├── icon.tsx / apple-icon.tsx / icon-192/ / icon-512/  # Ícones gerados (Next.js file conventions)
    │   └── layout.tsx
    ├── components/             # Componentes de UI, organizados por domínio
    │   ├── contacts/           # Lista, formulário, detail-view, tag picker
    │   ├── settings/           # Tag manager, custom fields, push notifications card, etc.
    │   └── ui/                 # Primitivos (Button, Dialog, Popover, Table, ...)
    ├── hooks/                  # use-auth, use-realtime, use-presence, use-can, ...
    ├── i18n/                   # Config do next-intl + teste de paridade de mensagens
    ├── lib/                    # Lógica de domínio, organizada por área
    │   ├── contacts/           # tag-api, tag-categories, dedupe, parse-contact-csv, ...
    │   ├── push/                # admin-client, send (sendPushToAccount)
    │   ├── whatsapp/            # Cliente da Meta Cloud API
    │   ├── automations/, flows/, dashboard/, account/, ai/, webhooks/, storage/, api-keys/
    │   └── supabase/            # Clientes Supabase (browser/server)
    └── types/                  # Tipos compartilhados (Contact, Tag, Deal, ...)
```

## Banco de dados

- **Supabase Postgres**, projeto `qedptmrcvcbzhucoeznd`.
- **Multi-tenant por `account_id`**: desde a migration `017_account_sharing.sql`, a maioria das tabelas tem `account_id` (não apenas `user_id`), permitindo múltiplos usuários por conta/imobiliária. `profiles.account_id` e `profiles.account_role` são `NOT NULL`.
- **Row-Level Security (RLS)** em todas as tabelas de dados de usuário. Funções RPC usam `SECURITY INVOKER` por padrão (respeita RLS de quem chama) — só usa `SECURITY DEFINER` quando estritamente necessário.
- **42 migrations** em `supabase/migrations/`, aplicadas manualmente via SQL Editor do Supabase (não há CI que rode migrations automaticamente neste fork).
- Tabelas centrais: `contacts`, `tags` (+ `contact_tags` many-to-many), `custom_fields` (+ `contact_custom_values`), `conversations`, `messages`, `deals`, `pipelines`, `automations`, `flows`, `broadcasts`, `notifications`, `push_subscriptions`, `api_keys`, `webhook_endpoints`, `segments` (+ `segment_tags`), `appointments`.
- **Tags:** desde a migration `039`, `tags` tem uma coluna `category` (texto livre, opcional) usada para agrupar tags na UI (ex.: "Bairro", "Faixa de valor"). Três funções RPC de filtro combinado por tags coexistem:
  - `filter_contacts_by_tags` (migration `025`) — contatos com **qualquer uma** das tags (OR).
  - `filter_contacts_by_all_tags` (migration `039`) — contatos com **todas** as tags (AND). Implementada como função irmã em vez de sobrecarregar a mesma função, porque o PostgREST não resolve bem overloads de RPC por nome.
  - `list_segments_with_counts` (migration `040`) — mesma semântica AND de `filter_contacts_by_all_tags`, mas por segmento salvo (`segments`/`segment_tags`) em vez de uma seleção de tags ad-hoc; devolve a contagem de contatos por segmento em uma única chamada.
- **Segmentos** (migration `040`): `segments` (nome, conta) + `segment_tags` (many-to-many com `tags`). Um contato pertence ao segmento se tiver *todas* as tags associadas a ele. RLS no nível `admin` para escrita, igual a `tags`.
- **Agenda/Compromissos** (migration `041`): tabela `appointments` (`contact_id` opcional, `type` enum: call/visit/meeting/proposal/follow_up/other, `scheduled_date`+`scheduled_time` separados, `status`). RLS no nível `agent` para escrita, igual a `deals`.
- **Dashboard** (migration `042`): RPC `count_unanswered_conversations` — conta conversas (não fechadas) cuja mensagem mais recente foi enviada pelo cliente, usada pelo card "Leads Não Respondidos".

## Integrações existentes

| Integração | Status | Onde |
|---|---|---|
| WhatsApp Cloud API (Meta) | **Não conectada** — WABA restrito, ver `STATUS_PROJETO.md` | `src/lib/whatsapp/`, `src/app/api/whatsapp/*` |
| Supabase Auth | Ativo (login/signup por e-mail+senha) | `src/lib/supabase/`, `src/hooks/use-auth.tsx` |
| Supabase Storage | Ativo (mídia de chat, avatares) | `src/lib/storage/` |
| Web Push (VAPID) | Ativo, testado em produção e iPhone real | `src/lib/push/`, `public/sw.js`, `src/app/api/push/*` |
| Hostinger (deploy) | Ativo — Git-based auto-deploy do branch `main` | N/A (configurado no painel Hostinger) |
| API pública v1 | Existe (`src/app/api/v1/*`, ver `docs/public-api.md`) | Não avaliada nesta sessão |
| MCP server | **Removido** nesta sessão (`e135cbf`) — atrapalhava a detecção de framework do Hostinger; recuperável do histórico do `upstream` se precisar no futuro | — |

## Fluxo de dados (exemplo: mensagem recebida no WhatsApp → push notification)

1. Meta envia POST para `src/app/api/whatsapp/webhook/route.ts`.
2. O webhook grava a mensagem em `messages`, atualiza `conversations`.
3. Chama `sendPushToAccount(accountId, {...})` (`src/lib/push/send.ts`), que busca as `push_subscriptions` da conta e envia via `web-push`.
4. O Service Worker (`public/sw.js`) recebe o evento `push`, mostra a notificação; um clique nela abre `/inbox?conversation={id}`.

## Decisões técnicas importantes (resumo — detalhes em `DECISOES_TECNICAS.md`)

- Fork próprio em vez de contribuir direto no upstream, para poder customizar livremente (idioma, segmentação imobiliária) sem esperar aprovação de PR.
- `tags.category` como texto livre (sem tabela `categories` separada) — mantém a implementação simples e evita uma migração maior do modelo de dados para uma necessidade que hoje é só agrupamento visual + filtro.
- Deploy no Hostinger via Git (não Docker) — o Docker existe no repo apenas como opção alternativa documentada, não é o caminho usado em produção.

## Configuração necessária para rodar localmente

Variáveis de ambiente em `.env.local` (não versionado): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_LOCALE=pt-BR`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. `META_APP_SECRET` fica comentado até a integração do WhatsApp ser retomada.
