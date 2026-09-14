# Plano — Calendly → automação "Reunião agendada" (vivo e checável)

> **O que é este arquivo.** Guia retomável da integração com o Calendly,
> pedida pelo operador em 2026-09-07: toda vez que alguém marcar um horário
> num evento do Calendly (inicialmente "Reunião com Advogado - Kommo"), o CRM
> acha o cliente pelo telefone, atualiza o nome, preenche "Data e Hora
> Reunião" e "Link Reunião", move o card para "Reunião Agendada" e avisa o
> número 83 98874-5316 pela conexão "Bancário - Comercial". **Ele é editado a
> cada fase** — quem pegar o plano depois sabe o que foi feito e onde parou.
>
> ⚠️ **Este documento envelhece.** Antes de decidir com base em algo aqui,
> confirme contra a realidade (grep, leitura do arquivo, query no banco).

- **Criado:** 2026-09-07 · **Medido contra:** `main` @ `bdb4d99`, produção
  `hxnhakmyxyhalbsktzwe` (queries de leitura em 07/09).
- **Fluxo:** executar → typecheck/lint/test (Node 22) / i18n-parity /
  i18n-chaves-usadas → preview em 1440×900 → revisar 2× → PR → migration
  aplicada em produção via conector ANTES do merge, com autorização do
  operador (convenção das 972–976).

---

## Estado

