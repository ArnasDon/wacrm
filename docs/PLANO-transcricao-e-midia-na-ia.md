# Plano — Transcrição de áudio e leitura de mídia pela IA

> Escrito e revisado em 2026-08-02. Baseado em mapeamento do código e do banco
> de produção, com cada achado conferido adversarialmente. Os números de linha
> valem para o `main` daquele dia — confirme antes de executar.
>
> **Fora de escopo, por decisão do operador:** a IA executar ferramentas
> (adicionar tag, mover card, etc.). Isso é uma etapa posterior; ver o apêndice.

## ⚠️ ADENDO 2026-08-27 — Fase 1 IMPLEMENTADA, com três decisões novas

A fase 1 foi implementada na branch `feat/radar-de-atendimento` (junto com o
Radar, de que depende). O que mudou em relação ao texto original abaixo:

1. **Provedor: Gemini, não ElevenLabs.** Com o Gemini no projeto (Radar), a
   transcrição usa a MESMA chave BYO da conta — zero segredo novo, zero ida à
   VPS — com modelo próprio FIXADO em código (`MODELO_TRANSCRICAO =
   'gemini-3.5-flash-lite'`, ~US$ 0,07/h vs US$ 0,22/h do Scribe; transcrever
   não precisa de raciocínio). **Atualização de 2026-08-28:** medição com 12
   áudios reais mostrou o Flash-Lite em ÚLTIMO entre os candidatos (18,4% de
   erro, inventando frases plausíveis em áudio ruim); a constante passou a
   `gemini-3.7-flash` (12,1%), e o argumento "não precisa de raciocínio"
   caiu — desligar o raciocínio piora o erro para 13,9%. Ver o comentário da
   constante em `src/lib/transcricao/transcrever.ts`. Sem chave Gemini (ou provedor ≠ gemini), a
   função devolve `recusada` **sem gravar estado** — cadastrar a chave reativa
   o botão. **Plano B continua sendo o ElevenLabs** (único com `audio/opus`
   por escrito): trocar é reescrever só o miolo de `transcreverAudio`.
   ⚠️ **Risco aberto** *(✅ FECHADO em 2026-08-28: 12 notas de voz REAIS do
   acervo — todas OGG Opus do WhatsApp, enviadas como `audio/ogg` no
   `inlineData`, o mesmo caminho de produção — foram transcritas por 9
   modelos, 12 de 12 em todos. O go/no-go foi dado: o Gemini aceita Opus.)*:
   a doc do Gemini lista "OGG Vorbis" e a nota de voz do WhatsApp é OGG
   **Opus** — funciona em relatos práticos; o 1º teste em produção com uma
   nota real é o go/no-go.
2. **O custo ENTROU em `ai_usage_log`** (modo `transcricao`, migration 943) —
   o §3.4 original dizia o contrário porque a chave era da casa; com a chave
   BYO da conta, o gasto aparece no painel de uso como os demais modos.
3. **O Radar transcreve sozinho os áudios DO CLIENTE da janela** (até 5 novos
   por análise, dentro do orçamento de tempo do ciclo), chamando a MESMA
   função idempotente do botão — pago uma vez, o texto entra como linha
   `[áudio] …` em toda análise futura. Áudio da equipe segue como lacuna
   declarada, e o botão da bolha aparece só na fala do cliente.

Migration: **0943_cb_transcricao_de_audio.sql** (colunas `transcricao_*` em
`messages` + `transcricao` no CHECK de `mode`). ⚠️ Aplicar ANTES do deploy do
merge — o worker do Radar passa a selecionar as colunas novas.

A **fase 2** (IA enxergar imagem/PDF na conversa) segue NÃO implementada e o
texto dela abaixo continua valendo.

---

## 1. Resumo

Duas entregas, nesta ordem:

1. **Transcrição de áudio sob demanda** — um botão em cada bolha de áudio.
   Ao clicar, o áudio é transcrito e o texto aparece num bloco expansível abaixo.
2. **A IA passa a enxergar mídia** — foto/print, PDF e planilha entram no
   contexto do modelo, tanto no rascunho quanto na resposta automática.

A fase 1 é pequena e isolada. A fase 2 é maior e mexe no núcleo da camada de IA.

### Decisões já tomadas

| Pergunta | Resposta |
| --- | --- |
| Transcrição automática ou sob demanda? | **Sob demanda** — só quando alguém clicar |
| A IA pode responder sozinha? | **Sim, pelo interruptor que já existe** (`ai_configs.auto_reply_enabled`) |
| Que tipos de arquivo? | Foto/print, PDF e planilha. **Vídeo fica de fora** |
| Transcrever os 64 áudios antigos? | **Não** — só os novos |

