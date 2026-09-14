# PLANO — Automações: multi-canal, funil e orquestração

> **Documento vivo.** Cada fase/PR concluído atualiza a seção
> [Registro de progresso](#registro-de-progresso) e marca os itens feitos.
> Uma sessão nova deve **ler este arquivo primeiro** para saber onde paramos.
>
> **Última atualização:** 2026-08-03 — **Fases 1, 2 e 2b implementadas e
> commitadas** na branch (não mescladas em `main`). Nenhuma pergunta pendente.
> Próximo: Fase 3 (orquestração — acionar/parar automação, robô e IA).
> **Branch de trabalho:** `feat/automacoes-canal-por-passo`, saída de `main`.

---

## 1. Objetivo

O módulo de automações nasceu no upstream (`wacrm`) quando o sistema tinha **uma
conexão só** e **não tinha funis**. Hoje o CB CRM tem múltiplas conexões
(multi-canal, migration 903) e funis com etapas (908/911). O módulo ficou para
trás. O operador pediu:

1. **Gatilho por conexão** — "quando chegar mensagem **neste número**".
2. **Ação por conexão** — "envie a resposta **por este número**".
3. **Funil nos gatilhos e nas ações** — recortar por funil/etapa e agir sobre o card.
4. **IDs próprios** para etiquetas, etapas, funis e campos personalizados.
5. **Ações novas:** enviar documento/áudio, acionar e parar automações específicas,
   acionar e parar chatbots de IA.
6. **(Secundário) Builder por etapa**, no estilo Kommo: dentro da tela de Funis,
   pendurar automações em cada etapa do quadro. Só depois de a automação estar
   "redonda".

---

## 2. Estado atual — achados verificados

> Todos os itens abaixo foram lidos no código, não deduzidos. Medições de banco
> feitas em 2026-08-03 no projeto `hxnhakmyxyhalbsktzwe`.

### 2.0 Estado do banco (2026-08-03)

| | |
|---|---|
| Conexões | **2 linhas, mas em CONTAS DIFERENTES — 1 canal por conta.** As duas Evolution (nenhuma Meta), as duas conectadas |
| Funis / etapas | **1 / 9** |
| Etiquetas / campos personalizados | **0 / 0** |
| Automações / fluxos | **0 / 0** |
| Negócios | 56 (59 em 2026-08-03 à noite, com o tráfego real do dia) |

⚠️⚠️ **NENHUMA CONTA É MULTI-CANAL HOJE — e isto explica o pedido original.**
Medido em 2026-08-03: `38f38852…` tem só "WhatsApp (QR Code)" e `a3af0191…`
(a do operador) tem só "Pessoal Leonardo". Todo seletor de canal do projeto
esconde-se com menos de 2 conexões, por convenção. Ou seja: **o escopo de
canal do gatilho sempre existiu e o operador nunca pôde vê-lo**, não porque
falte código, mas porque o segundo número está em outra conta. Enquanto os
dois números não estiverem na MESMA conta, nem o escopo do gatilho nem o
"Enviar por" novo aparecem na tela. É decisão do operador, não de código.

⚠️ **As duas conexões são Evolution.** Consequência dupla: (a) os passos
exclusivos da Meta (`send_template`, `send_buttons`, `send_list`) **não
funcionam nesta conta hoje** — a validação de ativação já recusa quando o
escopo é só-Evolution; (b) teste manual em produção só exercita texto e mídia.
Correções em código Meta-only se provam por teste automatizado, não na tela.

**Implicação central: não há nada em produção para migrar.** Nenhuma automação
ou fluxo foi criado ainda, então não existe pressão de compatibilidade sobre
formatos guardados em `trigger_config` / `step_config`. Podemos mudar a forma
sem escrever migração de dados.

### 2.1 Multi-canal — o que JÁ existe

- **Escopo de canal por automação já existe e já tem tela.**
  `automations.channel_ids uuid[]` (migration `0903_cb_multicanal.sql:33`), lido
  por `channelInScope()` em `src/lib/automations/engine.ts:740-749`, editável
  pelo `ChannelMultiSelect` em `src/components/automations/automation-builder.tsx:869-887`.
  Como é **um gatilho por automação**, esse escopo *já é* "qual conexão disparou".
  O seletor só aparece com **2+ conexões** (`automation-builder.tsx:873`) — e a
  conta tem 2, então ele deveria estar visível hoje.
- **Condição `channel`** ramifica dentro de uma automação
  (`engine.ts:817-825`), com seletor próprio (`automation-builder.tsx:1494-1537`).
- **Canal de saída por passo existe no motor, mas não na tela.**
  `ChannelScopedStepConfig` (`src/types/index.ts:745-747`) e
  `stepChannel()` (`engine.ts:846-861`) resolvem, nesta ordem: escolha explícita
  do passo → canal do disparo → canal da conversa → padrão da conta.
  **Nenhuma tela escreve `step_config.channel_id`.**

### 2.2 Multi-canal — o que está QUEBRADO

| # | Defeito | Onde | Efeito |
|---|---|---|---|
| B1 | `engineSendInteractive` **descarta** `preferredChannelId` | `src/lib/automations/meta-send.ts:93-115` | Botões/listas ignoram o canal escolhido e o canal do disparo; saem pelo canal atual da conversa. Os destinos já aceitam o parâmetro (`src/lib/flows/meta-send.ts:379,394`) |
| B2 | `tag_added` **nunca** carrega `channel_id` | `src/lib/contacts/tag-events.ts:56`, `engine.ts:475`, `src/lib/flows/engine.ts:753` | Numa automação de etiqueta o escopo de canal é inerte e a condição `channel` dá **sempre falso** |
| B3 | Gatilho **"Conversa Atribuída" nunca dispara** | nenhum call site de `runAutomationsForTrigger` usa esse tipo | A opção existe na tela, tem rótulo e validação, e não faz nada |
| B4 | Gatilho **"Agendamento" (`time_based`) nunca dispara** | `/api/automations/cron` só drena `automation_pending_executions` | Idem |
| B5 | ~~`interactive_reply` só existe no transporte Meta~~ **Reclassificado na revisão: não é defeito prático.** A Evolution não ENVIA botão (`send-message.ts:571-577` rejeita `interactive`), logo nunca RECEBE resposta de botão — o parse ausente em `inbound-store.ts` não tem o que parsear. | — | Fica como limitação documentada: menu por botão é recurso Meta-only, e a validação de ativação já diz isso |
| B6 | Sem validação de canal no cliente, **e a do servidor não olha o canal por passo** — `validateChannelScopeForActivation` (`validate.ts:239-271`) só lê o escopo da automação; `step_config.channel_id` é ignorado, e com escopo vazio ela retorna cedo (`:245`) | `automation-builder.tsx:711-721` (cliente); `validate.ts:245` (servidor) | Quando a Fase 1 criar a UI de canal por passo, um `send_template` fixado num canal Evolution passaria na ativação. Os **fluxos já resolveram as duas metades**: `validateFlowChannelForActivation` calcula o canal EFETIVO por nó (`src/lib/flows/validate.ts:823-850`) e roda também no cliente (`flow-editor-state.tsx:340-354`) |
| B7 | Duas buscas de canais no mesmo builder | `automation-builder.tsx:262` e `:824` | Duas requisições por montagem. Fluxos buscam uma vez só (`flow-editor-state.tsx:259`) |
| B8 | Chave i18n `Automations.builder.delete` **não existe** nos dois dicionários | `automation-builder.tsx:1204` | O botão Excluir do card de passo renderiza o caminho cru da chave |

### 2.3 Funil — estado

- **Tudo tem UUID estável e o motor já referencia por ID, nunca por nome.**
  Isso responde ao item 4 do pedido: `tags.id`, `pipelines.id`,
  `pipeline_stages.id`, `custom_fields.id`, `cb_channels.id` — todos `uuid` PK, e
  o motor guarda `tag_id`, `pipeline_id`, `stage_id`, `custom:<uuid>`,
  `channel_id`. **Não há trabalho a fazer aqui.**
  Duas exceções, ambas por desenho: a condição `contact_field` e a ação
  `update_contact_field` usam o **nome da coluna** para campos nativos
  (`name`/`email`/`company`) — campo personalizado usa id.
- **Automação e funil quase não se falam.** O único ponto de contato é a ação
  `create_deal` (`engine.ts:576-646`). **Não há** gatilho, condição ou ação de
  etapa/funil.
- `create_deal` **insere direto na tabela**, contornando as validações de
  `src/lib/deals/create-deal.ts` (o próprio cabeçalho de lá, `:1-17`, avisa
  disso): não confere se o funil é da conta nem se a etapa pertence ao funil.
- **FKs compostas** em `deals`: `(pipeline_id, account_id)`,
  `(stage_id, pipeline_id)`, `(channel_id, account_id)`,
  `(conversation_id, account_id)` (908 e 910). Mover um card entre funis exige
  atualizar `pipeline_id` e `stage_id` **na mesma instrução**.
- **A trilha de auditoria (912) já calcula tudo que um gatilho de etapa precisa** —
  de/para de etapa e funil, posições, ator, origem — por **trigger de banco**
  (`cb_deals_log_event_update`, `AFTER UPDATE OF pipeline_id, stage_id, status`).
  Mas **não há nenhum mecanismo de entrega**: `cb_lead_events` não está no
  realtime, não há `pg_notify`, e o único consumidor é um hook que faz polling
  (`src/hooks/use-lead-events.ts`).
- ⚠️ **Movimento entre funis emite `pipeline_changed`, NUNCA `stage_changed`**
  (`0912_cb_historico_de_atividade.sql:306-310`). Um gatilho "entrou na etapa X"
  que só escutar `stage_changed` **não dispara** quando o card vem de outro funil.

### 2.4 Muitos escritores, e alguns no navegador

Este é o fato que decide o desenho dos gatilhos novos.

**`deals.stage_id`** — 2 escritores de movimento, **os dois no navegador sob RLS**:
`src/app/(dashboard)/pipelines/page.tsx:223` (arrastar no Kanban) e
`src/components/pipelines/deal-form.tsx:189`. Mais 3 caminhos de criação no
servidor.

**`conversations.assigned_agent_id`** — 6 escritores, **um no navegador**:
`src/components/inbox/message-thread.tsx:1466` (seletor de responsável),
`src/app/api/ai/autoreply/[conversationId]/route.ts:78,87`,
`src/lib/ai/auto-reply.ts:199`, `src/lib/automations/engine.ts:518`,
`src/lib/flows/engine.ts:479`.

**Conclusão:** enxertar o disparo em cada call site é o caminho que quebra em
silêncio — é exatamente a razão pela qual a 912 pôs a auditoria num trigger de
banco. Os gatilhos novos seguem a mesma lição (ver §4.1).

### 2.5 Orquestração — o que existe para "acionar/parar"

| Capacidade pedida | Existe? | Primitiva a reusar |
|---|---|---|
| Desligar a IA numa conversa | coluna sim, escritor de motor **não** | `conversations.ai_autoreply_disabled` (`0029_ai_reply.sql:100`); copiar `src/app/api/ai/autoreply/[conversationId]/route.ts:75` |
| Religar a IA numa conversa | idem | mesma rota `:87-93` — decidir se zera `ai_reply_count` |
| **Acionar "chatbot X"** | ❌ **não existe "X"** | `ai_configs` não tem coluna `name`; é **1 agente padrão por conta + 1 por canal**, chaveado por `(account_id, channel_id)`. E **não há API nem tela** para criar o por-canal — `/api/ai/config` fixa `channel_id IS NULL` em toda operação. → Feature futura pré-avaliada em §4.7 (D7) |
| Acionar "robô X" (fluxo) | ❌ falta a função | `flows` **tem `name` e `id`**, e tem um `trigger_type: 'manual'` que **nunca dispara** — esperando exatamente isto. `startNewRun` (`src/lib/flows/engine.ts:1136`) é privado e tem assinatura de webhook |
| Parar o fluxo em andamento | ⚠️ efetivamente sim | o bloco `pauseFlows` de `src/lib/whatsapp/send-message.ts:816-828` já é um UPDATE por contato; basta extrair como função exportada |
| Acionar automação Y por id | ❌ | `runAutomationsForTrigger` é **por tipo de gatilho**, não por id |
| Parar automação | ❌ | não há nenhum DELETE/cancel de `automation_pending_executions` fora do cron; o CHECK não tem `'cancelled'` |
| Guarda de laço | ✅ | `src/lib/contacts/tag-chain.ts` — profundidade em `context.vars`, teto 3, **sobrevive ao `wait`** porque o contexto é JSONB |

⚠️ **`idx_one_active_run_per_contact`** (`0010_flows.sql:187`): **um fluxo ativo
por contato**. "Acionar robô Y" com um robô já rodando bate em `23505` — hoje
tratado como "outro webhook começou a run" e devolvido como sucesso silencioso.

⚠️ **Desativar uma automação NÃO para as execuções paradas em `wait`.**
`resumePendingExecution` (`engine.ts:148-153`) busca a automação **sem filtrar
`is_active`** e executa. Escopo de canal e casamento de gatilho também só são
avaliados no disparo, nunca no resume.

### 2.6 Mídia — o modelo já está pronto nos fluxos

- O nó `send_media` dos fluxos é o molde exato: arquivo enviado **uma vez, em
  tempo de desenho** (`uploadAccountMedia`, `src/lib/storage/upload-media.ts:79`),
  URL pública guardada no config JSONB, reusada em toda execução
  (`src/lib/flows/types.ts:105-126`, motor em `src/lib/flows/engine.ts:642-671`).
- **Sem migration**: `automation_steps.step_type` é `TEXT` **sem CHECK**
  (`0006_automations.sql:58`).
- **Sem bloqueio técnico**: a Meta busca a URL sozinha a cada envio
  (`meta-api.ts:300`), a Evolution aceita a mesma URL pública.
- ⚠️ **`engineSendMedia` não grava `media_url` na linha de `messages`**
  (`src/lib/flows/meta-send.ts:336-347`) — mídia enviada por fluxo aparece como
  balão vazio no inbox. Herdaríamos o defeito.
- ⚠️ **Os três buckets são `public = true`** e a rota pública **não passa por
  RLS** — o próprio cabeçalho da `0900_cb_storage_restringe_listagem.sql:24-30`
  diz isso. Quem tiver a URL abre o arquivo, para sempre, sem login. Para
  documento de cliente de escritório de advocacia, é exposição real, e **não há
  nenhum helper de URL assinada no repo**. *(Risco aceito pelo operador — D12.)*
- ⚠️ `flow-media` **não aceita áudio**; `chat-media` aceita.

### 2.7 Infra — o agendador existe e bate de 15 em 15 minutos

`docker-stack.yml:75-114`: um serviço `agendador` chama, em laço,
`/api/cb/scheduled/cron`, `/api/flows/cron` e `/api/automations/cron`, **a cada
900 s**. Isso significa:

- O passo `wait` das automações **funciona** (desde 2026-08-01).
- **15 minutos é rápido o bastante para "esperar", e lento demais para "moveu o
  card → manda a mensagem".** Um gatilho de etapa que dependa só do cron entrega
  a mensagem até 15 min depois do arrasto. Inaceitável — daí o desenho de §4.1.
- ⚠️ O CI **não** sobe esse serviço; `deploy.yml` só troca a imagem do `crm_crm`.
- `pg_cron`, `pg_net` e `http` estão **disponíveis mas não instalados** no
  Supabase deste projeto (medido em 2026-08-03).

---

## 3. Decisões tomadas

| # | Decisão | Quem/quando |
|---|---|---|
| D1 | Funil entra **como gatilho novo ("card mudou de etapa") E como filtro** dos gatilhos existentes | operador, 2026-08-03 |
| D2 | "Conversa Atribuída" e "Agendamento" **serão implementados de verdade** (nenhuma opção da tela pode mentir). *Revisto por D14:* o "Agendamento" cru sai do seletor; o tempo de verdade é §4.6 | operador, 2026-08-03 |
| D3 | Ações de funil: **mover para etapa**, **marcar ganho/perdido**, e **corrigir `create_deal`** para usar `createDeal` | operador, 2026-08-03 |
| D4 | Ações novas: **enviar documento/mídia**, **acionar/parar automação**, **acionar/parar chatbot** | operador, 2026-08-03 |
| D5 | Primeiro entregável = **conexão + funil**; builder por etapa fica por último | operador, 2026-08-03 |
| D6 | Gatilhos com muitos escritores usam **caixa de saída no banco**, não enxerto em call site | proposto 2026-08-03; sem objeção nas duas rodadas de perguntas construídas sobre ele |
| D7 (Q1) | **Agentes de IA nomeados** (geral, follow-up, satisfação, triagem — cada um com prompt e base próprios) são feature **futura, fora deste plano**; pré-avaliada em §4.7 para as decisões de agora não fecharem a porta | operador, 2026-08-03 |
| D8 (Q2) | Gatilho sem negócio no contexto age sobre **o negócio aberto mais recente** do contato | operador, 2026-08-03 |
| D9 (Q3) | O canal carimbado no evento de funil é **o da conversa atual**, não o do nascimento do card | operador, 2026-08-03 |
| D10 (Q4) | Religar a IA por automação **zera `ai_reply_count`** (atualizar o comentário da rota manual que dizia "não-automatizável") | operador, 2026-08-03 |
| D11 (Q5) | `run_flow` com robô ativo: **o novo substitui o atual** (encerrado como "substituído por automação"); segue valendo **uma run ativa por contato** | operador, 2026-08-03 |
| D12 (Q6) | **URL pública permanente aceita** para mídia de automação; a ressalva de §2.6 vira fato registrado, não pendência | operador, 2026-08-03 |
| D13 (Q7) | Movimento feito por automação **encadeia, SEM teto de profundidade** (teto recusado pelo operador). A guarda é **anti-ciclo**: a mesma cadeia não repassa pela mesma etapa/atribuição — garante término sem limitar esteira longa. Sem guarda nenhuma, X→Y→X mandaria mensagem ao cliente para sempre | operador (sem teto), 2026-08-03; guarda anti-ciclo proposta pela implementação |
| D14 (Q8) | **"Tempo" redefinido pelo operador:** (a) espera entre passos = o `wait` que já existe, com cadência afinada; (b) **gatilho relativo a data de campo personalizado** (lembrete de reunião: 24h/12h/1h antes). O `time_based` cru do upstream sai do seletor. Ver §4.6 | operador, 2026-08-03 |

---

## 4. Desenho das peças novas

### 4.1 Caixa de saída (`cb_automation_events`) — como um gatilho de banco vira automação

O problema: quem move o card e quem atribui a conversa está **no navegador**,
sob RLS. Não há ponto único no servidor por onde passar.

**Desenho proposto** — uma tabela de fila (não de auditoria; a auditoria já é a
`cb_lead_events` e não deve ser distorcida com CHECKs e linhas `reconstructed`):

```
cb_automation_events
  id, account_id, tipo ('deal_stage_changed' | 'deal_status_changed'
                        | 'conversation_assigned')
  contact_id, deal_id, conversation_id, channel_id
  from_stage_id, to_stage_id, from_pipeline_id, to_pipeline_id,
  from_status, to_status, assigned_agent_id
  origem ('usuario' | 'conexao' | 'automacao' | 'sistema'), cadeia jsonb
  criado_em, processado_em (NULL = pendente), tentativas, erro
```

Escrita por **triggers `SECURITY DEFINER`** em `deals`
(`AFTER INSERT OR UPDATE OF pipeline_id, stage_id, status`) e em `conversations`
(`AFTER UPDATE OF assigned_agent_id`), no mesmo molde da 912. Regras que a 912
já pagou para aprender, e mais três novas:

- **`IS NOT DISTINCT FROM` no topo** — o `deal-form` menciona as três colunas em
  todo save; sem a guarda, cada edição de anotação enfileira evento falso.
- **INSERT também enfileira** (`from_*` nulos). O print do Kommo é literal:
  "quando movido para **ou criado** nesta etapa" — e o card que o roteador de
  entrada cria (`routeInboundToPipeline`) precisa disparar igual.
- **`origem` e `cadeia`:** no INSERT a origem sai de `deals.source` (como a 912
  faz). No UPDATE, escritor de navegador = `auth.uid()` presente = `usuario`.
  Escritas do MOTOR passam a ir por RPC (`cb_mover_negocio(...)`) que carimba a
  **cadeia** — a lista de etapas/atribuições que este encadeamento já visitou —
  num GUC transacional (`set_config('cb.cadeia', ..., true)`); o trigger copia
  para o evento e o drain devolve ao contexto do disparo (mesmo transporte JSONB
  do `tag-chain.ts`, que sobrevive ao `wait`). **Guarda anti-ciclo, sem teto de
  comprimento (D13):** antes de disparar, o motor recusa evento cuja
  etapa/conversa já esteja na cadeia — esteira longa passa; círculo X→Y→X, que
  mandaria mensagem ao cliente para sempre, é barrado na segunda volta.
- **Carimbo de canal do evento = canal da conversa atual (D9):**
  `deals.conversation_id` → `conversations.channel_id`; sem conversa vinculada,
  a conversa mais recente do contato; pode ficar NULL (e aí o escopo de canal da
  automação deixa passar, como em todo disparo sem canal).
- **O trigger de `conversations` só enfileira atribuição de verdade:**
  `NEW.assigned_agent_id IS NOT NULL` e distinto do OLD. Desatribuir (o botão
  "Retomar IA" zera a coluna) não é "conversa atribuída".
- ⚠️ O passo `assign_conversation` de hoje atualiza **todas** as conversas do
  contato (`engine.ts:516-520`) — com o trigger ligado, um contato com 3
  conversas enfileira 3 eventos de uma vez. Corrigir o passo para mirar a
  conversa do contexto faz parte da entrega.
- **Nasce fechada** (lição da 931): `REVOKE ALL FROM anon, authenticated` — fila
  é assunto de service_role; conferir o resultado com `SET ROLE`, não a intenção.
- Índice parcial nos pendentes (`WHERE processado_em IS NULL`) e **GC** de
  processados com mais de 30 dias no próprio cron.

Três formas de drenar, nesta ordem de importância:

1. **Imediata, pelo escritor.** Os três escritores de navegador (Kanban,
   `deal-form`, seletor de responsável do `message-thread`) chamam uma rota
   `POST /api/automations/events/drain` logo depois do UPDATE, fire-and-forget.
   Os escritores de servidor chamam a função direto. → latência de segundos no
   caso comum.
2. **Rede de segurança:** o `/api/automations/cron` que já existe passa a drenar
   pendências no mesmo ciclo de 15 min. Pega o que o navegador não conseguiu
   avisar (aba fechada, rede caindo, SQL na mão).
3. **Reivindicação em dois passos** (`UPDATE … WHERE processado_em IS NULL`),
   igual ao cron de automações já faz, para o ping e o cron nunca dispararem duas
   vezes o mesmo evento.

**Por que não `pg_net`:** resolveria tudo pelo banco, mas exige instalar extensão,
guardar URL e segredo do CRM dentro do Postgres e depender de uma fila assíncrona
nova. Fica registrado como alternativa se o ping do cliente se mostrar
insuficiente.

**Política de falha, diferente da 912:** falha ao gravar o evento **engole com
`WARNING`, sempre** — inclusive com `auth.uid()` presente. A 912 re-levanta
porque perder auditoria é grave; aqui, re-levantar faria o arrasto do card
falhar na cara do operador por causa de uma automação.

⚠️ **O trigger tem de tratar `pipeline_changed` como mudança de etapa também.**
A 912 emite `pipeline_changed` e **não** `stage_changed` quando o card troca de
funil. Um gatilho que só escute `stage_changed` não dispara nesse caso.

### 4.2 Filtro de funil/etapa nos gatilhos existentes

Coluna própria `automations.stage_ids uuid[]`, no mesmo molde de `channel_ids`:

- **Vazio/`NULL` = todas as etapas** (nunca "nenhuma") — a convenção do projeto
  inteiro (`channelInScope`, `findEntryFlow`, `FILTROS_VAZIOS` do inbox).
- Etapa basta, funil é redundante: `(stage_id, pipeline_id)` é único, então a
  etapa já identifica o funil.
- Semântica: "o contato tem negócio **aberto** em alguma dessas etapas".
- ⚠️ Custo: exige consultar `deals`. Fazer **uma** consulta por disparo, e só
  quando existir automação com escopo de etapa — nunca uma por automação.
- ⚠️ Precisa de trigger de limpeza ao apagar etapa, no molde de
  `cb_channels_drop_from_automations` (`903:296-317`), senão sobra UUID órfão.

### 4.3 Ações e condições de funil

- `move_deal_stage` — **um `UPDATE` só** com `pipeline_id` + `stage_id`
  (exigência da 912: em dois updates a trilha conta que o lead saiu e voltou).
  Executa via a RPC `cb_mover_negocio` de §4.1, que carimba a profundidade.
- `set_deal_status` — `won` / `lost` / `open`.
- `create_deal` — passa a chamar `createDeal` de `src/lib/deals/create-deal.ts`.
- **Condição nova `deal_stage`** (e `deal_status`): "o card está na etapa X?".
  Sem ela, o padrão central do print do Kommo — *"movido para a etapa **depois
  de 240 horas** → agir"* — não é exprimível com segurança: vira gatilho de
  etapa → `wait 240h` → **condição "ainda está na etapa"** → ação. O `wait` já
  funciona; é a condição que falta para ele não agir às cegas sobre um card que
  o operador moveu nesse meio-tempo.

**`deal_id` entra no `AutomationContext`.** O evento da caixa de saída carrega o
card exato; o contexto o repassa (e ele sobrevive ao `wait` de graça, como
`channel_id` — JSONB intacto). As ações de funil agem **nesse** card quando ele
existe; para gatilho sem negócio no contexto (ex.: mensagem recebida → mover
card), a regra é **o negócio aberto mais recente do contato (D8)**.

⚠️ **Laço:** mover etapa e atribuir conversa emitem eventos que disparam
gatilhos que podem mover etapa e atribuir conversa. Encadeamento é permitido e
**sem teto (D13)**; a guarda anti-ciclo de §4.1 é o que garante que termina.

### 4.4 Acionar / parar

- `run_automation` — precisa de `runAutomationById()`, que não existe.
- `stop_automation` — precisa de `'cancelled'` no CHECK de
  `automation_pending_executions.status` (`006:129`). **Corrigir junto** o fato
  de desativar automação não parar execução parada em `wait`.
- `run_flow` — exportar/refatorar `startNewRun`, tornar opcional a dependência
  de `ParsedInbound`/`meta_message_id`. Com robô ativo no contato, **o novo
  substitui o atual (D11)**: encerra a run ativa com `end_reason` próprio
  ("substituído por automação") e inicia a nova — o invariante de uma run ativa
  por contato continua de pé.
- `stop_flow` — extrair `send-message.ts:816-828` como
  `abortActiveRunsForContact()` exportado.
- `set_ai` (ligar/desligar na conversa) — escreve `ai_autoreply_disabled`; ao
  **religar, zera `ai_reply_count` e limpa `ai_handoff_summary` (D10)** —
  atualizar o comentário da rota manual que dizia "não-automatizável", que a
  decisão do operador revogou. Config nasce com slot opcional `agent_id`,
  ignorado por ora (D7/§4.7).

### 4.5 Mídia

`send_media` copiando o nó de fluxos, bucket **`chat-media`** (é o que aceita
áudio). Corrigir de passagem o `media_url` que `engineSendMedia` não grava.
**Não** fazer GC do arquivo no envio — o mesmo arquivo serve toda execução.
URL pública permanente **aceita pelo operador (D12)** — sem trabalho de URL
assinada; a ressalva de §2.6 fica como fato registrado.

### 4.6 Tempo (D14) — o que "Agendamento" deveria ter sido

O operador definiu o que tempo precisa significar. São duas peças, e nenhuma é
o `time_based` do upstream (um cron cru sem alvo — **sai do seletor**):

**a) Espera entre passos — já existe, mas é grossa.** O passo `wait` estaciona
TODA espera em `automation_pending_executions` (`engine.ts:285-311`) e quem
acorda é o cron — que roda de 15 em 15 min. "Esperar 30 segundos" hoje significa
"até 15 minutos". Proposta: laço próprio no agendador batendo em
`/api/automations/cron` a cada **60 s** (`docker-stack.yml` — ⚠️ mudança de
infra **manual na VPS**, o CI não sobe serviço; o `CICLO_MINUTOS` das agendadas
não é afetado). Espera mínima efetiva vira ~1 min, e a tela diz isso: o seletor
do `wait` ganha piso de 1 minuto — prometer segundos que não existem é o mesmo
pecado da grade de 15 min da agendada, já resolvido lá.

