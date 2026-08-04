# Status do Projeto — wacrm (CRM WhatsApp)

> Última atualização: **2026-08-04**, ao final da sessão de segmentação imobiliária — etapa 5 (filtro AND em Transmissões).
> Este arquivo é o ponto de partida para qualquer sessão futura — leia antes de qualquer outra coisa.

## Estado atual

- **Produção:** https://crmronaldomeira.com — ativo, deploy automático via Hostinger a partir do branch `main` do fork.
- **Repositório:** [ronaldomeira-alt/wacrm](https://github.com/ronaldomeira-alt/wacrm) (fork de [ArnasDon/wacrm](https://github.com/ArnasDon/wacrm), remote `upstream`).
- **Banco:** Supabase, projeto `qedptmrcvcbzhucoeznd`, plano FREE.
- **Conta de uso:** `ronaldomeiracorretor@gmail.com` (conta/account_id única até o momento — sem outros membros de equipe).
- **Build de produção:** validado nesta sessão (`next build` — compilou sem erros, TypeScript ok, 55 páginas estáticas geradas).
- **Testes automatizados:** 651/656 passando. As 5 falhas são pré-existentes e não relacionadas a este projeto de segmentação — ver "Problemas conhecidos" abaixo.
- Commit `61d094c` já em produção (deploy automático confirmado).

## O que está funcionando

- CRM completo em pt-BR (tradução 100% — `messages/pt-BR.json`, 1429+ chaves, paridade garantida por teste automatizado com `en.json`).
- Caixa de entrada, funis (pipelines Kanban), automações, fluxos (flow builder), transmissões (broadcasts), agentes de IA, templates.
- Contatos: CRUD completo, importação CSV, campos personalizados, tags.
- **Módulo de segmentação imobiliária (novo, implementado hoje):**
  - Tags organizadas por categoria (Finalidade, Tipo de imóvel, Bairro, Faixa de valor, Quartos, Status, Momento).
  - 35 tags pré-cadastradas para a conta de produção, incluindo os 8 bairros de João Pessoa pedidos (Bessa, Manaíra, Tambaú, Cabo Branco, Altiplano, Intermares, Jardim Oceania, Aeroclube) + categoria livre para digitar outros bairros.
  - Filtro de contatos com alternância **"Qualquer uma dessas tags" (OR)** / **"Todas essas tags" (AND)** — permite buscas combinadas tipo "investimento + flat + bessa + 400-500k".
  - Validado ponta a ponta com um lead de teste real na produção (`Lead Teste Segmentado`), depois confirmado que o filtro AND é estrito (zera ao incluir uma tag que o lead não tem).
- PWA + notificações push (Web Push/VAPID) — testado em iPhone real, funcionando.
- Deploy contínuo: qualquer `git push origin main` dispara redeploy automático no Hostinger.

## O que está em desenvolvimento / pendente

- **Conexão real do WhatsApp Cloud API** — bloqueada. Ver "Problemas conhecidos".
- **Segmentação — etapa 6 do roadmap** (badges de contagem por categoria, ex.: "12 leads em Bessa") — ainda não implementada, sem RPC pronta.
- Módulo de Follow-up/Tarefas — só foi analisado (infra reaproveitável identificada: tabela `notifications`, push, padrão de cron), nada implementado ainda.

## Última alteração realizada

**Sessão de 2026-08-04 (parte 2)** — segmentação imobiliária, etapa 5 do roadmap (filtro AND em Transmissões):

1. `step2-select-audience.tsx` — alternância Qualquer/Todas + tags agrupadas por categoria (mesmo padrão de Contatos), reaproveitando `filter_contacts_by_all_tags` e `groupTagsByCategory`. Aplicado tanto na estimativa de alcance quanto na resolução real da audiência.
2. `use-broadcast-sending.ts` (`resolveAudience`) — mesmo filtro AND aplicado na resolução real dos destinatários no momento do envio (não só na estimativa), via `filter_contacts_by_all_tags` com `p_limit` alto (100000) já que a RPC é paginada.
3. `step4-schedule-send.tsx` — estimativa de alcance no resumo final também respeita `matchAll`.
4. `broadcasts/new/page.tsx` — `matchAll` propagado no estado do wizard, no payload de envio e no `audience_filter` salvo (rascunho e broadcast real).
5. Traduções novas (`filterModeAny`/`filterModeAll`/`noCategory` em `Broadcasts.wizard.selectAudience`) em `en.json` / `pt-BR.json` / `ko.json`.

Commit: `61d094c`. Já em produção.

**Validação:** `tsc --noEmit` limpo, `eslint` limpo, `next build` ok (55 páginas), `vitest run` 651/656 (mesmos 5 falhando pré-existentes, nada novo quebrou). Regressão confirmada em produção: o filtro AND/OR de Contatos (mesma RPC/helper compartilhados) continua funcionando pós-deploy. **Não foi possível testar visualmente a etapa 2 do wizard de Transmissões em produção** — não há nenhum template de WhatsApp com status `APPROVED` na conta (mesmo bloqueio do WhatsApp Cloud API), e o wizard não deixa passar da etapa 1 sem um template aprovado. Não criei um template falso em produção para contornar isso — se quiser essa validação visual completa, ou o WhatsApp é desbloqueado, ou criamos um template de teste descartável sob confirmação.

## Próxima tarefa recomendada

Na ordem de prioridade sugerida (ver `ROADMAP.md` para detalhes):

1. Decidir o próximo passo do WhatsApp: contatar suporte do Kommo pedindo verificação do Solution Provider, **ou** aceitar o bloqueio e seguir sem WhatsApp real por enquanto. Isso também destrava o teste visual completo do wizard de Transmissões (etapa 5 já está no código, só falta um template aprovado para exercitar via UI).
2. Etapa 6 do roadmap (badges de contagem por categoria) é a continuação natural da segmentação.
3. Alternativamente: iniciar o módulo de Follow-up/Tarefas (já analisado, plano pronto).

## Pendências e problemas conhecidos

- **WhatsApp bloqueado no Meta:** o WABA está restrito porque o "Solution Provider" vinculado (o próprio Kommo, registrado como parceiro técnico com acesso total) nunca completou a verificação de negócio da Meta. Revisão solicitada em 2026-07-28, ainda pendente na última checagem (2026-07-30), sem e-mail de resposta da Meta. Decisão tomada: **não remover o Kommo como parceiro** antes de tentar contato com o suporte deles — essa mensagem ainda não foi redigida.
- **5 testes falhando, não relacionados a esta sessão:**
  - `src/lib/currency.test.ts` (3 testes) — depende do `Intl.NumberFormat` do Node/ICU instalado na máquina; formatação de locale diverge do esperado neste ambiente Windows local.
  - `src/lib/dashboard/date-utils.test.ts` (2 testes) — `mondayIndex` compara `new Date("YYYY-MM-DD").getDay()` (hora local) com uma data parseada como UTC; em fusos horários negativos (Brasil, UTC-3) o dia vira o anterior. Bug latente em código do template upstream, não tocado nesta sessão. **Não corrigido propositalmente** — está fora do escopo do trabalho pedido e mexer nisso sem contexto do mantenedor original é arriscado.
- **Testes pendentes de confirmação manual pelo usuário:**
  - Recadastrar "Adicionar à tela inicial" / push notifications no domínio novo de produção (`crmronaldomeira.com`) — feito e validado antes só no domínio antigo/local.
  - Login manual em produção ainda não confirmado pelo próprio usuário (eu validei que a página carrega, mas não fiz login com a senha real).
- **Gaps identificados no diagnóstico comparativo com o Kommo, não solicitados ainda:** exportação CSV de contatos/negócios, movimentação automática de estágio no funil.