### O que essas decisões eliminam do plano

A escolha por "sob demanda" derruba as partes caras que um plano de transcrição
automática exigiria:

- **Nenhum worker novo, nenhum cron, nenhuma fila a drenar.** O laço do
  `agendador` não muda.
- **Uma ida pequena à VPS, uma vez só** — não zero, como uma versão anterior
  deste plano afirmou. *(⚠️ SUPERADO pelo adendo 2026-08-27: com o Gemini e a
  chave BYO da conta, a ida à VPS caiu — não há `ELEVENLABS_API_KEY` para
  provisionar. O parágrafo fica como registro do desenho ElevenLabs/plano B.)* O `docker-stack.yml` injeta cada segredo explicitamente
  no bloco `environment:` (o `crm.env` é `source`ado no `docker stack deploy`),
  então a `ELEVENLABS_API_KEY` exige: linha nova no `crm.env` da VPS, linha nova
  no `environment:` do stack (essa vai no repo) e um `docker stack deploy` à
  mão — o CI não aplica mudança de stack, só troca a imagem do `crm_crm`.
  ⚠️ Ao rodar o `docker stack deploy`, exportar `CRM_IMAGE` antes, senão o
  serviço volta de `:<sha>` para `:latest`.
- **Trabalho em voo no deploy vira um caso só**: uma transcrição em andamento
  dentro de uma requisição. A cláusula de 10 minutos do cadeado (§3.3) recolhe.

Sobra uma rota, uma migration, um módulo, ~5 linhas na bolha e uma ida à VPS.

### A tensão entre as duas decisões, e como ela se resolve

Transcrição sob demanda **e** resposta automática ligada se contradizem: a IA
precisa do texto de um áudio que ninguém clicou para transcrever.

A saída é **uma função única, idempotente e guardada**. O botão do operador e o
caminho da IA chamam a mesma coisa; quem chegar primeiro paga a transcrição, o
segundo lê o que já está salvo. Consequência prática, que deve ser dita ao
usuário na tela:

- **Resposta automática desligada** → o áudio só é transcrito se alguém clicar.
- **Resposta automática ligada** → o áudio é transcrito porque a IA precisa dele.

Isso não é um terceiro modo escondido: é o interruptor de IA fazendo o que o
operador ligou.

---

## 2. Ponto de partida — o que já existe

Levantado no código e no banco de produção. Nada aqui precisa ser construído.

**Os bytes são nossos.** No transporte Evolution (100% da produção — os dois
canais são `kind='evolution'`), o webhook baixa a mídia e sobe para o bucket
`chat-media` do Supabase Storage, gravando URL pública **permanente** em
`messages.media_url`. Não há política de retenção nem faxina.

**Estado real do acervo** (964 mensagens, 188 com anexo, zero de grupo):

| Tipo | Total | Recebidas | Com legenda | Observação |
| --- | ---: | ---: | ---: | --- |
| `audio` | 89 | 64 | 0 | 100% `audio/ogg`; 4 com `deleted_at` |
| `image` | 62 | 50 | 23 | 52 jpeg + 10 webp (figurinha) |
| `document` | 28 | — | 3 | 22 PDF, 3 docx, **1 xlsx** |
| `video` | 11 | — | 0 | fora de escopo |

**A tela atualiza de graça.** `public.messages` está na publicação
`supabase_realtime` com UPDATE ligado, e o handler do inbox faz
`{ ...m, ...newMsg }` com a **linha inteira**
([inbox/page.tsx:287](../src/app/(dashboard)/inbox/page.tsx:287)). Uma coluna
nova em `messages` acende na bolha sem nenhuma plumbing nova. O precedente
literal já roda: é o `UPDATE media_url` da fase 2 que troca o spinner pelo player.

**Não existem colunas de mime, tamanho nem duração** em `messages` — só
`media_url` e `media_state`. O mime real vive em `storage.objects.metadata`.

---

## 3. Fase 1 — Transcrição de áudio sob demanda

### 3.1 Migration `932_cb_transcricao_de_audio.sql`

> ⚠️ **Confirme o número antes de criar o arquivo.** As `930` e `931` já existem
> no repo (a lista do `CLAUDE.md` está stale). Rode `ls supabase/migrations/`
> **e** `list_migrations` — os dois já divergiram uma vez.

Colunas novas em `messages`:

| Coluna | Tipo | Para quê |
| --- | --- | --- |
| `transcricao` | `text` | o texto |
| `transcricao_status` | `text` | máquina de estado (abaixo) |
| `transcricao_erro` | `text` | motivo legível, em português |
| `transcricao_desde` | `timestamptz` | carimbo da reivindicação |
| `transcricao_em` | `timestamptz` | quando ficou pronta |
| `transcricao_tentativas` | `int NOT NULL DEFAULT 0` | teto contra retentativa eterna |

**CHECK:** `transcricao_status IN ('transcrevendo','pronta','falhou','recusada')`
ou NULL.

**Por que coluna em `messages` e não `content_text` nem tabela nova:**

- **Não `content_text`** — apagaria a diferença entre o que o cliente *escreveu*
  e o que a máquina *ouviu*, de forma irreversível (o valor original é NULL).
  Num CRM jurídico isso é inaceitável. Além disso a bolha de áudio nem lê
  `content_text`, então a transcrição ficaria invisível na tela e ao mesmo tempo
  apareceria na busca — o operador leria isso como defeito. E mudaria a prévia
  da conversa de `[audio]` para o texto por acidente.
- **Não tabela nova** — o realtime deixaria de ser de graça (`use-realtime.ts`
  escuta só `messages` e `conversations`), a bolha precisaria de JOIN ou de um
  segundo fetch, e a busca da 929 precisaria de um `UNION`. O padrão do projeto
  para "estado de um anexo" já é coluna em `messages` (`media_state`).

**Trade-off aceito conscientemente:** a transcrição **não** entra no índice GIN
da 929 e portanto **não é encontrada pela busca do inbox**. Se a busca por
conteúdo de áudio virar requisito, é uma migration adicional (ampliar o índice e
a RPC `cb_buscar_conversas_por_texto`), não um redesenho.

### 3.2 Estados

```
NULL  →  transcrevendo  →  pronta      (terminal)
                        →  falhou      (dá para tentar de novo, até 3x)
                        →  recusada    (terminal, SEM botão)
```

- **NULL** — nunca transcrito. O botão aparece.
- **transcrevendo** — reivindicado, `transcricao_desde` carimbado.
- **pronta** — `transcricao` preenchida. Terminal.
- **falhou** — erro transitório (rede, 5xx do provedor). Botão de tentar de novo.
- **recusada** — terminal **sem botão**: áudio grande demais, formato não aceito,
  sem chave configurada, tentativas esgotadas. É o mesmo espírito do `too_large`
  (906) e do `entrega_incerta` (926): o estado que existe justamente para **não
  oferecer um botão que só vai falhar de novo**.

### 3.3 O cadeado — não é opcional

```sql
UPDATE messages
   SET transcricao_status = 'transcrevendo',
       transcricao_desde = now(),
       transcricao_tentativas = transcricao_tentativas + 1
 WHERE id = $1
   AND content_type = 'audio'
   AND deleted_at IS NULL
   AND transcricao_tentativas < 3
   AND ( transcricao_status IS NULL
      OR transcricao_status = 'falhou'
      OR (transcricao_status = 'transcrevendo'
          AND transcricao_desde < now() - interval '10 minutes') )
RETURNING id;
```

O teto de tentativas mora **dentro** do cadeado — não num `if` separado que uma
retentativa concorrente poderia furar. Quando as tentativas esgotam, o código
marca `recusada` com motivo.

Zero linhas = alguém chegou antes (ou o teto esgotou); a rota devolve o estado
atual sem cobrar nada — `transcrevendo` em voo, `pronta`, `recusada`, o que for.

**Por que é obrigatório:** o `docker-stack.yml` usa `order: start-first` com
`replicas: 1`. Durante **toda** troca de imagem existem **dois processos Node
vivos ao mesmo tempo**, e o rate limit é um `Map` em memória, **por processo** —
ele não impede nada nesse instante. Só o `UPDATE ... RETURNING` impede pagar duas
vezes a mesma transcrição.

A cláusula de 10 minutos é o recolhimento de travada embutido no próprio cadeado
— sem ela, um deploy no meio de uma transcrição deixaria o áudio preso em
"Transcrevendo…" para sempre. É o bug literal que a 928 consertou nas agendadas.

### 3.4 Módulo `src/lib/transcricao/`

`transcrever.ts` — função única, chamada pelos dois caminhos:

```ts
transcreverAudio(db, { accountId, messageId }): Promise<ResultadoTranscricao>
```

Ordem das guardas (cada uma com motivo escrito, antes de gastar dinheiro):

