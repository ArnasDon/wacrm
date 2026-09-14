# Plano — Webhooks de entrada + tags aditivas na API

> Plano vivo. Marcar `[x]` conforme cada fase entra. Documento INTERNO
> (não vai para quem instala o sistema).

## Por que

O escritório vai configurar um webhook do **Typebot** para que todo lead que
entra em contato acione o CRM: criar o negócio, mandar mensagem, aplicar tag.
Hoje isso é possível **só pela API pública com chave** — o Typebot decide tudo
e o CRM obedece. Faltam duas coisas:

1. **Aplicar tag sem apagar as outras.** `PATCH /api/v1/contacts/{id}` com
   `tags: []` **substitui** o conjunto inteiro. O Typebot aplicando "Typebot"
   apagaria "Bancário", "Cliente Fechado" e o que mais houver.
2. **Um webhook nomeado, com log de acionamentos.** Nada no CRM responde
   "esse webhook está recebendo ou não?". Sem isso, um Typebot mal configurado
   falha em silêncio.

Medido em produção em 08/09/2026 (antes de começar):

| | |
| --- | --- |
| `contact_tags` | **0 linhas** — nenhuma tag aplicada ainda |
| `tags` | 11, incluindo **"Typebot"** e **"Formulário"** (criadas 02/09) |
| `api_keys` ativas | **0** (as duas existentes são `TESTE-*`, revogadas) |
| `webhook_endpoints` (saída) | **0** — o subsistema de saída nunca foi usado |

Ou seja: a substituição de tags ainda não destruiu nada porque não há o que
destruir. Estamos construindo antes da dor.

## O que este plano NÃO faz

- **Não configura o Typebot.** A integração em si vem depois, com a base pronta.
- **Não mexe nos webhooks de SAÍDA** (`webhook_endpoints`, migration 028). Eles
  continuam existindo, sem UI e com zero endpoints registrados. Dar tela a eles
  é trabalho separado (ver "Deixado de fora").
- **Não guarda o corpo cru** do que chega (ver D2).

---

## Decisões travadas

### D1 — Token na URL identifica; segredo no header autentica

O Calendly assina cada entrega com HMAC, e por isso o token da URL dele é só
"de qual conta é isso". **O Typebot não assina.** Sem uma segunda barreira, o
token na URL seria a única coisa entre um estranho e o disparo de automações —
e URL vaza em log de proxy, histórico de navegador e captura de tela.

Typebot e n8n mandam cabeçalho customizado. Então:

- **token na URL** (24 bytes base64url, em claro no banco, `UNIQUE` global) diz
  **qual webhook** é. Não é segredo, é endereço.
- **segredo no header** `Authorization: Bearer <segredo>` (32 bytes hex,
  cifrado com `ENCRYPTION_KEY`) prova que é você. Conferido com
  `timingSafeEqual`, **falhando fechado** — é a mesma forma do transporte
  Evolution (`EVOLUTION_WEBHOOK_SECRET`).
- **Escape explícito**: webhook criado com `sem_segredo = true` aceita sem
  header. Existe para sistema que não consegue mandar cabeçalho; a tela avisa
  em vermelho que aquele webhook depende só do sigilo da URL.

O segredo é mostrado **uma vez**, na criação, como a chave de API.

### D2 — O log guarda as VARIÁVEIS achatadas, não o corpo cru

O Calendly decidiu não guardar payload (977:31-32). Aqui a tentação é maior,
porque o payload é arbitrário e o operador vai querer depurar. Mesmo assim:
guardamos `variaveis jsonb` — o resultado do achatamento, que é **exatamente o
que a automação enxerga**.

Por quê: a pergunta real do operador não é "o que o Typebot mandou", é "por que
`{{vars.nome}}` saiu vazio". Essa pergunta se responde vendo a lista de
variáveis disponíveis com os valores — que é o que o achatado é. Guardar o cru
por cima acrescentaria dado pessoal de cliente numa tabela a mais, num
escritório de advocacia, para responder a mesma pergunta duas vezes.

