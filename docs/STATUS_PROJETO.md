# Status do Projeto — wacrm (CRM WhatsApp)

> Última atualização: **2026-08-04**, ao final da sessão de implementação do módulo de segmentação imobiliária.
> Este arquivo é o ponto de partida para qualquer sessão futura — leia antes de qualquer outra coisa.

## Estado atual

- **Produção:** https://crmronaldomeira.com — ativo, deploy automático via Hostinger a partir do branch `main` do fork.
- **Repositório:** [ronaldomeira-alt/wacrm](https://github.com/ronaldomeira-alt/wacrm) (fork de [ArnasDon/wacrm](https://github.com/ArnasDon/wacrm), remote `upstream`).
- **Banco:** Supabase, projeto `qedptmrcvcbzhucoeznd`, plano FREE.
- **Conta de uso:** `ronaldomeiracorretor@gmail.com` (conta/account_id única até o momento — sem outros membros de equipe).
- **Build de produção:** validado nesta sessão (`next build` — compilou sem erros, TypeScript ok, 55 páginas estáticas geradas).
- **Testes automatizados:** 651/656 passando. As 5 falhas são pré-existentes e não relacionadas a este projeto de segmentação — ver "Problemas conhecidos" abaixo.

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
- **Segmentação — etapas 5 e 6 do roadmap** (explicitamente adiadas pelo usuário nesta sessão):
  - Etapa 5: filtro combinado (AND) também nas Transmissões (`step2-select-audience.tsx` hoje só faz OR).
  - Etapa 6: badges de contagem por categoria (ex.: "12 leads em Bessa").
- Módulo de Follow-up/Tarefas — só foi analisado (infra reaproveitável identificada: tabela `notifications`, push, padrão de cron), nada implementado ainda.

## Última alteração realizada

**Sessão de 2026-08-04** — módulo de segmentação imobiliária, etapas 1 a 4 do roadmap aprovado:

1. Migration `039_tags_category_and_all_filter.sql` — coluna `tags.category` + função `filter_contacts_by_all_tags` (RPC).
2. Seed de 35 tags de segmentação na conta de produção.
3. `tag-manager.tsx` (Configurações → Campos e tags) — criação de tag com categoria + lista agrupada.
4. `contact-detail-view.tsx` (aba Tags do contato) — seletor de tags agrupado por categoria.
5. `contacts/page.tsx` (lista de Contatos) — filtro por tags agrupado + alternância Qualquer/Todas.
6. Traduções novas em `en.json` / `pt-BR.json` / `ko.json` (paridade validada por teste).

Commits: `6dca0a4` (banco) e `c27f807` (UI). Ambos já em produção.

## Próxima tarefa recomendada

Na ordem de prioridade sugerida (ver `ROADMAP.md` para detalhes):

1. Decidir o próximo passo do WhatsApp: contatar suporte do Kommo pedindo verificação do Solution Provider, **ou** aceitar o bloqueio e seguir sem WhatsApp real por enquanto.
2. Se o usuário quiser continuar evoluindo a segmentação: etapa 5 (filtro AND em Transmissões) é a mais barata e de maior valor imediato.
3. Caso contrário: iniciar o módulo de Follow-up/Tarefas (já analisado, plano pronto).

## Pendências e problemas conhecidos

- **WhatsApp bloqueado no Meta:** o WABA está restrito porque o "Solution Provider" vinculado (o próprio Kommo, registrado como parceiro técnico com acesso total) nunca completou a verificação de negócio da Meta. Revisão solicitada em 2026-07-28, ainda pendente na última checagem (2026-07-30), sem e-mail de resposta da Meta. Decisão tomada: **não remover o Kommo como parceiro** antes de tentar contato com o suporte deles — essa mensagem ainda não foi redigida.
- **5 testes falhando, não relacionados a esta sessão:**
  - `src/lib/currency.test.ts` (3 testes) — depende do `Intl.NumberFormat` do Node/ICU instalado na máquina; formatação de locale diverge do esperado neste ambiente Windows local.
  - `src/lib/dashboard/date-utils.test.ts` (2 testes) — `mondayIndex` compara `new Date("YYYY-MM-DD").getDay()` (hora local) com uma data parseada como UTC; em fusos horários negativos (Brasil, UTC-3) o dia vira o anterior. Bug latente em código do template upstream, não tocado nesta sessão. **Não corrigido propositalmente** — está fora do escopo do trabalho pedido e mexer nisso sem contexto do mantenedor original é arriscado.
- **Testes pendentes de confirmação manual pelo usuário:**
  - Recadastrar "Adicionar à tela inicial" / push notifications no domínio novo de produção (`crmronaldomeira.com`) — feito e validado antes só no domínio antigo/local.
  - Login manual em produção ainda não confirmado pelo próprio usuário (eu validei que a página carrega, mas não fiz login com a senha real).
- **Gaps identificados no diagnóstico comparativo com o Kommo, não solicitados ainda:** exportação CSV de contatos/negócios, movimentação automática de estágio no funil.