1. A mensagem é da conta, é `content_type='audio'` e `deleted_at IS NULL`.
   ⚠️ Áudio apagado **não** se transcreve — a 929 já tomou a decisão análoga
   para a busca: *"achar uma conversa pelo que foi APAGADO nela é decisão
   jurídica, não efeito colateral de índice"*. Vale igual aqui.
2. Já tem `transcricao` → devolve a existente. **Idempotência.**
3. `media_url` existe **e começa com `https://`**.
   ⚠️ No transporte Meta o `media_url` é o proxy **relativo**
   `/api/whatsapp/media/<id>`, que exige sessão de usuário logado. Um caminho
   server-side não tem sessão: buscaria HTML de login e transcreveria lixo.
   Recusa explícita, com motivo.
4. Reivindica (o `UPDATE` acima). Zero linhas → sai sem cobrar.
5. Baixa do bucket, confere tamanho, chama o provedor, grava.

> ⚠️ **SUPERADO PELO ADENDO 2026-08-27** — o provedor implementado é o
> Gemini com a chave BYO da conta; os dois blocos abaixo (provedor e
> chave) ficam registrados como **plano B**.

**Provedor: ElevenLabs Scribe v2.**

- Aceita `audio/ogg` e `audio/opus` **na entrada** — exatamente o que a nota de
  voz do WhatsApp entrega. **Sem transcodificação, sem ffmpeg.**
- Melhor pt-BR medido publicamente: 2,83% WER (Open ASR Leaderboard,
  arXiv 2510.06961v4, Tabela 4), contra 4,96% do Whisper large-v3.
- US$ 0,22/hora. No volume de hoje, **centavos por mês**.
- ⚠️ **A OpenAI não lista OGG/Opus** (`mp3, mp4, mpeg, mpga, m4a, wav, webm`) e
  **o Claude não aceita áudio de jeito nenhum** — o campo é descartado em
  silêncio, sem erro. Por isso a transcrição é sempre ElevenLabs,
  **independentemente de qual provedor a conta usa para o chat**.

**Chave:** variável de ambiente `ELEVENLABS_API_KEY`, lida no servidor.
Operacional: entra no `.env.local` (dev), no `crm.env` da VPS **e** no bloco
`environment:` do `docker-stack.yml` — com o `docker stack deploy` descrito no §1.
Sem a chave, `transcreverAudio` marca `recusada` com motivo "sem chave
configurada" — nunca falha genérico.

Recomendo env var em vez de coluna por conta: este fork é de uso interno, há uma
conta real, e o custo (centavos) é da casa. Se um dia precisar ser por conta, o
molde existe — `ai_configs` já guarda duas chaves cifradas (`api_key` e
`embeddings_api_key`). ⚠️ Mas **não copie `loadEmbeddingsKey` cegamente**: ele
não escopa o canal e, com uma segunda linha em `ai_configs`, responde "não há
chave, e não está corrompida" — degradar silencioso, não erro visível.

**Custo não entra em `ai_usage_log` — de propósito.** *(⚠️ SUPERADO pelo
adendo: com a chave BYO, o custo PASSOU a ser registrado — modo
`transcricao`, CHECK ampliado na 943.)* Os CHECKs de `mode` e
`provider` da tabela rejeitariam a linha, e o gasto é da chave da casa, não da
chave BYO da conta. Se um dia precisar de contabilidade, é migration — registrar
a decisão aqui evita que alguém "conserte" enfiando um valor inválido no CHECK.

### 3.5 Rota `POST /api/cb/transcricao/[messageId]`

Molde exato de `src/app/api/cb/groups/media/[messageId]/route.ts`:

```ts
const ctx = await requireRole('agent')
const limit = checkRateLimit(`cb:transcricao:${ctx.userId}`, RATE_LIMITS.transcricao)
if (!limit.success) return rateLimitResponse(limit)
// confere posse com o cliente do USUÁRIO (a RLS recorta)
// só então entra o service-role para escrever
```

Dois limites, como o par `aiDraft`/`aiDraftAccount` já faz — porque N agentes,
cada um sob o limite pessoal, ainda estouram a mesma chave:

- `transcricao`: 20/min por **usuário**
- `transcricaoConta`: 60/min por **conta**

### 3.6 UI

**Bolha** — [message-bubble.tsx:293](../src/components/inbox/message-bubble.tsx:293),
o `case "audio"` (hoje 10 linhas). Abaixo do `<audio>`:

- sem transcrição → botão discreto "Transcrever"
- `transcrevendo` → spinner
- `pronta` → bloco expansível com o texto
- `falhou` → motivo + "tentar de novo"
- `recusada` → motivo, sem botão