### D3 — Um webhook precisa de telefone, e o campo é configurável

Automação age sobre CONTATO. O payload tem que dizer quem é o cliente, e num
JSON arbitrário não há como adivinhar onde. Então o webhook guarda
`campo_telefone` (o nome da chave achatada, ex.: `telefone` ou `contato_whatsapp`)
e `campo_nome`. Sem telefone resolvível → resultado `sem_telefone`, gravado no
log, **sem** disparar automação e sem criar ficha.

A ficha NASCE do webhook quando o telefone é novo — mesma decisão da revisão D2
do Calendly (08/09), pelo mesmo motivo: o lead que chega pelo Typebot ainda não
mandou mensagem, então exigir contato existente desligaria a integração
justamente no caso que ela existe para atender.

### D4 — Escopo de tag reusa `contacts:write` / `contacts:read`

Não criar `tags:read`/`tags:write`. A chave do Typebot precisa de
`contacts:write` de qualquer jeito (para criar o contato), então um escopo
separado não reduziria privilégio nenhum — só somaria uma caixa a marcar.

### D5 — A API de tag trabalha por NOME, não por UUID

Não existe `GET /api/v1/tags` hoje; o integrador não tem como descobrir um
UUID de tag pela API pública. Trabalhar por nome (com criação opcional) é o que
`tags: []` já faz internamente via `resolveImportTagIds`, que casa por
`lower(trim(nome))`. Um `GET /api/v1/tags` entra junto, para descoberta.

### D6 — Um endpoint POST faz adicionar E remover

`POST /api/v1/contacts/{id}/tags` com `{ "add": [...], "remove": [...] }`.

Em vez de POST-para-adicionar + DELETE-para-remover, porque: (a) é uma chamada
só para "põe X e tira Y"; (b) `DELETE` com corpo é mal suportado por vários
clientes HTTP, e nome de tag tem espaço e acento (`"Ag. Demissão"`), o que faz
`DELETE /tags/{nome}` depender de codificação de URL; (c) o Typebot só precisa
saber fazer POST.

O `PATCH /api/v1/contacts/{id}` com `tags: []` **continua substitutivo**, sem
mudança — é contrato publicado.

### D7 — Seção própria "Webhooks", com as duas direções

Decisão do operador (08/09/2026). A tela é uma **seção nova** em Configurações,
no grupo `workspace`, ao lado de "API keys" — as duas são credenciais de
integração, e Integrações hoje são cartões de UMA conexão cada, o que não
comporta N webhooks com log paginado dentro.

A seção tem **duas abas**:

- **Recebidos** — os webhooks de entrada desta feature.
- **Enviados** — os `webhook_endpoints` da migration 028, que existem desde o
  upstream com HMAC e proteção SSRF e **nunca tiveram tela**: hoje só dá para
  registrar um por `curl` com uma chave de escopo `webhooks:manage`. Zero
  endpoints registrados em produção.