**b) Gatilho relativo a data de campo — o lembrete de reunião.** O
"24 horas antes — Lead: Reunião Marcada" do print do Kommo. Gatilho novo
(`date_field_offset`): config `{ campo (custom_field_id), offset em horas,
antes | depois }`. Dispara **por contato** cujo valor do campo cruza a janela —
o que responde sozinho o "dispara para quem" que matava o `time_based`. Cada
offset (24h, 12h, 1h…) é uma automação, como no Kommo.

- **Varredura no cron** (15 min bastam para lembrete em horas): contatos com
  valor do campo dentro da janela do ciclo.
- **Dedup por disparo:** tabela própria (faixa 900+) com UNIQUE
  `(automation_id, contact_id, valor_do_campo)`. Reunião **remarcada** (valor
  mudou) re-arma o lembrete — desejável; mesmo valor nunca dispara duas vezes.
- **Guarda de atraso** no molde da agendada: alvo que já passou há mais de 1h
  não dispara — marca e espera gente. Reunião de ontem não recebe "faltam 24h".
- **Campo de data não existe na tela hoje:** o gerenciador só cria
  `field_type: 'text'` (`custom-fields-manager.tsx:112`). Ganha a opção
  `datetime` (a coluna é TEXT livre — sem migration; input `datetime-local`).