**Reuso, não invenção:** o `Accordion` de `src/components/ui/accordion.tsx` já
está instalado e exercitado ([cb-channels-panel.tsx:957](../src/components/settings/cb-channels-panel.tsx:957)).
Para o bloco dentro da bolha, o precedente é o `InteractivePreview`, que pinta a
própria superfície opaca (`bg-card text-foreground ring-1 ring-border`) e por
isso lê certo sobre a bolha de entrada **e** a de saída, sem bifurcar por lado.

⚠️ **i18n:** toda chave nova entra em `en.json` **e** `pt-BR.json` na mesma
passada. O fallback do next-intl é por arquivo, não por chave — chave faltando
vira `MISSING_MESSAGE` cru na tela.

### 3.7 Testes

- `src/lib/transcricao/transcrever.test.ts` — molde de
  `src/lib/scheduled/dispatch.test.ts`. Cobrir: idempotência (segunda chamada não
  cobra), cadeado (segunda chamada concorrente recebe zero linhas), recusa de
  `media_url` relativo, recusa de áudio apagado, teto de tentativas.
- Não há teste de integração de webhook em lugar nenhum do projeto (`grep` por
  `from '@/app/api` nos testes devolve zero) — não invente um agora.

### 3.8 O que **não** entra na fase 1

- Transcrição automática de tudo
- Retroativo nos 64 áudios existentes
- Busca por conteúdo de áudio
- Áudio de grupo (`groups_enabled=false` nos dois canais; e acima do teto de
  5 MB a mensagem fica sem `media_url`, então não há bytes para transcrever)
- Distinção entre nota de voz e música encaminhada (o campo `ptt` do Baileys é
  descartado na normalização)

⚠️ **25 dos 89 áudios são nossos** (24 do celular pareado + 1 gravado no CRM).
O botão aparece neles também — decida se quer escondê-lo em `sender_type='agent'`.

---

## 4. Fase 2 — A IA passa a enxergar mídia

Aqui está o trabalho de verdade. A camada de IA hoje é **texto → texto**:
`ChatMessage` é `{ role, content: string }` e os dois adaptadores montam corpos
com string crua.

### 4.1 O achado que decide a arquitetura desta fase

> **Quando o áudio nasce, a IA já respondeu.**

O fan-out (flows → automações → funil → IA) roda dentro de
`persistInboundMessage` ([inbound-store.ts:346](../src/lib/whatsapp/inbound-store.ts:346)),
ou seja na **fase 1** do webhook. O `media_url` só existe na **fase 2**
([webhook/route.ts:287](../src/app/api/whatsapp/evolution/webhook/route.ts:287)).

**Transcrever depois não alcança a resposta automática por caminho nenhum.**
Qualquer plano que prometa "a IA passa a responder áudio" e não trate disso está
errado. É preciso um **segundo ponto de disparo**, explícito.

Situação análoga, mais sutil, para imagem: **foto com legenda já dispara a IA
hoje** — a legenda cai em `content_text` e satisfaz a guarda `inboundText.trim()`.
Mas `buildConversationContext` filtra `content_type='text'`, então **a própria
mensagem que acordou a IA é excluída do histórico**. Se for a única da conversa,
`messages.length === 0` e a IA sai calada. Foto **sem** legenda (54% delas) não
dispara nada.

⚠️ **Não afrouxe a guarda `inboundText.trim()`.** Ela é a guarda certa —
removê-la faria a IA responder a texto vazio. O caminho é **preencher o texto
antes**, não relaxar a condição.

**O desenho concreto do segundo disparo** — mais simples do que parece, por um
fato da assinatura: `dispatchInboundToAiReply` **não recebe texto nenhum**. Ele
recebe `{accountId, conversationId, contactId, configOwnerUserId, channelId}` e
**lê o histórico do banco** via `buildConversationContext`. Logo o segundo
disparo não é "passar a transcrição por parâmetro" — é chamar **a mesma função,
mais tarde**, quando a mídia (e a transcrição) já estão gravadas e o
`context.ts` novo as encontra.

1. **Na fase 1, a IA deixa de ser chamada para mensagem de mídia**
   (`content_type !== 'text'`). Flows e automações ficam intactos —
   `keyword_match` sobre legenda continua funcionando, e isso é desejável.
   Sem este passo, foto com legenda dispararia a IA **duas vezes** (fase 1 sem
   ver a imagem, fase 2 vendo) — e o `claim_ai_reply_slot` não deduplicaria:
   ele é um contador por conversa, contaria 2.
