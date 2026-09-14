# Plano — Anexos do cliente: nome, miniatura, rolagem e acervo da conversa

> **O que é este arquivo.** Guia retomável das quatro frentes de anexo pedidas
> pelo operador em 2026-09-01, mais a resposta à pergunta sobre grupos.
> **Ele é editado a cada fase**: ao INICIAR uma fase, registra-se aqui que a
> anterior foi concluída — objetivo, arquivos tocados e resultado medido — para
> que qualquer agente possa pegar o plano e saber onde tudo parou.
>
> ⚠️ **Este documento envelhece.** Antes de decidir com base em algo aqui,
> confirme contra a realidade (grep, leitura do arquivo, query no banco). Ao
> achar divergência, corrija este arquivo no mesmo PR.

- **Criado:** 2026-09-01 · **Medido contra:** `origin/main` @ `a50196b`, produção `hxnhakmyxyhalbsktzwe`
- **Fluxo por fase:** executar → `typecheck`/`lint`/`test`/`i18n-parity`/`i18n-chaves-usadas` →
  **testar no preview em resolução de monitor de verdade (1440×900+)** → revisar 2× →
  PR → **revisar ESTE plano antes da fase seguinte**.

---

## Estado

| Fase | Escopo | Estado | Migration | PR |
| --- | --- | --- | --- | --- |
| **1** | **Nome do arquivo** na bolha, no fio e no download | ✅ **feita** (2026-09-01) | `969` **aplicada** | `feat/anexos-do-cliente` |
| **2** | **Bug da rolagem** ao abrir anexo em nova aba | ✅ **feita** (2026-09-01) | nenhuma | idem |
| **3** | **Aba "Arquivos"** no painel (contato **e** grupo) | ✅ **feita** (2026-09-01) | nenhuma | idem |
| **4** | **Miniatura** do documento | ⬜ bloqueada por medição + decisão | a decidir | — |
| **5** | *(bônus)* **Anotações em grupo** | ✅ **feita** (2026-09-01) | nenhuma | idem |

**Decisões do operador (2026-09-01):** fazer as fases 1, 2, 3 e 5; a 4 fica
para depois da 1, como recomendado.

**Julgamentos tomados na execução, por falta de resposta explícita:**

- **Áudio ENTRA na aba** (decisão 2). O pedido abre com "todos os anexos e
  todas as mídias", e áudio é a maior categoria (278). ⚠️ Mas NÃO mostra nome
  de arquivo: nota de voz não tem nome, e a lista virava trinta linhas de id
  hexadecimal — medido na tela. Mostra a transcrição (943) quando `pronta`.
- **"Ir para a mensagem no fio" FICOU DE FORA** (decisão 3). Ele mexe no
  mesmo mecanismo de salto (`alvoId`, `saltoAtivoRef`) que a Fase 2 estava
  consertando; fazer os dois na mesma passada misturaria as duas mudanças no
  mesmo trecho de código.
- **`message-media.tsx` NÃO foi apagado** (decisão 5). É arquivo do upstream:
  apagá-lo faz cada merge futuro trazê-lo de volta como conflito ou
  ressurreição silenciosa. A CLAUDE.md já registra que é código morto, e essa
  nota resolve o risco sem custo recorrente.

### Resultado medido na tela (2026-09-01, preview 1440×900)

- Bolha do fio, na conversa do print do operador: `MARC_O_2024.pdf`,
  `ABRIL_2024.pdf`, `RESCISO_ES.xlsx` — antes as três diziam "Documento".
- Aba Arquivos do grupo: **93 documentos**, mais recente primeiro.
- Aba Arquivos de um 1:1: 9 fotos/vídeos em grade, 22 documentos, 30 áudios.
- Rolagem: posição preservada EXATAMENTE (5005 → 5005) num
  `visibilitychange`; quem estava no fim continua no fim; trocar de conversa
  ainda abre no fim.
- Estado de carga: 20 amostras em 2,4s ao trocar de conversa, **zero**
  ocorrências de "Nenhum arquivo nesta conversa".

---

## Achados que sustentam o plano (medidos em 2026-09-01)

### A. O nome do arquivo existe, chega até nós, e é jogado fora

