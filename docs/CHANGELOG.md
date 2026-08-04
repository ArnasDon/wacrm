# Changelog — wacrm (fork ronaldomeira-alt)

> Histórico cronológico das alterações feitas neste fork, além do que já vem do upstream (`ArnasDon/wacrm`). Cada entrada referencia o hash do commit em `main`.

## 2026-08-04

### Módulo de segmentação imobiliária (etapas 1-4)

- **`6dca0a4`** — Migration `039_tags_category_and_all_filter.sql`: adiciona `tags.category` (texto livre) e a função RPC `filter_contacts_by_all_tags` (contatos que têm **todas** as tags informadas — AND), irmã de `filter_contacts_by_tags` (migration `025`, que faz OR). Aplicada diretamente em produção via SQL Editor do Supabase; seed de 35 tags em 7 categorias (Finalidade, Tipo de imóvel, Bairro, Faixa de valor, Quartos, Status, Momento) rodado na conta de produção, incluindo os 8 bairros de João Pessoa pedidos.
- **`c27f807`** — UI de segmentação:
  - `src/lib/contacts/tag-categories.ts` (novo) — função `groupTagsByCategory`, com ordem de prioridade fixa para as 7 categorias imobiliárias.
  - `src/components/settings/tag-manager.tsx` — campo de categoria (com datalist de categorias existentes, aceita texto livre) na criação de tag; lista de tags agora agrupada por categoria.
  - `src/components/contacts/contact-detail-view.tsx` — seletor de tags da aba "Tags" do contato agora agrupado por categoria.
  - `src/app/(dashboard)/contacts/page.tsx` — filtro de tags agrupado por categoria + alternância "Qualquer uma dessas tags" (OR) / "Todas essas tags" (AND), visível a partir de 2 tags selecionadas.
  - `src/types/index.ts` — `Tag.category?: string | null`.
  - `messages/en.json`, `messages/pt-BR.json`, `messages/ko.json` — chaves novas (`categoryPlaceholder`, `noCategory`, `filterModeAny`, `filterModeAll`) nos três idiomas, paridade validada pelo teste `src/i18n/messages.test.ts`.
  - Validado ponta a ponta em produção: tag customizada de bairro ("Miramar") criada via texto livre; lead de teste criado com 4 tags (Investimento + Flat + Bessa + 400k-500k); filtro AND com essas 4 tags retornou exatamente o lead; adicionar uma 5ª tag (Studio, que o lead não tem) zerou o resultado — confirma que o AND é estrito.

### Deploy em produção (Hostinger)

- **`e135cbf`** — Remoção de `mcp-server/` do repositório. Tentativa de destravar o importador do Hostinger, que reportava "Estrutura de projeto inválida" — não era a causa raiz (era uma sessão de onboarding travada no Hostinger), mas manteve-se como simplificação legítima já que o mcp-server era opcional e não usado neste deploy.
- **`be00f9c`** — `Dockerfile`, `docker-compose.yml` e `.dockerignore` movidos para `docker/`. Mesmo motivo/resultado do item acima: não era a causa raiz do erro de deploy, mas ficou como reorganização válida (documentada em `docs/docker.md`).
- **Causa raiz real do erro de deploy** (não é um commit — foi um problema de sessão no painel do Hostinger): o Hostinger reutilizava uma sessão de onboarding travada (`order_id AzZSV1VRIKXgT2HL`). Abandonar essa sessão e recomeçar do zero ("Adicionar site" → "Implante web app") resolveu — o deploy funcionou de primeira, detectando Next.js corretamente.
- Domínio configurado: `crmronaldomeira.com` (Hostinger, plano Business já adquirido).
- Variáveis de ambiente importadas em produção via upload de `.env.production.import` pelo próprio usuário (nunca digitadas por mim na UI do Hostinger).
- **`8c101f9`** — Commit inicial do fork, bundlando o trabalho de toda a primeira parte da sessão:
  - Tradução completa da interface para pt-BR (`messages/pt-BR.json`, 1429 chaves, paridade 100% com `en.json`).
  - PWA + notificações push (Web Push/VAPID): `manifest.ts`, `apple-icon.tsx`, `icon-192/`, `icon-512/`, `public/sw.js`, `src/lib/push/*`, `src/app/api/push/*`, card de configurações em `appearance-panel.tsx`, hook no webhook do WhatsApp para disparar push em mensagem nova. Testado em iPhone real.
  - `src/i18n/messages.test.ts` atualizado para validar paridade de `pt-BR` (além de `ko`, que já era coberto).

## Antes desta sessão (contexto do fork)

- Fork criado a partir de `ArnasDon/wacrm` em `8b7279a` (branch `main`), via GitHub, com remotes `origin` (fork) e `upstream` (original) configurados localmente.
- Repositório clonado e ambiente local configurado com Supabase (projeto `qedptmrcvcbzhucoeznd`).