2. **O laço da fase 2 passa a carregar `flowConsumed` e `senderType`** de cada
   item (ele já é construído a partir dos resultados da fase 1 — verificar a
   forma exata do retorno na implementação).
3. **Depois do `UPDATE` de `media_url`**, se `sender_type='customer'` e
   `!flowConsumed`:
   - **precheck barato** antes de gastar dinheiro: canal com
     `ai_autoreply_enabled` (a coluna já existe em `cb_channels`) e
     `loadAiConfig` ativo com `auto_reply_enabled`. Sem isso, um áudio seria
     transcrito — e cobrado — com a IA desligada, violando a decisão
     "sob demanda";
   - **áudio** → `transcreverAudio()` (a mesma função idempotente da fase 1
     deste plano) e, com transcrição gravada, `dispatchInboundToAiReply(...)`;
   - **imagem / PDF** → `dispatchInboundToAiReply(...)` direto — o contexto
     novo já monta o bloco.

Efeito colateral bom: com resposta automática ligada, o áudio do cliente chega
já transcrito na tela — o botão da fase 1 encontra o texto pronto e não cobra
de novo.

Confiabilidade: isso roda dentro do mesmo `after()` onde o fan-out inteiro já
roda hoje — mesma classe de risco, nada piora. Se o deploy matar o processo no
meio: a IA não responde aquele áudio (exatamente como hoje) e uma transcrição
travada é recolhida pela cláusula de 10 minutos do cadeado.

Transporte Meta: **não há fase 2** — a mídia nunca é baixada e o `media_url` é
o proxy relativo. Lá a IA continua só de texto; a guarda de URL do §3.4 recusa
com motivo. Produção é 100% Evolution, então isso não bloqueia nada hoje.

### 4.2 O tipo — medido empiricamente

Foi feita a sondagem (editar `ChatMessage`, rodar `tsc --noEmit`, restaurar):

| Forma | Erros de `tsc` | Arquivos |
| --- | ---: | ---: |
| `content: string \| ContentBlock[]` | **5** | 3 |
| `content: ContentBlock[]` (estrita) | 30 | 10 (inclui 22 erros em 3 testes) |

**Use a união.** Custa 6× menos e todo call site que só repassa `messages`
(`auto-reply.ts`, `draft/route.ts`) fica intacto, sem uma linha de edição.

Os 5 erros: `playground/route.ts:45`, `handoff.ts:28` e `:39`, `query.ts:11` e
`:13` — todos `.trim()` sobre `content`. Resolve-se com um helper
`textoDe(content): string`.

**Baseline atual:** `npx vitest run src/lib/ai` = 11 arquivos, 67 testes, verdes.
`tsc --noEmit` limpo.

### 4.3 ⚠️ A armadilha silenciosa: `mergeConsecutive`

[providers/shared.ts:103](../src/lib/ai/providers/shared.ts:103):

```ts
last.content = `${last.content}\n\n${m.content}`
```

Com `content` array, a interpolação chama `Array.prototype.toString()` e produz
**`"[object Object],[object Object]"`** — sem erro de tipo, sem exceção em
runtime, e o provedor recebe lixo no lugar da imagem. O usuário veria a IA
respondendo como se a foto não existisse.

**Os dois adaptadores chamam essa função** (`openai.ts` direto,
`anthropic.ts` dentro de `normalizeForAnthropic`). E `normalizeForAnthropic` tem
um fallback que cria `content: '(The customer has not sent a message yet.)'` —
string crua, que também precisa virar bloco.

**Este é o item de maior risco da fase 2.** Escreva o teste antes da mudança.

### 4.4 Os blocos, por provedor

Os dois provedores divergem, e a divergência importa:

**Imagem — funciona igual nos dois, com a URL pública do bucket:**

```jsonc
// Anthropic
{ "type": "image", "source": { "type": "url", "url": "https://…" } }
// OpenAI /v1/chat/completions  (ANINHADO — a forma da Responses API é outra)
{ "type": "image_url", "image_url": { "url": "https://…", "detail": "auto" } }
```

**PDF — aqui a simetria quebra:**

```jsonc
// Anthropic: aceita URL direto, SEM beta header (é GA)
{ "type": "document", "source": { "type": "url", "url": "https://….pdf" } }
// OpenAI /v1/chat/completions: NÃO existe campo de URL.
// Só base64 (file_data) ou file_id da Files API.
{ "type": "file", "file": { "file_data": "data:application/pdf;base64,…", "filename": "x.pdf" } }
```

⚠️ Consequência de projeto: um bloco genérico `{ type: 'document', url }` **não
tem tradução para OpenAI**. O adaptador da OpenAI precisa **baixar o arquivo e
converter para base64** no servidor. Já o da Anthropic passa a URL.

