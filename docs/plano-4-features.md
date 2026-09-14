# Plano — 4 features novas no inbox

> **O que é este arquivo.** É o guia retomável das 4 features pedidas em 2026-07-27:
> assinatura por membro, filtros de pesquisa, anotação interna no fio e agendamento de
> mensagem. Serve para qualquer sessão futura saber **o que já foi feito, o que está
> pendente e por quê cada decisão foi tomada** — sem precisar reconstruir o raciocínio.
>
> **Como usar:** comece pela tabela de Estado. Antes de tocar em qualquer fase, leia o
> Fluxo de trabalho e execute o passo 1 (revisar o plano contra o código atual).
>
> ⚠️ **Este documento envelhece.** Vale a mesma regra do `CLAUDE.md`: antes de decidir com
> base em algo aqui, confirme contra a realidade (grep, leitura do arquivo, query no
> banco). Ao achar divergência, corrija este arquivo no mesmo PR. **Nota mentindo é pior
> que ausência de nota.**

- **Criado:** 2026-07-27 · **Revalidado:** 2026-08-01 contra `main` @ `8c02731`
- **Método:** 16 agentes de reconhecimento em duas rodadas + verificação direta no banco

---

## Estado

| Fase | Escopo | Estado | Migration | PR |
| --- | --- | --- | --- | --- |
| **0** | Decisões de produto | ✅ respondida 2026-08-01 | — | — |
| **1** | F3 — anotação interna no fio | ✅ **concluída 2026-08-01** | `918`, `919`, `920`, `921`, `922` (todas aplicadas e conferidas) | `feat/notas-na-conversa` |
| **2** | F1 — assinatura por membro | ✅ **concluída 2026-08-01** — no ar | `923_cb_assinatura` (aplicada) | [#30](https://github.com/leonardocabralb/CB-CRM/pull/30) → `de3ced2` |
| **3** | F2 fatia A — filtros | ✅ **no ar 2026-08-02** — revisada (fria + morna), mergeada e deployada (`b7eba08`) | `924_cb_favoritar` (aplicada e conferida) | `feat/filtros-do-inbox` (5 commits) |
| **4** | F4 — mensagem agendada | ✅ **no ar 2026-08-02** — agendador rodando na VPS, disparo real conferido | `925`, `926`, `927_cb_batimento_do_agendador`, `928_cb_quando_reivindicou` | [#31](https://github.com/leonardocabralb/CB-CRM/pull/31) → `13ce47e` |
| **5** | F2 fatia B — busca no corpo das mensagens | ✅ **no ar 2026-08-03** — conferida rodando em `crm.cbadvogados.com` | `929_cb_busca_em_mensagens`, `930_cb_reticencia_no_trecho` (aplicadas e conferidas) | `feat/busca-nas-mensagens` → `915c6ad` |
| **6** | Revisão final (2 passadas + testes) | ✅ **2026-08-03** — achou o `anon` aberto em 4 tabelas | `931_cb_fecha_anon_nas_tabelas_antigas` | — |

✅ **As quatro features pedidas em 2026-07-27 estão entregues e no ar.** O que resta na
Fase 6 é revisão de conjunto, não feature nova. O escopo cortado de propósito, fase a
fase, está na seção "O que ficou de fora, e por quê" no fim deste documento.

⚠️ **A Fase 4 só ficou completa fora do repositório.** O agendador é um serviço
`crm_agendador` no Swarm da VPS, criado à mão a partir da seção 6 de `docs/DEPLOY-VPS.md`;
o CI **não o cria nem o atualiza** (`docker service update` só mexe em serviço que já
existe). Um `docker stack rm` derruba o agendador junto, e a tela volta a acusar.

⚠️ **Os números das fases 2–5 andaram um.** A menção precisou de migration própria (a 918
criou a coluna `mencionados` mas deixou fechado o CHECK de `notifications.type`), e ela
levou o 919 que estava reservado para a assinatura. Vale de novo o aviso abaixo: conferir
com `ls` **e** `list_migrations` antes de criar, não deduzir desta tabela.

### Fase 1 — commits (branch `feat/notas-na-conversa`, saída de `main` @ `efdfbdf`)

| Commit | O quê |
| --- | --- |
| `a42abed` | migration 918 aplicada e conferida, tipos, capability `write-notes` |
| `12fbbd0` | a anotação no fio, reusando `intercalar()`, teste da invariante reescrito |
| `5ba6865` | botão e caixa amarela no compositor + `POST /api/cb/notes` |
| `5a959af` | as fichas leem a tabela nova + correção do embaralhamento do `autoFocus` |
| `4cfdb06` | três achados da revisão própria (ver "Achados" abaixo) |
| `283eabb` | menção de colega, sino, e a página branca do realtime |

⚠️ **A ordem mudou em 2026-08-01, depois das respostas da Fase 0.** A F1 subiu de última
para segunda: a resposta da **P1.1 foi "sim, imediatamente"** — entra gente na conta agora,
o que dá público à assinatura e, mais importante, **corrige sozinho o problema que a tinha
derrubado**. Os 90,6% de mensagens saindo pelo celular pareado existem porque *uma pessoa*
atende de *um aparelho*; com mais gente, o tráfego migra mecanicamente para o CRM, porque
o aparelho pareado é um só. A F1 continua em segundo e não em primeiro porque a F3 é
inteiramente aditiva (tabela nova + mecanismo pronto) e não encosta no caminho de envio,
enquanto a F1 muda **o texto que o cliente recebe** e mexe no núcleo compartilhado.

Legenda: ⬜ pendente · 🔄 em andamento · ✅ concluída · ⏸️ adiada · ❌ descartada

⚠️ **Os números de migration acima são intenção, não reserva.** A faixa `900+` é
compartilhada com toda branch em paralelo, e a colisão **já aconteceu uma vez** (dois
`904_`). Rodar `ls supabase/migrations/` **e** `list_migrations` imediatamente antes de
criar o arquivo — os dois, porque já divergiram (as 916 e 917 existiram no banco antes de
existirem em `main`).

---

## Fluxo de trabalho — vale para toda fase

Cada fase percorre o ciclo abaixo. **Nenhuma fase começa antes da anterior fechar.**

1. **Revisar o plano contra o código.** Ler o que esta fase diz que vai fazer e conferir
   arquivo por arquivo se ainda é verdade. Se divergir, **corrigir este documento antes de
   codar** e avisar o operador do que mudou.
2. **Executar.** Implementar a fase, com os commits separados como listado nela.
3. **Testar.** `npm run typecheck`, `npm run lint`, `npm run test`. Testes novos para o que
   a fase introduziu.
4. **Revisão fria.** Revisores independentes que **não recebem o plano** — só o diff e o
   código. Procuram bug do zero, sem saber qual era a intenção. É o que pega o que ninguém
   pensou. (Mesmo método de `e44aa08` e `aec6389`.)
5. **Revisão morna.** Revisores **com** o plano e a intenção em mãos. Conferem se o que foi
   feito é o que foi combinado, e se as armadilhas já documentadas no `CLAUDE.md` foram
   respeitadas. É o que pega desvio de escopo e regressão conhecida.
6. **Corrigir os achados**, atualizar a tabela de Estado e este documento.
7. **Seguir para a próxima fase**, repetindo do passo 1.

Ao fim de todas as fases, a **Fase 6** faz mais **duas** passadas sobre o conjunto inteiro,
procurando o que escapou fase a fase, e roda os testes de novo.

> **Sobre "fria" e "morna":** a distinção é o **contexto que o revisor recebe**, não o
> rigor. O revisor frio não sabe o que era esperado — por isso acha o que o plano não
> previu. O revisor morno sabe — por isso acha o que o plano previu e a implementação não
> cumpriu. Os dois são necessários; nenhum substitui o outro.

### Regras que valem em todas as fases

- Branch sai de `main` atualizado, nunca de outra branch de feature (`CLAUDE.md`).
- ⚠️ **`git push origin main` dispara deploy de produção** e o DNS já está virado —
  `crm.cbadvogados.com` serve a VPS e atende cliente real. Nenhum merge sem o operador
  saber que aquilo vai ao ar naquele instante.
- Toda chave nova de i18n entra em **`en.json` e `pt-BR.json` na mesma passada** — o
  fallback do next-intl é por arquivo, não por chave; chave faltando vira `MISSING_MESSAGE`
  cru na tela.
- Preferir **módulo novo** a reescrever arquivo do core (reduz conflito com o upstream).
- Antes da primeira branch: **confirmar que `main` está verde** no `typecheck` e no `lint`.
  Uma sessão anterior não conseguiu terminar o `tsc --noEmit`; sem baseline não dá para
  saber se o erro é nosso.
- Apagar `src/components/channels/channel-select 2.tsx` — untracked, byte-idêntico ao
  original, e um `git add -A` o commitaria como um segundo componente com os mesmos exports.

---

## Ground truth (medido em 2026-08-01, produção `hxnhakmyxyhalbsktzwe`)

| Métrica | 27/07 | 01/08 | Consequência |
| --- | --- | --- | --- |
| Mensagens | 121 | **894** | |
| Mensagens de saída | 30 | **234** | |
| **…digitadas no celular pareado** | — | **212 (90,6%)** | a assinatura alcançaria 1 em 10 — ver Fase 2 |
| `sender_id` preenchido | 0 | **0 de 894** | ninguém sabe quem enviou o quê |
| Conversas | 15 | **64** | |
| **Grupos já sincronizados** | 0 | **58** | ligar o interruptor soma 58 conversas de uma vez |
| Conversas de grupo ativas | 0 | **0** | `groups_enabled` está desligado |
| Membros / contas | 2 / 2 | **2 / 2** | ⚠️ **entra gente imediatamente** (P1.1) — remedir |
| Etiquetas | 0 | **0** | filtro de etiqueta não tem o que filtrar |
| Negócios | 0 | **55** | o funil passou a ser usado |
| **Etapas ocupadas** | — | **1 de 9** | filtro de etapa não discrimina nada hoje |
| Automações pendentes de cron | — | **0** | o cron nunca rodou; nada dependeu dele |

---

## Fase 0 — Decisões ✅

Respondida pelo operador em **2026-08-01**. As respostas estão registradas uma a uma no
Anexo B. As que **contrariaram** a recomendação e mudaram o plano:

| # | Recomendação | Decisão | Efeito |
| --- | --- | --- | --- |
| **P1.1** | Adiar a F1 se não entrar gente | **Entra gente imediatamente** | F1 sobe de 5ª para 2ª fase |
| **P1.4** | Não assinar em grupo | **Assina em grupo** | some a guarda; grupo entra pelo caminho comum |
| **P1.5** | Nada automático assina | **Assina, com interruptor** — e identificação interna de bot/IA **sempre** | vira duas peças; ver Fase 2 |
| **P2.3** | Arquivada = coluna nova | **Arquivada = `status='closed'`** | migration encolhe; some a coluna |
| **P2.6** | Regra de grupo por filtro | **Grupo tem filtro próprio** | `matchesTypeFilter` já existe — reusar |
| **P2.11** | Adiar tags e etapa para a fatia B | **Construir as duas agora** | Fase 3 cresce; ver a consequência lá |
| **P1.5b** | — | Mensagem automática assina com o **nome do escritório, fixo** | texto configurável, um só; nunca nome de pessoa |

Confirmaram a recomendação: **P1.2** (grava no banco), **P1.3** (esconde e reaplica),
**P1.6**, **P1.7**, **P1.8**, **P2.1**, **P2.2**, **P2.4**, **P2.5** (etapa do contato),
**P2.7** a **P2.10**, **P3.1** (tabela própria), **P3.2** (chave por conversa), **P3.3**,
**P3.4** (notifica), **P3.5** (menção por nome), **P3.6** a **P3.9**, e toda a F4.

---

## Fase 1 — F3: anotação interna no fio

**Por que primeiro:** é a feature com maior valor por unidade de risco. Toda a mecânica
difícil já existe no repositório — a fase é *estender*, não construir.

### O que mudou desde o plano original

A migration **912** (histórico de atividade) entregou de graça o mecanismo que o plano
antigo ia construir do zero: `intercalar()` + `ItemDaLinhaDoTempo<M>` +
`groupTimelineByDate` já misturam itens que **não são mensagem** no fio do chat, em ordem
cronológica, com desempate estável — puro e testado.

→ **A parte mais cara do plano antigo morreu.** F3 acrescenta uma fatia ao tipo existente.

### Decisão de arquitetura

**Tabela própria `cb_conversation_notes`, chaveada por `conversation_id`** — não linha em
`messages`.

Motivos, em ordem de peso:

1. **`conversation_id` é a única chave que cobre 1:1 e grupo.** `contact_notes.contact_id`
   é `NOT NULL` e conversa de grupo tem `contact_id` nulo — reusar aquela tabela deixaria
   grupo sem nota, em silêncio. Com 58 grupos esperando o interruptor, isso vira queixa no
   primeiro dia.
2. **Nota em `messages` vaza para a API pública v1.** `serializeMessage` deriva a direção
   de `sender_type`, então a nota sairia rotulada como *mensagem enviada ao cliente* — e
   `content_type` é `string` no tipo público, então **nada acusa**.
3. **Exigiria alargar dois CHECKs do upstream** (`sender_type` e `content_type`), que é
   superfície de conflito no merge.

Dois vazamentos que o plano antigo previa **não existem** e saem da lista: webhooks de
saída (o dispatch é explícito nos caminhos de ingestão, não há trigger em `messages`) e
contexto da IA (some desde que a nota não use `content_type='text'`).

⚠️ **`cb_lead_events` é precedente de EXIBIÇÃO, não de ESCRITA.** Ele é evento *derivado*,
sem autor, gravado por trigger porque havia 6 escritores espalhados. A nota é ato
*primário*: tem autor, tem intenção, tem um caminho só, e precisa ser apagável por gente.
Copiar o padrão de escrita dele seria errado.

### Schema — `0918_cb_notas_na_conversa.sql`

```sql
create table cb_conversation_notes (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id) on delete cascade,
  conversation_id uuid not null,
  -- Desnormalizado para as duas fichas lerem por contato sem join.
  -- NULO em conversa de grupo (grupo não tem contato).
  contact_id      uuid references contacts(id) on delete cascade,
  author_user_id  uuid references auth.users(id) on delete set null,
  autor_nome      text,                  -- congelado: o membro pode sair da conta
  texto           text not null,
  mencionados     uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  -- FK COMPOSTA: garante que a conversa é da mesma conta sem validar em código.
  -- O índice único (id, account_id) nasceu na 910.
  constraint cb_conversation_notes_conversa_fkey
    foreign key (conversation_id, account_id)
    references conversations(id, account_id) on delete cascade
);
create index cb_conversation_notes_conv_idx
  on cb_conversation_notes (conversation_id, created_at);
create index cb_conversation_notes_contato_idx
  on cb_conversation_notes (contact_id, created_at) where contact_id is not null;

alter table cb_conversation_notes enable row level security;
-- policies: SELECT/INSERT para is_account_member(account_id, 'viewer')  [P3.11]
--           DELETE para o autor OU admin da conta  [ver armadilha do SET NULL]
-- ⚠️ E o REVOKE, porque sem policy de UPDATE a RLS apenas FILTRA:
REVOKE UPDATE ON cb_conversation_notes FROM authenticated, anon;

-- Migração dos dados (P3.10): as notas de contato viram notas da conversa daquele
-- contato. É 1:1 — `idx_conversations_account_contact` é UNIQUE (account_id, contact_id).
-- Medido antes: 2 notas, 0 delas de contato sem conversa. Sem perda.
INSERT INTO cb_conversation_notes (account_id, conversation_id, contact_id,
                                   author_user_id, texto, created_at)
SELECT n.account_id, v.id, n.contact_id, n.user_id, n.note_text, n.created_at
FROM contact_notes n
JOIN conversations v ON v.contact_id = n.contact_id AND v.account_id = n.account_id;

DROP TABLE contact_notes;
```

⚠️ **`DROP TABLE contact_notes` só depois de as duas telas de ficha já lerem a tabela
nova** — senão o deploy quebra a ficha entre a migration e o código novo. Como a migration
é aplicada à mão (MCP do Supabase) e o deploy é separado, **aplicar a migration por último**
nesta fase, ou dividir em duas (criar+copiar agora, dropar depois do merge).

⚠️ **Adicionar a tabela à publication do realtime.** `contact_notes` e `cb_lead_events`
não estão. O argumento documentado para a trilha não ter realtime ("nenhuma ação que gera
evento acontece na tela onde ela é lida") **se inverte na nota**: ela é escrita exatamente
ali, no compositor, e dois atendentes na mesma conversa é o caso normal.

**A migration também alarga `notifications_type_check`** (P3.4 = sim, notifica): hoje ele
aceita o literal único `'conversation_assigned'`. ⚠️ Escrever a notificação **por código**,
não por trigger — a menção é intenção do autor, não efeito derivado. (É a diferença que
separa esta tabela de `cb_lead_events`.)

**A menção é por NOME** (P3.5), não por e-mail como o print de referência mostrava. Motivo
medido: agents e viewers **não enxergam o e-mail dos colegas** — a menção por e-mail
ficaria vazia justamente para o perfil que mais usa o inbox. Usar o `memberLabel` que já
existe (`full_name` → email → id). O texto de ajuda da caixa amarela muda junto: não pode
dizer "digitando @+email".

### Armadilhas específicas

- **Prefixo de chave próprio (`n:`)** na fatia nova de `ItemDaLinhaDoTempo`. Reusar `m:` ou
  `e:` colide e a ordem passa a variar entre renderizações.
- **O ramo da nota tem de vir ANTES da linha `const msg = item.mensagem!`** no laço de
  render. O `!` desliga a checagem e o TypeScript não avisa — toda nota derrubaria o fio
  com `TypeError` em runtime.
- **Existem dois escritores de `contact_notes` hoje**, ambos direto do navegador sob RLS.
  Qualquer campo novo tem de ser aplicado nos dois na mesma passada, ou eles divergem.
- **Molde visual pronto:** a faixa de `content_type='system'` (aviso de grupo) já é
  renderizada no fio deliberadamente **fora** do `MessageActions` — sem responder, reagir
  ou apagar. A nota segue o mesmo padrão.

### ⚠️ Revisão prévia (passo 1 do fluxo) — feita em 2026-08-01

Três agentes conferiram o plano contra o código. **O mecanismo do fio foi confirmado
inteiro** (`intercalar` em `describe.ts:145`, tipo em `:131`, ramificação do render em
`message-thread.tsx:1446`, e a linha perigosa `const msg = item.mensagem!` é a **1449**).
Mas nove coisas divergiram, e três mudam o desenho:

**1. A notificação da menção NÃO pode ser escrita do navegador.** `notifications` **não tem
policy de INSERT** — a 027 diz por escrito que as linhas são criadas *exclusivamente* pelo
trigger `SECURITY DEFINER`. Um insert do cliente dá **42501**.
→ **A nota passa a ser criada por uma rota de servidor** (`POST /api/cb/notes`), que grava
nota + notificação na mesma passada. Isso contraria o precedente de `contact_notes`
(insert direto do navegador) **de propósito**, e traz de brinde: validação das menções,
`autor_nome` carimbado no servidor, e o gate por papel no lugar certo.

**2. O teste existente quebra.** `describe.test.ts:248` afirma a invariante como **XOR de
duas fatias**: `Boolean(item.mensagem) !== Boolean(item.evento)`. Um item que só tem nota
dá `false !== false` → falha. → Reescrever para "exatamente uma das três" no **commit 2**,
não depois.

**3. A P3.3 não é implementável com o schema proposto.** A resposta foi "a nota do fio
aparece nas três superfícies", mas a sidebar e a ficha leem `contact_notes` **por
`contact_id`** (`contact-sidebar.tsx:68`, `contact-detail-view.tsx:159`), e a nota nova é
por `conversation_id` — e nota de grupo não tem contato. → **Decisão pendente**, ver
"Pendências" abaixo.

Divergências menores, já incorporadas:

- **`REVOKE UPDATE ... FROM authenticated, anon`** na migration. Sem policy de UPDATE a RLS
  apenas *filtra*: um bug de UI que tente editar volta "0 linhas" e **parece sucesso**. É o
  mesmo argumento escrito na 912:173-178.
- ⚠️ **`author_user_id ON DELETE SET NULL` + policy `author_user_id = auth.uid()` se
  anulam**: quando o autor sai do `auth.users`, a comparação vira NULL e a nota fica
  **indelevável para sempre**. → somar `OR is_account_member(account_id,'admin')`.
- **O botão não pode herdar `inputsDisabled`** (`message-composer.tsx:229` =
  `readOnly || sessionExpired`). `sessionExpired` é a janela de 24h da Meta, regra de envio
  ao *cliente*. Anotação interna travada quando a janela fecha mata a feature justamente na
  conversa parada, que é onde mais se anota. Botão próprio, gate só de papel.
- **Não reaproveitar a `<textarea>` do compositor:** o `handleKeyDown` (448-476) manda Enter
  para `handleSend` — a anotação interna sairia como mensagem para o cliente.
- **O auto-scroll depende de `[messages, leadEvents]`** (`message-thread.tsx:554`). Sem
  somar as notas ali, o autor não vê a nota que acabou de escrever.
- **O hook novo tem de ser chamado junto do `useLeadEvents` (linha 548)**, não perto do
  `messageGroups` (1133) — este vem *depois* do early return de 1105, e chamar hook ali
  viola a regra dos hooks e derruba conversa de grupo.
- **Alargar `NotificationType`** (`src/types/index.ts:243`) **quebra o typecheck** em
  `notifications/page.tsx:17`, onde `TYPE_ICON` é `Record<Notification["type"], …>`.
  ⚠️ Há um **homônimo** em `types/index.ts:603` — outro `'conversation_assigned'` que é
  gatilho de *automação*. Alargar o errado inventa um gatilho inexistente.
- **`useCan` tem união fechada `CanAction`** — não existe capability para nota.
- **Não dá para testar a caixa amarela com testing-library:** `vitest.config.ts:8` fixa
  `environment: "node"` e não há jsdom nem `@testing-library`. O teste da fase cobre as
  **funções puras** (intercalar com a terceira fatia, parsing da menção); a UI é verificada
  no navegador.
- **O texto da notificação não passa pelo dicionário** — `notifications.title/body` são
  colunas TEXT. O trigger existente grava em inglês cru; a nossa nasce em pt-BR e o sino
  fica com dois idiomas até alguém unificar.

Referências corrigidas no Anexo A: `describe.ts:131`/`:145` (não 129),
`members.ts:23` (não :5), `groupTimelineByDate` definida em `message-thread.tsx:154`.

### Pendências antes do commit 1

| # | Pergunta | ➡️ Recomendação | Resposta |
| --- | --- | --- | --- |
| **P3.10** | A nota do fio aparece na sidebar e na ficha do contato (P3.3), ou vive só no fio? | Somar `contact_id` nullable e mesclar as duas fontes | ✅ **Migrar tudo para a tabela nova** — `contact_notes` é aposentada |
| **P3.11** | Quem pode anotar: só quem pode enviar mensagem (agent+), ou **viewer** também? | **Viewer também** | ✅ **Viewer também** — capability nova em `CanAction` |

⚠️ **A P3.10 aumentou a Fase 1.** Migrar tudo significa que a fase deixa de ser aditiva e
passa a **reescrever duas telas fora do inbox** (`contact-sidebar.tsx:66` e
`contact-detail-view.tsx:157`) e a **mover os dados** de `contact_notes`.

Medido antes de decidir: **65 contatos, 1 sem conversa** · **2 notas, nenhuma delas de
contato sem conversa** → a migração dos dados é **sem perda**.

⚠️ **Capacidade que se perde, registrada de propósito:** com a nota chaveada por conversa,
**não dá mais para anotar um contato que ainda não tem conversa** — hoje dá. Atinge 1
contato dos 65, e nenhuma nota existente. Se um dia incomodar, a saída é a ficha criar a
conversa sob demanda (já existe `findOrCreateConversation`), não mudar o schema.

### Commits previstos

| # | Commit | Conteúdo |
| --- | --- | --- |
| 1 | `feat(notas): schema da anotação por conversa` | migration 918 (tabela + RLS + REVOKE UPDATE + realtime + cópia dos dados) + tipos + capability nova |
| 2 | `feat(notas): a nota entra no fio do chat` | fatia `nota?`, `intercalar` + **teste reescrito**, balão, auto-scroll, hook novo |
| 3 | `feat(notas): escrever anotação no compositor` | botão próprio, caixa amarela, **rota `POST /api/cb/notes`**, i18n nos dois dicionários |
| 4 | `feat(notas): a ficha lê as anotações da conversa` | **P3.10** — `contact-sidebar` e `contact-detail-view` passam para a tabela nova; `DROP TABLE contact_notes` |
| 5 | `feat(notas): menção de colega` | autocomplete **construído do zero**, `NotificationType` + `TYPE_ICON`, notificação na rota |
| 6 | `fix(notas): achados da passada fria` | correções da revisão |

### ⚠️ Achados da execução — o que divergiu do plano acima

Escrito **depois** de codar, para a próxima sessão não repetir o caminho errado.

**1. `DROP TABLE contact_notes` — feito na 922, autorizado pelo operador, e por muito
pouco não levou duas funções vivas junto.**

⚠️ **A lição que vale para qualquer DROP futuro neste banco:** `DROP TABLE` **não**
reclama de referência dentro de corpo de função. O PL/pgSQL só resolve o nome da tabela
na hora de executar, então o DROP passa limpo e o estrago aparece depois, em produção,
como `relation ... does not exist` no meio de uma operação. Duas funções vivas citavam
`contact_notes`:

| Função | O que quebraria |
| --- | --- |
| `merge_duplicate_contacts` (022/036) | a deduplicação de contato por telefone — a ingestão de cliente repetido |
| `redeem_invitation` (019) | **aceitar convite para a conta** — gente nova não entraria no escritório, justo agora (P1.1) |

E havia um segundo estrago, mais silencioso: aquela linha em `merge_duplicate_contacts`
**repontava** a anotação para o contato sobrevivente. `cb_conversation_notes.contact_id`
é `ON DELETE CASCADE` e o laço termina apagando o contato perdedor — sem a linha
equivalente na tabela nova, juntar dois cadastros do mesmo cliente **apagaria as
anotações internas** dele, sem erro e sem aviso.

Antes de qualquer `DROP TABLE`, rodar:

```sql
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND pg_get_functiondef(p.oid) ILIKE '%nome_da_tabela%';
```

A 922 recria as duas funções **antes** do DROP, na mesma transação, e assere no fim que
nenhuma função sobrou citando a tabela morta.

⚠️ **Esta nota mentiu por um commit, e o erro vale mais que o acerto.** Ela afirmava que
"as duas telas de ficha já leem a tabela nova" quando só a `contact-sidebar` tinha sido
migrada — `contact-detail-view.tsx` continuou lendo, escrevendo E APAGANDO
`contact_notes` (linhas 157, 281, 300). Com as duas tabelas vivas e as mesmas 2 linhas
copiadas nas duas, a tela de Contatos apagava a cópia velha, dizia "excluída", e o texto
seguia legível no fio do chat. Foi a **revisão fria de segurança** que pegou, não eu, não
o typecheck e não os testes — porque nada aqui é erro de tipo: as duas tabelas existem e
as duas consultas são válidas. Corrigido no commit `fix(notas): achados das revisões`.

Lição para as próximas fases: ao trocar uma tabela por outra, `grep` do nome antigo no
repositório inteiro é passo obrigatório do commit, não da revisão.

**2. A menção precisou de migration própria (919).** O plano dizia que a 918 alargaria o
`notifications_type_check` junto. Ela não alargou — e como as duas foram aplicadas em
momentos diferentes, virou arquivo separado. Efeito colateral: as fases 2–5 andaram um
número.

**3. `NotificationType` está na linha 269, não na 243.** A referência do plano envelheceu.
O homônimo de automação segue existindo mais abaixo no mesmo arquivo — o aviso continua
válido, só a linha mudou.

**4. `autoFocus` numa `<textarea>` controlada EMBARALHA o texto digitado.** Escrever
"Teste da anotação interna" gravava `teTeste da anotação internaste`. O React reaplica o
foco durante o commit e o cursor volta ao começo no meio da digitação. A saída é focar por
ref num efeito, com `setSelectionRange` no fim — o padrão que o `desfazerEnvio` já usava.
⚠️ Vale para qualquer caixa nova das próximas fases (o agendamento tem uma).

**5. Dois consumidores do mesmo hook de realtime derrubam a página.** O cliente do Supabase
indexa canal por tópico: pedir `channel('x')` duas vezes devolve o objeto já inscrito, e o
`.on()` seguinte estoura. Dentro de efeito, isso é erro não capturado — **página branca**,
não aviso no console. Todo hook novo com realtime tem de pôr o `useId()` da montagem no
nome do canal.

**6. Medir a UI com `javascript_tool` no meio da digitação MENTE.** A avaliação tira o foco
do campo, o que fecha o autocomplete e zera o `selectionStart` — cheguei a diagnosticar um
bug de cursor que não existe. Para conferir caixa com foco e teclado: só `computer` (type,
key, click) e **screenshot**, sem JS entre os passos.

**7. A conta tem 1 membro, não 2.** O "2 membros / 2 contas" do Ground truth é 1 membro em
cada conta. Consequência: a menção só pôde ser exercitada até a validação (o autor sai da
lista de notificados de propósito), e o caminho do sino foi conferido inserindo a linha à
mão e apagando depois. Refazer quando entrar a segunda pessoa (P1.1).

**8. `authenticated` tinha GRANT de INSERT em `notifications`.** Achado ao conferir o
resultado da 919. A 027 confiou só na ausência de policy. Revogado na 919, com as duas
metades e verificação — o padrão que o `CLAUDE.md` descreve.

---

## Fase 2 — F1: assinatura por membro

**Duas peças, decididas na P1.5:**

1. **Assinatura visível ao cliente** — `*Nome:*\n` no topo do texto enviado, com interruptor.
   Vale para mensagem de gente **e** para automação/fluxo/IA.
   ⚠️ **Mensagem automática assina com o nome do ESCRITÓRIO, fixo** (`*CB Advogados:*`),
   nunca com o nome de uma pessoa — uma resposta automática de madrugada sairia com o nome
   de quem não escreveu nada. Texto configurável, um só, ao lado do interruptor.
2. **Identificação interna de bot/IA — sempre, sem interruptor.** Não vai para o cliente:
   é marca na bolha, para a equipe saber que aquela resposta não foi escrita por gente.
   Existe mesmo com a peça 1 desligada, e mesmo com ela ligada (o cliente vê o nome do
   escritório; a equipe precisa ver que foi robô).

### Estado da peça 2 (medido)

| Origem | Selo hoje | Falta |
| --- | --- | --- |
| Resposta de IA (`ai_generated`) | ✅ selo com ✨ em `message-bubble.tsx:531` | — |
| Celular pareado (`from_device`) | ✅ selo próprio | — |
| **Automação / fluxo** (`sender_type='bot'`, `ai_generated=false`) | ❌ **nenhum** | **é o buraco** |

→ A peça 2 é pequena: um selo novo para `sender_type='bot'` sem `ai_generated`. Os outros
dois casos já estão cobertos.

### Decisão de arquitetura

- **O prefixo é gravado em `content_text`** (P1.2). Um CRM jurídico precisa mostrar
  exatamente o que o cliente recebeu; aplicar só no wire criaria duas verdades sobre a
  mesma mensagem.
- **`sender_id` passa a ser preenchido.** Campo novo em `SendMessageParams` (que hoje não
  tem nenhum campo de usuário) — o `user.id` já existe em
  `src/app/api/whatsapp/send/route.ts` e morre ali. ⚠️ `src/lib/api/v1/conversations.ts:5`
  avisa por escrito que `sender_id` **não pode vazar** no serializer público: conferir no
  mesmo PR.
- **Assina em grupo** (P1.4). Vai de graça pelo mesmo `sendMessageToConversation`, que
  ganhou o ramo de grupo internamente. ⚠️ Consequência a vigiar: no grupo o WhatsApp já
  identifica o remetente, e se houver menção `@participante` o texto fica com **duas
  camadas de metadado** antes do conteúdo útil.
- ⚠️ **Nome COMPLETO** — o operador reverteu a P1.6 em 2026-08-01, depois de ver a
  implementação. Motivo dele: num escritório de advocacia o cliente precisa saber com qual
  advogado falou, e o primeiro nome não identifica ninguém quando há mais de um Leonardo;
  o nome completo é o que ele vê na procuração e no processo. (Texto original da decisão
  abaixo, mantido para quem for ler o Anexo B.)
- ~~**Nome:** primeiro nome~~, com `coalesce(nullif(full_name,''), email)` (P1.6). O trigger de
  signup grava `COALESCE(..., '')`, então `NOT NULL` **não** garante não-vazio — sem isso a
  assinatura sai `*:*`.
- **Interruptor por conta, nascendo desligado** (P1.8) → migration `923_cb_assinatura`.


### Commits da Fase 2 (branch `feat/assinatura-do-membro`, de `main` @ `9bc27fb`)

| Commit | O quê |
| --- | --- |
| `d808ea3` | plano revisado contra o código — os cinco erros |
| `94c7daf` | conserto do build (Tailwind varrendo a saída de build) |
| `a555d81` | `sender_id` preenchido |
| `37fbb6c` | selo de robô na bolha |
| `2edc977` | a assinatura nos cinco escritores + migration 923 |
| `41b567a` | nome completo, tela de configuração, edição |
| `b3c15c6` + `1435b66` | a bolha otimista (duas passadas — ver abaixo) |
| `77fe13a` | correção do diagnóstico do build |

⚠️ **A bolha otimista precisou de DOIS commits, e o motivo vale para qualquer feature
que mude texto enviado.** O primeiro fez a rota devolver o texto final e o fio corrigir a
bolha ao receber a resposta — o que **encurtou** a janela em vez de fechá-la, porque o
navegador desenha antes de falar com o servidor. O operador testou e ainda viu a mensagem
piscar sem o nome. Só fechou quando o cliente passou a desenhar já assinado, usando as
**mesmas funções puras** do envio. Lição: "corrigir depois que a resposta chega" não é o
mesmo que "nascer certo", e só o teste de gente pega a diferença.

⚠️ **Também registrado: eu diagnostiquei o bug do build errado.** Ver o cabeçalho de
`src/app/globals.css` — o `.gitignore` já resolvia, o Tailwind não segue o symlink, e o
que realmente abre a porta é a cópia de conflito do iCloud (`.next 2`). Verifiquei que o
sintoma sumiu e concluí que foi por minha causa; o sintoma era real, a explicação não.

### ⚠️ Revisão prévia (passo 1 do fluxo) — feita em 2026-08-01, contra `main` @ `9bc27fb`

O plano acima estava **errado em cinco pontos**, três deles capazes de deixar mensagem
sem assinatura em produção. O que foi medido no código:

**1. Não existe um caminho de envio. Existem CINCO escritores de saída.**
E `sendMessageToConversation` **não é o funil**: automação, fluxo e IA passam **ao lado**
dele, com cliente service-role.

| # | Onde | `sender_type` | Quem chega ali |
| --- | --- | --- | --- |
| A | `whatsapp/send-message.ts:616` | `agent` | painel, API v1 pública, MCP |
| B | `flows/meta-send.ts:153` (`engineSendText`) | `bot` | fluxos **e IA** |
| C | `flows/meta-send.ts:305` (`engineSendMedia`) | `bot` | fluxos |
| D | `flows/meta-send.ts:524` (interativo) | `bot` | fluxos e automações |
| E | `automations/meta-send.ts:235` | `bot` | **automações** |

⚠️ **Existem DUAS funções `engineSendText` diferentes** — `flows/meta-send.ts:74` e
`automations/meta-send.ts:61`. Assinar só a dos fluxos deixa **toda automação sem
assinatura**. O plano falava de uma só.

Mais dois escritores de saída que **não** se assinam por construção (a mensagem já saiu
do celular pareado): `persistDeviceMessage` (1:1) e `persistGroupDeviceMessage`.

**2. Broadcast NÃO escreve em `messages`.** O plano o listava. `broadcast-core.ts` só toca
`broadcasts`/`broadcast_recipients` — disparo nunca aparece no fio, e modelo aprovado pela
Meta não aceitaria prefixo mesmo. Sai da lista.

**3. Não há tabela de configuração, e nenhuma migration `9xx` mexe em `accounts`.** O
precedente é `accounts.default_currency`, da **021** — coluna com `NOT NULL DEFAULT`, sem
mudança de RLS (a policy de 017 já restringe a admin+), lida em `use-auth.tsx:172` e
escrita direto sob RLS em `deals-settings.tsx:58`. É esse molde que a 923 copia.

**4. O teto de 1024 roda em TRÊS lugares, todos antes do prefixo.** `send-message.ts:181`
via `validateSendMessageParams`, chamado de `send/route.ts:113`, `v1/messages/route.ts:94`
e do próprio núcleo em `:223`. Uma legenda de 1020 caracteres passa na validação e a Meta
recusa a versão prefixada — o operador leva **502 em vez de 400**. Vale igual para o corpo
interativo (`interactive.ts:35`).

**5. `sender_id` é coluna morta e de graça.** Existe desde a 001, é `UUID` anulável, tem
**zero escritas e zero leituras** no repositório, e o serializer público a exclui por
allowlist. Preencher não precisa de migration.

### Armadilhas específicas

- ⚠️ **A bolha otimista é montada no cliente com o texto SEM assinatura**
  (`message-thread.tsx:640`, `:725`, `:789`, `:868`). Se só o servidor prefixa, o texto
  **muda na frente do operador** quando o realtime reconcilia. A rota hoje devolve só
  `message_id`/`whatsapp_message_id` (`send/route.ts:261`) — ou ela passa a devolver o
  texto final, ou o cliente prefixa igual.
- ⚠️ **`last_message_text` é escrito em CINCO lugares, sem helper comum**
  (`send-message.ts:646`, `flows/meta-send.ts:176`/`:326`/`:544`,
  `automations/meta-send.ts:260`), e há um sexto que o re-deriva do `content_text` depois
  de editar ou apagar (`conversation-preview.ts:26`). A decisão sobre assinar a prévia tem
  de ser repetida em todos.
- ⚠️ **A IA passa a LER a própria assinatura.** `ai/context.ts:26,38` monta o histórico do
  modelo a partir do `content_text`. Com o prefixo gravado ali, o modelo vê `*Nome:*` nas
  mensagens anteriores e tende a imitar — gerando assinatura dentro do texto que já vai ser
  prefixado de novo. **Tirar a assinatura ao montar o contexto da IA.**
- ⚠️ **Editar mensagem assinada** (P1.3). O diálogo é pré-preenchido com o `content_text`
  inteiro (`message-thread.tsx:984`) e o PATCH grava verbatim
  (`api/whatsapp/message/route.ts:394`): o operador veria `*Leonardo Cabral:*` cru e poderia
  apagar. → **Esconder o prefixo do campo e reaplicá-lo no servidor.**
- ⚠️ **API v1 e MCP não têm pessoa.** `v1/messages/route.ts:137` chama o núcleo com contexto
  de chave de API, sem `user`. → Assinam com o **nome do escritório**, mesma regra do robô
  (P1.5): envio sem gente não pode levar nome de gente.
  ⚠️ Pelo mesmo motivo, **não** usar `configOwnerUserId` (`ai/auto-reply.ts:19`) nem
  `run.user_id` (`flows/engine.ts:1103`) como autor: são o dono da configuração, não quem
  respondeu.
- ⚠️ **Os motores já recebem um `userId` e o IGNORAM** (`flows/meta-send.ts:48`,
  `automations/meta-send.ts:40`). Tentador usá-lo — é a mesma armadilha do item acima.
- **Bordas do nome:** nome com `*`, `_`, `~` ou crase corrompe o parse do WhatsApp; nome
  iniciado por espaço vira asterisco cru. Sanear na entrada.
- **A prévia da lista fica `Nome: corpo`.** `stripWhatsAppFormat` tira os asteriscos, não o
  nome (`conversation-list.tsx:644`). ⚠️ Em grupo isso **colide** com a convenção que já
  existe: `previaDaMensagem` (`cb-groups/persist.ts:333`) já monta `Nome: corpo`.
- **O negrito não é trabalho:** `parseWhatsAppFormat` (`inbox/whatsapp-format.ts:102`)
  renderiza `*Nome:*` em negrito de verdade — conferido caractere a caractere, o `:` antes
  do `*` de fechamento e o `\n` depois satisfazem `podeFechar`.
- **Áudio não tem legenda:** sai sem assinatura, por construção.
- **`messages` não tem policy de UPDATE garantida para o cliente do painel** — por isso
  `stampMessageChannel` usa `supabaseAdmin()` (`send-message.ts:660`). Qualquer update
  pós-insert segue a mesma regra.

### Mensagem interativa NÃO é assinada — decisão do operador (2026-08-01)

Menu com botões sai sem prefixo. Levantei como pendência porque o plano listava o caminho
interativo entre os escritores a assinar, e deixá-lo de fora cria inconsistência ("por que
o texto tem nome e o menu não?").

Motivo aceito: a assinatura ficaria **dentro do corpo do card**, colada num menu de botões
— visualmente lê como erro, não como identificação. E o menu já é obviamente o robô
perguntando; a equipe tem o selo ROBÔ na bolha, e o cliente não está falando com uma pessoa
naquele momento.

⚠️ Consequência a lembrar em qualquer revisão futura: `flows/meta-send.ts` tem um insert de
mensagem interativa que **não** passa por `aplicarAssinatura`. Isso é intencional, não um
escritor esquecido.

### O que a assinatura no `content_text` contamina (P1.2, decisão mantida)

Gravar o prefixo no texto foi decisão do operador — um CRM jurídico precisa mostrar
exatamente o que o cliente recebeu. O preço, medido, são **seis** consumidores do mesmo
campo: citação de resposta, copiar para a área de transferência, contexto da IA (acima),
relatórios (`dashboard/queries.ts:425`), busca (`conversation-list.tsx:234`) e o
`content_text` da **API pública** — que passa a expor o nome do atendente mesmo com
`sender_id` protegido por allowlist. Registrado aqui para não ser redescoberto como bug.

### Commits previstos

| # | Commit | Conteúdo |
| --- | --- | --- |
| 1 | `feat(mensagens): registrar quem enviou` | `sender_id` preenchido (sem migration) + teste do serializer v1 |
| 2 | `feat(inbox): marcar mensagem de automação` | peça 2 — selo de robô na bolha, i18n nos dois dicionários |
| 3 | `feat(assinatura): prefixo do membro no envio` | migration 923 + módulo próprio + interruptor + **os cinco escritores** |
| 4 | `fix(inbox): editar não expõe nem apaga a assinatura` | esconder no diálogo, reaplicar no servidor |
| 5 | `fix(assinatura): achados das revisões` | correções |

### Commits previstos

| # | Commit | Conteúdo |
| --- | --- | --- |
| 1 | `feat(mensagens): registrar quem enviou` | `sender_id` preenchido + guarda no serializer da API v1 |
| 2 | `feat(inbox): marcar mensagem de automação` | peça 2 — selo de bot na bolha, i18n nos dois dicionários |
| 3 | `feat(assinatura): prefixo do membro no envio` | migration 919 + módulo próprio + interruptor |
| 4 | `fix(inbox): editar não expõe nem apaga a assinatura` | esconder no diálogo, reaplicar no servidor |
| 5 | `fix(assinatura): achados da passada fria` | correções |

---

## Fase 3 — F2 fatia A: filtros

**Escopo:** nome, telefone, canal, status, responsável, os 3 toggles (não lidas /
arquivadas / favoritas) e o filtro de tipo (todas / diretas / grupos). **Tudo no cliente**
(P2.2), como já é hoje.

**Mais etiquetas (modo Qualquer/Todas) e etapa do funil** — a P2.11 foi confirmada como
"construir as duas agora".

⚠️ **Consequência da etapa vir para cá:** etiqueta já vem hidratada de graça
(`CONVERSATION_SELECT` embute `contact_tags(tags(*))`), mas **etapa não** — ela mora em
`deals.stage_id` e a lista de conversas não carrega `deals`. Filtrar no cliente exige uma
segunda busca: `deals(contact_id, stage_id)` da conta inteira, montando um mapa
`contact_id → etapa`. Com 55 negócios isso é irrelevante em custo, e é bem mais simples
que antecipar a RPC. Registrar que **essa segunda busca morre na fatia B**, quando tudo
virar uma query só.

⚠️ **Os dois filtros nascem sem discriminar nada:** 0 etiquetas criadas e 55 de 55
negócios na mesma etapa. Isso é aceitável porque entra gente na conta agora (P1.1), mas
significa que **o teste não pode ser "abri e funcionou"** — é preciso criar etiqueta e
mover negócio de etapa à mão para exercitar de verdade.

**Fora do escopo:** busca no corpo das mensagens (é a fatia B, exige índice e RPC).

### ⚠️ Revisão prévia (passo 1 do fluxo) — feita em 2026-08-01

**O achado que muda o desenho: o painel, como planejado, APAGARIA TRÊS COISAS QUE JÁ
FUNCIONAM.** O plano lista os campos do painel como se a lista não filtrasse nada hoje.
Ela filtra:

| Já existe | Onde | O que se perde se o painel "substituir" |
| --- | --- | --- |
| Busca no **texto da última mensagem** | `conversation-list.tsx:224-242` (`stripWhatsAppFormat(c.last_message_text)`) | achar conversa pelo que foi dito |
| Busca por **nome do grupo** (alias e assunto) | mesma função | achar grupo por nome |
| Facet de **empresa** | `matchesContactFilters` + UI em `:452-496` | filtrar por empresa do contato |

→ **A caixa de busca atual FICA como está** (nome, telefone, grupo e última mensagem numa
só). Os filtros estruturados entram **ao lado** dela, não no lugar. E o campo de empresa
entra na lista de filtros do painel, que o plano tinha esquecido.

**Outras oito divergências medidas:**

1. **`matchesTypeFilter` NÃO tem teste** — o plano dizia que as funções puras eram
   testadas. `conversations.test.ts` tem 7 casos, todos de `matchesContactFilters` e
   `normalizeConversation`. Escrever teste antes de mexer.
2. **O modo "Todas" de etiqueta é NOVO.** Hoje é OR puro e fixo
   (`contactTagIds.some(...)`, `conversations.ts:66`).
3. **`unread_count` é POR CONTA, não por pessoa** — confirma a decisão do operador. Quem
   abrir primeiro zera para a equipe inteira. Tornar por pessoa seria mudança de schema,
   não de tela.
4. **Hoje "não lidas" IGNORA o status por completo** (`else if`, `:201-205`) — inclui
   conversa encerrada. Separar os controles muda o que 49 das 64 conversas mostram.
5. **Três filtros nascem invisíveis ou vazios**, e os gates são deliberados (convenção do
   `CLAUDE.md`): canal só aparece com **2+ canais** (`:365`) e cada conta tem **1**;
   etiqueta só aparece com **1+ etiqueta** (`:410`) e há **0 no banco inteiro**; o tipo
   (diretas/grupos) só aparece com grupo carregado, e há **0** — os 58 grupos estão em
   `cb_groups` esperando `groups_enabled`. **Manter os gates**; um seletor de uma opção só
   ocupa espaço sem decidir nada.
6. **Arquivadas nasce vazia:** 0 conversas com `status='closed'`.
7. **"Etapa do contato" não é valor único.** O índice único da 911 só cobre
   `source='channel'`; negócio manual ou de automação pode duplicar. E **9 das 64
   conversas não têm negócio nenhum** — precisa de uma opção explícita "sem etapa", ou
   essas somem de qualquer recorte por etapa.
8. **`CONVERSATION_SELECT` é compartilhado com a API PÚBLICA v1**
   (`api/v1/conversations/route.ts:33`). Embutir `deals` ali mudaria o contrato público —
   por isso a busca de etapa é separada, como o plano já dizia.

### Remedição antes de codar (2026-08-01, já com a Fase 2 no ar)

O passo 1 do fluxo foi refeito contra `main` @ `de3ced2`. **A revisão prévia acima
continua valendo inteira** — nada do que ela descreve mudou no código. O que mudou são
dois números, e os dois mexem no que dá para testar:

| | Na revisão prévia | Agora | O que muda |
| --- | --- | --- | --- |
| Canais | 1 na conta ativa | **2 no banco, mas 1 por conta** | o filtro de canal **continua invisível** — o gate é 2+ *na conta*, e nenhuma tem |
| Conversas com responsável | — | **1 de 64** | o filtro de responsável nasce quase sem discriminar |

O resto bateu exatamente: 64 conversas, 49 não lidas, 0 arquivadas, 0 de grupo, 0
etiquetas, 55 negócios em 1 etapa só, 9 conversas sem negócio, 2 membros em 2 contas
(1 cada).

⚠️ **Consequência prática, e é a mesma da revisão prévia:** dos filtros desta fase, os
que hoje separam alguma coisa de verdade são **status, não lidas e favoritas**. Canal,
etiqueta, empresa, tipo e etapa nascem invisíveis ou inertes. Isso **não** é motivo para
cortá-los — entra gente na conta agora (P1.1) e os dados chegam junto —, mas é motivo
para **não** aceitar "abri a tela e funcionou" como teste. Cada um precisa ser
exercitado com dado criado à mão.

### ⚠️ A armadilha silenciosa que vale mais que todas as outras

`.eq()` em campo do contato **produz resultado errado, não erro** — e erra nos DOIS
sentidos:

- **Com o embed atual (LEFT):** o PostgREST aplica o filtro só ao recurso embutido. As
  conversas que não casam **continuam vindo**, com `contact: null` — a lista mostra tudo,
  com metade dos nomes virando "Desconhecido". Parece um filtro que não faz nada.
- **Trocando para `contacts!inner`:** vira INNER JOIN e **apaga toda conversa de grupo**
  (`contact_id IS NULL`), inclusive com o filtro vazio.

Nenhum dos dois dá erro, e **os dois passam em revisão de código**. → Filtrar em JS, como
o arquivo já faz.

**E uma segunda, do mesmo tipo:** `contacts` e `contact_tags` **não estão na publication
do realtime**, e a hidratação nunca atualiza contato já presente
(`{ ...c, contact: c.contact ?? fetched.contact }`, `inbox/page.tsx:163-167`). Etiqueta
criada em outra tela é **invisível para a aba aberta do inbox** até um resync — filtrar
por ela não acha a conversa. Sem erro. ⚠️ Isso morde exatamente o teste desta fase, que
depende de criar etiqueta à mão.

### ⚠️ Como os filtros se combinam — decisão do operador (2026-08-01)

**Todos os filtros do painel se aplicam JUNTOS (E lógico).** Não há filtro que substitua
outro nem que "ganhe" do resto. Marcar responsável = Ana e depois clicar em "não lidas"
mostra *as não lidas da Ana*, não todas as não lidas.

**"Não lido" é da CONTA INTEIRA, não por pessoa.** Uma conversa está não lida se ninguém
da equipe a leu — não "se eu não li". O recorte por pessoa sai do filtro de responsável,
que é o que o operador combina com ele quando quer "as minhas".

⚠️ **É por isso que o commit 3 é uma mudança de comportamento, e não uma adição.** Hoje
"não lidas" é uma opção *dentro* do dropdown de status, e escolhê-la SUBSTITUI o status.
Virando botão independente ela passa a somar. Quem hoje clica em "não lidas" esperando
ver todas vai passar a ver só as que sobrevivem aos outros filtros ativos — o que é o
comportamento pedido, mas muda o que um controle de uso diário faz. Por isso o contador
"Exibindo N chat(s)" importa: ele é o que explica um resultado vazio.

✅ **"Departamento" era exemplo genérico** — confirmado pelo operador em 2026-08-01.
Não existe e **não entra no escopo**. Fica registrado porque o termo aparece na conversa
que originou esta seção: quem reler daqui a um ano não deve sair procurando a tabela de
departamentos nem construir uma. Os filtros da fase são os listados no Escopo, e nada
além.

### Decisão de arquitetura

⚠️ **Não misturar filtro-cliente com filtro-servidor no mesmo painel.** Produz resultado
inconsistente (um filtro vê 64 conversas, outro vê a página carregada). A fatia A é 100%
cliente; a fatia B move **tudo** de uma vez para uma RPC.

Estender as funções puras de `src/lib/inbox/conversations.ts` (que são **nossas**, já
testadas) em vez de reescrever `conversation-list.tsx` (que é do **upstream**).

### Schema — `0924_cb_favoritar.sql` ✅ aplicada

**Arquivada = `status='closed'`** (P2.3). Não é coluna nova — o operador definiu que
arquivar *é* encerrar. Isso encolhe a migration e elimina a objeção do CHECK.
⚠️ Consequência a registrar: como é o mesmo campo, **uma conversa não pode estar
"encerrada mas não arquivada"**. Se um dia essas duas ideias precisarem se separar, é
migration nova, não ajuste de tela.

**Favorita por membro** (P2.3) → tabela de junção `(conversation_id, user_id)` com
`account_id` e FK composta. É o único item de schema desta fase.

**Filtro de grupo já existe:** `matchesTypeFilter` (`src/lib/inbox/conversations.ts:84`)
já resolve todas / diretas / grupos (P2.6). Reusar, não reescrever.

### Armadilhas específicas

- ⚠️ **Grupo some em silêncio.** `conversations.contact_id` é nullable com CHECK XOR contra
  `group_id`. Um filtro com `contacts!inner` vira INNER JOIN e **apaga toda conversa de
  grupo**; sem `!inner` o filtro não filtra a linha-pai. Nenhum dos dois é o certo. E isso
  **passa em todo teste manual hoje**, porque `groups_enabled` está desligado — só quebra
  quando alguém ligar o interruptor. **Testar obrigatoriamente com uma conversa de grupo
  criada à mão.**
- ⚠️ **"Não lidas" é reescrita, não adição.** Hoje é opção *mutuamente exclusiva* do mesmo
  dropdown de status. Virar toggle independente muda o comportamento de um controle que o
  operador usa todo dia.
- **Grupo tem filtro próprio** (P2.6), então a pergunta "grupo casa com este filtro?" deixa
  de ser decidida caso a caso: quem quer grupo escolhe grupo. Os filtros que perguntam algo
  sobre uma *pessoa* (etiqueta, empresa, etapa) continuam não casando com grupo por
  construção — grupo não tem contato.
- **Ligar grupos soma ~58 conversas de uma vez** — a lista carrega tudo sem `limit`.

### Commits previstos

| # | Commit | Conteúdo |
| --- | --- | --- |
| 1 | `feat(inbox): favoritar conversa` ✅ `7b72b60` | migration **924** + estrela na lista |
| 2 | `feat(inbox): painel de filtros` | painel colapsável, contador "Exibindo N", filtros no cliente |
| 3 | `fix(inbox): "não lidas" vira toggle independente` | separado por ser mudança de comportamento |
| 4 | `fix(inbox): achados da passada fria` | correções |

---

## Fase 4 — F4: mensagem agendada

⚠️ **A P4.1 respondeu ("cron na VPS com `x-cron-secret`"), mas o agendador continua não
existindo:** sem `vercel.json`, sem `schedule:` em workflow, sem serviço no Swarm, e
`pg_cron`/`pg_net` disponíveis porém **não instalados** (o schema `cron` sequer existe no
banco). Reconferido em 2026-08-01.

**O plano antigo dizia "basta copiar o padrão do cron das automações". Isso morreu:** o
padrão existe como *código* e nunca como *operação*. `automation_pending_executions` tem
**0 linhas desde sempre** — automação com delay e flow com espera já estão mortos em
produção, e ninguém notou porque ninguém dependeu deles.

→ Ligar o agendador **conserta também automações e flows**. É bônus, mas é preciso saber
que vai acontecer: regras paradas há semanas podem drenar de uma vez.

### Decisão de arquitetura

Tabela `cb_scheduled_messages` chaveada por **`conversation_id`** (única chave que cobre
1:1 e grupo), com FK composta `(conversation_id, account_id)` — de graça, o índice único
nasceu na 910.

**Não estacionar a agendada como linha de `messages`:** o CHECK de `status` não aceita nada
como `scheduled`.

⚠️ **Já existe uma coluna de agendamento morta no projeto:** `broadcasts.scheduled_at`
existe desde a 001, está tipada, e **nenhum código a lê ou escreve** (o upstream tem branch
removendo o stub). F4 sem executor repetiria exatamente esse erro.

### Armadilhas específicas

- ⚠️ **O relógio NÃO pode ser um "modo" sobre o botão Enviar.** A janela de desfazer tem
  **três saídas que disparam imediatamente**: trocar de conversa, desmontar o componente e
  apertar Enter de novo. Um modo ligado no mesmo botão sai na hora por qualquer uma delas.
  → O agendamento é um **diálogo** que produz a linha no confirmar, com caminho próprio que
  **não chama `setPendente`**.
- ⚠️ **Falhar FECHADO no canal.** `resolveEngineChannelPreferring` degrada em silêncio para
  o canal padrão — certo para engine, errado aqui: a mensagem sairia pelo número errado,
  sozinha, sem ninguém na tela. Num escritório de advocacia isso mistura identidades.
- ⚠️ **O envio pausa flows.** `sendMessageToConversation` pausa toda `flow_run` ativa do
  contato. Numa agendada isso aconteceria horas depois, sem operador na tela. Passar um
  sinalizador ao núcleo em vez de herdar o efeito.
- **Sem date picker no projeto.** Usar dois inputs nativos (`type="date"` + `type="time"`),
  único precedente (`deal-form.tsx`). ⚠️ Compor data+hora em horário **local** antes do
  `toISOString()` — nunca concatenar e entregar cru ao `new Date()` (a armadilha do `DATE`
  já mordeu em `expected_close_date`).
- **Vocabulário:** "Excluir" na aba colide com "Apagar para todos" da bolha. O texto de
  confirmação precisa dizer *"cancelar o envio agendado"*.

### ⚠️ Revisão prévia (passo 1 do fluxo) — feita em 2026-08-01, contra `main` @ `de3ced2`

Sete achados. Os quatro primeiros **mudam o plano**; os três últimos confirmam-no.

**1. O CI não consegue subir o agendador — nenhum deploy nosso sobe serviço novo.**
`.github/workflows/deploy.yml` termina em `docker service update --image … crm_crm`, e
**não** em `docker stack deploy`. Serviço acrescentado ao `docker-stack.yml` fica no
arquivo e nunca nasce na VPS. Some com ele a leitura de que "o commit do cron liga o
cron": o commit **prepara**, e alguém roda **um comando na VPS**. Meu acesso por SSH é
deliberadamente somente-leitura (quatro programas de escopo fixo, `ops/vps/README.md`) —
não dá para fazer, e não é para dar.
→ **O commit do cron foi de 1º para 4º**, imediatamente antes do merge, para ser a última
coisa em vista e não uma pendência esquecida no meio. O motivo original de pô-lo em
primeiro (não repetir o `broadcasts.scheduled_at` morto) continua honrado: **o merge não
acontece sem ele**.

**2. A "aba AGENDADAS" não existe como aba em lugar nenhum.** `contact-sidebar.tsx` é uma
coluna rolável de **seções** — o "Histórico" da 912 é seção, não aba.

⚠️ **Corrigido pelo operador durante a execução (2026-08-01), e o achado acima estava
respondendo à pergunta errada.** A questão não era "aba ou seção", era **onde**. A resposta
dele: nem modal para agendar, nem lista na coluna da direita. O agendamento é um **campo**
que o relógio do compositor revela, e a lista é uma **faixa expansível logo acima do
compositor, dentro do fio** — "eu preciso entrar no lead e saber que ele tem mensagens
agendadas". O motivo é de uso, e é o mais forte de toda a fase: quem abre a conversa precisa
**esbarrar** no que já está marcado antes de escrever, senão escreve por cima e o cliente
recebe duas. Na ficha lateral a informação existia e ninguém tropeçava nela.

Consequências que só apareceram por causa dessa troca:

- **A ficha lateral não recebe nada.** As mudanças em `contact-sidebar`, `group-sidebar` e
  na página do inbox foram revertidas — a faixa é irmã do compositor, então o contador que
  liga os dois mora em `message-thread.tsx` e não sobe até a página.
- **Grupo continua coberto de graça**, sem a peça duplicada: a faixa está no fio, e o fio é
  o mesmo para conversa 1:1 e de grupo.
- **A faixa só lista o que ainda espera decisão** (`pending`, `sending`, `failed`) e some
  quando não há fila. Agendada já enviada sai dali de propósito: virou uma bolha no fio logo
  acima, e repeti-la numa faixa permanente seria a mesma mensagem contada duas vezes, para
  sempre. Com isso o histórico de agendadas passou a ser o próprio fio.
- ⚠️ **Hora escolhida tem de estar VISÍVEL.** Com ela preenchida o botão de enviar AGENDA em
  vez de mandar; escondida, o atendente digitaria uma resposta urgente e ela sairia amanhã.
  Daí a etiqueta âmbar ao lado do botão, e daí a limpeza na troca de conversa.
- ⚠️ **O campo cru não cabe na linha do compositor**, e a razão é medida: com a ficha do
  contato aberta a linha tem ~576px, e um `datetime-local` de 168px derrubava a caixa de
  mensagem de 312px para **136px** — menor que o próprio campo, na tela em que se escreve.
  Por isso ele virou um **seletor que abre ACIMA do botão** (`Popover side="top"`, porque o
  compositor mora no rodapé), com `date` + `time` separados.
- **Abrir já vem com "24 h" marcado** — amanhã, na hora de agora — e há cinco atalhos
  (24 h · 72 h · 7 · 15 · 30 dias). Não é só conveniência: abrindo em "hoje, agora" o
  estado inicial nasceria no PASSADO e o botão apareceria armado para recusar.

**3. O núcleo de envio não aceita "sai por este canal".** `sendMessageToConversation`
chama `resolveChannelForConversation` por dentro, que degrada em silêncio para o padrão.
Fixar o canal pinando a conversa (o que a rota `/api/whatsapp/send` faz com `channel_id`)
está **errado aqui**: mudaria o número de toda a conversa às 3h da manhã.
→ Dois parâmetros **opcionais** novos no núcleo, ambos aditivos (o padrão preserva o
comportamento atual): `channelId` (exige exatamente aquele canal, **falha fechado**) e
`pauseFlows` (a agendada passa `false`, P4.5).

**4. `messages.sender_id` saiu de 0 para 5** — a Fase 2 começou a carimbar autor. Isso
levanta uma pergunta que o plano não fazia: **a agendada leva a assinatura de quem
agendou?** Sim. A pessoa escreveu o texto; a hora é que foi adiada. O disparo passa
`senderUserId = quem agendou`, e a 923 prefixa o nome dela — coerente com a P4.11
("gravar e mostrar quem agendou").

**5–7. Confirmados, sem mudança:** `automation_pending_executions` segue em **0 linhas** e
`broadcasts.scheduled_at` em **0 preenchidas** (o argumento da P4.1 continua de pé);
`messages_status_check` aceita exatamente `sending|sent|delivered|read|failed`, sem
`scheduled` (tabela própria está certa); `conversations_id_account_key` e
`cb_channels_id_account_key` existem, então as **duas** FKs compostas saem de graça.

**Números conferidos na hora:** última migration aplicada e em disco = `924` → a nova é a
**925**. `pg_cron` e `pg_net` seguem disponíveis e **não instalados**.

### Decisões que esta fase fecha (não estavam no plano)

- **`channel_id` é NOT NULL.** Falhar fechado começa na porta de entrada: conta sem
  conexão em `cb_channels` não agenda, com recado claro, em vez de agendar contra o
  fallback `whatsapp_config` e descobrir isso de madrugada.
- **`autor_nome` gravado junto do `created_by`**, mesma lição da anotação (918): a autoria
  precisa sobreviver à saída do membro. `created_by` é `ON DELETE SET NULL` — `CASCADE`
  apagaria agendamentos de um cliente porque um funcionário saiu.
- **Sem retentativa automática, e sem retentativa a partir de `sending`.** Linha travada
  em `sending` significa que o processo morreu no meio: a mensagem **pode** ter saído. Só
  o operador decide, e a saída dele é apagar e reagendar. Retentar dali é a receita para
  o cliente receber a mesma coisa duas vezes.
- **UPDATE não existe para o navegador.** Criar, executar agora e retentar passam por
  rota (o servidor carimba autor e resolve canal); apagar vai direto sob RLS, que é o
  molde da anotação.
- **A lista mora na ficha da conversa, e só lá.** Não há tela global de agendadas na v1 —
  agendada em conversa que ninguém abre fica invisível até a hora. Limitação conhecida.

### Commits previstos (revisados)

| # | Commit | Conteúdo | Feito |
| --- | --- | --- | --- |
| 1 | `feat(agendadas): schema da mensagem agendada` | migration **925** + RLS + REVOKE + tipos | `5164f31` |
| 2 | `feat(agendadas): worker de disparo` | rota de cron + claim em dois passos + canal fixo com falha fechada + `pauseFlows` | `7738fc2` |
| 3 | `feat(agendadas): agendar pelo compositor` | ~~diálogo, seção nas duas fichas~~ (ver o achado 2 acima), Executar/Apagar, i18n | `8d12e4a` |
| 4 | `chore(deploy): agendador que bate na rota` | serviço no `docker-stack.yml` + `docs/DEPLOY-VPS.md` — ⚠️ **exige um comando do operador na VPS** | `1a732ff` |
| 5 | `fix(agendadas): a UI que o operador pediu` | sem modal, faixa no fio, campo revelado pelo relógio | `953977e` |
| 6 | `fix(agendadas): achados das revisões + atalhos de prazo` | migration **926** + 11 correções | — |

### O que as três revisões acharam (passos 4 e 5 do fluxo)

Duas passadas frias (uma de bugs, uma de segurança/RLS) e uma morna. O que
sobreviveu à verificação, e o que foi feito:

| Achado | Gravidade | Correção |
| --- | --- | --- |
| `failed` mistura "não saiu" com "saiu e não foi gravado", e "Tentar de novo" reenvia os dois | **alta** | migration **926**: `entrega_incerta`. `db_error` e tempo esgotado da Evolution marcam a coluna; `podeDispararAgora` e `dispararUma` recusam |
| Enter duas vezes grava DUAS agendadas do mesmo texto | **alta** | trava de reentrância por `ref` — estado não fecha a janela de dois Enter no mesmo tique |
| A hora escolhida sobrevive à troca de conversa | **alta** | `limparAgendamento()` no efeito de troca, junto com a pendente |
| Grupo resolvia para o canal PADRÃO (achado meu, antes das revisões) | **alta** | lê `cb_groups.channel_id`; grupo sem canal conhecido não agenda |
| Resposta atrasada de outra conversa se pinta na ficha errada | média | contador de geração — `vivoRef` não cobre troca de conversa |
| Apagar conexão engolia agendada criada na janela da corrida | média | `.in('status', ['sent','failed'])` — o RESTRICT passa a expor a corrida |
| "Cancelar" prometia "a mensagem não vai sair" mesmo em `sending` | média | texto próprio para o caso incerto + conferência do resultado do DELETE |
| Canal não aparecia no card (P4.3 pedia) | média | rótulo do canal, só em conta com 2+ números |
| Citação continuava na tela depois de agendar | média | `onClearReply()` — a agendada não leva citação na v1 |
| Sem teto para `scheduled_for` (ano digitado errado trava a conexão) | baixa | 365 dias |
| Erro cru do Postgres na tela de todo membro | baixa | texto próprio para `db_error` |
| `docker stack deploy` reseta a imagem do `crm_crm` para `:latest` | baixa | `export CRM_IMAGE` no doc, com o porquê |

**Achado registrado e NÃO corrigido:** a FK `RESTRICT` do canal quebraria o
CASCADE vindo de `accounts` — apagar uma conta estouraria 23503, porque o
gatilho de `cb_channels` (901) ordena antes do de `cb_scheduled_messages`
(925). **Não há caminho de exclusão de conta no aplicativo**, então é latente;
trocar para `NO ACTION` daria a mesma proteção sem travar a cascata, e fica
para quando esse caminho existir.

### ✅ O que estava aberto no merge, e como fechou (2026-08-02)

- ~~**O agendador não existe em produção.**~~ **Resolvido.** O serviço `crm_agendador`
  subiu no Swarm pela seção 6 de `docs/DEPLOY-VPS.md`. Prova: o batimento saiu de `epoch`
  ("nunca rodou") para a hora corrente, e o aviso âmbar sumiu do cabeçalho sozinho.
- ~~**`AUTOMATION_CRON_SECRET` não foi conferido.**~~ **Resolvido pelo mesmo fato** — se o
  segredo não batesse, a rota devolveria 401 e o batimento não teria andado.
- ✅ **Disparo real de ponta a ponta, conferido.** Uma agendada do operador para 23:45 saiu
  às **23:48:28**, status `sent`, sem erro — dentro do ciclo de 15 min prometido na tela.
- ⚠️ **Conversa de grupo continua NÃO exercitada:** `groups_enabled` segue desligado e há 0
  conversas de grupo. Vale para a F4 **e** para a F2 fatia B. O caminho existe nos dois
  casos (o fio é o mesmo para 1:1 e grupo; a busca olha `messages.conversation_id`, que
  grupo também tem), mas não foi visto rodando.

---

## Fase 5 — F2 fatia B: busca no corpo das mensagens

**Escopo entregue:** achar conversa pelo texto de **qualquer** mensagem do histórico, e não
só da última. Migration `929_cb_busca_em_mensagens` (índice de trigrama + RPC) mais a
ligação com a caixa de busca que já existe.

### ⚠️ Revisão prévia (passo 1 do fluxo) — feita em 2026-08-02, contra `main` @ `fd4ba4c`

**O achado que muda o desenho: a "RPC única para o painel inteiro" foi CORTADA.** O plano
mandava mover *todos* os filtros da Fase 3 para o servidor, com paginação. Medindo contra o
código que a Fase 3 deixou no ar, isso deixou de ser a coisa certa a fazer:

| O que o plano supunha | O que está medido (2026-08-02) |
| --- | --- |
| A busca no corpo exige mover o painel para o servidor | Não exige. O painel filtra uma lista **carregada inteira**; a busca no corpo só precisa devolver o **conjunto completo** de conversas que casam, e o cruzamento acontece em JS sobre o mesmo universo |
| Cliente + servidor no mesmo painel produz resultado inconsistente | Produz **quando o cliente só tem uma página**. Não há página: `conversation-list.tsx` carrega tudo, sem `limit`. Os dois lados enxergam as mesmas 64 conversas |
| Paginação nasce junto | Paginação é necessidade **futura e independente** desta feature — a lista já carrega tudo desde antes da Fase 3, com ou sem busca |
| O custo é reorganizar consultas | O custo real é **reescrever a camada de dados do inbox**: as ~600 linhas de realtime de `inbox/page.tsx` presumem "tenho a lista toda". Com filtro no servidor, todo evento de realtime passa a exigir uma pergunta nova ao banco ("esta conversa ainda casa? em que página ela entra?") |

→ **Decisão: a Fase 5 é ADITIVA.** A busca no corpo entra ao lado do que existe, o painel
continua no cliente, e não há paginação. Reverte a metade "RPC" da **P2.2** e adia a
**P2.10** — as duas eram respostas do operador, e ficam registradas aqui como revertidas
por medição, não por conveniência. O que sobrevive da P2.2 é o essencial: **nada de meio a
meio** — a busca no corpo devolve o conjunto COMPLETO, nunca uma página.

⚠️ **Consequência a vigiar:** o dia em que a lista precisar paginar (milhares de conversas),
esta decisão precisa ser revista **junto** com o realtime, não isoladamente. Hoje são 64
conversas e 122 no pior caso (ligando os 58 grupos).

### Ground truth desta fase (medido em 2026-08-02, produção)

| Métrica | Valor | Consequência |
| --- | --- | --- |
| Mensagens | **963** | |
| …com texto e não apagadas | **773** | é o que o índice cobre |
| Texto somado | **38 KB** | o índice é irrelevante para desempenho hoje; existe pelo crescimento (~150 msg/dia) |
| Mensagens apagadas | 12 (7 ainda com texto) | ficam **fora** da busca (P2.7) |
| Mensagens editadas | **0** | `text_before_edit` fica fora pelo mesmo motivo |
| Maiores que 240 caracteres | 17 | por isso o trecho é uma **janela ao redor do termo**, não o começo do texto |
| Conversas com alguma mensagem de texto | 57 de 64 | |
| `statement_timeout` de `authenticated` | **8s** | confirmado |
| `pg_trgm` / `unaccent` | disponíveis, **não instalados** | a 929 instala as duas em `extensions` |

### Decisão de arquitetura

**RPC `cb_buscar_conversas_por_texto(p_termo)`**, `SECURITY INVOKER`, uma linha por
CONVERSA (`DISTINCT ON`), devolvendo também o **trecho** que casou e **quantas** mensagens
casaram.

⚠️ **Por que RPC e não consulta direta:** `select conversation_id from messages where
content_text ilike …` devolve uma linha por MENSAGEM, e o PostgREST **corta em 1000 linhas
sem avisar** — um termo comum devolveria busca incompleta com cara de completa. É o mesmo
motivo que fez a 025 do upstream virar RPC. O `DISTINCT ON` colapsa no banco.

⚠️ **Trigrama, não `tsvector` — e a razão é coerência, não desempenho.** A mesma caixa já
busca nome e telefone por PEDAÇO (`includes` em JS). Com `tsvector`, o corpo passaria a
casar por palavra inteira com radicalização: digitar "advog" acharia o contato "Advogados"
e **não** acharia a mensagem "advogado", no mesmo campo, sem nada na tela explicando qual
regra está valendo.

### Migration `0929_cb_busca_em_mensagens.sql` ✅ aplicada e conferida

- `pg_trgm` e `unaccent` em `extensions` (onde `pgcrypto` e `uuid-ossp` já moram).
- `cb_texto_para_busca(text)` — `IMMUTABLE`, minúsculas + sem acento. **Uma função para as
  duas pontas**: índice e consulta. Expressões diferentes nas duas pontas desligariam o
  índice em silêncio (resultado certo, só lento).
- Índice GIN de trigrama, parcial em `deleted_at IS NULL AND content_text IS NOT NULL`.
  288 kB. **Conferido em uso:** `Bitmap Index Scan on messages_busca_trgm_idx`.
- Par REVOKE completo + `has_function_privilege`.

⚠️ **Defeito pego antes de aplicar, e vale para toda função `SECURITY INVOKER` nova:** o
Postgres checa o privilégio de **tudo que roda dentro** como o usuário que chamou. Fechar a
função auxiliar `cb_texto_para_busca` derrubaria a busca inteira para todo mundo logado —
e o bloco de conferência, que roda como dono, **passaria verde**. Por isso a 929 tem um
segundo bloco que faz `SET LOCAL ROLE authenticated` antes de testar.

### Armadilhas específicas

- **Piso de 3 caracteres, e ele mora no BANCO.** Abaixo disso o trigrama não indexa e o
  resultado seria "quase tudo". Como a caixa continua achando por nome/telefone com 1 e 2
  caracteres, a tela **precisa dizer** que a parte do corpo só começa no terceiro — senão a
  diferença é invisível e parece defeito.
- **`%` e `_` digitados são texto, não curinga.** Sem escapar, digitar `%` "acharia" a conta
  inteira. Conferido: devolve zero.
- **A assinatura (F1) está dentro de `content_text`**, então o nome do membro vira termo de
  busca — desejável ("achar tudo que a Dra. Ana mandou"), mas precisa ser dito na tela.
- **A prévia da linha mente durante a busca.** A lista mostra a ÚLTIMA mensagem; se a
  conversa casou por uma mensagem de três meses atrás, a prévia não contém o termo e o
  operador lê aquilo como defeito. Por isso a RPC devolve o **trecho**, e a linha o mostra
  no lugar da prévia enquanto a busca estiver ativa.
- **Anotação interna (F3) NÃO entra na busca.** `cb_conversation_notes` é outra tabela e o
  escopo desta fase é o corpo das mensagens. Fica registrado como pendência consciente, não
  como esquecimento.

### Commits

| # | Commit | Conteúdo |
| --- | --- | --- |
| 1 | `feat(busca): indice e RPC…` ✅ `807af40` | migration 929 + a revisão prévia acima |
| 2 | `feat(inbox): a busca acha pelo texto…` ✅ `aee8b82` | migration 930, hook, funções puras, ligação na lista, i18n, 18 testes |
| 3 | `fix(busca): achados da revisão` | o que a releitura achou (abaixo) |

### O que a verificação e a releitura acharam

**Conferido rodando, não só lido** (dev local contra a base de produção):

| O que | Resultado |
| --- | --- |
| Índice de fato usado | `Bitmap Index Scan on messages_busca_trgm_idx` |
| Conversa achada SÓ pelo corpo | 64 → 1, com o trecho certo e "3 msgs" |
| Acento nos dois sentidos | "solucao" e "solução" devolvem o mesmo 1 |
| Piso de 3 letras | "do" mantém os 23 achados por nome e mostra o aviso |
| `%` e `_` digitados | zero resultados — são texto, não curinga |
| Limpar a caixa | volta aos 64 |
| **RLS** | quem não é membro recebe **0** onde o dono recebe 5 |
| **Falha da RPC** | `fetch` derrubado só para a busca: aviso vermelho, lista cai para nome/telefone, e recupera sozinha |
| Console | sem erro |

**Achados corrigidos:**

1. ⚠️ **`SECURITY INVOKER` teria derrubado a busca para todo mundo.** Pego antes de
   aplicar — ver a nota na 929. Vale para qualquer função nova nesse modo.
2. **O trecho começava no meio de uma palavra** (`az só um ajuste…`, onde "az" é o fim de
   "Faz"). Texto truncado sem marca se lê como texto corrompido. → migration **930**.
3. **Comentário no lugar errado no hook**, descrevendo o descarte por geração ao lado do
   `setTimeout`.

**Decisões conscientes, não esquecimentos:**

- **A janela do trecho fica velha por ~350 ms** enquanto a próxima resposta não chega
  (digitando "contrato" → "contratos"). Limpar a cada tecla faria as linhas piscarem para
  fora e para dentro a cada letra — muito pior de usar. O aviso "buscando" cobre o vão.
- ✅ **A exigência do plano "o nome do membro vira termo de busca, e isso precisa ser dito
  na tela" foi cumprida pelo TRECHO, não por um aviso.** A assinatura **está ligada** numa
  das duas contas e **28 mensagens** já carregam o prefixo `*Nome:*`; buscar "leonardo"
  devolve 14 conversas, das quais 5 casam só pela assinatura. Como cada linha mostra o
  pedaço que casou, o operador vê a diferença entre "o cliente escreveu o nome" e "foi a
  assinatura" sem ler aviso nenhum — e aviso genérico ninguém lê.
- **Sem tempo-limite no cliente.** Consulta pendurada deixaria "buscando" na tela para
  sempre; a `statement_timeout` de `authenticated` (8s) já é o teto real.

**O que NÃO foi exercitado:**

- **Conversa de grupo.** `groups_enabled` segue desligado e há 0 conversas de grupo. A
  mecânica não distingue (a RPC olha `messages.conversation_id`, que grupo também tem),
  mas não foi visto rodando.
- **Volume.** 963 mensagens e 38 KB de texto. O índice existe e é usado, mas nada aqui foi
  medido sob carga.
- **Normalização que muda o comprimento.** O recorte do trecho usa posição sobre o texto
  normalizado. Em português `unaccent` é 1:1 e há teste disso; num caractere exótico
  (`Æ` → `AE`) a janela sairia deslocada. É cosmético — nunca devolve dado errado.

---

## O que ficou de fora, e por quê

Nenhuma das 4 features ficou pendente. O que segue foi **cortado ou adiado de propósito**,
com a decisão registrada na fase que o cortou. Está aqui junto para que ninguém precise
reler o documento inteiro para descobrir o que o sistema **não** faz.

| O que não faz | Decidido em | Por quê |
| --- | --- | --- |
| ~~**Saltar para a mensagem** que casou na busca~~ | P2.1 | ✅ **Deixou de valer em 2026-08-03.** Era "outra feature", e virou a Fase A de `docs/plano-3-features-inbox.md` — o fio abre parado na mensagem, com ↑/↓ para percorrer os achados |
| **Paginação** da lista de conversas | Fase 5 | A lista carrega tudo (64 hoje, 122 ligando grupos). Vira necessidade real com milhares — e aí precisa ser revista **junto** com o realtime, não sozinha |
| **Painel de filtros no servidor** (RPC única) | Fase 5 | Exigiria reescrever a camada de dados do inbox sem mudar nada na tela. Medição na revisão prévia da Fase 5 |
| Busca em mensagem **apagada** e no texto **antes da edição** | P2.7 | Achar por texto retratado é decisão jurídica, não default acidental |
| Busca nas **anotações internas** (F3) | Fase 5 | Outra tabela; o escopo era o corpo das mensagens. Pendência consciente |
| **Agendar mídia** | P4.6 | Só texto: mídia dobra a superfície sem dobrar o valor |
| Agendada com **citação** de mensagem | Fase 4 | A citação some ao agendar, de propósito |
| **Tela global** de agendadas | Fase 4 | A lista mora na ficha da conversa, e só lá |
| "Não lido" **por pessoa** | P2.9 | `unread_count` é da conta. Por pessoa seria mudança de schema, não de tela |
| Anotar contato **sem conversa** | P3.10 | Atinge 1 contato dos 65. A saída seria a ficha criar a conversa sob demanda |
| **Departamento** como filtro | Fase 3 | Não existe no sistema; era exemplo genérico |

### Pontas soltas fora do plano

- **O agendador não é criado pelo CI.** `crm_agendador` foi criado à mão no Swarm; o
  workflow só faz `docker service update`, que não cria serviço. Um `docker stack rm`
  derruba os dois.
- **"Está tudo bem?" só se responde por ausência.** O indicador de saúde do agendador só
  aparece quando há problema. Não há onde conferir, sob demanda, que ele está vivo.
- **Nunca exercitado:** conversa de grupo (`groups_enabled` desligado, 0 conversas) e
  volume (963 mensagens, 64 conversas).

---

## Fase 6 — Revisão final ✅ (2026-08-03)

Diff acumulado revisado: `efdfbdf..main` — **81 arquivos, +11.474 / −571**.

⚠️ **Método, dito em voz alta:** as passadas foram feitas **pela própria sessão**, não por
revisores independentes como o fluxo prevê. O foco escolhido foi o que passada isolada
**não pode** achar: as **costuras entre as fases**. Cada fase já teve revisão fria e morna
própria; o que sobra para o conjunto é o que só existe no encontro delas.

### Costuras conferidas

| Costura | Veredito |
| --- | --- |
| **F1 assinatura × F4 agendada** — quem assina uma mensagem que sai sozinha às 3h? | ✅ `senderUserId: linha.created_by`; se a pessoa saiu da conta, cai no nome do escritório (P1.5b). Já estava pensado |
| **F1 × F4, teto de caracteres** | ⚠️ **Folga não declarada.** Agendada aceita 4000 caracteres e o teto do WhatsApp é 4096; a assinatura entra só na hora do envio. Estoura com nome > ~90 caracteres. Maior nome real hoje: **24**. Registrado, não consertado — consertar exigiria validar no agendamento um dado que só existe no envio |
| **F1 × F2B busca** | ✅ Resolvido pelo trecho, não por aviso (ver Fase 5) |
| **F3 anotação × F2B busca** | ✅ Fora do escopo, e registrado como tal |
| **F3 × prévia/lista** | ✅ Anotação não mexe na lista (P3.8) |
| **F2A filtros × F2B busca** | ✅ OU só entre as metades da busca; testado |
| **F4 × exclusão de canal** | ✅ FK RESTRICT + guarda no DELETE |
| **Grupo × motores** | ✅ O teste estrutural que lê o próprio fonte continua lá |
| **Realtime** | ✅ `cb_channels` e `cb_conversation_notes` na publication (P3.9); favoritas fora de propósito — daí o `resyncToken` |
| **Índice novo × webhook** | ✅ GIN com `fastupdate`; 38 KB indexados. Sem efeito mensurável na entrada |

### ⚠️ O achado da passada: `anon` tinha acesso a quatro tabelas nossas

Invisível fase a fase, óbvio olhando as oito tabelas `cb_*` lado a lado:

| Tabela | anon tinha | Fase |
| --- | --- | --- |
| `cb_channels` | SELECT INSERT UPDATE DELETE | 901 |
| `cb_groups` | SELECT INSERT UPDATE DELETE | 906 |
| `cb_message_media_ref` | SELECT INSERT UPDATE DELETE | 906 |
| `cb_lead_events` | SELECT | 912 |

As quatro tabelas das fases novas (918, 924, 925, 927) já revogavam.

**Não era vazamento** — medido com `SET ROLE anon`: 0 linhas em todas, porque toda política
passa por `is_account_member(account_id)` e `cb_message_media_ref` nem política tem. Era
**uma** barreira onde as novas têm duas, na tabela que guarda a configuração dos números
de WhatsApp do escritório. → migration **931**, conferida nas duas metades (o `anon`
perdeu; `authenticated` e `service_role` não perderam) e com a produção respondendo 64
conversas depois.

### Testes

- Suíte completa: **1190 testes, 102 arquivos, verdes**. `typecheck` e `lint` limpos.
- `get_advisors(security)`: **nenhuma função das 4 fases aparece**. Os avisos são todos do
  upstream (`is_account_member`, `peek_invitation`, `redeem_invitation`, …) e o de senha
  vazada do Auth. Pré-existentes, fora do escopo destas fases.
- ⚠️ **Conversa de grupo continua NÃO exercitada.** Ligar `groups_enabled` despeja 58
  grupos no inbox de produção — é decisão do operador, não da revisão.

### O que esta revisão NÃO fez

- Não releu linha a linha as 11.474 linhas do diff. Focou nas costuras, porque cada fase
  já teve suas duas passadas.
- Não teve revisor independente. Se o operador quiser a passada fria de verdade, ela ainda
  cabe — e o diff está congelado em `efdfbdf..main`.

---

## Anexo A — Mecanismos a reusar (não reconstruir)

| Mecanismo | Onde | Para |
| --- | --- | --- |
| `intercalar()` + `ItemDaLinhaDoTempo<M>` + `groupTimelineByDate` | `src/lib/lead-events/describe.ts:129`, `message-thread.tsx:1133` | **F3** — é literalmente a mecânica pedida |
| Faixa de `content_type='system'` fora do `MessageActions` | `message-thread.tsx:1455`, `cb-groups/system-events.ts:155` | **F3** — molde visual do balão |
| `parseWhatsAppFormat` / `stripWhatsAppFormat` | `src/lib/inbox/whatsapp-format.ts` | **F1** — negrito já funciona |
| `resolveEngineChannel*`, `evolutionTransportFor` | `src/lib/cb-channels/engine-send.ts` | **F4** — "por qual número isto sai" |
| RPC com join + dedup + contagem janelada | `0025_filter_contacts_by_tags.sql` | **F2 fatia B** — molde |
| `matchesContactFilters`, `matchesTypeFilter`, `CONVERSATION_SELECT` | `src/lib/inbox/conversations.ts` | **F2 fatia A** — estender, são nossos |
| Auth de cron + claim em dois passos | `src/app/api/automations/cron/route.ts:18` | **F4** — só o código; o agendador não existe |
| Índice único `(id, account_id)` → FK composta | migration `910` | **F3 e F4** — posse de graça |
| `memberLabel` (`full_name` → email → id) | `src/lib/account/members.ts:23` | **F3** menção, **F1** fallback |
| Polling com backoff + "aba oculta não pede nada" | `src/hooks/use-channel-health.ts` | **F4** — aba AGENDADAS |
| `barrarPorPapel` + `GatedButton` | `src/lib/auth/barrar-por-papel.ts` | **F3** e **F4** — permissão |
| `atualizarPreviaDaConversa` | `src/lib/inbox/conversation-preview.ts:26` | ponto único da prévia |
| Par REVOKE completo + `has_function_privilege` | migrations `913` e `915` | **F2 fatia B** |

---

## Anexo B — Perguntas de produto

🚧 = bloqueia a Fase 0. **➡️** = minha recomendação. Registrar a resposta na coluna própria.

### F1 — Assinatura

| # | Pergunta | ➡️ Recomendação | Resposta |
| --- | --- | --- | --- |
| 🚧 **P1.1** | A conta vai ter mais de um membro, e em que prazo? | Se não entrar gente em semanas, **adiar a F1 inteira** — assinatura por membro com um membro só é decoração | ✅ **Sim, imediatamente** — F1 sobe para a Fase 2 |
| 🚧 **P1.2** | O prefixo é **gravado** em `content_text` (aparece no histórico, prévia e busca) ou aplicado **só no texto que vai ao transporte** (banco limpo, mas o CRM não mostra o que o cliente recebeu)? | **Gravar** — CRM jurídico precisa mostrar exatamente o que o cliente recebeu; "só no wire" cria duas verdades sobre a mesma mensagem | ✅ Gravar no banco |
| 🚧 **P1.3** | Ao **editar** mensagem assinada: reassinar automaticamente, deixar o texto cru, ou proibir editar? | Esconder o prefixo do campo e reaplicar no servidor — deixar cru convida a apagar o próprio nome | ✅ Esconder e reaplicar no servidor |
| P1.4 | Mensagem para **grupo** leva assinatura? (vai de graça; não assinar exige guarda) | **Não** — o WhatsApp já identifica o remetente no grupo | ⚠️ **Sim, assina em grupo** (contraria a recomendação) |
| P1.5 | Automação, fluxo e IA (`sender_type='bot'`) assinam? | **Nada automático assina** — assinar robô com nome de gente é o pior resultado numa conversa jurídica | ⚠️ **Assina, com interruptor** — e identificação interna de bot/IA **sempre** |
| **P1.5b** | Com o interruptor ligado, que nome o cliente vê numa mensagem automática? | — | ✅ **Nome do escritório, fixo** — nunca nome de pessoa |
| P1.6 | Nome inteiro, primeiro nome, ou apelido configurável? E o fallback quando `full_name` for vazio? | Primeiro nome, `coalesce(nullif(full_name,''), email)` — e recusar nome com `*` ou espaço inicial | ⚠️ **REVERTIDO em 2026-08-01: nome COMPLETO** (fallback e saneamento mantidos) |
| P1.7 | Assinatura vai na **legenda de mídia**? | Sim em imagem/vídeo/documento, validando o teto de 1024 **depois** de somar o prefixo; áudio não tem legenda | ✅ Legenda sim, áudio não |
| P1.8 | O interruptor é por conta, canal ou membro? Nasce ligado? | Por conta, nascendo **desligado** — mudança visível para o cliente não deve acontecer sem alguém pedir | ✅ Por conta, desligado |

### F2 — Filtros

| # | Pergunta | ➡️ Recomendação | Resposta |
| --- | --- | --- | --- |
| 🚧 **P2.1** | A busca no corpo devolve **conversas** ou **mensagens** (com salto para o trecho)? | **Conversas** na v1 — "saltar para o trecho" exige âncora e scroll no fio, é outra feature | ✅ Conversas |
| 🚧 **P2.2** | O painel filtra no **cliente** ou no **servidor**? | Cliente na fatia A, **tudo** na RPC na fatia B — nunca meio a meio | ✅ Cliente na A, RPC na B |
| 🚧 **P2.3** | "Arquivada" é conceito novo ou o `status='closed'` existente? "Favorita" é por conversa ou por membro? | Arquivada = coluna nova (o CHECK de status só admite um valor por linha); favorita **por membro** | ⚠️ **Arquivada = `closed`** (contraria); favorita **por membro** (confirma) |
| P2.4 | "Responsável" é `conversations.assigned_agent_id` ou `deals.assigned_to`? | `assigned_agent_id` — o filtro está no inbox, a pergunta é quem atende a conversa | ✅ `assigned_agent_id` |
| P2.5 | "Etapa" é a do card do **contato** ou do card nascido **daquela conversa**? | Adiar para a fatia B; quando chegar, usar o card do contato. Hoje não discrimina: 55/55 na mesma etapa | ✅ **Etapa do contato como um todo** |
| P2.6 | Grupo entra ou sai de cada filtro? | Não casa com etiqueta/empresa/etapa (perguntas sobre pessoa); casa com favorita/arquivada/não-lida | ⚠️ **Grupo tem filtro próprio** — `matchesTypeFilter` já existe |
| P2.7 | A busca casa em mensagem **apagada** e no texto **antes da edição**? | Só o texto vigente na v1 — achar por texto retratado é decisão jurídica, não default acidental | ✅ Só o texto vigente |
| P2.8 | Buscar sem acento acha com acento ("Joao" → "João")? | **Sim** — expectativa básica em português; `pg_trgm` + `unaccent` na mesma migration do índice | ✅ Sim — `pg_trgm` + `unaccent` |
| P2.9 | "Não lidas" vira toggle independente? | Sim, mas **tratar como reescrita** de um controle que o operador já usa | ✅ Toggle, tratado como reescrita |
| P2.10 | A lista ganha paginação? | Continuar carregando tudo na fatia A (64 cabem); paginação junto com a RPC. ⚠️ ligar grupos soma 58 | ✅ Tudo na A, paginação na B |
| P2.11 | Construir "tags qualquer/todas" com **0 etiquetas** e "etapa" com 55/55 na mesma etapa? | **Não** — mandar as duas para a fatia B; construir agora é abstração para futuro hipotético | ⚠️ **Construir as duas agora**, na Fase 3 |

### F3 — Anotações

| # | Pergunta | ➡️ Recomendação | Resposta |
| --- | --- | --- | --- |
| 🚧 **P3.1** | Nota como linha de `messages` (realtime e ordenação de graça, mas polui prévia/painel/API) ou **tabela própria** intercalada? | **Tabela própria** — `messages` cobra pedágio em 4 lugares e exige alargar 2 CHECKs do upstream; e o mecanismo de intercalar já existe | ✅ Tabela própria |
| 🚧 **P3.2** | Nota em conversa de **grupo** precisa existir? | **Sim** → chavear por `conversation_id`. 58 grupos esperam o interruptor | ✅ Sim → `conversation_id` |
| P3.3 | As 2 notas de `contact_notes` sobem retroativamente para o fio? A nota do fio aparece no painel lateral? | Nota do fio aparece nas três superfícies; notas antigas **não** sobem — foram escritas em contexto de ficha | ✅ Três superfícies; antigas não sobem |
| P3.4 | A @menção **notifica**? | Alargar `notifications_type_check` e notificar pelo sino, escrevendo **por código** (a menção é intenção, não efeito derivado) | ✅ **Sim, notifica** — alarga o CHECK |
| P3.5 | Menção por **e-mail** (como pedido) ou por **nome**? | Por nome, via `memberLabel` — agents e viewers **não enxergam o e-mail** dos colegas | ✅ **Por nome**, via `memberLabel` |
| P3.6 | Quem apaga a nota? Exclusão física ou marca? | **Só o autor**, física, com confirmação — a RLS atual deixaria qualquer agent apagar a de qualquer um, sem trilha | ✅ Só o autor, física, com confirmação |
| P3.7 | A nota é editável? | Só criar e apagar — o balão do print tem lixeira, não lápis | ✅ Só criar e apagar |
| P3.8 | A nota sobe a conversa no topo / muda a prévia / marca não lida? | **Não** — mesma decisão que o aviso de sistema de grupo já tomou | ✅ Não mexe na lista |
| P3.9 | Precisa aparecer em tempo real para o colega com a conversa aberta? | **Sim** — adicionar à publication; o argumento da trilha se inverte aqui | ✅ Sim — entra na publication |

### F4 — Agendamento

| # | Pergunta | ➡️ Recomendação | Resposta |
| --- | --- | --- | --- |
| 🚧 **P4.1** | **Quem chama a rota de disparo?** Não existe agendador nenhum | Cron na VPS batendo no endpoint com `x-cron-secret` — a VPS já existe, o segredo já é padrão do projeto, sem jitter do GitHub Actions nem extensão no Postgres gerenciado | ✅ Cron na VPS com `x-cron-secret` |
| P4.2 | Que granularidade prometer? | Ciclo de 1 minuto e prometer "no minuto", escrito na tela | ⚠️ **REVISTO em 2026-08-02: 15 minutos.** O operador trocou para reduzir carga de servidor. A tela arredonda para a grade de 15 min e promete "sai em até 15 minutos". Ver `CICLO_MINUTOS` |
| P4.3 | Sai pelo número **escolhido** ou pelo que a conversa usar na hora? | **Fixar**, gravar `channel_id`, mostrar no card, e **falhar fechado** se o canal sumiu | ✅ Fixar + falhar fechado |
| P4.4 | E se o cliente responder antes da hora? | Sai assim mesmo na v1, mas **destacar na aba** as agendadas cujo contato escreveu depois | ✅ Sai, mas destaca na aba |
| P4.5 | O disparo **pausa** automações/fluxos como o envio manual? | **Não** — a pausa existe porque "tem gente aqui agora"; passar sinalizador em vez de herdar | ✅ Não pausa |
| P4.6 | Agendar mídia? | Só texto na v1 — mídia dobra a superfície sem dobrar o valor | ✅ Só texto na v1 |
| P4.7 | Grupo pode receber agendada? | **Sim** — agendada é ato de gente com hora marcada, não motor automático | ✅ Sim, grupo pode |
| P4.8 | Date picker novo ou inputs nativos? | **Nativos** — único precedente do projeto, e sem conflito de `package.json` com o upstream | ✅ Inputs nativos |
| P4.9 | O que a aba mostra quando o disparo **falha**? | Fica na aba com o motivo em texto claro + botão de tentar de novo **manual** — retry automático manda a mesma coisa três vezes às 3 da manhã | ✅ Fica com o motivo + retry manual |
| P4.10 | "Executar agora" passa pela janela de desfazer? "Excluir" pede confirmação? | Executar vai direto; Excluir confirma com o texto *"cancelar o envio agendado"* | ✅ Executar direto; Excluir confirma |
| P4.11 | Quem vê e cancela a agendada de outro membro? | Todo mundo vê e cancela (a mensagem sai em nome do escritório), mas **gravar e mostrar quem agendou** | ✅ Todos veem e cancelam; grava quem agendou |

---

## Anexo C — O que morreu do plano de 27/07

| Item | Por quê |
| --- | --- |
| "Fundação" como fase de código | A maior parte chegou de graça nos ~40 commits (fio intercalado, parser de negrito, `engine-send`). Sobrou decisão, não código |
| "A faixa 910–919 está livre" | `main` e o banco já vão até **917**. Próximo livre: **918** |
| F1 em primeiro *por dependência técnica* | A fundação que ela ia pagar chegou de graça. Foi para **última** na revalidação (sem público) e voltou para **segunda** em 01/08, quando a P1.1 respondeu que entra gente imediatamente |
| F3 "construir o merge no fio" | A 912 já entregou `intercalar()` inteiro, puro e testado |
| F3 — vazamento por webhooks e por contexto da IA | Não existem: não há trigger em `messages`, e o da IA some se a nota não usar `content_type='text'` |
| F4 "copiar o padrão do cron" | O padrão existe como código e **nunca como operação** — `automation_pending_executions` tem 0 linhas desde sempre |
| F2 "etapa do funil é o filtro mais difícil" | A 911 ("um funil por vez") resolveu a ambiguidade. Mas agora é **inútil**: 55/55 na mesma etapa |
| F2 "cortar etapa do funil por falta de dado" | Retirado — havia 0 negócios em 27/07, hoje há 55. Volta ao escopo na fatia B |
| F1 "a IA é caminho de envio próprio" | Deixou de ser: entra pelo `engineSendText` dos flows |

---

## Anexo D — Divergências encontradas no `CLAUDE.md`

Achados durante a revalidação, a corrigir no arquivo (regra do próprio `CLAUDE.md`:
"nota mentindo é pior que ausência de nota"):

- A seção da 908 afirma que a etapa de entrada é explícita via `default_stage_id`,
  "nunca `MIN(position)`". **Medido: os dois canais têm `default_stage_id` nulo** — e um
  deles também não tem `default_pipeline_id`. Como existem 55 negócios criados, ou o
  roteamento tem um caminho de fallback que a nota não descreve, ou os cards vieram por
  outra via. **Investigar antes da Fase 2** — a F2 filtra por etapa e herdaria o engano.
- A lista de migrations aplicadas está desatualizada (para em 915; o banco tem 917).