- ⚠️ **Fuso fixado na implementação:** o container roda em UTC e o operador
  digita hora de Brasília. Gravar o valor com offset explícito (ISO com fuso),
  senão todo lembrete erra por 3 horas.

Composição de graça: com o filtro de etapa (§4.2), "lembrete só para quem está
na etapa Reunião Marcada" é a soma das duas peças, sem código novo.

### 4.7 Pré-avaliação: agentes de IA nomeados (D7 — fora de escopo)

O que o operador quer um dia: vários chatbots **nomeados** (atendimento geral,
follow-up, satisfação, triagem), cada um com prompt e base de conhecimento
próprios. Estado real e o que faltaria:

- **Hoje:** `ai_configs` é 1 agente padrão por conta + no máximo 1 por canal,
  **sem coluna de nome**, chaveado por `(account_id, channel_id)` — e o
  por-canal nem tem tela/API (`/api/ai/config` fixa `channel_id IS NULL` em
  toda operação). A base de conhecimento é por conta com recorte opcional por
  **canal** (`ai_knowledge_documents.channel_id` + chunks, migration 903), e os
  RPCs `match_ai_knowledge_*` filtram por canal.
- **A feature exigiria:** coluna `name` + trocar os índices únicos da 903
  (1 padrão + 1 por canal) por unicidade por nome; um ponteiro
  `conversations.ai_agent_id` ("qual agente conduz ESTA conversa", NULL =
  resolução atual canal→padrão); knowledge e RPCs re-chaveados por agente
  (`ai_config_id`) em vez de canal; tela de gestão de agentes.
- **O que este plano já faz para não fechar a porta:** o passo `set_ai` nasce
  com slot opcional `agent_id`; qualquer referência futura usa `ai_configs.id`
  — PK estável que já existe, hoje sem nenhum leitor.

---

## 5. Plano por fase (PR)

> D5 escolheu "conexão + funil num PR": **Fases 1 e 2 são o MESMO PR** (mesma
> branch), em duas partes de trabalho — a parte A não depende de migration nova,
> a parte B carrega a caixa de saída. As ações de §4.4 e §4.5 vieram depois da
> decisão e não cabem no mesmo PR sem inchar a revisão — viraram PRs próprios.