**Planilha — nenhum dos dois lê `.xlsx`:**

- **Anthropic:** a doc é explícita — o bloco `document` aceita apenas
  `application/pdf` e `text/plain`. Binário precisa ser convertido antes.
- **OpenAI:** aceita o arquivo, mas parseia **só as primeiras 1.000 linhas por
  aba** e entrega um **resumo gerado por IA**, não a planilha. Pergunta sobre a
  linha 1.500 recebe resposta confiante e errada.

**Recomendação:** converter no servidor para CSV/Markdown com `xlsx` ou
`exceljs` e mandar como bloco de **texto** normal. Zero API nova, zero beta
header, mesmo código nos dois provedores, comportamento previsível.
⚠️ Planilha grande estoura a janela de contexto — recorte antes.

**Word (`.docx`)** — o acervo tem 3. Nenhum provedor aceita em bloco de
conteúdo; a família de solução é a mesma da planilha (extrair texto no
servidor, ex.: `mammoth`). Fora da primeira entrega, registrado para não
parecer esquecimento.

**Nota sobre o modelo padrão:** o formulário pré-preenche `claude-haiku-4-5`
(janela 200k) — nesse tier o limite de PDF é **100 páginas** por requisição,
não 600. Petição grande estoura; o erro do provedor deve virar mensagem clara,
não `empty_response`.

### 4.5 Modelos e custo

Todos os modelos atuais dos dois provedores enxergam, inclusive os baratos.
Uma tela de celular 1080×2400:

| Modelo | Custo/imagem | Nota |
| --- | ---: | --- |
| `claude-haiku-4-5` | US$ 0,0015 | mais barato da Anthropic; tier padrão |
| `claude-sonnet-5` | US$ 0,0101 | tier alta resolução |
| `claude-opus-5` | US$ 0,0168 | tier alta resolução |
| `gpt-5-nano` | US$ 0,00019 | mais barato no geral |
| `gpt-4o-mini` | US$ 0,0072 | ⚠️ **mais caro que o `gpt-4o`** |

⚠️ **`gpt-4o-mini` custa o dobro do `gpt-4o` por imagem** — os multiplicadores de
imagem dele são gigantes. Escolher o "mini" achando que economiza em visão dobra
a conta.

⚠️ **O tier de resolução da Anthropic muda o custo em ~2,3× pela mesma imagem** e
depende só do modelo: Sonnet 4.6 é tier padrão, Sonnet 5 é alta resolução.
Trocar de modelo muda a conta sem nenhuma mudança de código.

### 4.6 Ordem de execução da fase 2

1. **Teste primeiro** — um caso que prove que uma imagem sobrevive ao
   `mergeConsecutive`. Ele deve falhar antes da mudança.
2. `types.ts` — `ContentBlock` + união em `ChatMessage`.
3. `shared.ts` — `mergeConsecutive` ciente de blocos; `normalizeForAnthropic`
   com fallback em bloco.
4. Os dois adaptadores — tradução `ContentBlock` → payload de cada provedor,
   com o desvio de PDF (URL na Anthropic, base64 na OpenAI).
5. `context.ts` — parar de filtrar `content_type='text'`; trazer `media_url`,
   `content_type` **e `transcricao`**; montar blocos por tipo:
   - `image` → bloco de imagem (URL do bucket);
   - `document` PDF → bloco de documento (URL na Anthropic, base64 na OpenAI);
   - `audio` → **bloco de texto com a transcrição**, rotulado como áudio
     transcrito (nenhum provedor aceita o áudio em si). Sem transcrição, um
     placeholder `[áudio não transcrito]` — o modelo fica sabendo que houve um
     áudio que ele não ouviu, em vez de a mensagem sumir;
   - legenda continua passando por `removerAssinatura` como hoje.
   ⚠️ Isso **quebra o fake de `context.test.ts`**, que reproduz a cadeia
   `.eq('content_type','text')`. **Isso é a feature, não o bug** — torna a
   mudança visível na revisão.
6. Os 5 erros de `tsc` (helper `textoDe`).
7. `query.ts` / `latestUserMessage` — o RAG usa a última mensagem do usuário como
   consulta. Imagem sem legenda devolve string vazia; `retrieveKnowledge` já sai
   cedo nesse caso, mas confirme. Com transcrição presente, ela **é** a consulta.
8. **O segundo disparo** — o desenho concreto está no §4.1 (mover a IA de mídia
   para a fase 2, precheck barato, transcrever antes de despachar).