Medido em produção:

| `content_type` | total | sem `content_text` | com `media_type` |
| --- | --- | --- | --- |
| document | **188** | **166 (88%)** | **0** |
| image | 212 | 165 | 0 |
| audio | 278 | 278 | 0 |
| video | 17 | 16 | 0 |

A bolha (`src/components/inbox/message-bubble.tsx:459`) renderiza
`{message.content_text || t("document")}`. Como 88% dos documentos têm
`content_text` nulo, o operador vê o literal **"Documento"**
(`Inbox.bubble.document`).

**Por que está nulo:** `extractText`
(`src/lib/whatsapp/transport/evolution-inbound.ts:151-153`) lê **só o `caption`**
do `documentMessage`. Nunca lê `fileName`. Documento enviado sem legenda — o
caso normal — grava `content_text: null`.

⚠️ **O caminho da Meta NÃO tem esse defeito**
(`src/app/api/whatsapp/webhook/route.ts:1174` faz
`caption || filename`), mas **produção roda Evolution**. É a mesma classe de
divergência que a CLAUDE.md já cataloga: a doc de `src/lib/media/filename.ts:11`
afirma que "the webhook puts `document.filename`" em `content_text`, e isso é
verdade só para metade dos transportes.

**O nome chega, e nós o usamos — mas só para nomear o objeto no Storage:**

```
evolution-client.ts:410   getBase64FromMediaMessage → { base64, mimetype, fileName }
evolution-media.ts:89     const { base64, mimetype, fileName } = await ...
evolution-media.ts:104    const nome = fileName || `media.${extFromMime(mime)}`
evolution-media.ts:105    const path = buildMediaPath(args.accountId, nome)
evolution-media.ts:118    return publicUrl        ← fileName e mimetype morrem aqui
```

**Consequência boa:** o nome sobrevive, degradado, dentro do caminho do Storage.
Medida a forma do último segmento dos 188 documentos, com dígitos mascarados
como `9` e letras como `a`:

```
9999999999999-aaaaaaaa_9999.aaa   (18×)   ← <epoch-ms>-ABRIL_2024.pdf
9999999999999-aaaa_a_9999.aaa     ( 6×)   ← <epoch-ms>-MAR_O_2024.pdf   (MARÇO)
```

`buildMediaPath` (`src/lib/storage/media-path.ts:44-45`) troca tudo que não é
`[a-zA-Z0-9_-]` por `_` e corta em 40 caracteres — então **espaço e acento se
perdem**, mas o nome continua legível. E `basenameFromUrl`
(`src/lib/media/filename.ts:109-129`) já sabe remover o prefixo epoch.

⚠️ **Isso significa que os 188 documentos históricos são recuperáveis sem
backfill**: `mediaFilename(message)` já devolve `ABRIL_2024.pdf` para eles hoje.
A função existe, tem 3 fontes em cascata e **um teste**
(`src/lib/media/filename.test.ts`) — ela só nunca foi chamada pela bolha de
documento. É chamada em exatamente um ponto da UI:
`media-gallery.tsx:65`, para nomear o download.

### B. O bug da rolagem: três disparos, nenhuma guarda

Cadeia confirmada por leitura de código:

| # | Onde | O que acontece |
| --- | --- | --- |
| 1 | `message-bubble.tsx:450-462` | `<a target="_blank">` → nova aba → a aba do CRM fica `hidden` |
| 2 | `inbox/page.tsx:510-520` | Ao voltar: `visibilitychange` → `setResyncToken(n => n + 1)` |
| 3 | `message-thread.tsx:602-635` | Efeito com deps `[conversationId, resyncToken]` → `setLoading(true)` (`:609`) |
| 4 | `message-thread.tsx:2056-2059` | O fio inteiro vira um spinner de ~100px **dentro do contêiner de rolagem** → `scrollHeight` desaba → o navegador **grampeia `scrollTop` em 0** |
| 5 | `page.tsx:703-705` | `setMessages(loaded)` — **array novo, sem dedupe** |
| 6 | `message-thread.tsx:955-961` | Auto-scroll dispara → `el.scrollTop = el.scrollHeight` |

