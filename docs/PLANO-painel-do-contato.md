# Plano — Painel do contato no inbox (vivo e checável)

> **O que é este arquivo.** Guia retomável da reformulação do painel direito da
> caixa de entrada, pedida pelo operador em 2026-08-29. **Ele é editado a cada
> fase**: ao INICIAR uma fase, registra-se aqui que a anterior foi concluída —
> objetivo, arquivos tocados e resultado medido — para que qualquer agente possa
> pegar o plano e saber o que foi feito, o que mudou e onde tudo parou.
>
> ⚠️ **Este documento envelhece.** Antes de decidir com base em algo aqui,
> confirme contra a realidade (grep, leitura do arquivo, query no banco). Ao
> achar divergência, corrija este arquivo no mesmo PR.

- **Criado:** 2026-08-29 · **Medido contra:** `main` @ `8c5fc06`, produção `hxnhakmyxyhalbsktzwe`
- **Fluxo por fase:** executar → typecheck/lint/test/i18n-parity → **testar no
  preview em resolução de monitor de verdade (1440×900+, nunca no tamanho
  nativo do painel)** → revisar 2× → PR → **revisar ESTE plano antes da fase
  seguinte** (confirmar que o que está planejado ainda é necessário).

---

## Estado

| Fase | Escopo | Estado | Migration | PR |
| --- | --- | --- | --- | --- |
| **1** | Casca: largura 360px, sempre montado, botão junto, abas só-ícone | ✅ **feita e mesclada** (PR #54, em produção 2026-08-29) | nenhuma | #54 |
| **2** | Edição: nome, etiquetas, campos personalizados (+ tipos novos, `field_key`) | ✅ **feita e mesclada** (PR #55, em produção 2026-08-29) | `948` aplicada | #55 |
| **3** | Abas reordenadas + aba de **Traqueamento** (campos de anúncio) | ✅ **feita** (2026-08-29) | `949` **aplicada** | `feat/painel-do-contato-fase-3` |
| **4** | Negócio dentro da conversa (etapa/valor/ganho-perdido) | ✅ **feita e mesclada** (PR #57, em produção 2026-08-29) | nenhuma | #57 |
| **5** | Seletor dois-níveis (funil→etapas) · cartão compacto · **etapa com resultado** (entrar carimba ganho/perdido) | ✅ **feita** (2026-08-29) | `950` **aplicada** | `feat/painel-do-contato-fase-5` |
| **6** | API pública dos campos personalizados (ler/escrever por `field_key` — para o n8n do gestor) | ✅ **feita** (2026-08-29) | nenhuma | `feat/painel-do-contato-fase-6` |

**Decisões travadas com o operador (2026-08-29):** ordem das abas =
Principal · Notas · Tarefas · Traqueamento · Histórico (Histórico por último;
Traqueamento é aba nova, pedida em 2026-08-29) · o webhook "CB OS - Atlas"
(única automação viva, `deal_stage_changed`) é **FAKE** — pode ser disparado
sem medo no teste da Fase 4 · uma aba "Principal" com
contato + negócio juntos · campos personalizados continuam no CONTATO, editáveis
da conversa · tipos novos: Lista e Número/Moeda (mantendo Texto/Data) ·
`field_key` estável para a API futura · **mudar etapa pela conversa = efeito
idêntico ao arrasto no quadro** (garantido pelos triggers 912/933 — ver Fase 4)
· entrega em fases, um PR por fase.

**Cortes deliberados (anti-overengineering, decididos na revisão do plano):**
redimensionar por arrasto (o pedido era abrir/fechar por botão) · abas
Mídia/Reuniões (não pedidas) · hooks novos para tags/negócios (busca fica no
topo do painel; trocar de aba não refaz query) · rota/RPC nova para mover etapa
(o painel usa o MESMO caminho do quadro) · `UNIQUE(account_id, field_name)` ·
superfície mobile (dívida registrada à época; **paga no pós-plano**, abaixo).

---

## ✅ Fase 1 — Casca (concluída em 2026-08-29)

**Objetivo:** o painel muda de forma sem ganhar escrita nova: mais largo
(280→360px), abrir/fechar sem desmontar, botão de fechar JUNTO do painel (morava
no cabeçalho do fio, atrás de 4 outros controles), conteúdo reorganizado em 4
abas só-ícone, identidade compacta (avatar 64→40px).

**Arquivos tocados:**

| Arquivo | O que mudou |
| --- | --- |
| `src/components/inbox/painel/painel-do-contato.tsx` | **NOVO — o painel de verdade.** Cabeçalho compacto (fechar + avatar 40px + nome/telefone), abas `Principal / Histórico / Notas / Tarefas` (User/History/StickyNote/ListTodo, cada uma com `title`+`aria-label`), buscas de deals/tags e o realtime de notas no TOPO (trocar de aba não refaz query). Exporta `TituloDeSecao` (tipografia única das duas fichas). Valor do negócio via `formatCurrency` (antes imprimia `BRL1500`). |
| `src/components/inbox/contact-sidebar.tsx` | Virou **re-export fino** de `painel/painel-do-contato` — é arquivo do upstream; a evolução acontece no módulo novo (menos conflito de merge). |
| `src/components/inbox/group-sidebar.tsx` | Mesma casca (cabeçalho com fechar, avatar 40px em linha, `w-full`, `min-h-0` no ScrollArea), **sem abas** (pouco conteúdo). `Secao` agora usa `TituloDeSecao`. |
| `src/app/(dashboard)/inbox/page.tsx` | Painel **sempre montado**: o `{open && …}` virou wrapper com `w-[360px]`/`w-0` + `transition-[width]` + `inert` quando fechado (preserva o realtime das notas, permite animar, tira o painel fechado da ordem de tabulação). Tira fina de reabertura (28px) na borda direita quando fechado. Passa `onClose` e `resyncToken` aos painéis. |
| `src/components/inbox/message-thread.tsx` | Toggle do painel REMOVIDO do cabeçalho do fio (props `contactPanelOpen`/`onToggleContactPanel` extintas; comentário aponta a nova casa). |
| `messages/en.json` + `messages/pt-BR.json` | 4 chaves novas: `Inbox.sidebar.tabMain/tabHistory/tabNotes/tabTasks`. As chaves do abrir/fechar continuam em `Inbox.messageThread` (o botão mudou de casa; as chaves ficaram — comentado na page). |

**Resultado medido (2026-08-29, preview em 1440×900 e 1281px):**
painel 360px · 4 abas com aria-label correto · cada aba monta o conteúdo certo
(Histórico com evento retroativo, Notas com a nota real, Tarefas com o botão
"Nova tarefa") · fechar → classe `w-0` + `inert` + **painel continua no DOM**
(o realtime das notas sobrevive) + `localStorage` persiste · tira de 28px reabre
· estado vazio ("Selecione uma conversa") também tem o botão de fechar · sem
rolagem horizontal · `typecheck` limpo · lint 0 erros (40 avisos vs 43 do
baseline — reduziu) · 1927 testes · `i18n-parity` OK · console limpo (os
`MISSING_MESSAGE` vistos durante o dev eram cache do servidor; sumiram no
restart).

**O que NÃO foi verificado:** painel de grupo na tela (não há conversa de grupo
nesta conta — mudança é mecânica e idêntica à da ficha) · animação da transição
(o painel do navegador estava oculto e congela frames; a classe alvo está
correta) · **a tela em produção** (o PR ainda não foi mesclado).

**Custo aceito:** com painel aberto a 1281px, o fio fica com ~360px (antes 441).
É a troca que "painel mais largo" implica; fechar para recuperar espaço agora é
um clique visível. Se incomodar no uso real, reduzir para `w-[340px]` é mudar
duas classes na page.

---

---

## ✅ Fase 2 — Edição (concluída em 2026-08-29)

**Objetivo:** o painel deixa de ser só-leitura — nome, etiquetas e campos
personalizados editáveis de dentro da conversa, com identificador estável
(`field_key`) e os tipos Lista/Número no catálogo.

**Migration `948_cb_campos_personalizados` — APLICADA em produção
(2026-08-29):** `field_key` NOT NULL + UNIQUE por conta; gatilho BEFORE INSERT
gera a chave quando ausente (⚠️ deliberado: entre aplicar e o deploy, o código
VELHO de produção insere campo sem chave — o gatilho cobre a janela, e cobre
também merges futuros do upstream); CHECK de `field_type` em
(text, datetime, select, number); opções do `select` na `field_options` JSONB
(existia desde a 001, nunca usada). Backfill deu chave aos 3 campos reais;
gatilho testado em produção com rollback proposital (gera, dedupa `_2`,
normaliza chave explícita).

**Arquivos:**

| Arquivo | O que |
| --- | --- |
| `supabase/migrations/0948_cb_campos_personalizados.sql` | acima |
| `src/lib/contacts/chave-do-campo.ts` (+ teste) | gêmeo TS do gerador SQL — 7 pares medidos NO banco fixados em teste de paridade |
| `src/lib/contacts/custom-values.ts` | `salvarValoresDoContato`: **upsert + delete dos esvaziados** — substitui o delete-all+insert destrutivo |
| `src/components/contacts/campo-personalizado-input.tsx` | input por tipo (text/datetime/select/number), compartilhado ficha↔painel; `opcoesDoCampo` tolerante a lixo; valor herdado fora da lista continua selecionável |
| `src/components/contacts/custom-fields-manager.tsx` | chave sugerida em tempo real (para de seguir o nome quando tocada), tipos Lista/Número, editor de opções na criação E por linha, chave copiável por linha, 23505→"identificador já em uso" |
| `src/components/contacts/contact-detail-view.tsx` | aba de campos usa o input compartilhado + o save por upsert |
| `src/components/inbox/painel/painel-do-contato.tsx` | nome editável no cabeçalho (clique no nome; gate `send-messages`), etiquetas com popover aplicar/remover (SÓ via `tag-api` — automação `tag_added` preservada), seção CAMPOS com save e "Gerenciar" (admin) abrindo o MESMO diálogo do catálogo (fechar refaz a busca) |
| `src/components/inbox/painel/linha-de-edicao.tsx` | extraída do group-sidebar (+ Enter/Escape); grupo importa em vez de duplicar |
| `src/app/(dashboard)/inbox/page.tsx` | `handleContactUpdated` espelha o rename no contato ativo, no fio e na lista sem refetch |
| `messages/{en,pt-BR}.json` | 12 chaves `Inbox.sidebar.*` + 10 `Contacts.customFields.*` |

**Resultado medido (produção via preview 1440×900, tudo revertido depois):**
rename propagou às 3 superfícies na hora e foi revertido · etiqueta aplicada →
`tag_added` origem `usuario` na trilha (trigger 912) → removida · valor salvo
por upsert e a linha DELETADA ao limpar+salvar · campo Lista criado com chave
`campo_teste_948` + opções `{Alfa,Beta,Gama}` → apareceu no painel como Select
→ "Beta" salvo → campo de teste excluído · console limpo pós-restart ·
typecheck limpo · lint 0 erros (40 avisos, baseline) · **1936 testes** (9 novos)
· i18n-parity OK.

**Não coberto / notas:** replay local em banco vazio não rodou (Docker
inexistente nesta máquina) — o CI replaya; a migration só afirma schema e pula
dados com NOTICE · ⚠️ os 3 campos de data reais são tipados `text` (nasceram
antes da 935) — o painel os mostra como texto livre, e o gatilho de LEMBRETE
por data não os enxerga; retipar é decisão do operador (não há editor de tipo,
de propósito) — **retipados em 2026-08-29 a pedido do operador, ver
Pós-plano** · única automação viva é `deal_stage_changed` (webhook CB OS) —
nenhuma em etiqueta, teste de tag foi seguro.

## ✅ Fase 3 — Abas reordenadas + Traqueamento (concluída em 2026-08-29)

**Objetivo:** Histórico vai para o fim da fileira e nasce a aba de
**Traqueamento** — os campos que o clique no anúncio produz (UTMs, fbclid,
ctwa_clid, nomes de campanha/conjunto/anúncio), recebidos hoje por
preenchimento manual/automação e, no futuro, devolvidos à API de Conversões
da Meta.

**Decisão de desenho:** campo de traqueamento É campo personalizado comum
(mesma tabela/RLS/valores TEXT), separado por `custom_fields.categoria`
(`'geral' | 'tracking'`, migration **949, aplicada**). O que isso compra de
graça: a ação de automação `update_contact_field` já os preenche, filtros de
broadcast já os enxergam, e a futura API os lê pelo `field_key` da 948. **Sem
seed em migration** — o catálogo padrão (10 campos) nasce pelo botão "Criar os
10 campos padrão" na aba (admin), por conta.

**Arquivos:** `supabase/migrations/0949_cb_categoria_do_campo.sql` ·
`src/lib/contacts/campos-de-traqueamento.ts` (+ teste: catálogo é ponto-fixo
do gerador de chave da 948 — senão o seed divergiria do gatilho — e faltantes
comparados por CHAVE em qualquer categoria) · `painel-do-contato.tsx` (ordem
nova, aba com seed/save por SUBCONJUNTO — o Salvar da Principal não arrasta
edição meio-feita do Traqueamento e vice-versa) · `custom-fields-manager.tsx`
(seletor de categoria + etiqueta na linha) · `contact-detail-view.tsx` (aba de
campos agrupada: gerais, depois subtítulo Traqueamento) · tipos + 10 chaves
i18n.

**Resultado medido (produção via preview 1440×900):** ordem das abas exata ·
seed criou os 10 campos (**ficaram — são a entrega**) · "Nome da campanha"
preenchido → salvo → conferido no banco pela chave `nome_da_campanha` →
revertido · Principal continua só com os 3 gerais · 1940 testes (4 novos) ·
typecheck limpo · lint 0 erros · i18n-parity OK. Rótulos técnicos
(utm_source/fbclid) sem `capitalize` de propósito.

**Fora do escopo desta fase (futuro):** captura AUTOMÁTICA do `referral` de
click-to-WhatsApp no webhook (preencher ctwa_clid/utm sozinho na entrada) e o
envio à API de Conversões — a aba é o depósito que essas duas pontas vão usar.

---

## ✅ Fase 4 — O negócio dentro da conversa (concluída em 2026-08-29)

**Objetivo:** o operador toca o funil DE DENTRO da conversa — "o funil vai ser
um reflexo da caixa de entrada". Cartão NEGÓCIO no topo da aba Principal:
etapa (Select com a cor), funil (Select, só com 2+ funis — hoje a conta tem
UM, então ele fica oculto por regra, não por falta), valor e fechamento
previsto (salvos no blur), Ganho/Perdido/Reabrir, "Abrir negócio completo" e
"Criar negócio" abrindo o `DealForm` existente (que ganhou o prop opcional
`defaultContactId`, e resolve a conversa vinculada sozinho → `conversation_id`
carimbado no nascimento, 910). Sem negócio, o cartão vira o botão de criar.

**Arquivos:** `painel-do-contato.tsx` (cartão + `atualizarNegocio`/
`mudarEtapa`/`mudarFunil`/`mudarStatus`, espelhando `pipelines/page.tsx`:
update direto sob RLS + `avisarDrenagemDeFunil`; UM update na troca de funil;
estado local atualizado na mão — `deals` sem realtime; inputs de valor/data
com o valor salvo NA `key`, senão o Base UI avisa de `defaultValue` mutável a
cada save) · `deal-form.tsx` (`defaultContactId` opcional) · 3 chaves i18n
(o resto reusa `Pipelines.form`/`Pipelines.card` — mesmo texto nas duas telas).

**O TESTE DO REQUISITO 6 — paridade com o arrasto, medida em produção
(webhook CB OS - Atlas é fake, confirmado pelo operador):**

| | Painel (21:10) | Arrasto no quadro (21:14) |
| --- | --- | --- |
| Trilha 912 | `stage_changed` Avulso→Fechado, origem `usuario` | idêntico |
| Fila 933 | evento criado e processado na hora | idêntico |
| Automação | executou em +3s: `add_tag:success`, `send_webhook:failed` (destino fake barrado pela allowlist do motor) | executou em +1s, MESMOS passos |

Mais: Ganho→Reabrir gravou 2 `status_changed` na trilha · valor 12.345,67
salvo no blur e exibido `R$ 12.346` · data salva e limpa · tudo REVERTIDO
(valor 0, sem data, Contato Avulso, etiqueta "Cliente Fechado" que a
automação aplicou foi removida). O arrasto do teste foi por PointerEvents
sintéticos (o KeyboardSensor congela com o painel do navegador oculto — as
setas não avançam a colisão; anotado para testes futuros).

**Notas:** o funil "Leads" visto na exploração foi APAGADO no meio-tempo — a
conta tem um funil só, e o seletor oculto é a regra do `deal-form` agindo ·
1940 testes · typecheck limpo · lint 0 erros · i18n-parity OK.

---

## ✅ Fase 5 — Dois níveis, cartão compacto, etapa com resultado (2026-08-29)

**Pedidos do operador (mensagem de 2026-08-29):** seletor que lista FUNIS e
expande as etapas (referência Kommo), facilitando troca entre funis · cartão
com MENOS informação (só etapa + valor à vista; data e Ganho/Perdido/Reabrir
sob expansão) · etapa configurável como ganho/perdido — o fluxo dele não usa
botão, usa a etapa.

**Resposta dada antes de executar (verificada no código):** ganho/perdido NÃO
some com nada — card fica na coluna (com selo), conversa intocada, negócio
permanece; sai das métricas de aberto e entra em "Ganhos no mês".

**Decisões travadas:** sair de etapa marcada para NEUTRA **não reabre** (o
fluxo do jurídico: fechou → transfere → continua ganho); reabrir só por botão
ou por entrar em etapa com outro resultado · etapa marcada VENCE status
explícito no mesmo update · tudo num PR.

**Migration `950_cb_etapa_com_resultado` — APLICADA:**
`pipeline_stages.resultado` ('ganho'|'perdido'|null) + gatilho **BEFORE
INSERT/UPDATE OF stage_id** em `deals` que carimba o status ao ENTRAR em
etapa marcada. No banco porque há CINCO escritores de etapa — a mesma
garantia de paridade da Fase 4. Testada com rollback: entrou→won, saiu para
neutra→FICOU won, reabrir explícito→open (gatilho passa reto).

**Arquivos:** `950_...sql` · `src/lib/pipelines/resultado.ts` (+5 testes:
espelho client-side do gatilho para o selo aparecer sem refetch — fixado
contra o comportamento MEDIDO) · `seletor-funil-etapa.tsx` (dois níveis;
clicar no funil só expande; escolher etapa de outro funil = UM update com as
duas colunas, chegando na etapa ESCOLHIDA; com 1 funil, lista direta) ·
`painel-do-contato.tsx` (cartão compacto + expansão `detalhesAbertos`;
`moverPara` substituiu mudarEtapa/mudarFunil) · `pipeline-settings.tsx`
(seletor de resultado por etapa, upsert leva a coluna) · tipos + 6 chaves i18n.

**Resultado medido (produção, preview 1440×900):** compacto = só seletor+valor
(selo Ganho/Perdido é a exceção deliberada — escondê-lo faria ganho parecer
aberto) · funil temporário criado via SQL para provar o dois-níveis:
transferência Bancário→"Funil Teste 950/Andamento Teste" saiu como UMA linha
`pipeline_changed` na etapa escolhida (funil de teste apagado depois) ·
config salvo pela tela de Funis: **Contrato Fechado=ganho, Perdido=perdido
(FICOU — é a entrega)** · mover→Contrato Fechado: selo GANHO apareceu SEM
botão, trilha com "moveu"+"ganhou" no MESMO segundo (um update) · mover→
neutra: selo FICOU · Reabrir: open · etiqueta da automação removida ·
1945 testes · typecheck limpo · lint 0 erros · i18n-parity OK.

**Auditoria completa (pedida pelo operador, 2026-08-29, pós-Fase 5):**
CI replayou 948+949+950 em banco LIMPO ✓ · schema de produção 13/13 contra os
arquivos (colunas, CHECKs, gatilhos, privilégios, ordem dos BEFORE em `deals`)
✓ · raio de impacto medido: **fluxos** e **IA** têm ZERO ponto de contato com
campos/negócios/nome; **motor de automações** — `update_contact_field` lista
os 13 campos (traqueamento preenchível por automação HOJE), lembrete continua
só-datetime, `create_deal` não fixa status (nasce carimbado se a etapa de
entrada for marcada — config, não bug); **933** já separava etapa/status em
DOIS eventos no mesmo save, então automação `deal_status_changed` dispara
junto da de etapa, cada uma no seu tipo; **broadcasts** — filtros/merge-tags
ganham os campos novos, valor segue TEXT; **API v1** — PATCH é um update só,
etapa marcada vence. **UM VÃO ACHADO E CORRIGIDO:** o otimismo do arrasto no
quadro só refletia `stage_id` — o selo Ganho não aparecia sem reload; agora o
`handleDealMoved` usa o espelho (`statusAoEntrarNaEtapa`), verificado ao vivo.

**Incidente no meio:** o deploy do #57 falhou no SSH da VPS (`dial tcp :22:
i/o timeout` — runner do GitHub não alcançou a porta; CI e imagem OK).
Retry do job resolveu. Se repetir, olhar firewall/rede da VPS, não o código.

---

## ✅ Fase 6 — API pública dos campos personalizados (2026-08-29)

**O contrato para o n8n do gestor** (captura de referral e envio à Meta ficam
FORA do CRM, decisão do operador): os valores dos campos — traqueamento e
gerais — são lidos e escritos pela API pública, endereçados pela CHAVE estável
da 948, nunca por UUID.

- `GET  /api/v1/contacts/{id}/custom-fields` (escopo `custom_fields:read`) —
  catálogo inteiro com os valores do contato: `fields` (metadados + valor) e
  `values` (mapa chave→valor, para expressão de n8n indexar direto).
- `PATCH` (escopo `custom_fields:write`) — grava por chave; `""`/null LIMPAM
  (o upsert compartilhado deleta a linha); número/booleano viram string (o
  banco é TEXT de propósito); **chave desconhecida falha a requisição com 400
  e a lista** — typo do n8n aparece na primeira chamada, não na auditoria
  meses depois. Resposta = estado pós-escrita.
- Escrita REUSA `salvarValoresDoContato` — o mesmo caminho das telas.
- Regras v1 respeitadas: service-role com `.eq(account_id)` em TUDO; erro de
  banco vira 500 e nunca 404; escopo+rota em par (`scopes.ts` foi de 18→20).

**Arquivos:** `src/lib/api/v1/custom-fields.ts` (puro, +6 testes) · rota
`src/app/api/v1/contacts/[id]/custom-fields/route.ts` · `scopes.ts` ·
`docs/public-api.md` (seção com exemplos de payload) · CLAUDE.md (contagem de
escopos do fork).

**Resultado medido (chamadas REAIS contra o dev apontando produção, com
chave criada e revogada no fim):** GET 13 campos/13 nulos ✓ · PATCH gravou
string e coagiu `98765`→"98765" ✓ · typo `utm_sorce` → 400 "unknown field
keys" ✓ · limpar → null (linhas deletadas) ✓ · contato inexistente → 404 ✓ ·
chave sem escopo → 403 ✓ · sem chave → 401 ✓ · chave revogada → 401 ✓ ·
valores do contato zerados ao final · 1951 testes · typecheck limpo · lint 0
erros · i18n-parity OK.

## ✅ Pós-plano — retipar campos de data + superfície mobile (2026-08-29)

Dois itens do backlog, executados a pedido do operador depois das 6 fases.

**1. Retipar os 3 campos de data (`text` → `datetime`).** Feito por UPDATE
direto em produção (dado de conta, não schema — nenhuma migration): "Data da
Proposta", "Data de Fechamento do Contrato" e "Data do Primeiro Contato".
Medido antes: `contact_custom_values` tinha **0 linhas** (nenhum valor jamais
gravado em campo nenhum), então não houve conversão de formato — o campo nasce
`datetime` limpo, o painel os rende como `datetime-local` (conferido no
preview) e o gatilho de **lembrete por data** passa a listá-los
(`automation-builder.tsx` filtra `field_type === TIPO_DATA`). Valores novos
seguem a convenção da 935: ISO UTC no banco via `paraEntradaLocal`/
`deEntradaLocal`. ⚠️ Quem gravar essas chaves pela API v1 (n8n) deve mandar
ISO com offset — texto livre não quebra nada, mas o lembrete não dispara e o
input aparece vazio (tolerância de `campo-data.ts`).

**2. Superfície mobile do painel (`feat/painel-do-contato-mobile`).** A MESMA
instância montada vira, abaixo de `lg`, um overlay `fixed` que desliza da
direita (mesmo padrão do drawer de navegação: backdrop `z-30` + painel
`z-40`), aberto **tocando no nome/avatar no cabeçalho do fio** (padrão
WhatsApp) e fechado pelo backdrop ou pelo X do painel. Decisões que importam:

- **Estado mobile próprio (`painelMobileAberto`), sempre nasce fechado e não
  persiste** — o `contactPanelOpen` do desktop persiste "aberto" por padrão, e
  no celular isso cobriria o fio a cada conversa. Trocar de conversa ou voltar
  à lista fecha o overlay.
- **As duas variantes moram nas classes** (`fixed`+`translate-x` no mobile,
  `lg:static`+`lg:w-*` no desktop) — o HTML do servidor está certo nos dois
  mundos, nada desmonta ao cruzar o breakpoint, realtime das notas sobrevive.
  As larguras `sm:`/`lg:` coexistem por ordem de cascata (armadilha
  tailwind-merge documentada no comentário do wrapper).
- **`inert` segue a superfície ATIVA** via `useMediaQuery` novo
  (`src/hooks/use-media-query.ts`, `useSyncExternalStore` com snapshot de
  servidor `false`) — sem aviso de hidratação; primeiro paint assume mobile e
  reconcilia. O lint novo (`react-hooks/set-state-in-effect`) derrubou a
  primeira versão com setState em efeito.
- **Nome/avatar do cabeçalho viraram um `<button>`** (h2/p → span: button só
  aceita phrasing content). No desktop o mesmo toque reabre a coluna fechada —
  gesto idêntico nas duas superfícies. Prop nova `onOpenContactPanel` em
  `message-thread.tsx` (arquivo do upstream — camada nossa, ver CLAUDE.md).

**Arquivos:** `src/hooks/use-media-query.ts` (novo) ·
`src/app/(dashboard)/inbox/page.tsx` · `src/components/inbox/message-thread.tsx`
· este plano. Nenhuma chave i18n nova (reusa `showContactPanel`/
`hideContactPanel`).

**Resultado medido (preview 375×812 e 1440×900):** overlay fecha/abre com
classes+`inert` corretos, backdrop presente, 5 abas e ficha completa no
celular (incl. os 3 campos retipados como data) · desktop intocado: coluna
360px estática, X fecha (`lg:w-0` + tira de reabertura), clique no nome
reabre e persiste no localStorage · typecheck limpo · lint 0 erros ·
**1951 testes** · i18n-parity OK.

## ✅ Pós-plano — revisão quente e fria completa (2026-08-29)

Pedido do operador: revisar TUDO que o plano entregou (PRs #53–#59 + o #60),
caçando o que passou batido. Revisão quente (própria, nas costuras) + fria
(4 revisores adversariais independentes: painel/estado, banco/motor medido em
produção, API v1, layout/i18n/mobile). **Todo achado foi verificado contra o
código/banco/preview antes de aceito.** Correções no PR #60.

**Corrigidos (13):**

1. **CRÍTICO — rota v1 de campos importava de módulo `"use client"`.**
   `serializeCustomFields` chamava `opcoesDoCampo` do
   `campo-personalizado-input` — num route handler (layer RSC) o export vira
   client-reference proxy que LANÇA ao ser chamado, com build/typecheck/vitest
   verdes (reproduzido no Next 16.2.12; medido em produção: rota ainda carrega
   e catálogo tem 0 `select` — bomba armada para o 1º campo de lista, e o
   PATCH gravava ANTES de serializar → dado salvo + 500 no n8n). Função movida
   para `src/lib/contacts/campo-opcoes.ts` (puro, testado); 3 importadores.
2. **ALTA — troca de contato não invalidava o estado por-contato do painel.**
   Deals/etiquetas/valores do contato ANTERIOR ficavam visíveis e EDITÁVEIS
   sob o cabeçalho do novo até o fetch resolver (salvar gravava dado de A em
   B), e resposta fora de ordem sobrescrevia o atual. Agora: efeito de
   invalidação síncrono + `contactIdRef` (staleness) + gate `dadosProntos`
   (spinner no cartão, salvar/inputs travados). Medido no preview: t+120ms
   spinner + salvar desabilitado; t+2s liberado.
3. Falha na query de valores + "Salvar" = DELETE silencioso dos valores reais
   (o `?? ""` limpa o que não carregou) → all-or-nothing nas queries
   por-contato + toast `loadError` + o mesmo gate do item 2.
4. `dealAtivo` trocava de identidade no meio da interação ("Perdido" em X →
   cartão salta para Y → "Reabrir" reabria o errado) → âncora
   `ultimoNegocioMexido`.
5. Update de negócio sem checagem de ROWCOUNT (painel + arrasto do quadro):
   0 linhas com `error: null` (viewer sob RLS; negócio apagado por outro
   operador) parecia sucesso — com o espelho da 950 chegava a carimbar
   "Ganho" falso → `.select("id")` + rollback/refetch nos dois escritores.
6. Save de negócio recusado deixava o input não-controlado exibindo o texto
   não salvo (key derivada do valor, que não mudou) → nonce `resetNegocio`.
7. PATCH v1 aceitava qualquer texto em campo `datetime` ("31/12/2026" → 200,
   input vazio, lembrete da 935 nunca dispara) → exige ISO-8601 COM offset e
   normaliza para UTC (400 caso contrário).
8. `''` gravado pela automação saía como `""` onde a doc promete `null` →
   serialização normaliza vazio para null.
9. Sem teto de valor na v1 → `MAX_VALOR = 4000` (convenção das tarefas) e
   listas de erro fatiadas em 20 na mensagem do 400.
10. Breakpoint do JS em px vs `lg` do Tailwind v4 em rem: com fonte de
    acessibilidade ≠16px as superfícies divergiam (nome não abria nada,
    `inert` liberava painel invisível) → `useMediaQuery("(min-width: 64rem)")`.
11. `aria-label` do botão do cabeçalho apagava o NOME do contato do acessível
    e o fio perdeu o `h2` → h2 envolve o botão (button é phrasing), sem
    aria-label (conteúdo = nome), `title` diz a ação.
12. Data das anotações em inglês (`format` do date-fns sem locale) →
    `toLocaleString(undefined, …)`, regra do CLAUDE.md.
13. Chave de 60 chars estourava a linha do gerenciador (rolagem horizontal na
    lista) → truncate; e o comentário da migration 948 mentia a forma de
    `field_options` ("array" → objeto `{"opcoes": []}`) → corrigido.

**Registrados, sem correção (com motivo):**

- Negócio que NASCE em etapa marcada não emite `deal_status_changed` (ramo
  INSERT da 934 só enfileira stage) — automação "quando ganhar" não roda para
  card criado já em "Contrato Fechado". Decisão de produto + migration;
  proposta pendente.
- Trigger da chave (948) é só BEFORE INSERT — UPDATE via PostgREST pode
  gravar `field_key` suja/vazia (nenhum escritor no app faz isso hoje).
  Migration futura: estender a `BEFORE UPDATE OF field_key`.
- `anon` mantém DML nas tabelas upstream que 948/949/950 tocaram (postura
  pré-931, RLS segura tudo — medido 0 linhas) — REVOKE em migration futura.
- Upsert+delete de valores sem transação e eco pós-escrita não-atômico —
  aceito (retry converge; plano descartou RPC de propósito).
- Espelho da 950 com `stages` velhos entre sessões (selo até o refetch) —
  contrato sem realtime em `deals`, aceito.
- Overlay mobile sem Esc/inert no fundo — mesmo padrão do drawer de
  navegação (consistência da casa).
- Chave só-write da v1 lê o estado no eco do PATCH — documentado na doc.

**Limpos (verificados a fundo):** regra "um update só" nos 3 escritores ·
`avisarDrenagemDeFunil` em todo caminho · espelho `resultado.ts` ≡ gatilho
950 caso a caso (+ prova viva em `cb_lead_events`) · 950×933 sem disparo
dobrado · replay das 3 migrations em banco vazio · gerador de chave SQL ≡ TS
(24↔24) · tenancy da v1 (UUID de outra conta inalcançável) · erro de banco
nunca vira 404 · twMerge medido em 5 combinações · i18n 2461/2461 · grants
medidos em produção.

Checks finais: typecheck limpo · lint 0 erros/40 avisos · **152 arquivos /
1958 testes** · i18n-parity OK · preview verificado (ciclo de troca de
contato medido, console limpo no compile atual).

## ✅ Pós-plano — ajustes do operador (2026-08-29, noite)

Seis pontos pedidos após o uso real do painel; entregues num PR único a partir
do `main` já com o plano inteiro mergeado.

**Diagnóstico antes do código (mudou dois pedidos):** medido em `profiles`,
a conta tem UM membro — o "Gabriel" é OUTRA conta (workspace próprio, nunca
convidado). Logo: não havia a quem atribuir tarefa nem quem mencionar, e
menção a si mesmo NÃO notifica de propósito (rota de notas exclui automenção).
Os dois "bugs" eram estado da conta + convenção "seletor some com <2". A
correção de produto é convidar o colega em Configurações → Membros da equipe.

**Entregue:**

1. **Criação de tarefa na página /tarefas** — botão "Nova tarefa" no
   cabeçalho; sem cliente por prop, o `TaskForm` abre seletor de contato
   (carregado só nesse modo; teto de 1000 do PostgREST anotado no código).
2. **Responsável SEMPRE visível** no `TaskForm` (pedido explícito):
   desabilitado com "Você (único membro desta conta)" + dica de convite
   quando não há escolha; seletor normal com 2+.
3. **Etiqueta de tarefas abertas na aba do painel** — contagem por
   `count: 'exact', head: true` (qualquer responsável), 8ª consulta do
   fetch; a aba avisa via `aoAlterar` → `recontarTarefas` (o conteúdo da
   aba só monta quando aberta; a etiqueta existe antes).
4. **Linha "Canal" removida da Principal** — eco do seletor do cabeçalho
   do fio (linha correspondente do CLAUDE.md atualizada).
5. **Caixa de menção na aba Notas** — a MESMA `InternalNoteBox` do
   compositor (keyed por conversa — rascunho morre na troca; `onClose`
   virou opcional; lista de sugestões ganhou direção `listaParaBaixo`
   porque no topo de um scroller a lista para cima seria cortada).
6. **Nota fixada (migration 951)** — `fixada_em` + índice parcial ÚNICO
   por contato (o banco desempata corrida, 23505 → 409); escrita só pela
   rota `PATCH /api/cb/notes/[id]` (UPDATE segue revogado no navegador);
   card sticky no topo da aba (medido: rolagem move a lista e o card fica);
   hook ganhou realtime de UPDATE (REPLICA IDENTITY FULL da 921 já servia)
   e `aplicarFixacao` local. Nota de grupo não fixa (contact_id nulo).

**Verificado no preview:** etiqueta "2" no cliente com 2 tarefas abertas ·
formulário global com 118 clientes e Criar travado sem escolha · responsável
desabilitado + dica · menção abrindo para baixo na aba Notas · fixar/trocar/
desafixar com estado conferido no banco a cada passo (sempre ≤1 fixada) ·
datas de nota em pt-BR. Checks: typecheck limpo · lint 0 erros/40 avisos ·
152 arquivos/1958 testes · paridade i18n.

⚠️ Achado de infraestrutura no caminho: a **947 está aplicada mas sem
registro no histórico** do Supabase (conferida no schema) — registrada no
CLAUDE.md como segunda ocorrência do precedente da 037.

## ✅ Pós-plano — revisão dos ajustes (2026-08-30, PR de correções)

Revisão quente + fria (2 revisores adversariais: cliente/UI e servidor/banco
com medições em produção) sobre o PR #61. Nada corrompe DADO — os achados
reais eram estado de TELA em corrida. Corrigidos:

1. **Guarda tautológica de resposta em voo (alta)** — salvar nota e trocar de
   conversa no sub-segundo fazia a nota do cliente A aparecer na lista do B
   (o closure comparava A===A; herdado do caminho antigo e replicado). A
   guarda agora é VIVA, no hook (`conversaAtualRef`), cobrindo todos os
   chamadores — inclusive `aplicarFixacao`, cujo ramo de limpeza desafixava
   localmente a nota do cliente novo.
2. **Autofoco da caixa de menção no painel** — remontagem por troca de
   conversa roubava o foco do compositor e abria teclado no celular só de
   olhar as notas → prop `autoFocus` (off no painel; compositor intacto).
3. **Busca de contatos do formulário global** — erro virava lista vazia com
   cara de "não há clientes" e nunca retentava → toast + retry ao reabrir.
4. **Reset do TaskForm** — a chegada da lista de membros com a caixa aberta
   apagava título e cliente escolhido (pré-existente + novo) → efeito
   dividido; e o ramo "único membro" não afirma mais nada enquanto os
   membros CARREGAM (seletor neutro desabilitado).
5. **Rota de fixar** — nota apagada entre a leitura e o update virava 500
   com log de erro falso → `PGRST116` mapeado para 409 `NOTE_GONE` (a
   limpeza da fixada anterior já commitou; o operador refaz o pin).

Medido e LIMPO pelos revisores: realtime de UPDATE publicado de verdade
(fixar numa sessão aparece na outra; `prattrs` NULL = todas as colunas);
tenancy/papéis/grants da rota (anon sem NADA na tabela); índice parcial e
corrida 23505 no lugar certo; migração 951 idempotente e registrada; RLS da
contagem de tarefas. Registrados sem correção: fixada fora da janela de 200
notas (teto latente, comentado no hook), etiqueta oculta ≠ zero em falha de
contagem (convenção da casa), e `cb_channels` na publicação realtime com
lista fixa de colunas (nota no CLAUDE.md — armadilha para código futuro).

## Referências de exploração (2026-08-29)

- 117 contatos · 107 negócios (~1/contato), todos em "Contato Avulso", 0
  ganhos/perdidos — o funil nunca foi trabalhado; é o problema que a Fase 3 ataca.
- `custom_fields` NÃO tem slug (só UUID + `field_name` livre); `field_options`
  JSONB existe desde a 001 e nunca foi usada; tipos hoje: `text`, `datetime`
  (universo fechado só na UI).
- Fluxos e Agentes de IA/Radar: **zero ponto de contato** com o painel.
- Broadcasts: leem campos por UUID e tratam valor como texto — intactos.

## Revisão externa (Codex, 2026-08-30) — o que entrou

O Codex revisou os PRs no GitHub e deixou 22 apontamentos. 8 já estavam
resolvidos (nossa própria revisão chegou antes nos mesmos pontos — inclusive
os três P1), 1 foi recusado (rotular seeds por locale: o app é pt-BR fixo) e
13 viraram correção no PR desta seção. Os do painel:

- **`stages` do DealForm memoizado** (`stagesDoForm`): o efeito de reset do
  formulário tem `stages` nas dependências, e o filtro inline criava array
  novo a cada render — uma nota chegando por realtime, com o Sheet aberto,
  apagava o que o operador digitava.
- **Semear traqueamento** ficou tolerante a catálogo velho
  (`upsert ignoreDuplicates` no índice da 948) e **recarrega só as
  definições** — o `fetchContactData()` completo descartava rascunho de
  valor ainda não salvo.
- **`__limpar__` virou valor reservado** (`OPCAO_RESERVADA` em
  `campo-opcoes.ts`): opção de lista homônima era intraduzível em escolha
  (virava "limpar valor"); o editor a filtra e o leitor também.
- **Overlay mobile virou modal de verdade**: lista + fio ficam `inert` e o
  foco entra no painel enquanto ele cobre a tela (medido: 2 inertes com ele
  aberto, 1 — o próprio painel — com ele fechado).

Fora do painel, no mesmo PR: o leque dos lembretes (`triggerMatches` sem caso
para `date_field_offset` rodava TODAS as automações de lembrete da conta),
`null`/`''` como deslocamento zero, a 952 (follow-up "depois" aceita reunião
realizada), o PATCH da agenda apagando `contato_nome` histórico, o seletor de
cliente da agenda (trava, nome velho, busca com máscara de telefone) e o
envelope `data` no exemplo da doc da API.