### Fase 1 — Conexão (fechar o multi-canal) — **PR 1, parte A**

| | |
|---|---|
| Objetivo | O operador escolhe por onde a mensagem sai, e nenhum gatilho da parte A mente |
| Migration | **nenhuma** |
| Arquivos-chave | `src/components/automations/automation-builder.tsx`, `src/lib/automations/{engine,meta-send,validate}.ts`, `src/lib/contacts/tag-events.ts`, `src/app/api/whatsapp/webhook/route.ts`, `src/lib/whatsapp/inbound-store.ts`, `messages/{en,pt-BR}.json` |

- [x] Seletor "Enviar por" (`CanalDeSaida`) nos passos `send_message`,
      `send_template`, `send_buttons`, `send_list` → `step_config.channel_id`.
      Vazio = **herdar** o canal do disparo (rótulo próprio `outboundInherit`,
      nunca "todos os canais", que ali seria mentira). No interativo o
      `InteractiveBuilder` sobrescreve o `step_config` inteiro — o `channel_id`
      é remendado de volta no `onChange`.
- [x] **Aviso de conexão apagada** no seletor de saída
      (`config.outboundChannelGone`), com a escapatória do gate: ele aparece
      **mesmo com menos de 2 conexões** quando há órfão, senão apagar uma
      conexão de uma conta de duas esconderia o erro justo quando ele importa.
      *(Achado da revisão adversarial — eu tinha copiado o seletor da condição
      por canal sem copiar o aviso que ela já tinha.)*
- [x] **B1** — `engineSendInteractive` repassa `preferredChannelId`.
      5 testes novos em `meta-send.test.ts`; **3 deles falham contra o código
      antigo** (conferido), então guardam a regressão de verdade.
- [x] **B2** — `tag_added` passa a carregar canal. `canalDoContato` resolve a
      conversa mais recente **uma vez, no ponto central** (`tag-events.ts`), e
      o fluxo passa `run.channel_id` direto. Best-effort com try/catch: a
      etiqueta já foi gravada quando isto roda, e deixar a busca do canal subir
      transformaria uma escrita bem-sucedida em 500.
- [x] **B4 (revisto por D14)** — "Agendamento" e "Conversa Atribuída" **saíram
      do seletor**. O `useMemo` `opcoesDeGatilho` readiciona o valor corrente se
      a automação já estiver gravada com ele — senão o `<select>` mostraria a
      primeira opção da lista e o save gravaria essa mentira.
- [x] **B6, as duas metades** — servidor: `validateChannelScopeForActivation`
      passou a decidir pelo **canal efetivo do passo**; cliente: `AvisosDeCanal`
      roda a MESMA função ao vivo. 5 testes novos em `channel-scope.test.ts`.
- [x] **B7** — `TriggerCard` consome `useResources()`; uma busca de canais só.
- [x] **B8** — `Automations.builder.delete` nos dois dicionários, e os dois
      `defaultValue` enganosos removidos (o 2º argumento do next-intl são
      valores de interpolação, não fallback).
- [x] **B5 — descartado**, e a razão está em §2.2: a Evolution não envia botão,
      logo não recebe resposta de botão.
- [x] `i18n-parity` (1985/1985) · `typecheck` · `lint` (0 erros; baseline de
      70334 problemas é idêntico ao do `main` limpo) · `test` (**1282** passam,
      106 arquivos — 25 novos)

> **B3 (`conversation_assigned`) mudou para a parte B:** ele dispara pela caixa
> de saída, que é a peça central de lá. **B5 saiu do plano** — reclassificado
> como limitação documentada (ver §2.2).

**Como foi verificado** (2026-08-03):

- **Contrato do servidor, de ponta a ponta na sessão real:** POST criando passo
  com `channel_id` → GET devolve o mesmo id (round-trip pelo `step_config` opaco
  confirmado); PATCH tentando ativar `send_template` fixado num canal Evolution
  → **400** com `path: "steps[0].channel_id"` e a mensagem nova. Este segundo
  caso é exatamente o buraco que o código antigo deixava passar (escopo vazio →
  retornava cedo). Registros de teste apagados; banco de volta a 0 automações.
- **Na tela, com UMA conexão:** aviso de conexão apagada renderizado (o seletor
  se revela apesar do gate, como projetado), botão "Excluir" com texto em vez do
  caminho cru da chave, e o seletor de gatilho com 6 opções.
- **Na tela, com DUAS conexões:** interceptando só a resposta de
  `/api/cb/channels` no navegador (nenhum dado tocado) e navegando por dentro do
  app. Confirmado: "Vale para" = *Todos os canais* e "Enviar por" = *A mesma do
  disparo* aparecem lado a lado com as semânticas opostas corretas; a lista
  oferece as duas conexões; escolher "Comercial Oficial" e salvar grava
  `step_config = {"text":"...","channel_id":"ch-oficial"}` — **conferido no
  banco**. Registro apagado depois.
- **Precedência do canal, por teste** (`stepChannel` é privado, então o teste
  passa pelo motor e observa o que chega ao sender): passo vence disparo;
  sem passo herda o disparo; sem nada cai na conversa; `null` de config antiga
  não apaga o disparo. **Mutação conferida**: invertendo a precedência no
  código, o teste "o canal do PASSO vence o canal do disparo" falha.
- **`resolveEngineChannelPreferring` ganhou os primeiros testes** (6). É ele que
  transforma "o operador escolheu X" em "sai por X", e estava descoberto.
  Cobre: preferido vence a conversa; canal de OUTRA conta não vaza; canal
  apagado falha aberta; preferido apagado + conversa sem canal cai no padrão.

**Pendente para "pronto de verdade":** só o disparo real ponta a ponta — com as
duas conexões na MESMA conta, mensagem chegando pela A e saindo pela B de
verdade, pelo WhatsApp. Todo o resto da corrente está provado.

### Fase 2 — Funil nas automações — **PR 1, parte B**

| | |
|---|---|
| Objetivo | Automação lê e escreve o funil, e "Conversa Atribuída" dispara de verdade |
| Migration | `cb_automation_events` + triggers + RPC `cb_mover_negocio`, `automations.stage_ids`, trigger de limpeza |
| Arquivos-chave | migration nova, `src/lib/automations/engine.ts`, `src/app/api/automations/cron/route.ts`, rota de drain nova, `src/app/(dashboard)/pipelines/page.tsx`, `src/components/pipelines/deal-form.tsx`, `src/components/inbox/message-thread.tsx`, builder |

**Parte B1 — o gatilho (feito em 2026-08-03, migration `933_cb_gatilho_de_funil`):**

- [x] Caixa de saída `cb_automation_events` + trigger em `deals` (INSERT e
      UPDATE OF pipeline_id/stage_id/status), com as guardas de §4.1:
      `IS NOT DISTINCT FROM` no topo, INSERT enfileira, `origem` derivada como
      na 912, `REVOKE ALL FROM anon, authenticated` + RLS sem policy, índice
      parcial nos pendentes, poda de 30 dias. **Política de falha ENGOLE
      sempre** (diferente da 912): re-levantar faria o arrastar do card falhar
      por causa de uma automação.
- [x] `src/lib/automations/drain-events.ts` + rota
      `POST /api/automations/events/drain` + drenagem no cron de 15 min +
      poda. **Reivindicação em dois passos** para as duas pontas nunca
      dispararem o mesmo evento.
- [x] Aviso imediato pelos escritores de navegador via helper único
      (`avisar-drenagem.ts`, `keepalive`, fire-and-forget) — Kanban, save do
      `deal-form` e ganho/perdido.
- [x] Gatilho `deal_stage_changed` ("movido para **ou criado** na etapa") —
      troca de FUNIL tratada como mudança de etapa, que a 912 não emite.
- [x] Gatilho `deal_status_changed` (ganho/perdido/reaberto).
- [x] Recorte `automations.stage_ids` nos gatilhos existentes + trigger de
      limpeza ao apagar etapa (desativa se o escopo esvaziar) + **cópia no
      `duplicate`** + round-trip nas rotas POST/PATCH.
- [x] `deal_id`, `to_stage_id`, `from_stage_id` e `to_status` no
      `AutomationContext` — o evento carrega o card EXATO.
- [x] Tela: seletor de etapas agrupado por funil, nos dois papéis (config do
      gatilho e recorte da automação), com aviso de etapa apagada.

**Parte B2 — as ações (a fazer):**

- [ ] **B3** — gatilho `conversation_assigned` pela caixa de saída (trigger em
      `conversations`; só atribuição real, desatribuir não conta)
- [x] **Cadeia anti-ciclo (D13)**, migration **934**. Sem teto de
      profundidade, como o operador pediu: a chave é o par
      `deal:<id>|stage:<id>`, e o drenador recusa evento que revisite par já
      visitado NESTE encadeamento. Viaja por GUC transacional
      (`set_config('cb.cadeia', …, true)`) porque quem escreve o evento é o
      TRIGGER, que não recebe parâmetros — o UPDATE e o trigger estão na mesma
      transação, dentro da RPC. Escrita de gente não define nada e o trigger lê
      cadeia vazia: ação humana começa cadeia nova. **A trava provisória da 933
      saiu junto.**
- [x] Ações `move_deal_stage` e `set_deal_status`, via a RPC
      `cb_atualizar_negocio` (um `UPDATE` só com funil+etapa, exigência da 912;
      a etapa identifica o funil, então mover entre funis funciona). A RPC
      confere posse por conta — o motor roda em service-role e ignora RLS.
- [x] Alvo da ação: `context.deal_id` vence sempre (o evento carrega o card
      exato); sem ele, o negócio ABERTO mais recente (D8).
- [x] `create_deal` passa a usar `createDeal` — o insert direto herdado do
      upstream não validava posse do funil, pertencimento da etapa nem moeda
      da conta, e o próprio cabeçalho de `create-deal.ts` avisava disso.
      Colisão do índice único da 911 deixa de ser erro: vira
      "deal already existed", que é a regra "um funil por vez" funcionando.
- [x] `assign_conversation` mira a conversa do CONTEXTO. Antes filtrava só por
      conta+contato, então um contato com três conversas tinha as três
      atribuídas — inclusive as de outro número, atropelando o recorte por
      conexão. Sem conversa no disparo (etiqueta na ficha), cai em todas, como
      antes. 2 testes.
- [x] Condições `deal_stage` e `deal_status` — **leem o banco, não o
      contexto**. É a razão de existirem: depois de um `wait` de 240 horas o
      `to_stage_id` do contexto é história, e agir por ele mandaria ao cliente
      a cobrança de uma proposta que ele já aceitou.