São **dois danos somados**, e um conserto só não resolve os dois:

- O passo 4 **perde a posição** (o operador volta ao topo).
- O passo 6 **joga para o fim** (é o que o operador descreve como "meu mouse é
  movido lá pra baixo").

⚠️ E dispara **três vezes** por retorno de aba, porque `leadEvents` e `notas`
chegam em buscas próprias e estão nas deps do mesmo efeito (`:961`).

⚠️ **O `saltoAtivoRef` NÃO protege isto.** Ele é armado exclusivamente pelo salto
da BUSCA (`:939-946`); sem busca ativa é sempre `false`. Pior: `liberarSalto`
(`:344-347`) está pendurado no `onWheel`/`onTouchMove`, então **rolar à mão
DESLIGA** a única guarda existente. Não existe em lugar nenhum do inbox a
checagem clássica "o operador estava colado no fim?".

O comentário de `page.tsx:508` diz *"Cheap to fire; the children dedupe on their
own."* — **a premissa nunca foi implementada**; `handleMessagesLoaded` faz
`setMessages(loaded)` cru.

### C. A base da aba "Arquivos" já existe, e foi cortada uma vez

- `collectMediaGallery` (`src/lib/media/gallery.ts:40-56`) já enumera **imagens e
  vídeos** do fio na ordem, com teste. Exclui documento de propósito
  (`gallery.ts:7-11`: *"a document is handed to the OS rather than rendered"*).
- `GaleriaDoFio` (`media-gallery.tsx`) já está **ligada** ao fio
  (`message-thread.tsx:70`) e navega com ‹ › usando `messages.id` como
  identidade. O visualizador (`media-viewer.tsx`) tem **giro e zoom**.
- O fio carrega a conversa **inteira**, sem `limit` — e a página já guarda esse
  array (`page.tsx:703-705`). **A aba não precisa de consulta nova**: recebe
  `messages` por prop.
- Volume medido: 94 conversas com anexo, média 7,3, **máximo 93** numa conversa.
  Nada que peça paginação.

⚠️ **A aba de Mídia foi cortada explicitamente** em `docs/PLANO-painel-do-contato.md`
(*"Cortes deliberados … abas Mídia/Reuniões (não pedidas)"*). Agora foi pedida —
o corte era de escopo, não de viabilidade.

⚠️ `src/components/inbox/message-media.tsx` (276 linhas) é **código morto** —
zero imports. Contém uma segunda bolha de documento, com botão de download que a
bolha viva não tem. **Não usar como base sem decidir antes** se o arquivo morre
ou vira a implementação (a CLAUDE.md já avisa que religá-lo daria dois
visualizadores ao inbox).

---

## Fase 1 — O nome do arquivo

**Objetivo:** o operador lê `MARÇO 2024.pdf` na bolha, no fio, na prévia da lista
e no arquivo baixado — em vez de "Documento".

### Migration `0969_cb_nome_do_anexo.sql`

⚠️ **Conferir o número na hora** com `ls supabase/migrations/` **e**
`list_migrations` (a CLAUDE.md manda os dois; a numeração já divergiu 3 vezes por
branches em paralelo — 906, 963 e 966). Em 2026-09-01 o topo era `968` nos dois.

```sql
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_filename text;
```

Uma coluna anulável, sem índice, sem RLS nova. **Precedente no projeto:**
`cb_scheduled_messages.media_filename` (932) e `cb_media_library.filename` (953).

⚠️ **Sem backfill, de propósito.** `mediaFilename` já recupera o nome dos 188
documentos históricos a partir do caminho do Storage (achado A). Gravar a versão
degradada (`MAR_O_2024.pdf`) congelaria a perda no banco e apagaria a distinção
entre "nome verdadeiro" e "nome reconstruído".

### Escritores (4 caminhos)

| Arquivo | Mudança |
| --- | --- |
| `src/lib/whatsapp/transport/evolution-media.ts:118` | `resolveEvolutionMedia` devolve `{ url, filename, mime }` em vez de `string`. ⚠️ Conferir **todos** os call sites do tipo de retorno. |
| `src/app/api/whatsapp/evolution/webhook/route.ts:287-295` | O UPDATE final grava `media_filename` **e `media_type`** (hoje só `media_url`/`media_state`). |
| `src/app/api/whatsapp/webhook/route.ts:816-840` | INSERT grava `media_filename: message.document.filename`. `content_text` **fica como está** (não mexer no que já funciona). |
| `src/lib/whatsapp/send-message.ts:780-805` | INSERT grava `media_filename: filename ?? null` — o parâmetro já chega na função (`:94`), só não é persistido. |

O caminho de grupo (`src/lib/cb-groups/persist.ts`) usa o mesmo
`resolveEvolutionMedia` — cai junto, de graça.

### Leitores

- `src/lib/media/filename.ts` — `mediaFilename` ganha a **fonte 0**:
  `message.media_filename`, antes das três atuais. Todo download melhora sozinho.
- `src/components/inbox/message-bubble.tsx:446-462` — o case `document` passa a
  usar `mediaFilename(message)`.
  ⚠️ **Legenda e nome viram coisas diferentes:** mostrar `content_text` embaixo
  **só quando existir e for diferente do nome resolvido** — senão as linhas Meta
  antigas (onde `content_text` **é** o filename) mostrariam o nome duas vezes.
- `src/types/index.ts` — `Message` ganha `media_filename?: string | null`.
  ⚠️ Conferir se o `select` do fio nomeia colunas; se nomear, incluir a nova.
  ⚠️ **Não mexer no `CONVERSATION_SELECT`** — é contrato da API pública v1.
- `src/components/inbox/message-thread.tsx:1148-1153` — a bolha otimista tem
  `"Document"` **hardcoded em inglês**. Corrigir junto (é o mesmo assunto).

### Riscos

- **Tipo de retorno de `resolveEvolutionMedia`**: mudança de assinatura num
  caminho de ingestão. Typecheck pega, mas conferir os call sites à mão.
- **`media_type` passa a ser gravado no Evolution.** Hoje é NULL em 100% das
  linhas. Ganho colateral: a transcrição de áudio (943) resolve o mime por
  `messages.media_type` antes de cair no `Content-Type` do Storage.
  Não deve mudar comportamento — mas é superfície nova, então **medir uma
  transcrição depois de aplicar**.

---

## Fase 2 — O bug da rolagem

**Objetivo:** abrir um anexo e voltar não mexe na rolagem do fio.

**Dois consertos, os dois necessários** (ver achado B):

**(a) Não apagar o fio num resync.** `message-thread.tsx:609` — `setLoading(true)`
só quando `conversationId` mudou, nunca por bump de `resyncToken`. Isso remove o
colapso do `scrollHeight` (e o piscar do fio a cada troca de aba, que hoje
acontece sempre).
⚠️ O comentário de `:975-982` documenta esse colapso como fato medido e explica
por que `messages` está nas deps do efeito de centralizar a busca. **Aquela
dependência continua necessária** (o array troca de identidade de qualquer
jeito) — não removê-la achando que virou desnecessária.

**(b) Guardar o auto-scroll por "estava colado no fim".** `message-thread.tsx:955-961`:

- `coladoNoFimRef` nasce `true` (conversa abre no fim, como hoje).
- Atualizado no `onScroll` do contêiner por
  `scrollHeight - scrollTop - clientHeight < TOLERANCIA`.
- ⚠️ **Ignorar as medidas enquanto `loading`**: com o spinner, o conteúdo é mais
  curto que o contêiner, e a conta dá "está no fim" — o que ligaria de volta
  exatamente a guarda que estamos criando. (Com o conserto (a) esse estado deixa
  de existir no resync, mas continua existindo na troca de conversa.)
- O efeito retorna cedo quando `!coladoNoFimRef.current`.

Isso cobre os três disparos (`messages`, `leadEvents`, `notas`) com uma guarda só
— melhor que dedupar em três lugares.

**Fora de escopo, deliberado:** a pastilha "novas mensagens" do WhatsApp para
quem está lendo o histórico. Não foi pedida e é outra feature.

---

## Fase 3 — Aba "Arquivos" no painel

**Objetivo:** uma aba, no painel do contato **e do grupo**, listando tudo que foi
trocado na conversa — mídia navegável e documentos acessíveis — sem caçar no fio.

### Peças

| Arquivo | Papel |
| --- | --- |
| `src/lib/media/anexos.ts` *(novo, puro, com teste)* | `coletarAnexos(messages)` → itens com tipo, url, nome (`mediaFilename`), data, autor e `messageId`. Separa **mídia** (imagem/vídeo) de **arquivo** (documento). |
| `src/components/inbox/painel/aba-arquivos.tsx` *(novo)* | Dois blocos: grade de miniaturas para mídia, lista com ícone+nome+data para documentos. Estado vazio próprio. |
| `painel/painel-do-contato.tsx:852` | 6ª aba (`AbaDeIcone`, ícone `Paperclip`), chave `Inbox.sidebar.tabFiles`. |
| `group-sidebar.tsx` | ⚠️ **Hoje não tem abas nenhuma** (é uma `ScrollArea` com 4 seções). Ganha uma casca `Tabs` de dois gatilhos: Informações · Arquivos. |
| `inbox/page.tsx` | Passa `messages` (que já tem em estado) para os dois painéis. |

### Decisões de desenho já tomadas

- **Sem consulta nova.** O fio já carrega a conversa inteira e a página já guarda
  o array. ⚠️ Isso amarra a aba ao mesmo teto que a busca no fio: se um dia o fio
  paginar, a aba passa a mentir por omissão — **e nada avisa**. Registrar junto
  do aviso que já existe em `achados-no-fio`.
- **Clicar em mídia abre o `GaleriaDoFio`** (o visualizador com giro e zoom), com
  instância e estado próprios da aba. Duas instâncias do MESMO visualizador é
  seguro; o que a CLAUDE.md proíbe é ter DOIS visualizadores diferentes.
- ⚠️ **`collectMediaGallery` fica como está.** A aba usa `coletarAnexos`; a
  galeria continua recebendo só imagem e vídeo. Alargar `gallery.ts` para
  documento faria as setas ‹ › do fio pararem num PDF que o visualizador não sabe
  desenhar.
- **Ordem: mais recente primeiro.** É a pergunta que o operador faz ("o que ele
  mandou?"), ao contrário do fio, que é cronológico.

### Riscos

- `group-sidebar.tsx` ganhar `Tabs` mexe num arquivo que hoje é 100% nosso e
  simples. Manter a seção de informações **idêntica**, só embrulhada.
- ⚠️ Ao mexer no `TabsList` do painel do contato, lembrar da armadilha do
  tailwind-merge que a CLAUDE.md cataloga: override de classe que o primitivo
  declara sob variante precisa **repetir o prefixo**
  (`group-data-horizontal/tabs:h-auto`, nunca `h-auto` cru). A 6ª aba aperta a
  largura — conferir na tela, em 1440×900.

---

## Fase 4 — Miniatura do documento *(bloqueada)*

Imagem e vídeo **já aparecem** na bolha. O pedido é a miniatura do **PDF** — e,
no exemplo mandado pelo operador, o XLSX **também não tem miniatura no WhatsApp**
(só ícone). Então o alvo é PDF.

Três caminhos, nenhum grátis:

| # | Como | Alcança o histórico? | Custo |
| --- | --- | --- | --- |
| **A** | `documentMessage.jpegThumbnail` do payload Baileys — é o que o WhatsApp já embute | ❌ só mensagens novas | 1 coluna ou 1 objeto no Storage. **Precisa medir se chega pela Evolution.** |
| **B** | Renderizar a 1ª página com `pdf.js` no navegador, sob demanda | ✅ os 167 PDFs | dependência de ~1 MB; CPU no cliente |
| **C** | Renderizar no servidor (poppler no Dockerfile) | ✅ | infra nova na imagem; `sharp` **não** renderiza PDF |

⚠️ **Medição que falta antes de decidir:** confirmar se `jpegThumbnail` chega no
payload da Evolution. Nada no repositório o lê hoje (zero ocorrências), e não há
payload cru guardado para consultar — a sonda é um log das chaves do
`documentMessage` no próximo documento recebido.

**Recomendação:** fazer a Fase 1 primeiro e reavaliar. O nome do arquivo resolve
a maior parte da dor ("não consigo distinguir os documentos"); a miniatura é
conforto. Decidir A/B/C com o custo já sabido, e não antes.

---

## Fase 5 — Anotações em grupo *(bônus opcional)*

Sai da resposta à pergunta do operador (ver abaixo): é a única das seis features
ausentes em grupo que **não exige migration nem mudança de hook**.
`cb_conversation_notes.conversation_id` é `NOT NULL` e `contact_id` é anulável —
a migration 918 **já antecipa o caso de grupo por escrito** —, e
`use-conversation-notes.ts` já busca por `conversation_id`.

Custo: montar `InternalNoteBox` + a lista no `group-sidebar`, como as linhas
1356-1406 do painel do contato fazem.
⚠️ **Fixar nota fica de fora**: o índice único da 951 exige `contact_id NOT NULL`.

---

## Resposta à pergunta: por que grupo não tem as abas

**Foi decisão, não limitação** — e está escrita na migration `0906_cb_grupos.sql:130-135`,
que chama a fase de contenção de *"manter grupo fora do painel, da API v1 e do
seletor de negócios"*, aplicada **antes** do código que grava o primeiro grupo.
A ramificação vive em `inbox/page.tsx:962`, com o comentário: *"Painel próprio: a
ficha de contato é etiquetas, negócios, anotações e histórico do lead — nada
disso existe num grupo."*

Mas a decisão não custa o mesmo em cada feature. O que o banco de fato permite:

| Feature | Barreira real | Custo de habilitar |
| --- | --- | --- |
| **Anotações** | Nenhuma — tabela e hook já chaveiam por conversa (918) | **Baixo**, só UI |
| **Histórico** | `cb_lead_events` aceita `contact_id` nulo e tem `conversation_id`; o **hook** é que filtra por contato | **Médio** — variante do `useLeadEvents` |
| **Negócios** | `deals.contact_id` é anulável desde a 004; a guarda é de produto (`routeContactToPipeline`) | **Médio** — o Kanban precisa saber desenhar card de grupo |
| **Tarefas** | `cb_tasks.contact_id` é **NOT NULL** (944:64-66, com motivo escrito) | **Alto** — migration |
| **Campos personalizados** | `contact_custom_values.contact_id` **NOT NULL** + RLS por join em `contacts` | **Alto** — migration + RLS |
| **Automações** | ⚠️ Exclusão **estrutural e deliberada**: `cb-groups/persist.ts` **não importa os motores**, e há **teste lendo o próprio fonte** para garantir | **Alto** — é reverter política, não ligar um botão |

O caso das automações merece a citação, porque explica o estilo da decisão
(`src/lib/cb-groups/persist.ts:3-14`):

> ⚠️ NENHUM FAN-OUT AQUI, E ISSO É A FEATURE. […] A garantia não é um `if`: é o
> fato de este arquivo NÃO IMPORTAR os motores. […] Se um dia grupos entrarem nas
> automações, o import entra aqui, deliberado e visível na revisão — não escondido
> atrás de uma flag que alguém liga sem perceber.

---

## Decisões em aberto (precisam do operador)

1. **Miniatura (Fase 4):** A (só mensagens novas, barato), B (`pdf.js`, alcança
   os 167 PDFs antigos, +1 MB no bundle) ou C (servidor). Recomendo decidir
   **depois** da Fase 1.
2. **Áudio na aba "Arquivos"?** O pedido cita fotos, vídeos, PDF e planilha. Há
   **278 áudios** — mais que todo o resto somado. Incluí-los como terceiro bloco
   é barato, mas não foi pedido.
3. **Botão "ir para a mensagem no fio"** a partir da aba? É o que amarra o acervo
   à conversa, mas exige içar o estado de salto (`alvoId`), hoje exclusivo da
   busca, do fio para a página.
4. **Fase 5 (anotações em grupo)** entra neste trem ou fica para depois?
5. **`message-media.tsx` (código morto, 276 linhas):** apagar nesta passada ou
   deixar? Ele contém uma bolha de documento concorrente com botão de download.