| Fase | Escopo | Estado | Migration | PR |
| --- | --- | --- | --- | --- |
| **1** | Integração (cartão em Integrações + webhook + log paginado), gatilho `calendly_booking`, passo `send_to_number`, variáveis `{{contact.*}}`/`{{conversation.link}}` | ✅ **feita** (2026-09-07) | `977_cb_calendly` **aplicada** (07/09, via conector, antes do merge) | [#128](https://github.com/leonardocabralb/CB-CRM/pull/128) |
| **2** | Depois do deploy: operador conecta o Calendly (token); a automação "Calendly → Reunião agendada" é criada (seção 3.5), o evento é escolhido no gatilho e ela é ATIVADA | ✅ **feita** (07/09): token conectado pelo operador, automação criada e fixada no evento por SQL, ATIVA; teste de ponta a ponta na seção 7 | — | [#129](https://github.com/leonardocabralb/CB-CRM/pull/129)–[#131](https://github.com/leonardocabralb/CB-CRM/pull/131) |
| **2b** | Achados do Codex, 2ª rodada: ramo que falha derruba a execução; "Aguardar" vira `em_espera` (não `disparado`); gatilho sem disparo fora da grade | ✅ **feita** (07/09) | `978_cb_calendly_em_espera` **aplicada** (07/09, via conector, antes do merge) | [#132](https://github.com/leonardocabralb/CB-CRM/pull/132) |

**Decisões travadas pelo pedido (07/09):**

- O fluxo é montado **com as ferramentas de automação do CRM** (gatilho +
  passos no mesmo editor das automações), não como módulo fechado. Cada
  passo do pedido vira um passo da automação, editável pelo operador.
- A integração mora em **Configurações → Integrações**, ao lado do Meta Ads,
  seguindo o mesmo padrão (token cifrado, tela nunca vê o token).
- O evento do Calendly é **configurável** (o pedido diz que "poderá ser
  mudado dentro das configurações"): é a config do gatilho, com "qualquer
  evento" como padrão.

**Decisões com recomendação (o plano segue com a recomendação como hipótese
até o operador dizer o contrário):**

| # | Decisão | Recomendação | Por quê |
| --- | --- | --- | --- |
| **D1** | De onde sai o **telefone** do cliente no Calendly | `text_reminder_number` (lembrete por SMS) se vier; senão a pergunta do formulário configurada no cartão ("Pergunta do telefone", ex.: `WhatsApp`); senão a primeira resposta que parece telefone (10–13 dígitos) | o payload não tem campo "telefone": ele existe só se o evento pede; a régua fica visível e ajustável no cartão |
| **D2** | ~~Agendamento cujo telefone **não está no CRM**~~ → **REVISTA em 08/09/2026** | **CRIAR** a ficha e a conversa (dono durável da conta), e disparar a automação | a versão antiga ("não criar") só funcionava por acidente: o OUTRO CRM respondia ao mesmo agendamento mandando um WhatsApp pelo celular pareado, e era ESSA mensagem que criava a ficha aqui — medido, 4,2 s e 4,5 s depois do nosso processamento, o que fez os dois primeiros agendamentos reais virarem `sem_contato`. O operador vai desligar aquela automação; sem criar a ficha, lead novo nenhum teria em quem a automação agir |
| **D3** | **Escopo** da assinatura do webhook no Calendly | `organization` (todos os eventos da organização), com queda para `user` quando o token não é de admin | o evento pode ser de outro advogado; o token de admin enxerga todos |
| **D4** | Onde fica a escolha do **evento** | na config do **gatilho** (select alimentado pela API do Calendly; vazio = qualquer evento) | permite mais de uma automação por evento no futuro sem mexer na integração |
| **D5** | ✅ **REVISTA em 14/09/2026: o nome do agendamento vira o nome da ficha e o título do negócio aberto, e fica FIXADO** (era "sobrescrito pela próxima mensagem do cliente; aceitar e avisar") | migration 999 (`contacts.nome_fixado_em`) + `fixarNomeDoAgendamento` antes do disparo + `.is('nome_fixado_em', null)` nos três caminhos que gravavam o nome do perfil | Decisão do operador, pelo motivo da identidade: o cliente fala muitas vezes pelo celular da EMPRESA, e quem agendou é a pessoa. Os caminhos que sobrescreviam: `inbound-store.ts` (Evolution), o webhook da Meta e o envio por telefone da API v1. Escrita MANUAL (painel, ficha, formulário) continua trocando nome fixado e também grava a marca, só quando o nome mudou. Detalhes em CLAUDE.md, seção do Calendly |
| **D6** | **Ordem** dos passos na automação criada | nome → campos → **aviso ao número** → mover card | um passo que falha ENCERRA a execução (`engine.ts`, `break` no catch), e `move_deal_stage` falha quando o contato não tem card aberto — o aviso do agendamento não pode depender disso |
| **D7** | Cancelamento no Calendly (`invitee.canceled`) | fora deste PR; a assinatura escuta só `invitee.created` | não foi pedido; reagendamento já chega como `invitee.created` novo (campos atualizados, aviso de novo) |

---

## 1. O pedido, traduzido para o que já existe

| Pedido | No CB CRM | O que falta |
| --- | --- | --- |
| "toda vez que houver um agendamento no calendly" | nada escuta o Calendly (`date_field_offset` só LÊ o campo de data que alguém preencheu) | webhook de entrada + gatilho `calendly_booking` |
| 1. achar conversa e card pelo telefone | `findExistingContact` (últimos 8 dígitos, tolerante a tronco); conversa única por contato (036); card = negócio ABERTO mais recente (`negocioAlvo`) | chamar a partir do webhook e entregar `contact_id`/`conversation_id` ao motor |
| 2. nome = nome do Calendly | passo `update_contact_field` com `field: 'name'` | valor `{{vars.agendamento_nome}}` |
| 3. campos "Data e Hora Reunião" (`datetime`) e "Link Reunião" (`text`) | `update_contact_field` com `custom:<id>`; datetime grava ISO UTC (`campo-data.ts`) | `{{vars.agendamento_inicio}}` e `{{vars.agendamento_link}}` |
| 4. mover para "Reunião Agendada" | passo `move_deal_stage` (RPC `cb_atualizar_negocio`) | só a etapa (`3ab137e6…`, funil Bancário - Comercial) |
| 5. avisar 83 98874-5316 pela "Bancário - Comercial" | **não existe**: `send_message` só fala com o contato do disparo | passo novo `send_to_number` (telefone + conexão + texto) |

---

## 2. O que foi medido antes de desenhar

### 2.1 Produção (07/09/2026)

| Medida | Valor | Consequência |
| --- | --- | --- |
| Etapa "Reunião Agendada" | só no funil **Bancário - Comercial** (`3ab137e6-1be6-439e-a88d-3b66ac59dee7`, posição 4) | o passo aponta para ela; contato com card em OUTRO funil é transferido pela RPC (deriva o funil da etapa) |
| Campos | `data_e_hora_reuniao` (`datetime`, `e40ad0f2…`) e `link_reuniao` (`text`, `a5d00f62…`) já existem, bloco Geral | nenhum campo novo |
| Conexão "Bancário - Comercial" | `f2f9820b-3cbe-4581-870b-92415fd547aa`, padrão da conta, Evolution, conectada | o aviso sai por ela |
| Contato 83 98874-5316 | **não existe** em `contacts` (nenhum telefone terminando em 88745316) | o passo cria contato + conversa na primeira vez, pelo mesmo caminho da API pública (`resolveConversationByPhone`) |
| Automações | 2 (webhook Atlas em `deal_stage_changed`; teste do plano 955) | nenhuma escuta o Calendly |
| `custom_fields.field_type` | CHECK `(text, datetime, select, number)`; valor é TEXT | datetime em ISO `…Z` |
| Conta | `a3af0191-…` (Leonardo, 2 membros) | 5 contas no banco: a rota do webhook identifica a conta por um token na URL |

### 2.2 Motor de automações (código)

- **Não há CHECK de `trigger_type`/`step_type` no banco** (936 confirma): tipo
  novo é união TS + `validate.ts` + builder + `trigger-meta.ts` +
  `descrever-passo.ts` (com teste cobrando chave i18n por passo).
- `interpolate` (engine.ts) conhece `{{message.text}}`, `{{vars.X}}` e
  `{{channel.id}}` — **`{{contact.name}}` não existe**. O webhook entrega os
  dados em `context.vars`, e o builder passa a listar as variáveis.
- `runAutomationsForTrigger({accountId, triggerType, contactId, context})`
  nunca lança; confere posse do contato; aplica `channelInScope`,
  `triggerMatches` e `stageInScope`.
- Passo que falha **encerra a execução** (D6).
- `engineSendText` (flows/meta-send.ts) manda como robô: persiste `sender_type='bot'`,
  não reabre conversa, não roteia para funil — é o caminho certo para o aviso.
- `resolveConversationByPhone` (whatsapp/resolve-conversation.ts) cria
  contato + conversa com o dono durável; já está na allowlist de
  `dono-duravel.test.ts`.

### 2.3 Calendly (API v2, medido na doc em 07/09)

- Auth por **Personal Access Token** (Integrations → API & Webhooks →
  Personal access tokens). Webhooks exigem **plano pago** (Standard+).
- `POST /webhook_subscriptions` `{url, events, organization, user?, scope, signing_key}`;
  `GET /webhook_subscriptions?organization=&scope=`; `DELETE /webhook_subscriptions/{uuid}`;
  `GET /users/me` (uri, current_organization, name, email, scheduling_url);
  `GET /event_types?organization=|user=` (uri, name, active, scheduling_url).
- Assinatura: header `Calendly-Webhook-Signature: t=<unix>,v1=<hex>`,
  HMAC-SHA256 da string `t + '.' + corpo cru` com a `signing_key` que NÓS
  informamos ao assinar. Tolerância recomendada: minutos.
- Entrega: timeout de 10s (conexão) / 15s (leitura); 3xx/4xx/5xx são
  retentados por 24h com backoff e depois a assinatura é **desativada** —
  daí responder 200 na hora e processar em `after()`.
- Payload `invitee.created`: `payload.name`, `email`, `text_reminder_number`
  (ou null), `questions_and_answers[{question, answer}]`, `timezone`,
  `scheduled_event.{uri, name, start_time, end_time, event_type,
  location{type, location, join_url?}}`, `cancel_url`, `reschedule_url`,
  `old_invitee` (reagendamento), `uri` do invitee (chave de idempotência).

---

## 3. Desenho

### 3.1 Migration `977_cb_calendly.sql`

- `cb_calendly_config` (uma linha por conta): `access_token` (PAT, cifrado),
  `signing_key` (cifrado), `webhook_token` (segredo de rota, único —
  identifica a conta na URL), `user_uri`, `organization_uri`, `user_name`,
  `user_email`, `scheduling_url`, `webhook_uri`, `webhook_scope`,
  `pergunta_telefone`, `status`, `last_event_at`, `last_error`, `created_by`,
  timestamps. **Fechada** para `authenticated` (sem policy, sem GRANT), como
  a `cb_meta_ads_config`; `anon` sem nada (931); `service_role` tudo.
- `cb_calendly_eventos`: o que chegou e o que aconteceu com cada agendamento
  (`evento`, `invitee_uri`, `event_type_uri/nome`, `nome`, `email`,
  `telefone`, `inicio`, `fim`, `link`, `perguntas`, `contact_id`,
  `resultado` ∈ {recebido, disparado, em_espera (978), sem_automacao,
  sem_contato, sem_telefone, ignorado, falhou}, `detalhe`). `UNIQUE (account_id, evento,
  invitee_uri)` = idempotência (o Calendly reenvia). Fechada como a config —
  a tela lê pela rota.
- Conferências válidas em banco VAZIO; teste `rls-das-tabelas-do-calendly.test.ts`
  lendo o `.sql` (o mesmo racional do teste do Meta Ads).

### 3.2 `src/lib/calendly/` (puros, com teste, salvo os marcados)

| Módulo | Faz |
| --- | --- |
| `telefone.ts` | `digitosDoTelefone` (Calendly manda "+55 96 99112-6767" ou o que o cliente digitou; 10–11 dígitos sem DDI ganham 55), `formatarTelefone` ("(96) 99112-6767" para BR, `+…` para o resto), `pareceTelefone` |
| `payload.ts` | `lerAgendamento(corpo, {perguntaTelefone})` → `Agendamento` normalizado (ou `null` para evento que não é `invitee.created`); D1 mora aqui |
| `assinatura.ts` | `verificarAssinatura(header, corpoCru, chave, agoraSeg)`, `gerarChaveDeAssinatura`, `gerarTokenDeWebhook` |
| `variaveis.ts` | `variaveisDoAgendamento(a)` → `vars` do contexto: `agendamento_nome`, `agendamento_email`, `agendamento_telefone`, `agendamento_evento`, `agendamento_data` (dd/mm/aaaa hh:mm em `America/Sao_Paulo`, montado por `formatToParts` — nunca `toLocaleString`, que muda de forma entre majors do Node), `agendamento_inicio` (ISO UTC, o que o campo `datetime` guarda), `agendamento_link`, `agendamento_local`, `agendamento_cancelar`, `agendamento_remarcar`, `agendamento_situacao` ("Novo agendamento" / "Reagendamento") |
| `cliente.ts` | API do Calendly com Bearer no cabeçalho, erros como CÓDIGO (`token_invalido`, `sem_permissao`, `limite`, `rede`, `calendly_error`), `semSegredo` limpando o token de qualquer mensagem (lição do Meta Ads) |
| `cartao.ts` | o estado do cartão a partir da config (sem segredos) e dos últimos eventos |
| `conexao.ts` (I/O) | conectar (valida em `/users/me`, assina o webhook org→user, grava cifrado), reassinar, desconectar |
| `processar.ts` (I/O) | do evento gravado ao `runAutomationsForTrigger`: acha o contato, a conversa, conta quem escuta, despacha, carimba o resultado |

### 3.3 Rotas (`src/app/api/cb/calendly/`)

| Rota | Papel | Faz |
| --- | --- | --- |
| `GET /api/cb/calendly` | admin | cartão + últimos 20 eventos (service role; nada de token) |
| `PUT /api/cb/calendly/config` | admin | `{access_token}` → valida, assina o webhook, grava |
| `PATCH /api/cb/calendly/config` | admin | `{pergunta_telefone}` |
| `DELETE /api/cb/calendly/config` | admin | apaga a assinatura no Calendly (melhor esforço) e a config; eventos ficam |
| `POST /api/cb/calendly/reassinar` | admin | recria a assinatura com o token guardado (a assinatura desativada pelo Calendly exige recriar) |
| `GET /api/cb/calendly/event-types` | admin | lista para o select do gatilho |
| `POST /api/cb/calendly/webhook/[token]` | **público** (assinado) | confere assinatura → grava o evento (idempotente) → **200** → processa em `after()` |

A URL do webhook sai de `NEXT_PUBLIC_SITE_URL` e é recusada quando não é
alcançável de fora (`ehUrlAlcancavel`, a guarda da Evolution) — um dev
local assinando `localhost` no Calendly da produção quebraria a entrega em
silêncio.

### 3.4 Motor

- `AutomationTriggerType` += `calendly_booking`; `CalendlyTriggerConfig
  {event_type_uri?, event_type_nome?}`; `AutomationContext.calendly_event_type?`;
  `triggerMatches`: config vazia = qualquer evento, senão igualdade de URI.
- `AutomationStepType` += `send_to_number`; `SendToNumberStepConfig
  {phone, contact_name?, text, channel_id?}`. Execução: valida o telefone,
  exige que a conexão escolhida seja DESTA conta e resolva de fato (falha
  fechada — nada de cair no padrão), acha/cria contato + conversa pelo
  telefone (`resolveConversationByPhone`; o nome só na criação), envia por
  `engineSendText` com `preferredChannelId`. Não roteia para funil, não
  reabre conversa (é o robô falando com a equipe).
- `validate.ts`, `descrever-passo.ts` (+ chave `resumo.send_to_number`),
  `trigger-meta.ts`, builder (opção de gatilho com select de evento;
  editor do passo com telefone, nome, conexão e texto; dica das variáveis).

### 3.5 A automação criada (Fase 1, inativa; o operador ativa na Fase 2)

"Calendly → Reunião agendada", gatilho `calendly_booking` (evento:
qualquer, até a conexão existir), passos nesta ordem (D6):

1. `update_contact_field` `name` = `{{vars.agendamento_nome}}`
2. `update_contact_field` `custom:e40ad0f2…` (Data e Hora Reunião) = `{{vars.agendamento_inicio}}`
3. `update_contact_field` `custom:a5d00f62…` (Link Reunião) = `{{vars.agendamento_link}}`
4. `send_to_number` telefone `5583988745316`, nome "Leonardo Cabral Baptista",
   conexão Bancário - Comercial, texto (formato do operador, 07/09, com
   negrito do WhatsApp):
   ```
   *Novo Agendamento:*
   *Nome:* {{vars.agendamento_nome}}
   *Data:* {{vars.agendamento_data}}
   *Telefone:* {{vars.agendamento_telefone}}
   *Origem:* {{contact.origem}}
   *Tamanho da Dívida:* {{contact.campo.tamanho_da_divida}}
   *Link CRM:* {{conversation.link}}
   ```
   Os `{{contact.*}}` e o `{{conversation.link}}` nasceram deste pedido: o
   motor só conhecia `{{vars.*}}`, `{{message.text}}` e `{{channel.id}}`.
   Agora todo passo de texto (mensagem, aviso, campo, legenda, webhook)
   aceita `contact.name|phone|email|company|link`,
   `contact.campo.<chave_do_campo>` e `conversation.link` — o contato é
   carregado uma vez por execução, e só quando o texto cita.
5. `move_deal_stage` → Reunião Agendada

---

## 4. Passos do operador (Fase 2)

1. No Calendly (plano pago): Integrations → API & Webhooks → gerar um
   Personal Access Token com a conta que ENXERGA o evento (admin da
   organização, de preferência).
2. Configurações → Integrações → Calendly → colar o token → Conectar. O CRM
   assina o webhook na hora e mostra o estado.
3. Se o formulário do evento pergunta o telefone com um rótulo específico
   ("WhatsApp"), escrever esse rótulo em "Pergunta do telefone".
4. Automações → "Calendly → Reunião agendada" → escolher o evento "Reunião
   com Advogado - Kommo" no gatilho → ativar.
5. Marcar um horário de teste com um telefone que exista no CRM e conferir:
   ficha renomeada, campos preenchidos, card em Reunião Agendada, aviso no
   83 98874-5316, e a linha no cartão da integração.

---

## 5. Fora deste PR

- `invitee.canceled` / no-show (D7).
- O log do cartão mostra os dados NORMALIZADOS de cada recebimento (nome,
  e-mail, telefone e origem, evento, horário, link, respostas do
  formulário, resultado, contato) — não o JSON cru do Calendly.
- Criar contato/card para telefone desconhecido (D2).
- ~~Fixar o nome vindo do Calendly contra o `pushName` do WhatsApp (D5).~~
  Feito em 14/09/2026 (migration 999).
- OAuth do Calendly (o token pessoal basta para um escritório).

---

## 6. Resultado medido — Fase 1 (2026-09-07, worktree em `main` @ `bdb4d99`)

- **Código:** `src/lib/calendly/` (`payload`, `assinatura`, `variaveis`,
  `cartao`, `cliente` puros; `conexao`, `processar` I/O) e
  `src/lib/contacts/telefone.ts`; migration `977_cb_calendly.sql` + teste
  estrutural de RLS; motor (`calendly_booking`, `send_to_number`,
  `destinatario.ts`); rotas `/api/cb/calendly/{,config,reassinar,
  event-types,webhook/[token]}`; `calendly-card.tsx` em Integrações;
  `calendly-trigger-config.tsx` + editor do passo no builder; chaves nos
  dois dicionários; CLAUDE.md.
- **Testes:** 89 novos (telefone 11, assinatura 11, payload 14, variáveis
  8, cliente 9, cartão 5, processar 3, rota do webhook 9 com banco e
  `after()` mockados, RLS da 977 7, motor 8, validação 2, resumo do passo
  2). Suíte inteira **2.754** verdes no Node 22; `typecheck` limpo; `eslint` 0 problemas nos arquivos tocados;
  `i18n-parity` e `i18n-chaves-usadas` OK; `icu-safety` OK (as chaves
  duplas entram por VALOR, nunca escritas no dicionário).
- **Preview (localhost:3111, 1440×900, conta real):**
  - Integrações → cartão "Calendly" aparece depois do Meta Ads. Sem a
    migration aplicada a rota devolve 500 e o cartão mostra o caminho de
    ERRO ("Não foi possível carregar… Tentar de novo", chip "Com erro") —
    que é o comportamento certo para tabela ausente. O estado "não
    conectado" com o formulário do token só é alcançável com a 977
    aplicada.
  - Automações → nova → gatilho "Agendamento no Calendly": dica, escopo
    por conexão e por etapa (herdados), select "Evento do Calendly" com
    "Qualquer evento" e a mensagem de carga falha (sem a tabela; com ela e
    sem conexão vira "Conectar em Integrações"), a caixa com as 12
    variáveis. Passo "Avisar um número": telefone (dica do 55), nome na
    ficha, texto com placeholder das variáveis, "Enviar por" com "A
    conversa do número (ou a conexão padrão)". Salvo como rascunho
    ("Automação criada"), conferido no banco (`trigger_type =
    calendly_booking`, `send_to_number` com `phone`, `contact_name`,
    `text`) e **apagado** em seguida — a automação de verdade nasce
    depois do deploy (seção 3.5), porque o builder em produção hoje não
    conhece o passo e quebraria se alguém a abrisse antes.
- **NÃO medido, e por quê:** a conexão real com o Calendly (token do
  escritório), a assinatura do webhook e um agendamento de ponta a ponta —
  exigem a migration em produção, o deploy (URL pública) e o token, que o
  operador tem e eu não. O caminho do webhook está coberto por teste com o
  banco mockado; `supabase db start` não rodou (Docker parado nesta
  máquina) — o replay da 977 em banco vazio fica para o CI.
- ⚠️ **Achado durante a execução (pego pelo próprio teste):** a heurística
  de telefone lia CPF (11 dígitos, como celular sem DDI) como telefone.
  Corrigido com a lista de rótulos de documento e a pontuação de CPF/CNPJ
  (`payload.ts`); a pergunta configurada pelo operador vence a exclusão.
- ⚠️ **Achado de desenho:** `send_message` herda o canal do disparo, e um
  `send_to_number` que fizesse o mesmo avisaria o advogado pelo número por
  onde o CLIENTE escreveu. O passo NÃO herda (só a escolha explícita, que
  falha fechada). Está no teste do motor e no CLAUDE.md.

### Complemento medido no mesmo dia (07/09, depois da revisão do operador)

- **Formato do aviso** trocado pelo que o operador escreveu (negrito do
  WhatsApp, sem "Tipo", com Origem = campanha - conjunto - anúncio, Tamanho
  da Dívida e Link CRM). Para isso o motor ganhou `{{contact.*}}` e
  `{{conversation.link}}` em todo passo de texto (5 testes novos no motor:
  nome/telefone/e-mail/link, campo ausente vira vazio, link da ficha, e a
  guarda de "só consulta o contato quando o texto cita, uma vez por
  execução").
- **Log de recebimentos** virou seção expansível no cartão, **20 por
  página** (pedido do operador), com "‹ Mais recentes / Mais antigos ›" e
  cada linha abrindo os dados que chegaram. Rota `GET /api/cb/calendly/
  eventos?pagina=N` com `count: 'exact'`.
- **Migration 977 aplicada em produção** pelo conector com autorização do
  operador ("siga"); conferido por consulta: RLS ligada nas duas, `anon` e
  `authenticated` sem SELECT, `service_role` com INSERT, linha
  `977_cb_calendly` no histórico.
- Preview depois da migration: cartão em "Não conectada" com o formulário
  do token; token inválido de teste → "Falha: o Calendly recusou o token"
  (401 real do Calendly), nada gravado (0 linhas em `cb_calendly_config`).
- ⚠️ **O token do Calendly foi colado no chat pelo operador.** Não foi
  digitado em lugar nenhum por decisão de regra (credencial só entra pela
  mão do operador); recomendado gerar um novo e colar no cartão.

### Achados do Codex no PR #128 (07/09) — os três tratados no PR seguinte

1. **P1 — `send_to_number` normalizava número estrangeiro em dígitos como
   Brasil** ("14045551234" → "5514045551234", aviso para outro
   destinatário). `digitosDoTelefone` passou a exigir o 9 na 3ª posição
   para acrescentar o 55 a 11 dígitos (celular BR = DDD + 9 + 8; na
   América do Norte N9X é reservado, então não colide). A dica do editor
   manda escrever número de fora com `+`. Teste com o caso do achado.
2. **P2 — `webhook_state` nunca era relido** (o Calendly desativa a
   assinatura após 24h de falhas sem avisar). `conferirAssinatura` no
   `GET /api/cb/calendly` lê a assinatura ao vivo e corrige a coluna
   (404 → `disabled`; 401 → `token_invalido`); toda entrega grava
   `active`. `cliente.assinatura(uri)` novo, com teste.
3. **P2 — o evento virava "disparado" sem confirmar execução**.
   `runAutomationsForTrigger` devolve `ResultadoDoDisparo`; `processar`
   grava `disparado` só com execução sem falha, `sem_automacao` (com "fora
   do escopo") quando conexão/etapa barram, `falhou` quando um passo
   falhou ou o disparo não aconteceu. `resultadoDoDisparo` é puro, com 4
   testes.

## 7. Teste de ponta a ponta em produção (2026-09-07, ~21h45 BRT)

Depois do merge do #128 (deploy no ar) e da 977 aplicada, o operador
conectou o token (organização, webhook `active`) e pediu o teste.

- Automação "Calendly → Reunião agendada" criada por SQL (5 passos da
  seção 3.5), ativada, e o agendamento feito na página pública
  `calendly.com/cbadvogados` → "Reunião com Advogado - Kommo" → 9/9 17:30,
  com nome, e-mail e "Telefone (Whatsapp)" `+55 83 98874-5316`.
- **Medido:** webhook recebido **2 s** depois da confirmação; assinatura
  aceita; telefone lido por HEURÍSTICA (rótulo "Telefone (Whatsapp)",
  resposta com `+55`); contato casado pelos últimos 8 dígitos (a ficha
  guarda `558388745316`, sem o nono dígito, e casou mesmo assim);
  `automation_logs` `success` com os 5 passos; campos `data_e_hora_reuniao
  = 2026-09-09T20:30:00Z` (17:30 BRT) e `link_reuniao` (Google Meet do
  Calendly); card em "Reunião Agendada"; aviso `delivered` no
  83 98874-5316 pela Bancário - Comercial, com a assinatura do escritório
  na frente (923) e o link `https://crm.cbadvogados.com/inbox?c=…`.
- **Achado:** "*Origem:*" saiu como " -  - " (contato sem campanha).
  Nasceu `{{contact.origem}}`, que junta só as partes preenchidas; o passo
  em produção foi trocado por SQL para usá-la.
- O gatilho foi fixado no evento pela URI que veio no próprio webhook
  (`…/event_types/ABFU5IERKFEFK5FB`, "Reunião com Advogado - Kommo") —
  sem sessão em produção no navegador, foi por SQL.
- As outras mensagens que chegaram ao número no mesmo minuto são de outra
  automação, de outro CRM (Kommo), disparada pelo mesmo agendamento —
  informado pelo operador.

### Cartão de chegada na grade do funil (07/09, pedido do operador)

O operador procurou a automação em Funis → Automações e não achou: a grade
só posicionava gatilhos de etapa. `montarGrade` passou a receber os passos
e a criar cartões de CHEGADA (`tipo: 'chegada'`, borda azul, cabeçalho
"Chega nesta etapa por: Agendamento no Calendly") sob a etapa de destino do
`move_deal_stage`/`create_deal`, sem "expandir". 7 testes em
`grade-do-funil.test.ts`. A seção 3.4 do plano e o CLAUDE.md foram
corrigidos: a frase "não aparece no funil" deixou de ser verdade.

### Achados do Codex nos PRs #129 e #131 (2ª rodada, 07/09) — tratados no #132

1. **P2 — automação parada em "Aguardar" era gravada como `disparado`.**
   `dispararAutomacoes` passou a contar `emEspera` (retorno `partial`, no
   escopo de fora ou num ramo) e `resultadoDoDisparo` grava `em_espera`
   (migration 978 amplia o CHECK; rótulo nos dois dicionários). Falha vence
   espera. A linha do evento NÃO é atualizada quando o agendador retoma — o
   `detalhe` diz onde olhar (`automation_logs`). Decisão: preservar
   `partial` no resultado em vez de "adiar o resultado até a execução
   pendente terminar" — a segunda opção exigiria o agendador conhecer o
   evento do Calendly (acoplamento motor → Calendly, com ciclo de import)
   para cobrir um caso que a automação de produção não tem.
2. **P2 — passo que falhava DENTRO de um ramo de condição não derrubava
   nada.** O ramo devolvia `null`, o escopo de fora seguia e o log terminava
   "success" com `error_message` preenchido; `comFalha` ficava em zero.
   Agora o ramo devolve o status dele, o escopo de fora marca `failed` e
   PARA (como pararia fora do ramo). "Aguardar" dentro do ramo sobe como
   `partial` no retorno mas não segura o escopo de fora (o log segue a
   semântica do upstream). 4 pinos em `engine.test.ts`, que reprovam sem a
   correção; o mock de `automation_steps` passou a recortar por escopo.
3. **P2 — `time_based`/`conversation_assigned` com `move_deal_stage`
   ganhavam cartão de chegada** apesar de nunca dispararem (sem call site
   desde o upstream). Lista `GATILHOS_SEM_DISPARO` em `trigger-meta.ts`,
   usada por `cartoesDeChegada`; teste amarra a lista ao `TRIGGER_OPTIONS`
   do builder (lê o fonte).

### O cadeado do "Processar de novo" (08/09, achado do Codex nos PRs #133/#134)

O botão nasceu com uma guarda de leitura: conferir o `resultado` e então
processar. Isso não serializa nada — dois cliques (duas abas, dois
administradores) leem a mesma linha e disparam a automação duas vezes, e o
mesmo vale para um clique durante o `after()` do webhook. A primeira
tentativa de conserto (recusar `recebido` com menos de 2 minutos) media a
IDADE da linha, o que também não serializa: duas requisições acham a mesma
linha velha e passam as duas. E não podia funcionar, porque em produção não
há corte de duração de rota — a idade não diz se o processamento anterior
terminou.

Conserto: migration **980**, coluna `processando_desde`, e o cadeado
`UPDATE…RETURNING` de `src/lib/calendly/claim.ts` — o mesmo padrão da
transcrição de áudio (943). Quem consegue escrever a coluna é o dono; os
demais recebem 409 com o motivo real (`ainda_processando` × `ja_processado`,
que são conselhos diferentes). O webhook carimba o cadeado junto com a
linha; `gravarResultado` o solta na mesma escrita do resultado; o caminho de
exceção grava `falhou` em vez de soltar limpo, porque a automação pode ter
enviado antes de morrer; claim de mais de 10 minutos é tomado.

### Cerca de posse e teto de processamento (08/09, 2ª rodada do Codex no #135)

O cadeado sozinho não bastava, e o Codex apontou os dois furos:

1. **Recolher por idade podia tomar a linha de um dono VIVO** — em produção
   não há corte de duração de rota, então "10 min sem notícias" não provava
   nada. Conserto: `TETO_DE_PROCESSAMENTO_MS` (4 min), abaixo do
   recolhimento (10 min), com teste cobrando a margem. Quem passa do teto
   grava `falhou` e sai, então cadeado velho passa a significar dono morto.
2. **A escrita do resultado casava só por id** — um dono recolhido terminava
   tarde, sobrescrevia o resultado de quem assumiu e soltava o cadeado vivo
   do outro. Conserto: cerca de posse (`processando_desde` do próprio claim)
   em `gravarResultado` e `liberarClaim`, a mesma do worker do Radar.

Limite declarado: desistir não cancela o trabalho em voo — uma promessa em
JS não se aborta. O que impede o estrago é a cerca, que transforma as
escritas do desistente em no-op.