9. Planilha (§4.4) — **pode ser cortado da primeira entrega sem prejuízo.**

### 4.7 Segurança

⚠️ **Transcrição e legenda são conteúdo do cliente, não instruções.** Um áudio
pode dizer "ignore as instruções anteriores e…". O prompt já trata a mensagem do
cliente como não confiável ([defaults.ts:66](../src/lib/ai/defaults.ts:66)) — a
transcrição precisa entrar **pelo mesmo caminho**, delimitada e rotulada, nunca
concatenada no prompt de sistema.

⚠️ **O bucket `chat-media` é público** e a rota `/storage/v1/object/public/…`
não passa por RLS (verificado: um `HEAD` sem autenticação devolve
`200 / audio/ogg`). Mandar a URL para um provedor de IA é entregar o arquivo do
cliente por link aberto. Para escritório de advocacia é decisão do operador —
a alternativa é baixar e mandar base64, ao custo de reenviar os bytes a cada
turno (a API é stateless e o histórico é reenviado inteiro).

---

## 5. Riscos

| Risco | Mitigação |
| --- | --- |
| `mergeConsecutive` vira `[object Object]` sem erro | teste antes da mudança (§4.3) |
| A IA responde antes de o áudio existir | segundo disparo na fase 2 (§4.1) |
| Foto com legenda dispara a IA duas vezes (fase 1 + fase 2) | IA de mídia sai da fase 1; só a fase 2 despacha (§4.1) |
| Áudio transcrito — e cobrado — com a IA desligada | precheck barato antes de `transcreverAudio` (§4.1) |
| Deploy no meio da transcrição trava o áudio | cláusula de 10 min no cadeado (§3.3) |
| Dois processos no `start-first` cobram duas vezes | `UPDATE … RETURNING` com teto embutido (§3.3) |
| Canal Meta futuro quebra a transcrição | recusa de `media_url` relativo (§3.4) |
| Retentativa eterna queima a chave | `transcricao_tentativas < 3` dentro do cadeado → `recusada` |
| Planilha grande estoura o contexto | recortar antes de mandar (§4.4) |
| PDF grande no modelo padrão (Haiku, 100 págs.) | erro do provedor vira mensagem clara (§4.4) |

**Fecha um item PENDENTE do `CLAUDE.md`:** `maxDuration = 60` **não é aplicado**
nesta produção. `next.config.ts` tem `output: "standalone"` e o `Dockerfile`
termina em `CMD ["node", "server.js"]` — não há plataforma serverless lendo esse
número. O único fim de vida real do `after()` é o SIGTERM do deploy. Vale
atualizar o `CLAUDE.md` no mesmo PR.

---

## 6. Convenções do projeto a respeitar

- Branch derivada de `main` atualizado; **nunca commitar direto no `main`**
  (push no `main` **dispara deploy de produção**).
- Migration na faixa `900+` com prefixo `cb_`; conferir o número com `ls` **e**
  `list_migrations` imediatamente antes de criar.
- Chave nova de i18n entra em `en.json` **e** `pt-BR.json` na mesma passada.
- `npm run typecheck` e `npm run lint` antes de finalizar.
- Ao achar divergência entre este plano e a realidade, corrigir o plano — nota
  mentindo é pior que ausência de nota.

---

## Apêndice — Fase 3 (fora deste plano): a IA executar ferramentas

Registrado para não se perder. Situação em 2026-08-02:

- **Não existe tool use.** Grep por `tool_use|tool_call|tool_choice|function_call`
  em todo o `src/` devolve **zero**. O único efeito colateral que o modelo
  provoca é o sentinela de texto `[[HANDOFF]]`.
- **O `mcp-server/` já expõe 12 ferramentas** com schema zod e escopos, falando
  com `/api/v1`. As definições são reaproveitáveis; o transporte (stdio) não.
- **Adicionar tag** tem helper canônico pronto (`addContactTagAndDispatch`), e
  resolver tag por nome já existe ponta a ponta.
- **Mover card entre etapas não tem caminho server-side** — hoje é update cru do
  navegador sob RLS. Precisa ser escrito do zero, com `account_id` explícito.
- **A trilha de auditoria (912) não sabe dizer "foi a IA"** — o CHECK de `origin`
  aceita só `usuario|conexao|automacao|sistema|retroativo`. Precisaria de migration.
- ⚠️ **O parser da Anthropic descarta blocos não-texto em silêncio** — só
  acrescentar `tools` faria o primeiro tool call virar `empty_response`, um erro
  genérico com cara de instabilidade do provedor.