**Pronto quando:** arrastar um card no Kanban dispara a automação em segundos
(não em 15 min); um card criado pelo roteador de entrada dispara "criado na
etapa"; mover entre funis dispara sem a trilha registrar saída-e-volta; e
atribuir uma conversa (na tela ou por automação) dispara `conversation_assigned`
sem entrar em laço.

**Verificação da parte B1** (2026-08-03, no banco de produção, tudo desfeito
depois — 0 automações, 0 logs, 0 eventos, card de volta na etapa original):

- Movi um card de verdade: **1 evento** na fila, com contato, canal e etapas
  de origem/destino resolvidos.
- **A guarda que mais importa:** re-salvei o card mencionando as três colunas
  com os MESMOS valores (é o que o `deal-form` faz ao editar só a anotação) —
  a fila continuou com **1** evento, não 2. Sem ela, editar anotação mandaria
  mensagem ao cliente.
- Automação ativa com gatilho em "Qualificado" + passo `wait` (escolhido de
  propósito: registra log e estaciona **sem enviar nada a cliente**). Movi o
  card para Qualificado → `POST /events/drain` → `automation_logs` com
  `trigger_event = deal_stage_changed` e canal carimbado, e o contexto
  estacionado carregando `deal_id`, `to_stage_id`, `from_stage_id` e
  `channel_id` intactos no JSONB.
- **Negativo:** movi o card para "Lead", que NÃO está na config do gatilho. O
  evento foi entregue ao motor e o `triggerMatches` o descartou —
  `automation_logs` continuou com 1 linha. Isso revelou que o campo
  `disparados` do resultado da drenagem mentia (contava eventos entregues, não
  automações executadas); renomeado para `entregues`, com o porquê no tipo.
- 13 testes novos (`funil.test.ts`): casamento dos dois gatilhos, config vazia
  = qualquer etapa, contexto sem etapa não casa (falha fechada), contexto do
  evento e a guarda de atraso de 1h.

### Fase 2b — Tempo: lembretes por data — **PR 2**

| | |
|---|---|
| Objetivo | Confirmação de reunião e follow-up por horário — as duas peças de §4.6, "essenciais" na palavra do operador |
| Migration | tabela de dedup de disparos (faixa 900+) |
| Arquivos-chave | migration nova, `src/lib/automations/engine.ts`, `src/app/api/automations/cron/route.ts`, `docker-stack.yml`, `docs/DEPLOY-VPS.md`, `src/components/contacts/custom-fields-manager.tsx`, builder |

- [x] Gatilho `date_field_offset` (migration **935**): varredura no cron,
      dedup por `(automation_id, contact_id, valor)` — **o valor na chave é o
      que faz reunião remarcada re-armar** — e guarda de atraso de 1h.
- [x] `cb_para_timestamp`: casamento SEGURO de texto para data. `value` é TEXT
      livre e um `::timestamptz` cru derrubaria a varredura inteira por causa
      de uma linha com "amanhã de tarde" escrito.
- [x] A janela é feita **no banco** (`cb_alvos_de_lembrete`). Ler
      `contact_custom_values` inteiro e filtrar em JS esbarraria no teto de
      1000 linhas do PostgREST sem avisar — varredura incompleta com cara de
      completa.
- [x] Tipo `datetime` no gerenciador de campos + input `datetime-local` na
      ficha do contato. `src/lib/contacts/campo-data.ts` guarda a conversão
      nos dois sentidos: **banco em ISO absoluto, tela em hora local**.
- [x] Dois laços no agendador (§4.6a): **60 s** para automações, **900 s** para
      agendadas e fluxos. ⚠️ O de 900 s não pode encolher — o número tem de
      bater com `CICLO_MINUTOS` de `src/lib/scheduled/display.ts`.
      ⚠️ **Exige `docker stack deploy` à mão na VPS**; o CI só troca a imagem.
- [x] Tela: seletor de campo de data + horas + antes/depois no card do gatilho,
      com aviso quando não existe campo do tipo Data.
- [x] Verificações de sempre (i18n-parity 2019/2019, typecheck, lint, 1317 testes)

**Pronto quando:** contato com "Reunião" amanhã às 10h, numa automação "24h
antes → enviar mensagem", recebe hoje às ~10h (± um ciclo); remarcar re-arma o
lembrete; reunião passada não dispara; e um `wait` de 2 minutos resume em ~2
minutos, não em 15.

**Verificado em 2026-08-03**, com campo, contato e valor DESCARTÁVEIS, tudo
apagado depois (0 campos personalizados, 69 contatos e 59 negócios reais):

- Reunião daqui a 23h40, automação "24h antes": ciclo 1 disparou; ciclos 2 e 3
  responderam `repetidos: 1` e não dispararam de novo.
- **Remarquei** a reunião (valor novo, ainda na janela) → disparou outra vez.
  É o valor na chave da trava fazendo seu trabalho.
- **Reunião 30h no passado** → `disparados: 0`. Ninguém recebe "faltam 24h"
  depois da reunião.
- ⚠️ **Um erro meu de montagem virou prova de outra coisa:** criei o campo com
  `accounts limit 1` e a automação na conta do operador — contas diferentes. A
  varredura respondeu `disparados: 0`, ou seja, **o filtro por conta da
  `cb_alvos_de_lembrete` recusou cruzar contas**, que é a única barreira ali
  (o motor roda em service-role e ignora RLS).
- Mutação conferida no sinal do deslocamento: invertendo `antes`/`depois`, dois
  testes falham. É o defeito mais provável e mais silencioso da feature —
  mandaria a confirmação 24h DEPOIS da reunião.

### Fase 3 — Orquestração (acionar/parar) — **PR 3** ✅

- [x] `runAutomationById` + ação `run_automation`
- [x] `'cancelled'` em `automation_pending_executions` + ação `stop_automation`
- [x] **Corrigir:** desativar automação passa a impedir o resume de execução parada
- [x] `abortActiveRunsForContact()` extraído + ação `stop_flow`
- [x] `startNewRun` exportável + ação `run_flow` (o "Executar Robô X" do print) —
      **substitui** a run ativa (D11)
- [x] Ação `set_ai` — desligar/religar IA na conversa; religar **zera o
      contador** (D10); slot `agent_id` reservado (D7)
- [x] Guarda anti-ciclo unificada (D13) para automação→automação→fluxo

### Fase 4 — Mídia — **PR 4** ✅

- [x] Passo `send_media` (imagem, vídeo, documento, áudio) com upload no builder
      (bucket `chat-media`; URL pública aceita — D12)
- [x] Corrigir `media_url` não gravado por `engineSendMedia` (defeito herdado dos fluxos)

### Fase 5 — Builder por etapa, estilo Kommo — **PR 5**

- [x] Painel por etapa dentro de `src/components/pipelines/`, listando e criando
      automações de `deal_stage_changed` daquela etapa
- [x] Só faz sentido depois da Fase 2 (o gatilho) e da Fase 3 (o "acionar robô")

### Fase 6 — `docs/INFRA-VPS.md`: o que o banco tem e a VPS não — **PR 6**

Não é feature de automação; entrou aqui porque **esta série criou a dependência**.
O laço rápido de 60 s do agendador não nasce por push nenhum (o CI só troca a
imagem do `crm_crm`), então "lembrete de reunião" e passo "Aguardar" passaram a
depender de um `docker stack deploy` feito à mão, que hoje não está registrado
em lugar nenhum. Pedido pelo operador em 2026-08-04.

**O problema em uma frase:** o schema do banco tem migrations, um histórico e
uma ordem de aplicação; a VPS não tem nada disso. Se a máquina morrer, o que
existe para reconstruí-la é `docs/DEPLOY-VPS.md` — que documenta **só a stack do
CRM** e assume de pé tudo que está por baixo.

O que **não** está escrito em lugar nenhum (levantado em 2026-08-04):