As duas direções na mesma seção porque a pergunta do operador é uma só ("o que
entra e o que sai deste CRM"), e porque separá-las obrigaria a explicar a
diferença duas vezes.

---

## Fase 1 — Tags aditivas na API pública ✅

- [x] `removeContactTag` (`src/lib/contacts/tag-write.ts:75`) passa a devolver
      `boolean` (se removeu de fato). Hoje devolve `void` e não pede `count`,
      então não dá para distinguir "removi" de "não estava lá". Os 3 chamadores
      atuais ignoram retorno — mudança não quebra ninguém.
- [x] `src/lib/api/v1/tags-do-contato.ts` (novo, puro onde der, com teste):
      resolve nomes → ids, monta o diff, chama os helpers centrais.
      **Usa `addContactTagAndDispatch` e `removeContactTag`** — não escreve em
      `contact_tags` direto (já há 3 bypasses no repo, não somar um 4º).
- [x] `POST /api/v1/contacts/{id}/tags` — escopo `contacts:write`.
      Corpo: `{ add?: string[], remove?: string[], create_missing?: boolean }`.
      `create_missing` default `true`; em `remove`, nome desconhecido é no-op.
      Resposta: o contato serializado (o integrador confere o que ficou sem uma
      2ª chamada — padrão de `custom-fields/route.ts:186`).
- [x] `GET /api/v1/tags` — escopo `contacts:read`. Lista `{id, name, color}` da
      conta, ordenada por nome.
- [x] Mapear `ContactTagWriteError` explicitamente: ele **não** é `ApiError`, e
      cair no `toApiErrorResponse` transforma um "Tag not found" (404) em
      **500 genérico**.
- [x] Envolver `resolveImportTagIds` em try/catch — ela lança erro cru do
      PostgREST, que também vira 500 genérico.
- [x] `docs/public-api.md`: tabela de endpoints + seção nova. A tabela de
      escopos não muda (D4).

**Notas que valem para quem mexer depois**

- A auditoria é **automática**: o trigger da 912 grava `tag_added`/`tag_removed`
  em `cb_lead_events` a cada INSERT/DELETE em `contact_tags`. Vindo de
  service-role (toda rota v1) ele registra com `origin = 'sistema'` e
  `actor_user_id = NULL`. **Não escrever log à mão** — `authenticated` nem tem
  INSERT nessa tabela.
- Aplicar tag **dispara automação** (`tag_added`), uma execução por tag
  adicionada, sequencial. `add: [3 tags]` = 3 execuções. A guarda anti-ciclo é
  `_tag_chain_depth`, teto 3.
- ⚠️ `tags.user_id` é `NOT NULL` com `ON DELETE CASCADE` para `auth.users`, e
  `tags` **não** está em `TABELAS_PROTEGIDAS` de `dono-duravel.test.ts`. A v1
  já usa `resolveAuditUserId` (dono da conta como queda), mas a primeira
  preferência dele é `whatsapp_config.user_id`, que pode não ser o dono.
  Endurecer isso é candidato a fase própria — ver "Deixado de fora".

## Fase 2 — Banco e porta de entrada ✅

- [x] **Migration `0982_cb_webhooks_de_entrada.sql`** (número conferido em
      08/09/2026 contra `ls supabase/migrations/` **e** `list_migrations` — as
      duas fontes dão 981 como última).
  - `cb_webhooks`: `id`, `account_id` (FK CASCADE), `nome text NOT NULL`,
    `token text NOT NULL UNIQUE` (claro), `segredo text` (cifrado, nulo quando
    `sem_segredo`), `sem_segredo boolean NOT NULL DEFAULT false`,
    `is_active boolean NOT NULL DEFAULT true`, `campo_telefone text`,
    `campo_nome text`, `last_event_at`, `created_by` (SET NULL), timestamps.
  - `cb_webhook_eventos`: `id`, `account_id`, `webhook_id` (FK CASCADE),
    `recebido_em`, `resultado text NOT NULL DEFAULT 'recebido' CHECK (...)`,
    `detalhe text`, `contact_id` (**SET NULL** — apagar o cliente não apaga o
    registro de que o acionamento chegou), `telefone`, `nome`,
    `variaveis jsonb NOT NULL DEFAULT '{}'`, `processando_desde`,
    `processado_em`.
  - RLS ligada, `REVOKE ALL FROM PUBLIC, anon, authenticated` +
    `GRANT ALL TO service_role`, **sem policy** — tudo passa pela rota, como as
    tabelas do Calendly. Índice `(account_id, recebido_em DESC)`.
  - Bloco `DO $$` de conferência, válido em banco VAZIO: nenhuma conferência
    exige dado, e todo `REVOKE` tem o `GRANT` de volta por escrito.
- [x] `src/lib/webhooks-de-entrada/achatar.ts` (puro, com teste) — JSON
      arbitrário → `Record<string, string>`. As restrições vêm do `interpolate`
      do motor e **não são negociáveis**:
  - chave só `[A-Za-z0-9_]` (o regex do motor é `[\w.]`; acento, hífen e espaço
    fazem o `{{...}}` ficar literal na tela do cliente);
  - **sem caminho aninhado**: o motor lê só `partes[1]`, então
    `{{vars.pedido.total}}` nunca funcionaria — achata para `pedido_total`;
  - todo valor vira string (objeto viraria `"[object Object]"`);
  - **`_cadeia` e `_tag_chain_depth` são reservadas** (guardas anti-ciclo do
    motor) — payload externo não pode sobrescrevê-las.
- [x] `src/lib/webhooks-de-entrada/claim.ts` — cópia do `src/lib/calendly/claim.ts`,
      que já é genérico por natureza: `RECOLHER_CLAIM_MS` 10 min,
      `TETO_DE_PROCESSAMENTO_MS` 4 min, a margem entre os dois com teste,
      cerca de posse `.eq('processando_desde', claimIso)` em toda escrita
      pós-claim, `motivoDaRecusa`.
- [x] `POST /api/cb/webhooks/[token]` — a porta. Ordem deliberada:
      forma do token (regex, 404) → rate limit **por token** → segredo do
      header (`timingSafeEqual`, 401, nada gravado) → `JSON.parse` (400) →
      achatar → gravar a linha com o `claimIso` já dentro → **200** →
      `after()` com `comTetoDeProcessamento` e `gravarResultado` nos três
      caminhos (sucesso, teto, exceção).
- [x] Resolver contato: `campo_telefone` → `digitosDoTelefone` →
      `resolverDestinatario` (o mesmo do `send_to_number`, que grava o **dono
      durável da conta** em `contacts.user_id`, nunca quem clicou).
- [x] `src/lib/webhooks-de-entrada/log.ts` — contrato compartilhado entre rota
      e UI: tamanho da página, `RESULTADOS_REPROCESSAVEIS`, colunas do select.
      A UI **importa** essa constante; não duplicar a lista.

## Fase 3 — Gatilho `webhook_received` ✅

Checklist dos pontos que um gatilho novo exige (levantado do `calendly_booking`):

- [x] `src/types/index.ts` — membro no union `AutomationTriggerType` +
      `WebhookTriggerConfig` no union de config.
- [x] `TRIGGER_META` (`trigger-meta.ts:9`) — ⚠️ é `Record` sobre o union:
      esquecer é **erro de compilação**.
- [x] **NÃO** mexer em `GATILHOS_SEM_DISPARO` (há teste fixando o conteúdo).
- [x] `AutomationContext` ganha `webhook_id` — é o único campo que
      `triggerMatches` pode ler, e ele atravessa o passo "Aguardar" de graça
      (o contexto inteiro vira JSONB em `automation_pending_executions`).
- [x] Ramo em `triggerMatches` **antes do `return true` de `engine.ts:1444`**.
      ⚠️ Sem ramo, o default faz **todo** webhook disparar **toda** automação do
      tipo — falha silenciosa. Convenção: config vazia = qualquer webhook;
      preenchida = só aquele, **falhando fechado**.
- [x] Ramo em `validateTriggerForActivation` (`validate.ts:245`).
- [x] `TRIGGER_OPTIONS` (`automation-builder.tsx:243`) — ⚠️ **manter o formato
      literal**: `trigger-meta.test.ts:22` lê o FONTE por regex.
- [x] `src/components/automations/webhook-trigger-config.tsx` (novo), modelado
      em `calendly-trigger-config.tsx`: máquina de estados de carga explícita,
      opção órfã preservada, e o painel de `{{vars.*}}` — aqui alimentado pelas
      **variáveis do último acionamento real** daquele webhook, que é como o
      operador descobre o que dá para interpolar sem ler documentação.
- [x] i18n: `Automations.builder.triggers.webhook_received.{label,hint}` nos
      **dois** dicionários + o namespace do painel.
- [x] **Teste novo que hoje não existe**: o análogo de
      `descrever-passo.test.ts:155` para GATILHOS. `triggers.<tipo>.label` é
      chave dinâmica, o portão de i18n do CI declara não alcançá-la, e sem esse
      teste o CI passa verde com o keypath cru aparecendo no `<select>` do
      builder e no cartão do funil.

## Fase 4 — Tela ✅

- [x] Seção nova em Configurações: **Webhooks**, grupo `workspace`, ao lado de
      "API keys", com duas abas (D7).
- [x] **Aba Recebidos** — lista de webhooks. Por linha: nome, chip de estado,
      último acionamento, contagem por resultado. Expandindo: URL (readonly,
      mono), aviso de segredo, `campo_telefone`/`campo_nome`, e o **log**.
- [x] O log copia a forma do Calendly (`calendly-card.tsx:430-648`): `<table>`
      HTML cru, `React.Fragment` com duas `<tr>` (linha + detalhe), `<dl>` no
      detalhe, cor por resultado em 4 faixas, paginação por dois botões e um
      texto. **Nada de `Table`/`Collapsible` do shadcn** — é o padrão da casa.
- [x] Criar webhook: nome + campos de mapeamento; o segredo é revelado **uma
      vez**, com botão de copiar.
- [x] Botão "Processar de novo" por linha do log, gateado por
      `RESULTADOS_REPROCESSAVEIS` importado do módulo (rota e tela nunca
      divergem).
- [x] **Aba Enviados** — tela para os `webhook_endpoints` da 028, que hoje só
      existem por `curl`. Criar (URL + eventos, `secret` revelado uma vez),
      listar, ligar/desligar, apagar. Mostrar `failure_count` e
      `last_delivery_at`, e explicar que **15 falhas seguidas desativam** o
      endpoint sozinho e que reativar zera o contador.
  - Só admin (é o que as policies da 028 já exigem).
  - ⚠️ A entrega é **uma tentativa, 5s, sem retry**, e o vocabulário tem **3
      eventos** (`message.received`, `message.status_updated`,
      `conversation.created`). A tela precisa dizer as duas coisas, senão o
      operador conta com garantia que não existe.
  - As rotas já existem (`/api/v1/webhooks`), mas são autenticadas por **chave
      de API**, não por cookie. A tela precisa de rotas de sessão próprias em
      `/api/cb/webhooks-de-saida` — reusar as da v1 exigiria a tela carregar
      uma chave, que é exatamente o que a seção existe para evitar.

## Fase 5 — Documentação ✅

- [x] `docs/public-api.md`: os endpoints de tag e `GET /api/v1/tags`.
- [x] Doc do webhook de entrada para quem instala (como criar, o que o sistema
      externo precisa mandar, como ler o log).
- [x] Atualizar o `CLAUDE.md` na mesma passada, com as armadilhas que o código
      novo carrega (nota mentindo é pior que ausência de nota).

---

## Riscos

| Risco | Mitigação |
| --- | --- |
| Sem ramo em `triggerMatches`, todo webhook dispara toda automação | Ramo + teste com os 3 casos canônicos (vazio / casa / falha fechada) |
| `{{vars.x}}` some do texto em silêncio quando a chave tem acento | Achatamento sanitiza, e o painel do gatilho mostra as variáveis REAIS do último acionamento |
| Payload externo sobrescreve `_cadeia` e fura a guarda anti-ciclo | Chaves reservadas rejeitadas no achatamento, com teste |
| Reformatar `TRIGGER_OPTIONS` quebra teste que lê o fonte por regex | Anotado na Fase 3 |
| Dois processos Node no deploy `start-first` processam o mesmo acionamento | Cadeado `UPDATE…RETURNING` + cerca de posse (o `claim.ts` do Calendly, já provado) |
| Migration aplicada depois do deploy deixa a rota gravando em tabela ausente | Migration **antes** do merge (regra da casa para migration que ACRESCENTA) |

## Deixado de fora, por decisão

- **Retry durável dos webhooks de saída** (hoje: uma tentativa, 5s). A tela da
  Fase 4 vai DIZER que a entrega é best-effort; consertar isso é outro
  trabalho (precisa de fila e agendador).
- **Evento de webhook para tag** (`tag.added`) — o vocabulário de saída tem 3
  eventos e nenhum de contato.
- **`tags` na lista de tabelas protegidas** de `dono-duravel.test.ts`.

---

## Revisão (08/09/2026)

Revisão independente do diff inteiro, mais verificação e2e no preview contra
o banco de produção (webhook criado, acionado seis vezes, automação
disparando, tudo removido depois — ver o histórico da sessão).

**Seis achados, todos corrigidos antes do merge:**

| # | O quê | Onde |
| --- | --- | --- |
| 1 | Erro de banco na releitura final virava **404 depois** da escrita — o integrador leria "contato não existe" sobre um contato recém-alterado e recriaria a ficha | `api/v1/contacts/[id]/tags/route.ts` |
| 2 | Validação em `toLowerCase()` e resolução em `chaveDeTag()`: `{add:["Bancário"], remove:["bancario"]}` passava, removia e reinseria a MESMA etiqueta, disparando `tag_added` | `lib/api/v1/tags-do-contato.ts` |
| 3 | O reprocessar não amarrava o evento ao webhook da URL — o payload de B rodava com o mapeamento e o escopo de A | `claim.ts` + a rota de reprocessar |
| 4 | Reprocessar com o webhook DESLIGADO gravava `ignorado`, que é terminal: um clique queimava a linha para sempre | rota de reprocessar |
| 5 | `??=` sobre `{}` engolia chave herdada do `Object.prototype` (`constructor`, `toString`…) — sumia do payload E do log | `lib/webhooks-de-entrada/achatar.ts` |
| 6 | A escrita de `last_event_at` descartava o erro em silêncio | `api/cb/entrada/[token]/route.ts` |

Os de 1 a 5 ganharam teste de regressão, e os testes foram conferidos contra
o código ANTIGO para provar que reprovam.

**Verificado e limpo:** vazamento de segredo (nem `COLUNAS_DO_WEBHOOK` nem
as rotas o expõem), tenancy nas consultas auxiliares, uso do cadeado e da
cerca de posse, rowcount nas escritas, e a migration num banco vazio.

### Segunda rodada — Codex no PR #150

| # | Veredito | O quê |
| --- | --- | --- |
| 1 | ❌ **Falso positivo** | "`id_externo` omitido vira NULL e o insert estoura". O `columns` do postgrest-js só é fixado para ARRAY (`index.mjs:4438`); com objeto único o PostgREST deriva as colunas das chaves presentes e a omitida usa o DEFAULT — a doc do `defaultToNull` diz "only applies for bulk inserts". O e2e já havia provado ao vivo: três acionamentos gravados com `campo_id` vazio, todos 200. |
| 2 | ⚠️ **Real, parcialmente corrigido** | Corrida na criação de etiqueta nova: `tags` não tem UNIQUE em `name` e `resolveImportTagIds` faz ler-então-inserir. Mitigado relendo o catálogo depois da criação — as duas requisições convergem na etiqueta MAIS ANTIGA, então o contato ganha uma linha só e o `tag_added` dispara uma vez só. **Sobra**: a linha duplicada no catálogo. Fechar de vez exige índice único em `(account_id, lower(btrim(name)))` com deduplicação do que já existe — vale para o `PATCH` e para o import de CSV também, que têm a mesma corrida desde sempre. Fica para PR próprio. |
| 3 | ✅ **Real, corrigido** | A seção `webhooks` não estava em `SECOES_SO_DE_ADMIN`, e `podeVerSecao` tem fail-open para membro sem perfil — a seção aparecia para não-admin como tela permanentemente quebrada. Corrigido, e o teste do editor passou a DERIVAR da constante em vez de cravar `"perfis"`. |