| Camada | Onde está hoje |
|---|---|
| Stack do CRM (`crm_crm` + `crm_agendador`) | ✅ `docker-stack.yml`, versionado |
| CI/CD e segredos do GitHub | ✅ cabeçalho do `deploy.yml` |
| Variáveis do `crm.env` | 🟡 a lista real é o bloco `environment:` do `docker-stack.yml`; o §3 do `DEPLOY-VPS.md` está atrasado |
| **Traefik** (config, entrypoints, store do Let's Encrypt) | ❌ nada |
| **Rede `CBAdvNet`** | ❌ só a nota de armadilha (`not manually attachable`), não como criar |
| **Evolution API** (imagem, banco, Redis, volumes, env, rota `api.cbadvogados.com`) | ❌ **nada** |
| Registros DNS (`crm`, `api`, `vps`) | ❌ nada |
| `docker login ghcr.io` na VPS (pull da imagem privada) | 🟡 uma linha solta |
| Backup de qualquer coisa | ❌ nada, e não se sabe se existe |

⚠️ **O que dói de verdade é a sessão do WhatsApp.** O Supabase é gerenciado e
mora fora da VPS, então contato, conversa, mensagem e funil **sobrevivem** à
máquina morrer — a VPS não guarda dado de negócio nenhum. Mas o pareamento do
número (o QR lido uma vez) vive nos volumes da Evolution, dentro dela. Sem
backup, migrar quer dizer **reler o QR em cada número**, com o escritório sem
WhatsApp até alguém com o celular na mão refazer isso. O resto (Traefik,
certificado, rede) reconstrói em minutos — desde que alguém saiba os valores
exatos, que hoje existem só na cabeça de quem configurou.

- [ ] **Uma passada de leitura na VPS** — `docker service ls`, `docker service
      inspect` de cada serviço, `docker volume ls`, `docker network inspect
      CBAdvNet` e o arquivo de stack da Evolution. ⚠️ **Bloqueador:** em
      2026-08-04 o SSH foi recusado pelo classificador de permissões do Claude
      Code. Sem liberar isso, o documento sai do repositório e da memória — ou
      seja, sai **adivinhado**, que é pior que não existir
- [ ] `docs/INFRA-VPS.md` = inventário do que existe + runbook de reconstrução do
      zero, na ordem em que as camadas dependem umas das outras
- [ ] Responder explicitamente **o que tem backup e o que não tem** (hoje ninguém
      sabe), e o custo de perder cada coisa
- [ ] Regra de manutenção, no molde das migrations: **toda mudança na VPS ganha
      uma linha ali, no mesmo PR** — documento que mente é pior que ausente
- [ ] Corrigir o `DEPLOY-VPS.md`, que ainda abre dizendo que
      `crm.cbadvogados.com` aponta para a Hostinger. O cutover de DNS foi feito
      em 2026-07-25; o passo 1 dele descreve trabalho que já está pronto

---

## 6. Armadilhas que valem para qualquer fase

1. **Escopo vazio = TUDO**, nunca "nenhum". Vale para canal, etapa e qualquer
   recorte novo. Uma tela que disser "nenhum" onde o motor lê "todos" faz o
   operador desativar a regra errada.
2. **Seletor some com menos de 2 opções** — convenção do projeto.
3. **Registro sem id mostra travessão**, nunca o padrão da conta.
4. **Filtro não esconde o irrestrito** — automação sem escopo dispara em tudo e
   continua visível sob qualquer filtro.
5. **Toda chave nova entra nos DOIS dicionários na mesma passada.** O fallback do
   next-intl é por arquivo, não por chave: chave faltando vira `MISSING_MESSAGE`
   na tela do usuário.
6. **UUID órfão em JSONB não é limpo por FK.** Apagar canal/etapa/funil deixa o
   id preso no `step_config`/`trigger_config`. Ou trigger de limpeza, ou aviso na
   tela (o builder já faz isso para canal, `automation-builder.tsx:1509-1519`).
7. **Migration nossa na faixa `900+` com prefixo `cb_`.** Rodar
   `ls supabase/migrations/` **e** `list_migrations` imediatamente antes de criar
   o arquivo — os dois já divergiram.
8. **`git push origin main` deploya produção.** Trabalhar em branch saída de
   `main`, PR só para o CB-CRM.

---

## 7. Perguntas em aberto

**Nenhuma.** As oito da primeira versão foram respondidas pelo operador em
2026-08-03 e viraram as decisões **D7–D14** (§3). Dois detalhes foram decididos
de ofício pela implementação e estão sinalizados para veto: a guarda
**anti-ciclo** no lugar do teto de profundidade que o operador recusou (D13,
§4.1) e o **fuso explícito** no valor do campo de data (§4.6b).

---

## Registro de progresso

| Fase | PR | Estado | Branch | Quando |
|---|---|---|---|---|
| 0 — investigação | — | ✅ concluída | — | 2026-08-03 |
| 1 — conexão | 1 (parte A) | ✅ concluída, **em produção** | `main` | 2026-08-04 |
| 2 — funil | 1 (parte B) | ✅ concluída, **em produção** | `main` | 2026-08-04 |
| 2b — tempo (lembretes) | 2 | ✅ concluída, **em produção** | `main` | 2026-08-04 |
| 3 — orquestração | 3 | ✅ concluída | `feat/automacoes-orquestracao` | 2026-08-04 |
| 4 — mídia | 4 | ✅ concluída | `feat/automacoes-orquestracao` | 2026-08-04 |
| 5 — builder por etapa | 5 | ⬜ não iniciada | — | — |
| 6 — `docs/INFRA-VPS.md` | 6 | ✅ concluída | `feat/automacoes-orquestracao` | 2026-08-04 |

✅ **Laço rápido de 60 s no ar desde 2026-08-04 17:10 UTC.** O operador rodou o
`docker stack deploy` na VPS (o CI só troca a imagem do `crm_crm`, nunca sobe
serviço novo). Confirmado pela linha `[agendador] laço rápido (60s)…` na tarefa
`ipc58leozeq9` e pelo `cb_agendador_batimento` respondendo 1 s depois. "Aguardar",
lembretes por data e a fila do funil saíram do ritmo de 15 min.

⚠️ **Dívida que isso deixou: o laço rápido pode morrer em SILÊNCIO.** Ele roda
em segundo plano (`&`) e o lento em primeiro plano. Se o lento cair, o contêiner
cai junto e o Swarm reinicia — visível. Se o rápido cair sozinho, o contêiner
segue de pé fazendo metade do trabalho, e **nada percebe**: só a rota de
agendadas tem batimento (`cb_agendador_batimento`, migration 927). É exatamente
o modo de falha que aquele batimento foi criado para eliminar do outro lado.

Conserto proposto (migration própria, PR à parte): um segundo carimbo na mesma
forma, escrito por `/api/automations/cron`, com o mesmo aviso âmbar no cabeçalho
quando envelhecer. Barato e mecânico — não entrou no PR 3 por ser schema fora do
escopo de orquestração.

✅ **CAUSA IDENTIFICADA (mesmo dia, mais tarde).** Aquele `crm_agendador` que
"morreu sozinho" às ~17:03 UTC não teve causa misteriosa: **a VPS inteira
reiniciou** às ~17:02. Quase todo serviço da máquina tem um `Failed` com exit
255 no mesmo instante, e o erro de DNS da tarefa seguinte é o mesmo sintoma que
manteve a Evolution fora do ar por uma hora. Registrado em
[`docs/INFRA-VPS.md`](INFRA-VPS.md) §8.

**Lição:** "causa não identificada" num serviço isolado, com erro de rede logo
depois, merece um olhar no uptime da máquina antes de virar mistério.

### Histórico

**2026-08-03 — Fase 0, investigação.** Mapeado o motor de automações (8 gatilhos,
13 passos, 5 condições), a tela (1825 linhas, um gatilho por automação, passos em
árvore), o modelo de funil/etiqueta/campo personalizado, a IA, os fluxos e a
mídia. Achados 8 defeitos (B1–B8), sendo 2 gatilhos que nunca disparam. Confirmado
que **todo id já é UUID estável** — o item 4 do pedido não gera trabalho.
Confirmado que o agendador roda de 15 em 15 min e que isso é lento demais para o
gatilho de etapa, o que decidiu o desenho da caixa de saída. Nada implementado.

**2026-08-03 — Revisão do plano (2ª passada).** Correções sobre a 1ª versão:
(1) **B3 mudou da Fase 1 para a Fase 2** — dependia da caixa de saída, que só
nasce lá; a 1ª versão tinha essa dependência invertida. (2) **B5 reclassificado
como não-defeito**: a Evolution não envia botão, logo não recebe resposta de
botão — verificado que `inbound-store.ts` não tem o que parsear. (3) Medido que
**as duas conexões da conta são Evolution** → critérios de pronto ajustados
(Meta-only se prova por teste, não na tela). (4) **B6 dobrou de tamanho**:
verificado que `validateChannelScopeForActivation` ignora `step_config.
channel_id` e retorna cedo com escopo vazio — a validação por canal efetivo do
passo entrou na Fase 1. (5) **Q8 nova**: `time_based` não tem alvo natural
(dispara para quem?); proposta de desenho contactless registrada. (6) §4.1
ganhou as guardas que faltavam (`IS NOT DISTINCT FROM`, INSERT enfileira,
origem/profundidade via RPC + GUC, REVOKE, GC, trigger de conversa só em
atribuição real, fan-out do `assign_conversation`). (7) §4.3 ganhou as
**condições `deal_stage`/`deal_status`** — sem elas o padrão do Kommo "depois
de X horas, se ainda está na etapa" não é exprimível — e o `deal_id` no
contexto. (8) Mapeamento de PRs alinhado à decisão D5 (Fases 1+2 = PR 1).

**2026-08-03 — Rodada de decisões: Q1–Q8 respondidas (D7–D14).** Destaques:
agentes de IA **nomeados** são feature futura, pré-avaliada em §4.7 para o passo
`set_ai` já nascer com slot `agent_id`; encadeamento por automação é **sem
teto**, com guarda **anti-ciclo** (D13); e o operador redefiniu "tempo" (D14) —
o `time_based` cru sai do seletor (a parte A ficou **sem migration**) e nasce o
gatilho **relativo a data de campo personalizado** (§4.6, lembrete de reunião),
promovido a **PR 2 próprio (Fase 2b)** por ser "essencial" na palavra dele —
orquestração, mídia e builder viraram PRs 3/4/5. O `wait` ganha cadência de
60 s no agendador e piso honesto de 1 min na tela. Decisões D8–D12 destravaram
os pontos que faltavam nas Fases 1b/3/4. Nada implementado ainda.

**2026-08-03 — Fase 1 (parte A) implementada.** Branch
`feat/automacoes-canal-por-passo`, saída de `main`, **sem commit e sem migration**.
9 arquivos, +472/−47. Todos os itens da Fase 1 marcados acima.

Achado que muda o enquadramento do pedido original: **nenhuma conta tem 2
conexões** — os dois números estão em contas diferentes (§2.0). O escopo de
canal do gatilho sempre existiu; o operador nunca pôde vê-lo porque o seletor
se esconde com menos de 2 conexões. Nada a corrigir em código.

Revisão adversarial (3 lentes independentes → verificação cética por achado;
17 analisados, 14 refutados, **3 confirmados**):

1. **[alta] Conexão apagada no `step_config` não avisava nada** — achada por
   DUAS lentes independentes. Eu tinha copiado o seletor da condição por canal
   sem copiar o aviso `channelGone` que ela já tinha; o passo voltaria a herdar
   em silêncio e a mensagem sairia pelo número não oficial. **Corrigido**, com
   texto próprio (diz que a mensagem CONTINUA saindo, por outro número — o
   oposto do aviso da condição, que fica inerte) e com a escapatória do gate.
2. **[baixa] O docblock de `channelInScope` passou a mentir** — ele afirmava
   que `tag_added` chega sem canal e que barrá-lo seria regressão; depois do B2
   é justamente o contrário. **Corrigido** (só comentário), estreitando a nota
   para o resíduo que ainda passa livre.
3. O terceiro confirmado é a mesma causa-raiz do nº 1, por outra lente.

Os 14 refutados incluem quatro que pareciam graves e não eram: canal de outra
conta no `step_config` (o resolvedor falha aberta, de propósito e documentado),
regressão no `tag_added` (é a mudança pretendida, B2), e dois pré-existentes em
arquivos que este diff nem toca.

**2026-08-03 — Fase 1: fechamento da verificação.** Restavam duas lacunas, e as
duas eram fecháveis sem conexão nova. (1) **A precedência do canal não tinha
teste nenhum** — nem `stepChannel`, nem `resolveEngineChannelPreferring`, que é
justamente o que transforma a escolha do operador em envio. 10 testes novos, e
a mutação foi conferida: invertendo a precedência, o teste crítico falha.
(2) **O seletor com 2 conexões nunca tinha sido visto** — verificado
interceptando só a resposta de `/api/cb/channels` no navegador, com navegação
soft por dentro do app; a escolha grava no banco. Total: 1282 testes.
Sobra apenas o disparo real pelo WhatsApp, que depende de dado, não de código.

**2026-08-03 — Fase 2, parte B1: o gatilho de funil.** Migration **933**
aplicada em produção (`ls` + `list_migrations` conferidos antes; os dois
diziam 932). Caixa de saída, trigger, drenagem em duas pontas, os dois
gatilhos novos, o recorte por etapa e a tela. 1295 testes.

Dois defeitos meus achados durante a implementação, antes de aplicar:
(1) a busca do canal estava FORA do bloco de exceção do trigger — uma falha
ali derrubaria o arrastar do card, exatamente o que a política de falha
promete impedir; (2) o resultado da drenagem chamava de `disparados` o que era
"entregues ao motor", afirmando que uma automação rodou quando o filtro de
gatilho a tinha descartado.

⚠️ **Trava provisória no trigger:** card criado por automação (`source =
'automation'`) NÃO re-enfileira. O passo `create_deal` já existe e giraria
para sempre ("criou card na etapa X → cria negócio"), e a cadeia anti-ciclo
(D13) só chega com as ações de funil. A linha sai junto com ela.
*(Saiu na 934, no mesmo dia.)*

**2026-08-03 — Fase 2, parte B2: as ações e a cadeia.** Migration **934**
aplicada. `move_deal_stage` e `set_deal_status` via RPC, e a guarda anti-ciclo
**sem teto** que o operador pediu.

Provado montando o laço de propósito, em produção: duas automações apontando
uma para a outra (Avulso→Qualificado, Qualificado→Avulso), as duas ativas.
Drenando em sequência, a cadeia cresceu 0 → 1 → 2 e a volta seguinte foi
barrada, com o motivo escrito na coluna `erro`:
*"ciclo detectado (deal:…|stage:… já visitado neste encadeamento)"*.
Três voltas e parou — não quatro, não infinitas. Tudo apagado depois.

⚠️ **Efeito colateral do teste:** as idas e voltas geraram **9 linhas
`stage_changed` em `cb_lead_events`** no negócio de uma cliente real (Erika
Meireles), em 2026-08-03 entre ~19:58 e ~20:41, todas com `origin = 'sistema'`.
O card voltou à etapa original. **Decisão do operador (2026-08-03): ficam como
estão** — nada de auditoria foi apagado. Quem estranhar movimentações de etapa
nessa ficha naquela noite, é isto.
**Lição para o próximo teste de funil: usar um negócio descartável, criado
para o teste e apagado depois — não um card de cliente real.**
*(Aplicada no teste seguinte, das condições: contato e negócio "ZZ …" criados
e apagados, sem tocar em cliente nenhum.)*

**2026-08-03 — Fase 2 fechada.** `create_deal` pelo criador central,
`assign_conversation` mirando a conversa certa, e as condições `deal_stage` /
`deal_status`. 1304 testes.

O padrão do print do Kommo foi provado inteiro, com dado descartável: gatilho
"entrou em Qualificado" → condição "está em Qualificado?" (lida do banco) →
ação "mover para Desqualificado". O log registrou `branch=yes` e
`move_deal_stage` com sucesso, e o card chegou onde devia. Tudo apagado.

**2026-08-03 — Fase 2b: lembrete por data.** Migration **935** aplicada.
`cb_para_timestamp` (cast que devolve NULL em vez de estourar), `cb_alvos_de_
lembrete` (a janela resolvida em SQL, para não esbarrar no teto de 1000 linhas
do PostgREST), `cb_automation_reminders` com `UNIQUE (automation_id,
contact_id, valor)`, o tipo **Data** no campo personalizado e o seletor na
ficha do contato. 1317 testes.

Três armadilhas tratadas, todas silenciosas: (1) **fuso** — contêiner em UTC,
operador em Brasília; sem conversão explícita *todo* lembrete erraria por 3h
sem erro nenhum, então as duas conversões vivem num módulo só
(`campo-data.ts`); (2) **reunião remarcada** — o valor da data entra na chave
única, então remarcar re-arma e o mesmo horário nunca dispara duas vezes;
(3) **texto que não é data** — o campo é livre, e um cast cru derrubaria a
varredura inteira por causa de uma linha, deixando todo mundo sem lembrete.

Provado em produção com dado descartável: reunião a 23h40 disparou no ciclo 1
e respondeu `repetidos: 1` nos ciclos 2 e 3; remarcar re-armou; reunião 30h no
passado não disparou. Conferido por mutação que inverter `antes`/`depois`
quebra o teste crítico — é o defeito mais provável da feature, e mandaria a
confirmação **depois** da reunião.

Um erro meu de montagem virou prova de outra coisa: criei o campo numa conta e
a automação em outra, e a varredura devolveu zero. Ou seja, o filtro por conta
de `cb_alvos_de_lembrete` **recusou cruzar contas** — a única barreira ali,
já que o motor roda em service-role e ignora RLS.

**2026-08-04 — PRs 1 e 2 em produção; Fase 6 entra no plano.** As Fases 1, 2 e
2b foram para o `main` (4 commits) e o CI rolou a imagem. Migrations 933/934/935
já estavam aplicadas desde 2026-08-03.

⚠️ **Estado que existiu entre as duas datas, e a lição:** as migrations foram
para produção um dia antes do código. O gatilho do banco ficou vivo sem
consumidor — **cada card arrastado gravava uma linha em `cb_automation_events`
que ninguém drenava**. Foi inofensivo por desenho (a guarda de atraso de 1h
descarta com o motivo escrito, em vez de despejar), e a fila estava em 0 no
momento do push. Mas a ordem certa é código antes de trigger, ou os dois
juntos: uma migration que instala um produtor sem instalar o consumidor deixa
produção acumulando em silêncio.

**Fase 6 nasceu de um pedido do operador**, ao perguntar se existia para a VPS
algo equivalente às migrations do banco. Não existe — levantamento na §5. O que
tornou a pergunta urgente foi esta própria série: o laço de 60 s do agendador
não sobe por push, então "lembrete de reunião" passou a depender de um
`docker stack deploy` manual que não estava registrado em lugar nenhum.
A resposta curta: **o banco sobrevive à VPS morrer** (Supabase é gerenciado e
fica fora), **a sessão do WhatsApp não** — ela vive nos volumes da Evolution, e
sem backup migrar significa reler o QR de cada número.

**2026-08-04 — Fase 3: orquestração.** Migration **936** aplicada (`ls` +
`list_migrations` conferidos: os dois diziam 935). Cinco passos novos —
`run_automation`, `stop_automation`, `run_flow`, `stop_flow`, `set_ai` —, a
guarda anti-ciclo unificada e o defeito do resume corrigido. 1339 testes.

**A migration é pequena de propósito.** Os passos novos NÃO precisaram de
schema: `automation_steps` não tem CHECK em `step_type`. As duas linhas que
entraram existem porque "parar" não tinha como ser REGISTRADO, e o motor teria
de mentir sobre o que aconteceu: execução cancelada viraria `failed` (o painel
diria que quebrou) e robô parado por regra viraria `paused_by_agent` (a tela
diria que uma PESSOA interveio, quando não houve pessoa nenhuma).

Decisões tomadas pela implementação, sinalizadas para veto:

- ⚠️ **`run_automation` e `run_flow` EXIGEM o alvo ativo.** A alternativa
  ("é uma ordem explícita, obedeça") deixa o interruptor da tela de ser freio:
  com algo saindo errado, o operador desliga e a peça continua rodando,
  acionada por uma regra que ele talvez nem lembre que existe. Robô sob
  demanda não precisa ficar inativo para isso — é para isso que existe
  `trigger_type: 'manual'`, que já não parte de mensagem nenhuma
  (`findEntryFlow`).
- **`stop_automation` é recortado por CONTATO.** Cancelar as esperas da
  automação alvo para a conta inteira faria um cliente entrando numa etapa
  apagar o follow-up de 24h de todos os outros, em silêncio e sem desfazer.

Dois achados de arquitetura durante a implementação:

1. ⚠️ **Ciclo de import iminente.** `flows/engine → contacts/tag-events →
   automations/engine`; o motor de automações importar `flows/engine` fecharia
   o ciclo. (O `automations/engine` já desviava disto de propósito ao importar
   `tag-write` em vez de `tag-events` — o desvio estava lá, sem nota.) Resolvido
   com `flows/parar-run.ts`, que não depende de nada, mais **um import dinâmico**
   para `startFlowForContact`, que precisa do laço de avanço.
2. ⚠️ **A etiqueta é um segundo caminho de recursão**, e ele não passa por
   `run_automation`: "A aciona B, B aplica etiqueta, a etiqueta dispara A". O
   que salva é o `...input.context` de `tag-events.ts`, que carrega a cadeia
   para dentro do disparo novo. Era load-bearing e não tinha nota; tem agora.
   Sem ele o único freio seria `MAX_TAG_CHAIN_DEPTH = 3`, ou seja, o cliente
   ainda receberia 3 rajadas.

**Provado em produção, com dado descartável** (contato, etiqueta, robô e
automações "ZZ …", todos apagados depois; nenhum passo manda mensagem, os
observáveis são etiqueta, registro e coluna):

- **Laço pelos DOIS caminhos ao mesmo tempo** — A aciona B por
  `run_automation`, B aplica a etiqueta que A escuta. Parou na 2ª volta, com o
  motivo escrito nos dois logs: *"ciclo detectado (automation:… já visitado
  neste encadeamento)"*. 3,3 segundos, 2 execuções, 1 etiqueta aplicada.
- **Desativar PARA o que está parado** — automação inativa com espera vencida
  → `cancelled`, e nem chegou a buscar os passos. Conferido por mutação: sem a
  guarda, o teste falha.
- **`run_flow` substitui a run ativa** — a antiga virou
  `stopped_by_automation` / `replaced_by_automation` e a nova nasceu. É a
  prova da ordem "encerrar ANTES de inserir": ao contrário, o INSERT bateria no
  índice único parcial e voltaria 23505, que `startNewRun` engole como
  duplicata — o robô novo simplesmente não nasceria, sem erro na tela.
- **`set_ai` religando** zerou os quatro campos (`ai_autoreply_disabled`,
  `ai_reply_count` 7→0, `ai_handoff_summary`, `assigned_agent_id`).

Efeito colateral do dia, **em dado real e benigno**: a fila de funil tinha 3
eventos de cards criados por clientes que chegaram, e o mais antigo foi
descartado pela guarda de atraso com o motivo escrito — *"evento atrasado 1h —
não disparado para não despejar fila represada"*. É a guarda funcionando em
produção, em dado real, pela primeira vez.

⚠️ **Pendência que a Fase 3 herda e não resolve:** o passo `wait` e tudo que
depende do cron continuam no ritmo de 15 min até o `docker stack deploy` do
laço rápido ser feito na VPS.

**2026-08-04 — Batimento do laço rápido (migration 937).** A dívida registrada
horas antes, paga no mesmo dia: o laço de 60 s podia morrer em silêncio, e a
tela continuaria dizendo "agendador OK" com o passo "Aguardar" sem acordar e o
lembrete de reunião sem sair. Agora `/api/automations/cron` carimba
`cb_agendador_batimento.ultimo_ciclo_automacoes`, e o aviso do cabeçalho ganhou
o recado próprio. 1347 testes.

**Coluna, não tabela nova.** A 927 já é "sinais vitais do agendador" com todo o
aparato de RLS e REVOKE; um segundo laço do MESMO processo é a mesma coisa.

O que morde código novo:

- ⚠️ **O carimbo fica ANTES dos `return` da rota, num call site só.** O caminho
  comum sai pelo `return` do meio ("não havia execução parada"); carimbar no
  fim faria o batimento só bater quando houvesse trabalho — o defeito exato que
  a 927 nasceu para consertar do outro lado. E protege de quem vier depois: um
  `return` novo não tem como pular um carimbo já feito.
- ⚠️ **`undefined` (a tela não perguntou pela coluna) NÃO acende**, e é
  diferente de `null`/epoch (perguntou, nunca rodou). Tratar os dois igual faria
  toda chamada antiga de `avaliarAgendador` acusar um laço morto que está vivo.
  Quando a LEITURA falha o hook manda `undefined` de propósito: ali o
  `ultimoCiclo` já vira `null` e acende sozinho, e um segundo alarme pela mesma
  causa mandaria o operador caçar defeito inexistente.
- ⚠️ **O recado do laço rápido vem DEPOIS dos de agendador parado.** Contêiner
  morto envelhece os dois batimentos juntos, e o recado de cima é mais grave
  porque sabe da fila. Este é para o caso novo: lento vivo, rápido morto.
- **Tolerância de 5 min** (cinco ciclos), contra 35 do laço lento. Não é
  derivada de `CICLO_MINUTOS`: a cadência do laço rápido vive no
  `docker-stack.yml`, fora do código.

Achado na verificação visual, com o cenário plantado em produção (lento fresco,
rápido em `epoch`): o título da caixa dizia **"MENSAGENS AGENDADAS"** enquanto o
corpo dizia "as mensagens agendadas não são afetadas". O título passou a seguir
o recado — e o rótulo acessível junto, senão quem usa leitor de tela ouviria o
assunto errado antes de abrir. Conferido por mutação que os testes pegam a
remoção da checagem (3 falham).

**2026-08-04 — Fase 6 concluída, e ela achou um incidente em produção.**
`docs/INFRA-VPS.md` escrito a partir de `scripts/vps-inventario.sh`, rodado de
verdade contra a máquina (o operador autorizou a chave de leitura no mesmo dia).

⚠️ **O levantamento descobriu que o WhatsApp do escritório estava fora do ar
havia uma hora.** A VPS reiniciou às ~17:02 UTC; `evolution_evolution` e os três
serviços do `n8n` ficaram em laço de reinício por não resolverem `postgres:5432`
— a rede overlay do Swarm volta pela metade depois de reboot. Curado com
`docker service update --force`, e confirmado pelo fluxo de mensagens voltando
ao ritmo normal.

**A lição de monitoramento vale para este plano inteiro:** o CRM respondeu 200
o tempo todo, então qualquer monitor de "o site está no ar?" teria dito que
estava tudo bem. O sinal honesto é o **fluxo de mensagens no Supabase**. E o
cabeçalho do CRM chegou a exibir "1 conexão, 1 com problema" uma hora antes,
visto e ignorado numa verificação de outra feature.

Achados que a Fase 6 registrou e ninguém sabia: **10 stacks, 16 serviços** na
máquina; **nenhum backup de nada**; **9 das 10 definições de stack existem só em
`/root/`, fora do git**; a Evolution é um **fork nosso** (`-lidfix`) que o label
da stack não reflete; e 3,7 GB de volumes órfãos do Chatwoot.

**2026-08-04 — Fase 4: mídia.** Passo `send_media` (imagem, vídeo, documento e
áudio) com upload no builder, e o defeito herdado dos fluxos corrigido.
**Sem migration** — `automation_steps` não tem CHECK em `step_type`. 1353 testes.

⚠️ **O defeito herdado era pior do que "faltava um campo".** `engineSendMedia`
gravava a linha em `messages` com `content_type = 'image'` e **`media_url`
nulo**: o cliente recebia a imagem pelo WhatsApp e a EQUIPE via uma bolha vazia
no CRM. É o pior formato de defeito — ninguém desconfia do que já saiu. O envio
manual sempre gravou (`send-message.ts:783`); só este caminho não. A correção
vale para os FLUXOS também, que usavam o mesmo sender.

⚠️ **Áudio não leva legenda, e o dano é silencioso.** A nota de voz sai por
`sendWhatsAppAudio`, que não tem campo de legenda: o texto seria gravado em
`messages.content_text`, apareceria no fio para a equipe e **não viajaria** ao
cliente — a equipe leria uma conversa que o cliente nunca teve. A guarda está
em três lugares, como na 932: validação, tela e motor (a config pode ter sido
gravada antes da regra). Conferido por mutação.

Decisões da implementação:

- **Na tela, o campo de legenda SOME no áudio** — não fica desabilitado. Campo
  inerte convida a digitar; ausente, com o porquê no lugar, ensina. E trocar o
  tipo para áudio **limpa** a legenda já digitada, senão ela ficaria gravada,
  invisível, e a ativação seria recusada sem o operador ver o motivo.
- **Sem coleta de lixo do arquivo.** O mesmo objeto serve toda execução; apagar
  no envio (como a agendada faz) quebraria a automação no segundo disparo.
- **`engineSendMedia` vem dos FLUXOS**, como `engineSendInteractive*` já fazia
  em `automations/meta-send.ts`. Sem ciclo: `flows/meta-send` só depende de
  `whatsapp/*` e `cb-channels/*`.

Verificado na tela: o passo aparece no menu, o editor nasce em Imagem com
legenda, e trocar para Áudio faz o campo sumir e a explicação aparecer.

**2026-08-04 — Fase 5: o painel por etapa.** O raio no cabeçalho de cada coluna
do Kanban abre a lista de automações daquela etapa e cria a próxima já com o
gatilho apontando para ela. **Sem migration** — a Fase 2 já tinha o gatilho e o
recorte. 1381 testes.

A regra de classificação ficou fora da tela, em `src/lib/automations/por-etapa.ts`,
pelo mesmo motivo dos filtros do inbox: a resposta tem de ser a MESMA que o
motor dá, e a única forma de garantir isso é ter um lugar só, testado.

⚠️ **O painel mostra TRÊS grupos, e o segundo é a razão de ele existir.**
Automação com `trigger_config.stage_ids` vazio dispara em TODA etapa. Um painel
que listasse só quem NOMEIA a coluna diria "nada acontece nesta etapa" enquanto
o motor manda mensagem a cada card que entra — o formato de defeito que este
projeto trata como o pior, porque a tela parece certa. Conferido na produção: a
coluna "Desqualificado", jamais nomeada na automação de teste, exibiu o grupo
"De todas as etapas" com a explicação.

⚠️ **O terceiro grupo, "Nunca dispara aqui", nomeia um estado alcançável pela
tela de hoje.** São duas listas de etapa com significados opostos —
`trigger_config.stage_ids` ("entrou nesta") e `automations.stage_ids` ("está
nesta", o escopo). Trocar o tipo de gatilho para "mudou de etapa" ESCONDE o
seletor de escopo e não limpa o valor: a automação fica ligada, configurada e
incapaz de rodar, sem nada na tela dizendo isso. Por isso o botão "Nova
automação nesta etapa" preenche só o gatilho — preencher os dois funciona hoje
e fabrica a armadilha para amanhã.

Decisões da implementação:

- **A etiqueta conta só o que dispara E está ligado.** Contar a pausada põe um
  número numa coluna onde nada acontece, e o operador vai caçar defeito no motor.
- **O raio aparece com zero.** É por ali que se cria a primeira automação da
  etapa; um botão que só nasce depois de já existir automação não ensina ninguém.
- **A consulta não filtra por funil.** A regra irrestrita vale para toda etapa
  de todo funil — filtrar por `pipeline_id` a esconderia.
- **Há teste comparando `classificarNaEtapa` com o `triggerMatches` de verdade**,
  importado do `engine.ts`. Se a regra do motor mudar, ele quebra aqui.

Achado durante a verificação visual: `formatRelative` devolvia `5m ago` e
`never` **em inglês**, cru, nas TRÊS telas que a usam (lista de automações,
histórico e o painel novo) — a mesma família de erro que o CLAUDE.md já proíbe
para `toLocaleDateString('en-US')`. Passou a usar `Intl.RelativeTimeFormat` e a
receber o texto de "nunca" de fora, já traduzido. Ganhou 9 testes (não tinha
nenhum), e a inversão do sinal foi conferida por mutação — sem ela a tela diria
"daqui a 10 minutos" sobre um disparo que já aconteceu, e ninguém questiona um
relógio.

**2026-08-04 — A visão "Automações" do funil (estilo Kommo).** Pedida pelo
operador com prints do Kommo, logo depois da Fase 5. Alternador
**Leads | Automações** na página de funis; na visão nova as colunas continuam
sendo as etapas e cada cartão ocupa aquelas em que a regra dispara.

⚠️ **Sem migration, e isso não é sorte:** a largura do cartão É o
`trigger_config.stage_ids` que a Fase 5 já usava. "Expandir" grava mais etapas;
sem etapa nenhuma o cartão atravessa o quadro — que é exatamente o "Webhook"
roxo de largura total no print do Kommo, e o grupo "De todas as etapas" da
caixa que a grade substituiu.

Duas peças puras, com teste, pelo mesmo motivo dos filtros do inbox:

- `grade-do-funil.ts` (19 testes) — quais colunas o cartão ocupa e como
  empilhar sem sobrepor. ⚠️ **Etapas não vizinhas viram VÁRIOS cartões**: um
  retângulo da coluna 1 até a 3 afirmaria que a regra vale na 2, e ela não
  vale. Cada trecho contínuo é um cartão, e os dois levam o aviso de que há
  mais da mesma regra em outro lugar.
- `descrever-passo.ts` (18 testes) — o resumo em negrito. Devolve **chave +
  valores**, nunca texto pronto, e há teste lendo os DOIS dicionários que cobra
  uma chave por tipo de passo (21 tipos, 29 chaves com as variantes). Sem ele,
  um passo novo no motor põe `Pipelines.automacoes.resumo.send_x`, cru, dentro
  do cartão.

A caixa por coluna da Fase 5 foi **removida** — decisão do operador entre
manter as duas ou substituir. Duas telas dizendo a mesma coisa divergem na
primeira mudança; o raio da coluna agora leva para a grade. As 19 chaves i18n
dela saíram junto.

Verificado na produção com 5 automações de teste (todas pausadas, apagadas em
seguida): cartão de uma coluna, de três, de largura total, um de etapas
separadas com o aviso, o empilhamento em linhas, o "(apagado)" no lugar de um
UUID órfão, o "+1 ação", o expandir (incluindo desmarcar tudo, que a caixa
anuncia como "vale para TODAS as etapas" antes de salvar) e o duplicar.

**Fica em inglês, e não foi tocado:** o sufixo `(Copy)` no nome da automação
duplicada vem da rota `/api/automations/[id]/duplicate`, que não tem contexto
de i18n. Aparece agora com mais frequência, porque duplicar virou um botão.
