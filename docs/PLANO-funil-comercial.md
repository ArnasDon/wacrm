# Plano — Funil comercial: lista de leads, desempenho e saúde (vivo e checável)

> **O que é este arquivo.** Guia retomável da introdução de duas visões novas na
> tela de Funis, pedidas pelo operador em 2026-09-03 a partir de uma ferramenta
> de referência (prints do mesmo dia): uma **lista** dos leads de um funil, com
> etapa editável, valores, campos personalizados e exportação; e um **painel do
> funil comercial** — funil de eficiência, negativos, taxas de conversão entre
> etapas (atual × anterior), entrada de leads por dia, conversão ao longo de 12
> meses e mapa de saúde. **Ele é editado a cada fase**: ao INICIAR uma fase,
> registra-se aqui que a anterior foi concluída — objetivo, arquivos tocados e
> resultado medido — para que qualquer agente possa pegar o plano e saber o que
> foi feito, o que mudou e onde tudo parou.
>
> ⚠️ **Este documento envelhece.** Antes de decidir com base em algo aqui,
> confirme contra a realidade (grep, leitura do arquivo, query no banco). Ao
> achar divergência, corrija este arquivo no mesmo PR.

- **Criado:** 2026-09-03 · **Medido contra:** `main` @ `4754a45`, produção
  `hxnhakmyxyhalbsktzwe` (queries de leitura em 03/09, ~21h)
- **Fluxo por fase:** executar → typecheck/lint/test (Node 22, o do `.nvmrc`)
  /i18n-parity/i18n-chaves-usadas → **testar no preview em resolução de monitor
  de verdade (1440×900+)** → revisar 2× → PR → **revisar ESTE plano antes da
  fase seguinte** (confirmar que o que está planejado ainda é necessário).
- **Um PR por fase.** Migration aplicada em produção via conector ANTES do
  merge, com leitura de conferência (convenção das 972/973/974).

---

## Estado

| Fase | Escopo | Estado | Migration | PR |
| --- | --- | --- | --- | --- |
| **0** | Fundamentos: correspondência etapa → degrau do funil de eficiência (coluna + UI em Funis), RPC das trajetórias, módulos puros do cálculo | ✅ **feita** (2026-09-04) | `975_cb_degrau_do_funil` **aplicada** (04/09) | [#119](https://github.com/leonardocabralb/CB-CRM/pull/119) |
| **1** | **Lista de leads** do funil: colunas fixas + campos personalizados, etapa editável na linha, busca/etapa/situação/período, ordenação, CSV | ✅ **feita** (2026-09-04) | nenhuma | [#120](https://github.com/leonardocabralb/CB-CRM/pull/120) |
| **2** | **Desempenho**: funil de eficiência, negativos e em aberto, taxas atual × anterior, entrada por dia, cards de conversão/valor | ✅ **feita** (2026-09-04) | nenhuma | [#121](https://github.com/leonardocabralb/CB-CRM/pull/121) |
| **3** | **Saúde**: conversão por degrau nos últimos 12 meses (linhas) e mapa de calor | ✅ **feita** (2026-09-04) | nenhuma | [#122](https://github.com/leonardocabralb/CB-CRM/pull/122) |
| **4** | **Meta Ads em Integrações**: conexão com a conta de anúncios (token cifrado), campanhas → funil, gasto diário por campanha puxado pelo agendador → custo por lead, CAC e custo dos perdidos no Desempenho | ✅ **feita** (2026-09-04) — falta o operador **conectar** (token) e rodar `docker stack deploy` na VPS | `976_cb_meta_ads` **aplicada** (04/09) | [#123](https://github.com/leonardocabralb/CB-CRM/pull/123) |
| **5** | **Depois, cada um por decisão própria**: captura automática do anúncio de origem (fica barata depois da Fase 4) · backfill de lista de outro CRM (plano próprio) | 🔭 futuro | — | — |
| **6** | **Contagem POR PERÍODO como padrão** (o que aconteceu no período), com "por mês de entrada" (a coorte) sob demanda — Desempenho e Saúde | ✅ **feita** (2026-09-18) | nenhuma | (este PR) |
| **7** | **Ciclo de vendas** no Desempenho: Entrada → Contrato, Reunião → Contrato, Proposta → Contrato (mediana, média, n) | 🔜 próxima | nenhuma | — |
| **8** | **Reuniões por dia e horário** na Saúde (mapa dia da semana × hora; cruzar com No Show / Proposta / qualquer etapa; taxa por horário), com a fonte no log do Calendly + o campo do contato, e o **cancelamento** do Calendly passando a ser recebido | 🔜 depois da 7 | uma (cancelamento) | — |

**Decisões travadas com o operador (2026-09-03):**

- O funil de eficiência é **fixo** (Lead → MQL → Reunião → Proposta →
  Contrato) e **cada funil do CRM escolhe quais das suas etapas correspondem
  a cada degrau**, podendo somar várias etapas num degrau (ex.: "leads
  avulsos" + "leads do TypeBot" = Lead); essa correspondência alimenta o
  funil de eficiência, as taxas entre etapas, a entrada de leads, a conversão
  ao longo do tempo e o mapa de saúde.
- **Os dados do funil vêm SÓ do CRM, por enquanto**: a equipe move os cards;
  nenhum n8n espelhando o funil externo. Um backfill a partir da lista de
  outro CRM fica como possibilidade futura, com plano próprio (Fase 5b).
- **"Contato Avulso" e as demais etapas de entrada CONTAM como Lead.** Qual
  etapa é qual degrau será configurado à mão pelo operador, depois, na tela
  de Funis (a Fase 0 entrega o controle; ninguém grava mapeamento por ele).
- ⚠️ **Negócio transferido para outro funil CONTINUA contando no funil de
  origem** (regra 6). O operador pediu que isto fique escrito para não se
  perder: está aqui, vai para o cabeçalho de `coorte.ts` e para o CLAUDE.md
  no PR da Fase 0.
- O filtro "só alto valor" **fica de fora**.
- **Investimento começa direto pela API da Meta**, integrada na aba de
  Integrações (Configurações → Integrações), sem lançamento manual.

**Decisões travadas com o operador em 2026-09-18** (as Fases 6–8):

- **O padrão passa a ser "por período"**: quem olha setembro vê os 5
  contratos fechados em setembro, mesmo que as 10 reuniões tenham sido em
  agosto. A contagem por coorte ("por mês de entrada") continua, sob demanda,
  num seletor ao lado do período — é ela que responde "dos que entraram,
  quantos converteram", com nenhuma taxa acima de 100%.
- **As duas regras de contagem ficam ESCRITAS e PINADAS por teste**
  (`por-periodo.test.ts`): (1) o mesmo lead que bate duas vezes em "Reunião
  Agendada" conta UMA vez; (2) sair de Reunião para Contrato não tira o lead
  de Reunião — e ele conta em Proposta mesmo sem ter passado por ela.
- **Taxa acima de 100% no modo por período é MOSTRADA como é**, com a nota
  na tela (é razão de fluxo: contratos do mês ÷ reuniões do mês). Nunca
  cortar em 100%.
- **Ciclo "Reunião → Contrato" conta da ENTRADA na etapa de reunião** (não
  da data real da reunião no Calendly): vale para qualquer funil e reunião
  marcada à mão, e a diferença medida é de 1,1 dia em mediana (máx. 4,9).
- **O cancelamento do Calendly entra na Fase 8**: hoje reunião cancelada
  conta como marcada e dilui a taxa de no-show por horário. Exige clicar
  "Reassinar" no cartão do Calendly depois do deploy; cancelamentos antigos
  não são recuperáveis.
- **Dados anteriores à operação real: DEIXAR DILUIR.** O CRM só passa a ser
  operado de verdade na semana de 21/09; os ~700 cards parados nas etapas de
  entrada e os movimentos feitos com atraso na arrumação ficam como estão.
  Uma "data de início da medição" por funil e o "informar a data real ao
  mover" foram oferecidos e RECUSADOS. ⚠️ A migração da Kommo
  (`docs/PLANO-migracao-kommo.md`, decisão 9) pode tornar isso irrelevante:
  a Kommo guarda o histórico inteiro de etapas, e a trilha reconstruída com
  as datas reais faz o funil dos últimos 15 meses sair verdadeiro.

**Decisões ainda abertas:** ver a seção "Decisões a tomar" — cada uma tem a
recomendação escrita; o plano segue com a recomendação como hipótese até o
operador dizer o contrário.

---

## 1. O pedido, traduzido para o que já existe

A ferramenta de referência tem cinco abas por funil (Leads · Fontes/Webhooks ·
Atividade · Mapa · Saúde). O pedido cobre **duas** delas — a lista e o painel
de eficiência/saúde — e é isso que este plano entrega. Correspondência com o
que o CB CRM já tem:

| Na referência | No CB CRM hoje | O que falta |
| --- | --- | --- |
| Seletor de funil | `pipelines/page.tsx:574-618` (com recorte por perfil, `funisVisiveis`) | nada — as visões novas entram embaixo dele |
| Abas Leads / Saúde | `vista` = `"leads" \| "automacoes"` (`page.tsx:148`, estado React, sem URL) | duas/três vistas novas no mesmo toggle |
| Tabela de leads com estágio editável | Kanban (`pipeline-board.tsx`) escreve etapa por arrasto; painel da conversa por `SeletorFunilEtapa` | a **tabela** e a escrita na linha (mesmo padrão dos dois) |
| Colunas CPF/CNPJ, Valor da dívida, Situação, Campanha, Conjunto, Anúncio | 18 campos personalizados cadastrados (8 gerais de venda + 10 de traqueamento no bloco "Traqueamento") | mostrá-los em coluna |
| Valor proposta | `deals.value` (NUMERIC, `formatCurrency` em pt-BR) | coluna |
| "Na etapa desde" | `cb_lead_events` (912) guarda cada mudança de etapa com `occurred_at` | derivar da trilha |
| Exportar CSV | só um `toCsv` privado na página de broadcast (`broadcasts/[id]/page.tsx:130-149`) | módulo reutilizável |
| Funil de eficiência e taxas | `pipeline-analytics.tsx` (6 métricas de valor, sem período, sem conversão) | **todo o cálculo de coorte** |
| Mapa de saúde 12 meses | nada | tudo |
| Investimento / CAC / custo por lead | nada (nenhuma tabela de gasto; nenhuma integração com Meta Ads) | integração Meta Ads em Integrações + tabelas de gasto (Fase 4) |
| Fontes/Webhooks | Conexões (`cb_channels`) + chaves de API | fora do escopo |
| Atividade | `cb_lead_events` já é o feed (por contato: `use-lead-events.ts`) | fora do escopo (barato, se quiser depois) |

---

## 2. O que foi medido antes de desenhar

### 2.1 Produção (03/09/2026)

| Medida | Valor | Consequência para o plano |
| --- | --- | --- |
| Funis | 6 (Bancário - Comercial, Bancário - Jurídico, Trabalhista - Comercial, Trabalhista - Jurídico, 2× TESTE) | as visões são POR funil, como o Kanban |
| Negócios | **273** — 270 `source='channel'`, 3 manuais | volume pequeno; a paginação entra por disciplina, não por necessidade |
| Onde estão | **270 parados na etapa de entrada** (122 Contato Avulso, 75 Entrada Avulsa, 64 Avulso, 9 Contato Avulso jurídico); 1 em Proposta Realizada | ⚠️ **o funil do CRM ainda não é operado**: hoje o painel nasceria vazio |
| `deals.value` | 0 em todos os de canal; 18.000 no manual | "Valor proposta" existe, ninguém preenche |
| `cb_lead_events` | 273 `deal_created`, **9 `stage_changed` (2 negócios, testes de 29–31/08)**, 6 `status_changed`, 2 `pipeline_changed` | a trilha funciona; só não tem história real ainda |
| Campos personalizados | 18 cadastrados; **0 valores preenchidos** em 275 contatos | as colunas nascem vazias até alguém (n8n ou equipe) preencher |
| Contatos com e-mail / empresa | 1 / 1 | e-mail é coluna secundária aqui |
| Etiquetas | 11 cadastradas, **0 vínculos** | o selo "origem" da referência (ex.: BACKFILL_GESTOR) não tem dado hoje |
| Chaves de API | 2, ambas de teste e **revogadas** | ⚠️ o n8n do gestor NÃO está escrevendo no CRM |
| Automações | "Envio Webhook CB OS - Atlas" em `deal_stage_changed` → etapa Contrato Fechado (4 execuções de teste) | o caminho CRM → Atlas existe; o inverso não |

**Leitura:** a estrutura está pronta (funis com etapas ricas, `resultado`
ganho/perdido na 950, trilha de eventos, campos de venda e de traqueamento,
API pública com escrita de etapa e de campos), mas **os dados que a
referência mostra vivem fora do CRM** (TypeBot + "Atlas Gestor"). As visões
deste plano valem tanto quanto o funil for operado no CRM — e a decisão do
operador (03/09) é que ele SERÁ operado no CRM, sem espelho por integração:
mover o card passa a ser o que alimenta o painel. Por isso a Fase 0 entrega
a correspondência das etapas ANTES de qualquer gráfico.

### 2.2 Código (o que dá para reaproveitar)

- **Trilha `cb_lead_events` (912)** — cada evento de negócio carrega
  `to_pipeline_id` + `to_stage_id` + `occurred_at` (`deal_created`,
  `stage_changed`, `pipeline_changed`; `status_changed` também). Funil e etapa
  mudam numa linha só quando o funil muda (`pipeline_changed`). Negócios
  anteriores à 912 têm um `deal_created` sintético (`reconstructed=true`) e
  nenhuma história de etapa — em produção é **1** negócio. Índices: por
  contato e por negócio; **nenhum por funil/tempo** (a Fase 0 cria).
  `authenticated` só lê (RLS por conta).
- **Escrita de etapa** — três caminhos de tela, todos com o MESMO padrão:
  `update({stage_id}).eq('id').select('id')` + checagem de ROWCOUNT (RLS
  que barra volta 0 linhas sem erro) + carimbo otimista
  `statusAoEntrarNaEtapa` + `avisarDrenagemDeFunil()`. Arrasto:
  `page.tsx:447-485`; formulário: `deal-form.tsx:193-266` (funil e etapa no
  MESMO update); painel: `painel-do-contato.tsx:621-694`. A lista repete o
  padrão.
- **Carga do quadro** — `loadDeals` (`page.tsx:189-237`) com
  `DEAL_SELECT_DO_QUADRO` e plano B (`cartao.ts:35-40`), **sem paginação**.
  O padrão de paginação certo está em `conversation-list.tsx:297-338`
  (`.order('id')` + `.range()` + `count:'exact'`).
- **Campos personalizados** — `contact_custom_values` (valor TEXT para todo
  tipo; RLS de SELECT por conta na 017:499). Ordem "por bloco":
  `.order('posicao',{nullsFirst:false}).order('field_name')` (966). Tipos:
  `text | datetime | select | number` (948).
- **Gráficos** — `recharts` só via o `BarChart` do Tremor vendorizado
  (`src/components/tremor/bar-chart.tsx`, com `layout` horizontal/vertical);
  cores em classes Tailwind (`chart-colors.ts`: blue, emerald, violet, amber,
  gray, cyan, pink, lime, fuchsia). Os outros gráficos do painel são SVG à
  mão. Não há date picker — datas são `<input type="date">` nativo.
- **Moeda** — `formatCurrency`/`formatCurrencyShort` (pt-BR fixo, NBSP).
- **Permissões** — a tela `pipelines` já existe no catálogo de perfis
  (`catalogo.ts`), piso de escrita `agent` (`poderes.ts:135`). Vistas dentro
  de `/pipelines` **não precisam de TelaId nova**. O gate de tela usado para
  negócio é `useCan('send-messages')` (o poder `manage-deals` existe em
  `poderes.ts` mas não é `CanAction`).
- **API v1** — `POST /api/v1/deals` (contato, funil, etapa, título, valor),
  `PATCH /api/v1/deals/{id}` (`stage_id`, `pipeline_id`, `status`, `value`,
  `title`), `PATCH /api/v1/contacts/{id}/custom-fields` (por `field_key`).
  Ou seja: **um integrador já conseguiria espelhar o funil externo no CRM
  hoje**, sem código novo — caminho DESCARTADO pelo operador em 03/09: os
  dados do funil vêm do CRM.
- **Anúncio de origem** — **nada é lido**: o webhook da Meta não declara
  `referral`, e `evolution-inbound.ts` não olha `contextInfo.externalAdReply`
  / `ctwaClid` / `sourceUrl`. Os campos `ctwa_clid`/`fbclid`/`nome_da_campanha`
  só se preenchem por gente ou por API (Fase 5a).

---

## 3. O modelo: funil de eficiência FIXO, etapas mapeadas por funil

### 3.1 Os degraus

O funil de eficiência tem sempre os mesmos cinco degraus, nesta ordem:

```
lead → mql → reuniao → proposta → contrato
```

Mais uma classe negativa, `perda`, e a ausência de classe (a etapa **não
conta** no funil de eficiência — ex.: uma etapa de estacionamento).

Cada `pipeline_stages` ganha **uma** coluna, `degrau`, nula por padrão:

```sql
degrau text CHECK (degrau IS NULL OR degrau IN ('lead','mql','reuniao','proposta','contrato','perda'))
```

- **Várias etapas podem apontar para o mesmo degrau** (o pedido do operador:
  "Entrada Avulsa" + "Entrada Anúncios" = Lead; "Reunião Agendada" + "MQL 2 -
  Reunião Qualificada" = Reunião, se ele quiser).
- **Etapa sem degrau não conta**: negócio parado nela ainda não entrou no
  funil de eficiência. ⚠️ Decisão do operador (03/09): **"Contato Avulso" e
  as outras etapas de entrada CONTAM como `lead`** — todo contato de
  WhatsApp que vira card entra no funil ao NASCER. Consequências: a entrada
  no funil e a criação do negócio coincidem para todo negócio de canal; o
  balde "sem avanço" começa grande (os 270 de hoje); e fornecedor ou cliente
  antigo que mandar mensagem conta como lead até alguém movê-lo (para
  `perda`, ou para uma etapa sem degrau que o operador crie para isso).
- **`degrau` é independente de `resultado` (950).** `resultado` continua
  decidindo o `status` do negócio (ganho/perdido) ao entrar na etapa;
  `degrau` decide o que a etapa significa no funil de eficiência. A tela de
  Funis **sugere** `contrato` para etapa `ganho` e `perda` para etapa
  `perdido` no momento de configurar, mas **não deriva nada em tempo de
  execução** — o que vale é o que está gravado. (Motivo: "No Show" pode ser
  `perda` no funil de eficiência sem ser `perdido` no status, se o
  escritório reagenda.)
- **Configurado = tem ao menos uma etapa em `lead`.** Sem isso as vistas de
  Desempenho e Saúde mostram o estado "configure a correspondência", com o
  link para Funis — nunca zeros com cara de resposta.
- **Degrau sem etapa correspondente** (ex.: funil sem etapa de proposta): o
  card aparece tracejado ("sem etapa correspondente") e as taxas encadeiam
  pulando o degrau (Reunião → Contrato). Não se inventa 100%.

**Exemplo com o funil real "Bancário - Comercial"** (é uma sugestão de
mapeamento para o operador confirmar na tela — não está gravado):

| Etapa (posição) | Degrau sugerido |
| --- | --- |
| Contato Avulso (0) | `lead` — decisão do operador: a entrada automática conta como lead |
| Desqualificado (1) | `perda` |
| Lead - Type e Forms (2) | `lead` |
| MQL 1 - Recebeu Link (3) | `mql` |
| Reunião Agendada (4) | `reuniao` |
| MQL 2 - Reunião Qualificada (5) | `reuniao` |
| No Show (6) | `perda` |
| Reunião Sem Proposta (7) | `perda` |
| Proposta Realizada (8) | `proposta` |
| Contrato Fechado (9, `ganho`) | `contrato` |
| Perdido (10, `perdido`) | `perda` |

E "Trabalhista - Comercial": Entrada Avulsa + Entrada Anuncios → `lead`;
Não Respondeu + Desqualificado - Sem Direito → `perda`; Qualificado → `mql`;
Link Enviado → *(reunião? proposta?)* — decisão do operador; Contrato
Assinado → `contrato`; Protocolado (`ganho`) → `contrato` ou não conta.

### 3.2 As regras de contagem (todas puras, todas com teste)

Tudo sai da **trajetória** do negócio: a lista ordenada de etapas em que ele
entrou, com o instante de cada entrada (`cb_lead_events`), mais a etapa atual.

1. **Entrada no funil** = o primeiro instante em que o negócio entrou numa
   etapa COM degrau (positivo ou `perda`). Negócio criado direto numa etapa
   mapeada entra na criação; negócio nascido em "Contato Avulso" e movido
   para "Lead" entra no movimento. Entrar direto em `perda` (Contato Avulso →
   Desqualificado) É entrada — alguém avaliou aquele contato como lead e o
   descartou; a referência conta os desqualificados entre os leads (9 de 35).
2. **Coorte do período** = negócios cuja entrada no funil caiu no período.
   Tudo o mais se conta SOBRE a coorte, até hoje (não até o fim do período):
   "dos 35 que entraram em setembro, 21 chegaram a MQL" — inclusive se
   chegaram em outubro.
3. **Alcançou o degrau k** = entrou em alguma etapa de degrau ≥ k (só
   degraus positivos; `perda` não alcança nada). É monotônico por
   construção: um negócio que pulou de Lead para Proposta conta como tendo
   passado por MQL e Reunião, e nenhuma taxa passa de 100%.
4. **Situação atual** = o degrau da etapa em que está HOJE: `perda` →
   perdido (um card POR ETAPA de perda, com o nome dela — é assim que "Não
   Respondeu", "Desqualificado" e "No Show" da referência aparecem sem uma
   segunda taxonomia); `contrato` → fechado; `lead` sem ter alcançado mais
   nada → **sem avanço** (o "Não respondeu — lead sem avanço de etapa" da
   referência, derivado); `mql`/`reuniao`/`proposta` → em andamento, com o
   "pipeline ativo" da referência = os que estão em `proposta`.
5. **Na etapa desde** = a última entrada na etapa atual; para negócio que
   nunca mudou, a criação.
6. ⚠️⚠️ **Negócio transferido para outro funil CONTINUA na coorte do funil de
   origem, com a última etapa que teve aqui** — DECISÃO DO OPERADOR
   (03/09/2026), que pediu que ficasse ESCRITA: aqui, no cabeçalho de
   `coorte.ts` e no CLAUDE.md. O fluxo do escritório é
   "fechou → transfere para o funil do Jurídico → continua ganho" (nota da
   950), e o índice `cb_deals_contato_canal_idx` (911) impede segundo card
   de canal por contato: a transferência é do MESMO negócio. Sem esta regra,
   cada contrato fechado sumiria da estatística comercial no instante em que
   fosse para o Jurídico. O PAINEL (Desempenho e Saúde) conta normalmente.
   ⚠️ A LISTA, não: por decisão da Fase 1 (D3, e o corte da coluna
   "Transferido para" registrado no resultado medido), ela mostra só quem
   está NESTE funil hoje — o contrato fechado que foi para o Jurídico
   aparece nos números do comercial e NÃO na lista do comercial. Uma
   versão desta regra dizia "a lista mostra 'transferido para X' na
   linha", e o código nunca fez isso. Se a divergência incomodar na
   operação (o filtro "Fechado" da lista nunca vai bater com o card
   "Contratos"), é decisão de produto à parte.
7. **Negócio apagado some** da coorte (a trilha fica, o negócio não; o
   `deal_deleted` não aparece no chat por decisão da 912 — aqui também não).
8. **Período** = intervalo local `[desde, até)`; presets Este mês · Mês
   passado · Este ano · Ano passado · Total · Personalizar (dois
   `<input type="date">`). **Período anterior** = o de mesma duração
   imediatamente anterior (frase da referência: "comparação vs período de
   mesma duração anterior"); "Total" não tem anterior.
9. **Taxa entre degraus** = alcançou(k+1) / alcançou(k), sobre a coorte;
   **global** = alcançou(contrato) / alcançou(lead). Δ em pontos
   percentuais contra o período anterior.
10. **Entrada por dia** = coorte agrupada pelo dia local da entrada
    (`localDayKey` de `dashboard/date-utils.ts`).
11. **12 meses** = doze meses — por período (o padrão desde 18/09, seção
    3.5) cada mês mostra o que aconteceu nele; por mês de entrada, doze
    coortes mensais. Coorte recente ainda em andamento aparece marcada
    ("N leads em aberto", só no modo por entrada); célula PEQUENA fica
    apagada com a nota "poucos leads" — taxa sobre 2 é ruído, e a referência
    pinta 100% e 0% com a mesma confiança. A régua da célula é a base da
    taxa: as entradas da coorte, ou o degrau de partida do mês por período.

⚠️ **A LISTA filtra por outra data, de propósito (D3):** a coluna "Data" da
referência é a chegada do lead; no CRM o equivalente operacional é
`deals.created_at` (quando o card nasceu), sempre presente. "Entrada no
funil" é conceito do painel e aparece na lista como coluna, mas o filtro de
período da lista usa a criação. Com as etapas de entrada mapeadas como
`lead`, as duas datas coincidem para todo negócio de canal; diferem só para
negócio nascido em etapa sem degrau — e a lista mostra as duas colunas.

### 3.3 De onde vem a trajetória: uma RPC, uma chamada por vista

`cb_funil_trajetorias(p_pipeline_id, p_desde, p_ate)` — `LANGUAGE sql STABLE
SECURITY INVOKER` (a RLS das SEIS tabelas que ela toca vale para quem
chama: `deals`, `cb_lead_events`, `contacts`, `conversations`,
`contact_custom_values` e `custom_fields` — `conversations` entra pela
subconsulta de `conversa_do_contato`). Uma linha por
negócio que **já passou por este funil**:

```
deal_id, contact_id, conversation_id, conversa_do_contato,
title, value, status, pipeline_id, stage_id, channel_id, source, assigned_to,
created_at, updated_at,
contato_nome, contato_telefone, contato_email, contato_empresa, contato_avatar,
campos jsonb        -- {field_key: value} do contato (só preenchidos)
trajeto jsonb       -- [{etapa, funil, em, origem, tipo}] em ordem, inclusive a saída para outro funil
```

- **Quem entra:** negócio com algum evento `deal_created`/`stage_changed`/
  `pipeline_changed` com `to_pipeline_id = p` (é assim que o transferido
  continua contando), E (criado no intervalo OU com algum evento no
  intervalo) — um SUPERCONJUNTO barato; o recorte fino pela entrada no funil
  é feito em TS, porque "entrada" depende do `degrau`, que a RPC não
  conhece de propósito (SQL burro, TS esperto e testável). `p_desde` nulo =
  Total.
- **Paginada** pelo padrão da lista de conversas: `.order('deal_id')` +
  `.range()` + `count:'exact'`, em `src/lib/funil/carregar.ts`. Hoje são
  273 linhas; no volume da referência (1.466/ano) são 2 páginas.
- **Índice novo** `cb_lead_events (to_pipeline_id, occurred_at) WHERE deal_id
  IS NOT NULL` — a trilha não tem índice por funil.
- **Grants**: `REVOKE EXECUTE FROM PUBLIC, anon` + `GRANT EXECUTE TO
  authenticated, service_role`, com a conferência trocando de papel
  (`SET LOCAL ROLE authenticated`) — a lição da 929 (o bloco de conferência
  roda como dono e passa verde mesmo com a função fechada).
- **Por que RPC e não três consultas no cliente:** o caminho "só PostgREST"
  precisa de (1) negócios do funil paginados, (2) eventos por
  `to_pipeline_id` paginados (crescem ~5–10 por negócio), (3) negócios
  transferidos buscados por id em lotes — três laços de paginação e um
  agrupamento no cliente. A RPC faz o `GROUP BY` onde ele é de graça e
  devolve uma linha por negócio. Já existem ~10 RPCs `cb_*` com a mesma
  disciplina de migration.

### 3.4 Módulos (puros, com teste) e componentes

```
src/lib/funil/                                    (assinaturas MEDIDAS no código)
  degraus.ts        DEGRAUS = ['lead','mql','reuniao','proposta','contrato'], tipo Degrau,
                    classificarEtapas(etapas) → {classeDaEtapa, porClasse, faltando,
                    configurado, etapas}
  trajetoria.ts     fatosDoNegocio(linha, pipelineId, classificacao) → {linha, noFunil,
                    transferidoPara, entradaEm, degrauMaximo, etapaAtual, classeAtual,
                    naEtapaDesde, perdidoDesde, alcancouEm, situacao, alcancouContrato};
                    aplicarMudancaDeEtapa (otimista)
  periodo.ts        presets → {desde, ate} local; periodoAnterior (dias de calendário)
  coorte.ts         resumoDoPeriodo(fatos, classificacao, intervalo, agora) → contagens por
                    degrau, perdas por etapa, sem avanço, em andamento, taxas, entradas por
                    dia; funilDeContagens e emAbertoDe (a montagem única dos dois modos);
                    comparar(atual, anterior)
  por-periodo.ts    resumoPorPeriodo / resumoNoModo(modo, …) (seção 3.5), periodoSemAtividade,
                    lerModo, MODO_PADRAO, CHAVE_DO_MODO
  saude.ts          coortesMensais(fatos, classificacao, meses, agora, modo) → meses; escalaRelativa,
                    transicoesDoHistorico, linhasDoMapa(meses, classificacao, modo) (a cor por
                    célula é corDaCelula, e ela mora no componente mapa-de-calor.tsx)
  lista.ts          catálogo de colunas, ordenar, filtrar (busca/etapa/situação/período), linhasDoCsv
  apresentacao.ts   percentual, variação e pontos percentuais em pt-BR fixo
  carregar.ts       laço paginado da RPC (order + range + count) — I/O, não é módulo puro
src/lib/csv.ts      paraCsv (';' + BOM, RFC 4180) + baixarArquivo — novo, sem tocar a página de
                    broadcast (que tem um `toCsv` PRÓPRIO, e continua com ele)
src/hooks/use-trajetorias.ts   carrega por (pipelineId, intervalo) com sinalizador `carregando`
src/components/funil/          (o que EXISTE; os nomes riscados abaixo nunca nasceram)
  lista-de-leads.tsx · colunas-popover.tsx · seletor-de-periodo.tsx
  desempenho.tsx · grafico-de-taxas.tsx · grafico-de-entradas.tsx
  saude.tsx · mapa-de-calor.tsx · grafico-de-conversao.tsx
```

⚠️ **Três componentes desta lista foram DESCARTADOS durante a execução, e a
lista acima já os omite:** `cards-do-funil.tsx` (os cards ficaram inline no
`desempenho.tsx`), `correspondencia-legenda.tsx` (a legenda virou uma linha
de rodapé, "sem bloco à parte") e `investimento-form.tsx` (a Fase 4 não tem
lançamento manual — o gasto vem da API, e a tela é
`src/components/settings/meta-ads-card.tsx`).

O `vista` da página de Funis vira `"leads" | "lista" | "desempenho" | "saude"
| "automacoes"` (rótulos: Quadro · Lista · Desempenho · Saúde · Automações —
o Kanban deixa de se chamar "Leads" porque a lista também é de leads). Cada
vista carrega o próprio dado quando ativa, como a de Automações já faz; ao
voltar ao Quadro depois de mexer na Lista, `refreshDeals()`.

---

### 3.5 A contagem POR PERÍODO (Fase 6, 18/09/2026)

`src/lib/funil/por-periodo.ts` (puro, com teste), sobre a regra 7 da
trajetória (`FatosDoNegocio.alcancouEm`: a data em que o negócio alcançou
cada degrau pela PRIMEIRA vez). Devolve o MESMO `ResumoDoPeriodo` da coorte,
então as telas não bifurcam — só escolhem o modo (`resumoNoModo`), lembrado
por dispositivo em `localStorage` (`wacrm:pipelines:funil:modo`; parse, nunca
`as`). O que muda entre os modos, campo a campo:

| Campo | Por período (padrão) | Por mês de entrada (coorte) |
| --- | --- | --- |
| Leads (`entradas`) | entrou no funil no período | idem |
| Degrau k (`porDegrau`) | alcançou k pela 1ª vez no período (`alcancouEm[k]`) | da coorte, alcançou k até hoje (`degrauMaximo`) |
| Taxas e transições | razão de FLUXO do período — pode passar de 100% | conversão da coorte — nunca passa de 100% |
| Perdas por etapa | está em perda hoje E a estadia atual em perda começou no período (`perdidoDesde`, regra 8) — trocar de etapa de perda não muda o mês; a linha é a etapa de perda ATUAL | da coorte, está em perda hoje |
| Dinheiro (valor, ticket, CAC) | alcançou contrato no período E continua fechado | da coorte, continua fechado |
| Custo dos perdidos | custo por lead do período × entrantes do período perdidos hoje (`perdidosDosEntrantes`) — nunca × `perdidos`, que é fluxo e passava do investimento | custo por lead × perdidos da coorte (o mesmo número) |
| Sem avanço / em andamento / fora do funil | foto de hoje de quem ENTROU no período | idem (é a mesma foto) |
| "N em aberto" (Saúde) | não existe: mês passado é final | coorte com lead sem desfecho |
| Célula pequena (Saúde) | pelo DENOMINADOR da taxa no mês (reunião → proposta: as reuniões do mês; a global: as entradas) | por entradas da coorte |

Armadilhas que a implementação carrega:

- A RPC devolve a trajetória INTEIRA de todo negócio com evento no intervalo
  carregado; "primeira vez" só é primeira olhando a história toda. Paginar
  ou truncar o trajeto ao período faria a reentrada contar de novo.
- Os gráficos de taxa ganharam teto redondo e marcas rotuladas
  (`eixoDasTaxas`, `apresentacao.ts`). O recharts não corta o dado — sem
  `allowDataOverflow` ele ALARGA o domínio até o valor —, mas com
  `domain=[0,100]` e `ticks` fixos o ponto acima de 100% ficava numa faixa
  sem rótulo nem grade, e o Tremor inventava as marcas (uma versão desta
  nota dizia que a barra era cortada; a revisão do PR #224 mediu no fonte da
  lib).
- `coortesMensais` exige o `modo` — um chamador novo não pode cair na coorte
  sem escolher.
- Eventos `retroativo` contam na data que carregam (a carga da Kommo).
- Os cinco baldes NÃO somam as entradas por período (e não devem): fechado
  e perdido são fluxo do período, os outros três são a foto dos entrantes.
  A nota de "Negativos" diz de quem é cada número, e "% das entradas do
  período" pode passar de 100%.
- "Lead" ≠ entradas quando o negócio entra DIRETO em perda num mês e vira
  lead em outro (raro: card nasce em `default_stage_id`): a entrada é do
  primeiro mês e o degrau Lead, do segundo. Aceito; o subtítulo "contratos ÷
  leads do período" é aproximado nesse caso.
- `naEtapaDesde`/`perdidoDesde` caem em `created_at` quando a etapa atual
  não tem evento (o gatilho da 912 engole falha em escrita de servidor): a
  perda cai no mês de criação — o mesmo furo da coorte, só que datado.

## 4. Decisões a tomar (com recomendação)

D1, D2, D5 (o filtro), D7, D10 e D11 foram decididas em 03/09 — estão em
"Decisões travadas", no topo. Ficam abertas as abaixo, com a recomendação
como hipótese.

| # | Decisão | Recomendação | Por quê |
| --- | --- | --- | --- |
| **D3** | Data do período: painel por **entrada no funil** (coorte); lista por **criação do negócio** | como está na seção 3.2 — ⚠️ SUPERADA no painel em 18/09/2026: o padrão passou a ser POR PERÍODO (seção 3.5), e a coorte ficou sob demanda; a lista continua por criação | a coorte é o que torna as taxas consistentes; a criação é o que a lista operacional espera |
| **D4** | Período anterior = **mesma duração imediatamente anterior** ou mês/ano-calendário anterior inteiro | mesma duração (frase da referência) | "Este mês" com 3 dias comparado com um mês inteiro mentiria em -90% |
| **D5** | Colunas padrão da lista | padrão = colunas fixas + nenhum campo personalizado (o seletor de colunas liga e persiste por membro) | 18 colunas vazias de largada só fariam a tabela rolar; ligar uma vez persiste. (O filtro "só alto valor" saiu por decisão do operador; se voltar, "Tamanho da Dívida" precisa virar campo `number` antes — hoje é texto livre) |
| **D6** | Mapa de calor: cor **relativa à linha** (melhor mês verde, pior vermelho, por transição) ou escala absoluta | relativa por linha, com coorte pequena apagada | absoluta pinta "Lead → Contrato" de vermelho em todo mês (2–9%) e não informa nada; o título da referência diz "relativa ao histórico", o render dela parece absoluto |
| **D8** | Fórmula do "custo de no-show" | card "Custo dos perdidos" = custo por lead × leads perdidos no período; a quebra por etapa de perda fica na seção "Negativos e em aberto" da mesma tela (o "no-show" é uma das linhas) — o card NÃO tem tooltip, ao contrário do que esta linha dizia | a referência não escreve a fórmula; esta é a mais defensável e não depende de existir uma etapa chamada "No Show" |
| **D9** | Onde as vistas moram | abas dentro de `/pipelines` (sem rota nem TelaId nova) | herda o seletor de funil, o recorte por perfil e o gate de escrita da tela |

---

## 5. Fases

### ✅ Fase 0 — Fundamentos (concluída em 2026-09-04)

**Objetivo:** existir a correspondência etapa → degrau, editável em Funis; a
RPC das trajetórias; e o cálculo inteiro coberto por teste ANTES de qualquer
tela — para as Fases 1–3 serem só apresentação.

**Migration `0975_cb_degrau_do_funil.sql`** (conferir o número com
`ls supabase/migrations/` E `list_migrations` na hora — a lista do CLAUDE.md
envelhece):
1. `ALTER TABLE pipeline_stages ADD COLUMN degrau text` + CHECK (seção 3.1).
   Sem backfill: nulo = não configurado, de propósito (D2 é do operador).
2. `CREATE INDEX cb_lead_events_funil_idx ON cb_lead_events (to_pipeline_id,
   occurred_at) WHERE deal_id IS NOT NULL`.
3. `cb_funil_trajetorias(uuid, timestamptz, timestamptz)` (seção 3.3),
   `REVOKE … FROM PUBLIC, anon`, `GRANT … TO authenticated, service_role`.
4. Conferências que valem em banco VAZIO: coluna e CHECK existem; índice
   existe; `has_function_privilege('anon', …)` = false e `('authenticated',
   …)` = true; `SET LOCAL ROLE authenticated; PERFORM
   cb_funil_trajetorias(gen_random_uuid(), null, null)` não estoura (zero
   linhas é o resultado certo em banco vazio — afirmar ausência é seguro).
5. Aplicar em produção pelo conector ANTES do merge; conferir lendo
   `pipeline_stages.degrau` pelo PostgREST e chamando a RPC com o funil
   "TESTE Funil Bancario".

**Arquivos:**

| Arquivo | O que muda |
| --- | --- |
| `src/types/index.ts` | `PipelineStage.degrau?: string \| null` (string, e não o union `Degrau`, para `types/` não importar de `lib/funil` — quem lê a coluna estreita com `ehDegrau`/`ehClasse`); aproveitar para acrescentar `account_id` a `Pipeline` e `Deal` (é NOT NULL desde a 017 e falta no tipo) |
| `src/lib/funil/degraus.ts` (+test) | catálogo dos degraus, `classificarEtapas` |
| `src/lib/funil/trajetoria.ts` (+test) | `fatosDoNegocio`, regras 1–7 da seção 3.2, inclusive transferido e negócio nascido em etapa sem degrau |
| `src/lib/funil/periodo.ts` (+test) | presets, período anterior, fuso local, virada de mês/ano |
| `src/lib/funil/coorte.ts` (+test) | contagens, taxas, negativos por etapa, sem avanço, entradas por dia, comparação em pp, degrau sem etapa correspondente |
| `src/lib/funil/saude.ts` (+test) | 12 coortes mensais, séries por transição, cor relativa, coorte pequena |
| `src/lib/funil/carregar.ts` (+test com stub) | laço paginado da RPC; devolve `null` quando não coube (contrato da lista de conversas: "não confie") |
| `src/components/settings/../pipeline-settings.tsx` | ao lado do select de `resultado` (`:466-475`), um select "Funil de eficiência" por etapa (Não conta / Lead / MQL / Reunião / Proposta / Contrato / Perda), com sugestão a partir de `resultado`; aviso quando o funil não tem `lead` |
| `messages/en.json` + `pt-BR.json` | `Pipelines.funil.*` (rótulos dos degraus, situação, ajuda) — os rótulos dos degraus são chaves montadas (`degraus.${id}`): teste cobrando os dois dicionários, como `editor.test.ts` faz |
| `CLAUDE.md` | seção nova "Funil comercial" com as regras que o operador pediu por escrito — a do transferido (regra 6) em primeiro lugar — e as armadilhas da seção 7 |

**Resultado esperado (medir):** typecheck/lint/test verdes no Node 22;
`i18n-parity` e `i18n-chaves-usadas` OK; o operador consegue mapear as
etapas de "Bancário - Comercial" e "Trabalhista - Comercial" na tela e o
valor persiste no reload (a policy de `pipeline_stages` é admin — testar com
`agent` que o select vem desabilitado); a RPC devolve as 273 linhas
paginadas em uma página e o negócio movido em 31/08 aparece com trajeto de
2 entradas.

**Resultado medido (2026-09-04, worktree em `main` @ `bcc5cd9`):**

- Migration `975` aplicada em produção pelo conector ANTES do merge, com as
  conferências passando (coluna, CHECK, índice, `anon` sem EXECUTE,
  `authenticated` com, e a chamada trocando de papel). Conferido depois por
  leitura: a RPC devolve **123** linhas no Bancário - Comercial (122 de canal
  + 1 manual), 9 no Bancário - Jurídico, 93 no Trabalhista - Comercial e 71
  no Trabalhista - Jurídico (25 negócios novos desde a medição de 03/09);
  todas com `conversa_do_contato`; **2** com movimento (o negócio de teste
  de 29/08 — 11 passos, inclusive a ida e volta pelo funil de teste — e o de
  31/08, com 2 entradas); superconjunto de setembro = 72, de agosto = 49.
  `campos` nulo em 100% (nenhum campo personalizado preenchido, como medido).
- **68 testes novos** em `src/lib/funil/` (degraus, trajetória, período,
  coorte, saúde, carga paginada, e as chaves montadas nos dois dicionários);
  suíte inteira **2591** verdes no Node 22; typecheck limpo; lint 0 erros
  (43 avisos, todos anteriores); `i18n-parity` e `i18n-chaves-usadas` OK.
- Preview (worktree em `localhost:3101`, 1440×900, sessão herdada): o
  diálogo "Gerenciar funil" mostra o select "Funil de eficiência" ao lado do
  de resultado em cada etapa, com as 7 opções; marcar `resultado = perdido`
  numa etapa sem degrau SUGERE `perda` na hora; com degrau em alguma etapa e
  nenhum `lead` aparece o aviso âmbar, que some ao marcar um `lead`;
  Cancelar descarta; **gravar `lead` em "Contato Avulso" e `perda` em
  "Desqualificado", recarregar e reabrir devolve os dois valores** — e
  reverter para "Não conta" volta tudo a NULL (conferido no banco: 0 etapas
  com degrau). Console sem erros.
- ⚠️ **Os funis "TESTE Funil Bancario/Trabalhista" NÃO são desta conta**: o
  seletor do operador lista só os 4 reais (Bancário/Trabalhista ×
  Comercial/Jurídico). O plano os chamava de "sandbox"; o teste de tela com
  escrita foi feito no funil REAL e revertido no mesmo minuto. As Fases 1 e
  2 criam um funil de teste próprio na conta e o apagam ao fim.
- A ideia de testar "com `agent` que o select vem desabilitado" não se
  aplica: o diálogo inteiro é admin (botão gated + policy
  `pipeline_stages_modify`) — um `agent` não o abre.
- **Nada de mapeamento gravado**: quem mapeia é o operador (decisão D2).
- ⚠️ **Erro corrigido depois do PR aberto:** o replay das migrations no CI
  (banco VAZIO) reprovou a 975 com "permission denied for table contacts" —
  a conferência chama a RPC como `authenticated`, a função é SECURITY
  INVOKER, e num banco novo o SELECT de `authenticated` nas tabelas não
  existe (é default privilege do Supabase). Correção: a migration passou a
  CONCEDER `SELECT` nas seis tabelas que a função lê (no-op em produção,
  executado lá também para repo e banco ficarem iguais). É a regra "o que a
  migration confere, ela concede", que a 929 não precisou porque as tabelas
  dela já tinham GRANT escrito em migration anterior.
- **Revisão do Codex no PR #119 — três achados P2, os três tratados:**
  (1) etapa MAPEADA apagada sumia da classificação e a história dela
  evaporava do painel (entrada deslizando, conversão sumindo) → a tela de
  Funis passou a BARRAR a remoção de etapa mapeada com histórico na trilha
  (saída explícita: "Não conta" → salvar → remover), com a limitação escrita
  no cabeçalho de `trajetoria.ts`; (2) negócio que entrou por etapa mapeada
  e foi estacionado numa etapa sem degrau ficava na coorte sem balde nenhum
  e os totais não fechavam → `ResumoDoPeriodo.foraDoFunil`, quinto balde,
  com teste de partição (fechado + perdido + sem avanço + em andamento +
  fora do funil = entradas); (3) o período anterior era calculado em
  milissegundos, o que em fuso com horário de verão deslocava a fronteira
  em uma hora → passou a deslocar por DIAS DE CALENDÁRIO (teste de março →
  29/01 à meia-noite, e de ano bissexto; rodado também com
  `TZ=America/New_York`).

**Arquivos tocados:** `supabase/migrations/0975_cb_degrau_do_funil.sql`;
`src/lib/funil/{degraus,trajetoria,periodo,coorte,saude,carregar}.ts` (+
`.test.ts` de cada); `src/types/index.ts` (`PipelineStage.degrau`,
`account_id` opcional em `Pipeline`/`Deal`);
`src/components/pipelines/pipeline-settings.tsx` (select por etapa, sugestão
a partir do resultado, aviso sem Lead, `degrau` no upsert);
`messages/{en,pt-BR}.json` (`Pipelines.settings.stageDegrau/stageDegrauHint/
semLead` e `Pipelines.funil.degraus.*`); `CLAUDE.md` (seção "Funil comercial"
+ entrada da 975); este plano.

### ✅ Fase 1 — Lista de leads (concluída em 2026-09-04)

**Objetivo:** a vista "Lista" no funil selecionado: a tabela da referência com
os dados que o CRM tem.

- **Colunas fixas:** `#` · Data (criação) · Nome (clicável → conversa, via
  `urlDoInbox({c, de:'funil'})`, preferindo a conversa do CONTATO como
  `conversaDoCard`) · Na etapa desde · Etapa (pastilha na cor da etapa, com
  seletor na própria célula) · Valor · Telefone · E-mail · Entrada no funil ·
  Situação (derivada do degrau) · Conexão · Responsável · Empresa · Transferido
  para. **Campos personalizados:** uma coluna por campo, agrupadas por bloco
  no seletor de colunas (Geral / Traqueamento), como a ficha faz.
- **Seletor de colunas** persistido em `localStorage`
  (`wacrm:pipelines:lista:colunas`, com `normalizar` como
  `campos-do-card.ts`); padrão = fixas principais (D5).
- **Ordenação** por clique no cabeçalho (Data, Na etapa desde, Nome, Etapa
  por posição, Valor, Entrada); padrão "Na etapa desde ↓" (referência).
- **Filtros:** busca (nome/telefone/e-mail, sem acento — a normalização de
  `achados-no-fio.ts`), etapa, situação (Todas / Em andamento / Fechados /
  Perdidos / Fora do funil), período (`seletor-de-periodo`, presets + datas).
  Contador "N de M no período".
- **Linha:** fundo tingido para `perda` (vermelho suave) e `contrato`
  (verde suave), como a referência; lápis → `DealForm` (busca o negócio por
  id na hora de abrir — `DEAL_SELECT_BASICO` — em vez de reconstruí-lo da
  linha).
- **Etapa na linha:** mesmo padrão do quadro (`update` + rowcount +
  `statusAoEntrarNaEtapa` + `avisarDrenagemDeFunil`), trajeto otimista via
  `aplicarMudancaDeEtapa`, gate `useCan('send-messages')` desabilitando o
  select (RLS + rowcount como rede). Falha → toast + recarga da linha.
- **CSV:** `src/lib/csv.ts` (`;` + BOM UTF-8 para o Excel em pt-BR abrir
  direto; datas `dd/mm/aaaa hh:mm`; valores com vírgula), exporta as linhas
  FILTRADAS e as colunas VISÍVEIS, nome `funil-<slug>-<aaaa-mm-dd>.csv`.
  ⚠️ A página de broadcast mantém o `toCsv` dela (arquivo do upstream; duas
  cópias de 15 linhas > conflito de merge).
- **Carga:** `use-trajetorias` (RPC paginada) gateada por `carregando` —
  nunca "nenhum lead" durante a carga (armadilha do efeito passivo, CLAUDE.md).
  Só negócios com `pipeline_id` = funil atual entram na lista; os transferidos
  ficam de fora dela (estão na lista do outro funil) e só contam no painel.
- **Sem virtualização** por decisão: ≤ 2k linhas/ano; paginar a RENDERIZAÇÃO
  em 100 linhas com "carregar mais" é suficiente e o `Table` do projeto não
  tem virtualização.

**Resultado esperado (medir):** preview 1440×900 num funil de teste criado
na conta para a fase e apagado ao fim (os funis "TESTE" existentes são de
OUTRA conta — medido na Fase 0; NUNCA mover negócio real); trocar etapa na linha grava e o quadro reflete ao
voltar; CSV abre no Numbers/Excel com acentos certos; perfil `viewer` vê a
lista com o select desabilitado; sem rolagem horizontal fora da tabela
(`overflow-x-auto` do `Table`, corpo da página parado).

**Resultado medido (2026-09-04, worktree em `main` @ `f8cf74b`):**

- Vista "Lista" no toggle da página de Funis (Quadro · Lista · Automações —
  o Kanban deixou de se chamar "Leads"). Módulo puro `src/lib/funil/lista.ts`
  (colunas, preferência normalizada, ordenação, recorte, CSV) com **14** testes;
  `src/lib/csv.ts` (`;` + BOM UTF-8, RFC 4180) com **3** (os números 19 e 4
  desta linha estavam ERRADOS desde que foram escritos — medidos em 04/09
  contra os mesmos arquivos, sem uma linha de diferença); hook `use-trajetorias`
  (carregando DERIVADO da chave do pedido, sem setState síncrono no efeito);
  componentes `lista-de-leads`, `colunas-popover`, `seletor-de-periodo`.
  Suíte inteira **2610** verdes no Node 22; typecheck limpo; lint 0 erros;
  `i18n-parity` e `i18n-chaves-usadas` OK.
- ⚠️ **Coluna "Transferido para" foi cortada** antes de nascer: a lista mostra
  só quem está NESTE funil hoje, então ela seria sempre vazia. O transferido
  é assunto do painel (regra 6), não da lista.
- Preview em 1440×900, num funil de teste criado na conta pelo conector
  ("TESTE Fase 1 (apagar)": 4 etapas mapeadas + 2 negócios sem contato) e
  APAGADO ao fim (funil, negócios em cascata e os eventos órfãos da trilha):
  tabela com as 9 colunas padrão e "2 de 2 no período"; **mover a etapa na
  linha** troca a pastilha e a situação na hora e GRAVA (conferido no banco:
  `stage_changed` com `origin='usuario'`); busca por nome, filtro de
  situação ("1 de 2 no período") e de etapa recortam; "Mês passado" mostra
  "Nenhum negócio criado neste período."; ordenar por Nome inverte; o
  seletor de colunas lista as 13 fixas + os 18 campos por bloco, ligar
  "Empresa" e "Nome da campanha" cria as colunas e grava em
  `wacrm:pipelines:lista:colunas`; o lápis abre "Editar negócio" com o
  título certo; "Exportar CSV" dispara sem erro.
- ⚠️ **Falso erro no console:** `MISSING_MESSAGE Pipelines.automacoes.abaLista`
  apareceu 38 vezes com a aba já escrita "Lista" na tela — é o CACHE do
  `next dev`, que carregou os dicionários antes da chave existir (o mesmo
  achado da Fase 1 do painel do contato). Depois de reiniciar o servidor,
  nenhuma ocorrência nova. Quem vir isso confere o dicionário antes de
  "corrigir" código.
- Não testado: CSV aberto no Excel (o download não é observável no painel;
  o conteúdo está coberto por teste) e o perfil `viewer` (o select nasce
  desabilitado por `useCan('send-messages')`, mesmo gate do painel).

### ✅ Fase 2 — Desempenho (concluída em 2026-09-04)

**Objetivo:** a vista "Desempenho": o painel do funil de eficiência para o
período escolhido, com comparação.

Blocos, de cima para baixo (todos alimentados por `resumoDoPeriodo` de UMA
carga da RPC para `[desde do período anterior, hoje)`):

1. **Barra de período** (mesmo `seletor-de-periodo` da lista) + frase
   "Período pela data de ENTRADA no funil · comparação com o período anterior
   de mesma duração" + **legenda da correspondência** ("Lead = Entrada Avulsa
   + Entrada Anúncios · MQL = …", com link para Funis). Funil sem `lead`
   mapeado → estado vazio com o link, e nada mais.
2. **Cards de eficiência**: Leads no período (Δ% vs anterior) · Contratos
   (Δ) · Conversão global (Δ pp) · Valor fechado (soma de `value` dos
   fechados da coorte) · Ticket médio. (Os cards de custo entram na Fase 4.)
3. **Funil de eficiência**: um card por degrau, na ordem fixa, com contagem e
   "% do degrau anterior" (o primeiro, "% das entradas"); degrau sem etapa
   tracejado. Cabeçalho: "N entradas no funil no período".
4. **Negativos e em aberto**: um card por etapa `perda` (contagem, % dos
   leads) + "Sem avanço" + "Em andamento" (com "N em Proposta" como o
   "pipeline ativo" da referência). À direita: "X leads perdidos neste
   período".
5. **Taxas de conversão entre degraus — atual × anterior**: barras
   horizontais (Tremor `BarChart`, `layout="vertical"`, cores `emerald` ×
   `amber` como a referência), uma linha por transição + global; tooltip
   com os dois valores e Δ pp.
6. **Entrada de leads por dia**: linha com área sobre os dias do período;
   tooltip "dd/mm · N lead(s)". Gráfico de linhas: **vendorizar o
   `LineChart` do Tremor** (mesmas duas adaptações do `bar-chart.tsx`;
   Apache 2.0) — é o mesmo componente que a Fase 3 usa; SVG à mão como o
   `conversations-chart.tsx` seria a terceira implementação de tooltip do
   repo.

**Resultado esperado (medir):** com o funil de teste mapeado e 6–8 negócios
movidos (inclusive um transferido para outro funil e um pulando degrau), os
números batem com o cálculo à mão registrado no PR; a partição de CINCO
baldes fecha (`situacao`: fechado + perdido + sem avanço + em andamento +
fora do funil = entradas — ⚠️ pelo campo `situacao`, nunca somando
`resumo.fechados`, que é "alcançou contrato" e inclui quem voltou para
Proposta); período sem coorte mostra
zeros COM a nota "nenhum lead entrou no funil neste período" (não o estado
"configure"); dark mode legível (cores do `chart-colors.ts`).

**Resultado medido (2026-09-04, worktree em `main` @ `844629c`):**

- Vista "Desempenho" no toggle (Quadro · Lista · Desempenho · Automações):
  `src/components/funil/desempenho.tsx` (cards do `MetricCard` do painel,
  funil de eficiência com uma faixa de cor por degrau e as etapas mapeadas
  escritas em cada card — é a "legenda da correspondência", sem bloco à
  parte —, negativos com um card por etapa de perda + Sem avanço + Em
  andamento ("N em Proposta") + **Fora do funil**), `grafico-de-taxas.tsx`
  (Tremor `BarChart`, barras deitadas, emerald × amber) e
  `grafico-de-entradas.tsx` (recharts DIRETO, área + linha — vendorizar o
  `LineChart` do Tremor seria a terceira cópia de tooltip do repo; o plano
  previa vendorizar e mudou aqui). `src/lib/funil/apresentacao.ts` (pt-BR
  fixo: percentual, variação, pp, rótulo do dia) com 4 testes. Suíte em
  **88** no módulo; typecheck limpo; lint 0 erros; portões de i18n OK.
- UMA carga da RPC para `[desde do período anterior, hoje)`; a comparação
  "com os N dias anteriores" escreve o N na frase do topo.
- Preview em 1440×900 num funil de teste criado pelo conector ("TESTE Fase
  2 (apagar)": 7 etapas mapeadas, 11 negócios movidos por UPDATE — inclusive
  um pulando degrau, dois perdidos, um voltando para Lead, um estacionado e
  um do período ANTERIOR com a trilha retroagida para 29/08) e apagado ao
  fim (funil em cascata, trilha e fila de automação limpas). Os números
  bateram com o cálculo à mão, que é o MESMO fixture de `coorte.test.ts`:
  9 leads (+800% vs os 4 dias anteriores, que tinham 1), 2 contratos,
  conversão global 22,2% (+22,2 pp), R$ 42.000 fechados, ticket R$ 21.000;
  funil 9 → 6 (66,7%) → 3 (50,0%) → 3 (100,0%) → 2 (66,7%); No Show 2,
  Sem avanço 1, Em andamento 3 (1 em Proposta), Fora do funil 1; entradas
  por dia 01/09–04/09 com 9 no dia 4; "Total" dá 10 leads e "sem período
  anterior"; o funil real (Bancário - Comercial, sem degrau) mostra o
  estado "configure" com o botão que abre Gerenciar funil.
- ⚠️ Console: de novo o `MISSING_MESSAGE` (`abaDesempenho`) do cache do
  `next dev`, mais um `ArrowDown is not defined` vindo do HMR de uma versão
  intermediária do arquivo — nenhum dos dois sobrevive ao restart do
  servidor. Quem revisar console em `next dev` depois de mexer em
  dicionário ou em imports reinicia antes de acreditar.

### ✅ Fase 3 — Saúde (concluída em 2026-09-04)

**Objetivo:** a vista "Saúde": a tendência de 12 meses.

- **Conversão por degrau ao longo do tempo**: `LineChart` com uma série por
  transição + global, doze coortes mensais (`saude.ts`), rótulos `mmm/aa`.
- **Mapa de saúde**: grade CSS (linhas = transições + global, colunas =
  meses), célula com a taxa, cor relativa à linha (D6), célula de coorte
  pequena apagada com tooltip "N leads — poucos para taxa"; os meses ainda
  em andamento marcados. Rodapé com a fonte: "etapas pelo mapeamento do funil
  X" (a referência escreve "Contratos do Atlas Gestor · demais etapas via
  Rastreamento"; a nossa fonte é uma só, e a legenda diz qual).
- Uma carga da RPC (`desde` = 1º dia de 11 meses atrás) por funil; o
  cálculo mensal é `coortesMensais` sobre os mesmos `fatos` da Fase 2.

⚠️ **Saúde só fica útil com meses de operação ou com o backfill futuro (Fase 5b).** A
vista nasce honesta: os meses sem coorte ficam vazios com a nota, não zero.

**Resultado medido (2026-09-04, worktree em `main` @ `7dce4c6`):**

- Vista "Saúde" no toggle (Quadro · Lista · Desempenho · Saúde ·
  Automações): `src/components/funil/saude.tsx` (uma carga da RPC para
  `[1º dia de 11 meses atrás, hoje)`; doze coortes mensais por
  `coortesMensais`), `grafico-de-conversao.tsx` (recharts direto, uma linha
  por transição + a global, legenda própria) e `mapa-de-calor.tsx` (tabela
  HTML, cor `hsl(0→130, alfa 0,35)` relativa à LINHA, célula de coorte
  pequena apagada com o motivo no `title`, mês com lead ainda sem desfecho marcado "N em aberto" sob o rótulo — era "mês corrente marcado ●" até o Codex apontar, no PR #122, que a coorte de agosto com leads abertos segue mudando em setembro).
  `saude.ts` ganhou `transicoesDoHistorico` e `linhasDoMapa` (escala
  calculada SEM as coortes pequenas — 100% sobre um lead dominaria o ano)
  com testes; módulo em **90** testes; typecheck limpo; lint 0 erros;
  portões de i18n OK.
- Preview em 1440×900 num funil de teste criado pelo conector ("TESTE Fase 3
  (apagar)": 4 etapas, 13 negócios com `created_at` e trilha RETROAGIDOS
  para julho/agosto/setembro) e apagado ao fim: "13 entradas no total";
  linhas Lead → MQL, MQL → Contrato e global; mapa com as 12 colunas
  (`out/25 … set/26●`), julho verde (50,0% · 6 leads) e agosto vermelho
  (40,0% · 5 leads) na linha Lead → MQL, setembro apagado (2 leads, "taxa
  pouco confiável"), meses sem coorte com "—"; o funil real sem degrau cai
  no "configure". Console limpo numa aba nova depois do restart do servidor.
- Rótulo do mês mudou de "jul. de 26" (o `toLocaleDateString` com ano) para
  "jul/26" — doze colunas lado a lado não cabiam com o "de".

### Fase 4 — Meta Ads em Integrações (migration `976`)

**Objetivo:** o CRM passa a saber quanto foi gasto em anúncios, por dia e por
campanha, e cada campanha aponta para um funil — daí custo por lead, CAC e
custo dos perdidos no Desempenho, sem digitação. Decisão do operador (03/09):
começa direto pela API da Meta, na aba de Integrações.

**Onde mora:** um cartão "Meta Ads" em Configurações → Integrações
(`src/components/settings/meta-ads-card.tsx`, montado por
`integracoes-panel.tsx` FORA do `cartoes.map`). ⚠️ Ele **não** passa por
`montar.ts`/`montarCartoes` nem pela rota `/api/cb/integracoes/status`:
aquilo é o caminho das chaves de IA, e este cartão tem rota própria
(`GET /api/cb/meta-ads`), porque precisa de service role para ler uma tabela
que o navegador não alcança. Visualmente segue o padrão do "Google Agenda". Estados: não conectado · conectado (conta, moeda, última
sincronização, N campanhas, M sem funil) · erro (token vencido, sem
permissão). Expandido: o formulário de conexão e a tabela campanha → funil.

**Pré-requisitos fora do código (operador):** Business Manager com a conta de
anúncios; um usuário de sistema com acesso a ela e um token de longa duração
com `ads_read` (Configurações do negócio → Usuários do sistema → Gerar token,
escolhendo um app da Meta do BM — qualquer um serve); o id da conta
(`act_…`). Sem o token nada aqui funciona, e o token é o único segredo.

**Migration `0976_cb_meta_ads.sql`** — três tabelas `cb_*`, todas com
`REVOKE ALL FROM anon` (931) e **escrita SÓ pela API** (REVOKE
INSERT/UPDATE/DELETE de `authenticated`, como `cb_tasks`):
- `cb_meta_ads_config` (uma linha por conta): `account_id` PK,
  `ad_account_id`, `access_token` cifrado com `encrypt()` de
  `src/lib/whatsapp/encryption.ts` (AES-256-GCM, `ENCRYPTION_KEY` — ⚠️
  rotacionar a chave invalida este token junto com os do WhatsApp), `moeda`,
  `status`, `last_sync_at`, `last_error`, `created_by`, timestamps. **Sem
  SELECT para `authenticated`**: o que a tela precisa vem pela rota de
  status, e o token nunca sai de rota nenhuma, nem mascarado.
- `cb_meta_ads_campanhas`: `account_id`, `campaign_id` (texto, id da Meta),
  `nome`, `status_meta`, `pipeline_id` NULO = "sem funil" (FK composta
  `(pipeline_id, account_id)` com `ON DELETE SET NULL (pipeline_id)`, coluna
  NOMEADA — lição da 966), `last_seen_at`; `UNIQUE (account_id,
  campaign_id)`. SELECT para o membro da conta (é o que amarra gasto → funil
  no Desempenho).
- `cb_meta_ads_gastos`: `account_id`, `campaign_id`, `dia date`, `gasto
  numeric(12,2)`, `atualizado_em`; a chave é a PRIMARY KEY composta
  `(account_id, campaign_id, dia)` — é ela o alvo do `onConflict`. SELECT
  para o membro da conta.

**Rotas** (`/api/cb/meta-ads/*`, `requireRole('admin')`, service-role):
- `PUT config` — grava conta + token cifrado e testa na hora (`GET
  /act_<id>?fields=name,currency` e a primeira página de campanhas); falha
  volta como CÓDIGO (`token_invalido`, `sem_permissao`,
  `conta_nao_encontrada`), nunca a mensagem crua da Meta.
- `DELETE config` — desconecta (apaga a config; campanhas e gastos ficam,
  para o histórico do Desempenho não sumir).
- `PATCH campanhas/[id]` — só `pipeline_id`, por allowlist (como
  `CB_CHANNEL_SAFE_COLUMNS`); a rota confere que o funil é da conta.
- `POST sync` — sincroniza agora (o mesmo código do cron), responde 202 e
  trabalha em `after()`.
- `GET cron` — entra no laço LENTO do `docker-stack.yml` (`for rota in
  cb/scheduled flows cb/radar cb/meta-ads`), com `x-cron-secret`. ⚠️ O CI
  não relê o `command` do agendador — `docker stack deploy` manual na VPS,
  com o `crm.env` carregado (as três linhas do CLAUDE.md). Teto real = o
  `-m 120` do curl, não o `maxDuration`.

**Sincronização (`src/lib/meta-ads/`):** `cliente.ts` (fetch a
`graph.facebook.com/<META_ADS_API_VERSION>` — constante PRÓPRIA, porque a do
`meta-api.ts` do WhatsApp não é exportada; são dois literais independentes, e
subir a versão do Graph exige mexer nos dois — paginando por `paging.next`,
com cerca de origem) e `sincronizar.ts`: (1) relê as campanhas
(upsert por id, carimba `last_seen_at`); (2) `GET /act_<id>/insights?level=
campaign&fields=campaign_id,spend&time_increment=1&time_range=…` para os
**últimos 3 dias** — a Meta reprocessa o gasto de ontem por até 48h; puxar
só "hoje" congelaria um número que ainda muda — e upsert em gastos; (3)
carimba `last_sync_at`/`last_error`. Primeira sincronização depois de
conectar: 90 dias, em `after()`. Puros e testados: `janela-de-sync.ts`
(quais dias puxar), `atribuicao.ts` (gasto do período por funil a partir de
campanhas + gastos, e o "sem funil"), `cartao.ts` (o estado que a rota
`GET /api/cb/meta-ads` devolve ao cartão — nada a ver com `montarCartoes`).
`cliente.ts` faz I/O; o que os testes cobrem são os ajudantes puros dele
(`codigoDoErro`, `normalizarAdAccountId`, `semSegredo`, `doGraph`).

**No Desempenho (linha 2 da Fase 2):** Investimento no período (soma do
gasto diário das campanhas do funil nos dias do período — granularidade
diária, sem pró-rata) com "há N min" da última sincronização · Custo por
lead = investimento ÷ entradas · CAC = investimento ÷ contratos · Custo dos
perdidos (D8) · tabela "Investimento por campanha". ⚠️ **Gasto em campanha
SEM funil não some**: aparece como aviso ("R$ X em N campanhas sem funil
atribuído", com link para Integrações) — silenciado, o custo por lead sairia
menor do que é. Sem integração conectada, os cards dizem "conecte o Meta Ads
em Integrações", nunca R$ 0,00 com cara de número.

**Fora daqui:** custo por lead POR CAMPANHA (exige saber de qual campanha
veio cada lead — Fase 5a); orçamento e limites; qualquer escrita na Meta.

**Resultado medido (2026-09-04, worktree em `main` @ `f25c259`):**

- Migration `976_cb_meta_ads` **aplicada em produção** pelo conector e
  conferida por consulta: as três tabelas com RLS ligada, `anon` sem SELECT
  nas três, `authenticated` sem INSERT/UPDATE/DELETE nas três, sem SELECT em
  `cb_meta_ads_config` (o token cifrado não passa pelo PostgREST) e com
  SELECT em campanhas/gastos, `service_role` com INSERT nas três.
- Código: `src/lib/meta-ads/` (`cliente.ts` com Bearer no cabeçalho e
  paginação por `paging.next`; `janela-de-sync.ts`; `atribuicao.ts`;
  `cartao.ts`; `sincronizar.ts`) com testes, rotas em
  `/api/cb/meta-ads/{,config,campanhas/[id],sync,cron}`,
  `use-gastos-de-anuncios.ts`, `meta-ads-card.tsx` no painel de Integrações,
  e no Desempenho a linha de cards (Investimento · Custo por lead · CAC ·
  Custo dos perdidos), o aviso de campanha sem funil e a tabela por
  campanha. Suíte em **2629** testes; typecheck limpo; lint 0 erros;
  portões de i18n OK.
- Preview em 1440×900: o cartão "Meta Ads" aparece em Integrações como **não
  conectado**, com o formulário (conta + token como `password`) e o texto de
  onde tirar o token. Token propositalmente inválido → `PUT config` devolve
  **400** e a tela mostra "Falha: a Meta recusou o token"; o log do servidor
  registra `[meta-ads] conexão recusada (token_invalido)`. Nada foi gravado.
  No Desempenho de um funil com degrau mapeado, a linha
  "Conecte o Meta Ads em Integrações…" com link para `?tab=integracoes`.
- ⚠️ **O que NÃO foi testado aqui, e por quê:** a sincronização de verdade
  (campanhas, gasto diário, tabela campanha → funil, cards com número)
  exige o token `ads_read` e o `act_…` do escritório, que o operador tem e
  eu não. O caminho de erro foi exercitado; o caminho feliz espera a
  conexão real.

**Revisão de código do trabalho inteiro (04/09), e o que ela mudou.** Quatro
revisores independentes leram os módulos puros, o SQL e as rotas, os
componentes e os dois documentos contra o código. O que virou correção nesta
branch, além dos quatro achados do Codex no próprio PR #123:

- ⚠️⚠️ **Dinheiro deixou de contar quem VOLTOU.** `resumo.fechados` é
  "alcançou contrato" (o degrau do funil, monotônico); valor fechado, ticket
  médio e CAC passaram a sair de `fechadosAgora` (`situacao === 'fechado'`).
  Um distrato aparecia como receita E como perda, e dividia o investimento
  por um número inflado — medido numa coorte de teste: 4 "contratos" e
  R$ 68.000 onde havia 1 e R$ 24.000.
- **O gráfico de entradas por dia passou a somar o mesmo que o card "Leads"**
  (a grade densa é limitada; a coorte não é).
- **CSV: aspas não protegem contra fórmula** — nome vindo do WhatsApp ou
  campo vindo do n8n começando com `=`/`+`/`-`/`@` era avaliado pelo Excel
  na máquina de quem abrisse a planilha.
- **`created_at` nulo deixou de derrubar as três vistas** (uma linha assim
  descartava a carga inteira, para sempre).
- **A seta do delta passou a concordar com o texto** no intervalo de ±0,05.
- **O token da Meta não sobrevive à mensagem de erro nem ao log**
  (`semSegredo`), e a paginação não segue URL fora do Graph (`doGraph`).
- **Teste novo pinando a RLS das três tabelas do Meta Ads**: elas só podem
  dar SELECT ao membro porque a RLS está ligada, e a conferência dentro da
  migration testa GRANT, não RLS.
- **A auditoria dos documentos achou 16 imprecisões**, todas corrigidas —
  inclusive duas contagens de teste erradas desde que foram escritas, três
  componentes listados que nunca existiram e a afirmação de que o cartão do
  Meta Ads passa por `montar.ts`.

**Correções do Codex às fases ANTERIORES, entregues nesta mesma branch**
(os três achados são de Fase 2 e Fase 3, não da Fase 4 — vieram nos PRs #121
e #122 e só foram corrigidos aqui):

- **Taxa nula deixou de virar 0,0%** no gráfico de taxas: no preset "Total"
  (sem período anterior) e em transição sem denominador, o valor ia como
  `?? 0` e o tooltip afirmava uma conversão MEDIDA em zero. Agora o nulo
  viaja como nulo (barra ausente) e o formatador escreve "—".
- **Funil SEM etapa nenhuma caiu no estado de configuração.** A guarda era
  `stages.length > 0 && !configurado`, então o funil sem etapa (etapa
  apagada, ou insert padrão que falhou) renderizava zeros com cara de funil
  configurado. Como `stages` também é `[]` **enquanto carrega**, a página
  passou a carimbar de quem são as etapas (`etapasDe`) e Desempenho/Saúde
  recebem `etapasCarregadas` — prop OBRIGATÓRIA, para o compilador cobrar de
  quem montar a vista numa tela nova. É a mesma família do "efeito passivo"
  do CLAUDE.md: lista vazia durante a carga não é resposta.
- **"Em andamento" no mapa de saúde passou a ser a coorte com lead sem
  desfecho**, não o mês do calendário: agosto com 6 abertos segue mudando em
  setembro, e setembro com tudo resolvido já é final. O marcador virou a
  contagem visível ("6 em aberto") sob o rótulo do mês, com o motivo no
  `title`. Medido no preview: a marca ficou em **ago/26**, onde estão os 6,
  e não em set/26.

### Fase 5 — Depois (cada item é uma decisão à parte)

- **5a — Captura automática do anúncio de origem.** Hoje nada é lido (2.2).
  No Evolution/Baileys a primeira mensagem de um clique em anúncio traz
  `contextInfo.externalAdReply` (título, `sourceUrl`, `sourceId`) e
  `ctwaClid`; na Cloud API, `referral` (`source_id`, `source_url`, `ctwa_clid`,
  `headline`). Gravar isso nos campos `ctwa_clid`/`fbclid`/`nome_do_anuncio`
  do contato na ingestão (`inbound-store.ts` + webhook) é o que faz "Campanha /
  Conjunto / Anúncio" existirem sem depender de gente. ⚠️ Nome de campanha e
  conjunto NÃO vêm no clique — só o id/título do anúncio; com a Fase 4 no
  lugar, o `sourceId` é resolvido pela mesma API (`GET /<ad_id>?fields=name,
  adset{name},campaign{name}`), e aí nasce "custo por lead por campanha".
  Medir primeiro num payload real de anúncio antes de desenhar (não há um
  guardado).
- **5b — Backfill de lista de outro CRM** (decisão do operador: possibilidade
  futura, plano próprio). Problema real: o gatilho da 912 escreve
  `deal_created` com `now()` em todo INSERT em `deals`; um importador precisa
  inserir e depois REESCREVER `occurred_at` do evento (ou inserir eventos
  `reconstructed=true` por etapa com as datas históricas) via service role,
  casando contatos por telefone (`findExistingContact`, últimos 8 dígitos) —
  e as etapas da lista de origem têm de ser traduzidas para etapas DESTE
  funil (o `degrau` cuida do resto). Merece plano próprio; este só registra
  a armadilha.
- **Descartado em 03/09:** espelhar o funil externo pela API v1 (n8n do
  gestor). A API continua existindo para outros usos; os dados do funil vêm
  do CRM.

---

### ✅ Fase 6 — Contagem por período como padrão (concluída em 2026-09-18)

**Objetivo.** Responder "quantos contratos fechei ESTE mês" com os contratos
deste mês, e não com os da coorte que entrou neste mês. Pedido do operador
em 18/09, com a contagem por coorte mantida sob demanda.

**Entregue.** `src/lib/funil/por-periodo.ts` (+ teste com os cenários do
operador), `FatosDoNegocio.alcancouEm` (`trajetoria.ts`), `funilDeContagens`
e `emAbertoDe` extraídos de `coorte.ts` (a coorte não mudou de resultado —
os testes dela passam intactos), `coortesMensais(…, modo)` em `saude.ts`,
`eixoDasTaxas` em `apresentacao.ts` e nos dois gráficos, o hook
`use-modo-de-contagem.ts`, o `SeletorDeModo` em `seletor-de-modo.tsx`, e as
notas de modo no Desempenho e na Saúde. Chaves novas em `Pipelines.funil.modo`
e nas duas abas, nos dois dicionários.

**Medido em produção antes (18/09).** Nenhuma etapa dos 4 funis tem `degrau`
gravado: as abas continuam em "configure" até o operador mapear. Os quatro
funis têm trilha para 100% dos cards (295/295, 393/393, 21/21, 215/215), mas
só 14 mudanças de etapa no total — a operação real começa na semana de
21/09. Há 1 contato com dois cards no mesmo funil (um automático em "Contato
Avulso", um manual em "Proposta Realizada"): conta como dois leads, e é o
único caminho de inflar a contagem (o formulário manual de negócio não
confere se o contato já tem card; router, automação e API v1 conferem).

**Revisão de 19/09 (o Codex estava sem cota; duas revisões adversariais
próprias, matemática e UI).** Três P2 corrigidos no mesmo PR, cada um com
pino: (1) a perda MIGRAVA de mês quando o negócio trocava de etapa de perda
(No Show em agosto → Perdido em setembro apagava a perda de agosto) — a data
passou a ser o começo da estadia em perda (`perdidoDesde`, regra 8); (2) na
Saúde por período a célula "pequena" e a escala liam as ENTRADAS do mês, que
não são denominador de taxa nenhuma naquele modo — passaram a ler o
denominador da transição (`linhasDoMapa(…, modo)`); (3) "Custo dos perdidos"
multiplicava o custo por lead do período por perdas de leads de qualquer mês
e passava do investimento — multiplica os entrantes do período já perdidos
(`perdidosDosEntrantes`). Mais: a nota de Negativos avisa que "% das
entradas" pode passar de 100%; a faixa de vazio da Saúde olha atividade, não
só entradas; o motivo escrito do `eixoDasTaxas` estava errado (o recharts
alarga o domínio, não corta) e foi reescrito aqui, no CLAUDE.md e no código;
"stage" → "step" no inglês onde é degrau. Sem achado P1; lint, typecheck,
i18n e os 4.143 testes verdes nas duas revisões.

### Fase 7 — Ciclo de vendas (próxima)

Três medidas no Desempenho, sem migration, a partir da trilha: **Entrada →
Contrato**, **Reunião → Contrato** (da entrada na etapa de reunião — decisão
de 18/09) e **Proposta → Contrato**. Cada uma com mediana, média e o `n`.

- Usa as entradas REAIS nas etapas (a primeira entrada numa etapa DA CLASSE),
  nunca o alcance monotônico: o card que pulou a Proposta fica FORA de
  "Proposta → Contrato" — contaria 0 dias e puxaria a média para baixo.
- Atribuição ao período pelo modo vigente: por período, os contratos
  alcançados no período; por coorte, os da coorte que fecharam.
- "Primeira mensagem" ≈ entrada no funil: medido em 18/09, 671 de 691 cards
  (97%) nascem até 1 h da primeira mensagem; nos 3% restantes (contato
  antigo que virou lead depois) a entrada no funil é a data mais honesta.
  Os três campos `data_do_primeiro_contato` / `data_da_proposta` /
  `data_de_fechamento_do_contrato` criados pelo operador estão com 0
  preenchidos e NÃO são fonte de nada aqui.
- Hoje a base tem 1 card que chegou a Contrato: a medida nasce vazia e enche
  com a operação (ou com a carga da Kommo, se vier com histórico).

### Fase 8 — Reuniões por dia e horário, na Saúde (depois da 7)

Mapa dia da semana × hora (fuso de Brasília, `formatToParts`), pelo horário
PARA O QUAL a reunião foi marcada, com um seletor "cruzar com a etapa" (No
Show, Proposta Realizada, qualquer etapa do funil) que mostra contagem e
taxa por horário — no-shows ÷ reuniões do horário é a "probabilidade de
no-show" pedida. Preferência do seletor por dispositivo (`localStorage`).

- ⚠️ **Fonte: o LOG do Calendly (`cb_calendly_eventos`), não o campo
  "Data e Hora Reunião".** Medido em 18/09: log = 50 agendamentos; campo =
  40 (só o último por contato — os 10 reagendados/repetidos sumiram, e o
  no-show que reagenda é justamente esse caso). Tudo o que está no campo veio
  do Calendly (0 exceções).
- ⚠️ **Mais o campo, para quem NÃO tem agendamento no log** — é o caso do
  lead migrado da Kommo, que traz a data da reunião no campo e nunca passou
  pelo webhook. Vira um agendamento sintético, "sempre em vigor".
- **Remarcação**: reunião remarcada ANTES de acontecer sai da conta (nunca
  aconteceu); remarcada DEPOIS (o no-show que reagenda) fica. A régua é o
  `recebido_em` da nova contra o `inicio` da antiga.
- **Atribuição**: a entrada do card na etapa é ligada ao agendamento que
  estava em vigor naquele instante (o último recebido antes da entrada) —
  não à data em que o operador moveu. Por isso a arrumação com atraso não
  estraga estes mapas; vai-e-volta na etapa (mover para No Show e devolver)
  é o que estraga.
- **Rota nova só para admin** (`cb_calendly_eventos` é fechada ao
  navegador), devolvendo só contato + horários — sem nome, e-mail ou
  telefone. Paginada.
- **Cancelamento (decisão de 18/09)**: assinar `invitee.canceled`
  (`EVENTOS_ASSINADOS`), gravar `cancelado_em` no evento (migration pequena)
  e excluir a reunião cancelada dos mapas. Depois do deploy o operador clica
  "Reassinar" no cartão do Calendly. Também é o que tira o Calendly do
  "fora do bloco da agenda" do Meu dia.
- Hoje a base tem 1 entrada em No Show e 1 em Proposta: o mapa de
  agendamentos nasce com os 50; os de desfecho enchem com a operação.

### Contrato com a migração da Kommo (`docs/PLANO-migracao-kommo.md`)

O que o funil ESPERA da carga — para a sessão da migração levar em conta:

1. **As datas saem de `cb_lead_events.occurred_at`**, sem filtrar `origin`:
   evento `retroativo` conta na data que carregar. Carga que deixe o gatilho
   da 912 carimbar `now()` despeja todo lead importado no dia da importação
   — nos dois modos, na Saúde e no ciclo (trava 6 daquele plano).
2. **Mínimo por lead**: `deal_created` na data real de criação (a etapa de
   entrada) e a entrada na etapa ATUAL na data real (o `closed_at` do ganho/
   perdido, ou o último `lead_status_changed`). Com só isso, os degraus
   intermediários herdam a data do degrau que os alcançou (o contrato "conta"
   em Reunião e Proposta na data do contrato) e o ciclo "Reunião → Contrato"
   simplesmente não inclui esse lead.
3. **Ideal (decisão 9 = histórico real)**: um evento por mudança de etapa da
   Kommo, com o de-para valendo para as etapas por onde o lead PASSOU. Aí o
   funil dos 15 meses sai verdadeiro, inclusive reuniões por mês.
4. **Card já existente aqui (decisão 11)**: os eventos retroativos convivem
   com os que a trilha já tem (o `deal_created` do router, o Calendly →
   "Reunião Agendada"); entradas duplicadas na mesma etapa contam uma vez
   (`alcancouEm` é a primeira).
5. **Um card por contato**: lead com mais de um card no mesmo funil conta
   como dois leads. Os 118 contatos com mais de um lead na Kommo (trava 5)
   precisam de decisão lá.
6. **Data da reunião**: se vier no campo `data_e_hora_reuniao`, a Fase 8 a
   lê como agendamento sintético (item acima).

## 6. Fora do escopo (dito para não voltar por acidente)

- Abas "Fontes/Webhooks", "Atividade" e "Mapa" da referência.
- Filtro salvo na lista de leads (corte deliberado já registrado em
  `PLANO-filtros-salvos-e-campos-automaticos.md`).
- Virtualização da tabela; realtime nas vistas novas (o quadro também não
  tem; recarrega ao trocar funil/período e após cada escrita).
- Edição de campos personalizados NA LINHA da lista (a ficha e o painel já
  salvam sozinhos; a lista é leitura + etapa).
- Probabilidade ponderada por etapa (`pipeline-analytics.tsx` continua como
  está, no Quadro).

---

## 7. Riscos e armadilhas (o que vai para o CLAUDE.md quando as fases entrarem)

- ⚠️ **Lista vazia durante a carga vira afirmação.** Todo estado "nenhum lead"
  / "nenhuma coorte" / "configure" só pode ser mostrado com `carregando=false`
  E `stages` já carregados — o "configure" depende de `stages`, e uma lista de
  etapas ainda vazia diria "funil sem lead mapeado" sobre funil configurado.
- ⚠️ **Alcance é monotônico e transferido continua contando** (regras 3 e 6).
  Quem "simplificar" para `stage_id` atual ou para `pipeline_id` atual apaga
  contratos do funil comercial e faz taxas passarem de 100%.
- ⚠️ **`degrau` não deriva de `resultado`.** A tela sugere; o cálculo lê só a
  coluna. Derivar em tempo de execução faria "No Show" virar perda no painel
  sem ninguém ter decidido.
- ⚠️ **A RPC é SUPERCONJUNTO.** Nunca somar linhas da RPC como se fossem "a
  coorte": o recorte pela entrada é em `coorte.ts`. Uma versão que confie na
  janela da RPC conta negócio de janeiro movido em março como coorte de março
  — que é justamente o certo — mas também o contaria em abril se tiver
  qualquer evento em abril.
- ⚠️ **Período em fuso local**, como o painel (`date-utils.ts`). Servidor em
  UTC no futuro (SSR) quebraria a virada de mês às 21h de Brasília.
- ⚠️ **Coorte recente é incompleta por natureza**, e a tela diz isso. Comparar
  "este mês" com "mês passado" em conversão para contrato compara um mês
  aberto com um fechado — o Δ é informativo, não julgamento.
- ⚠️ **`deals.value` é o "valor proposta"**; "Tamanho da Dívida" é TEXTO. Nada
  de somar ou filtrar por número em campo `text` (D5).
- ⚠️ **PostgREST corta em 1000 linhas sem avisar** — a RPC pagina com
  `order + range + count`, e `carregar.ts` devolve `null` (não uma lista
  parcial) quando não coube.
- ⚠️ **CSV com `;` e BOM** é para o Excel pt-BR; quem trocar para `,` para
  "seguir o broadcast" faz o operador abrir tudo numa coluna só.
- ⚠️ **O token da Meta é segredo e cifrado**: nunca sai da rota de status,
  nem mascarado; erro da API volta como código. Rotacionar `ENCRYPTION_KEY`
  invalida-o junto com os tokens do WhatsApp. ⚠️ **E não basta o código**: a
  mensagem da Meta ECOA o token ("Malformed access token EAAB…", medido em
  04/09) e ia para o log do servidor — `semSegredo()` a limpa antes de ela
  virar `MetaAdsError.message`.
- ⚠️ **Campanha sem funil silencia custo** — o card do Desempenho avisa em
  vez de esconder; quem "limpar" o aviso faz o custo por lead mentir para
  baixo.
- ⚠️ **O gasto de ontem muda por 48h** na Meta: a janela de sincronização é
  de 3 dias, com upsert por (campanha, dia). Puxar só o dia corrente congela
  número errado. ⚠️ **E o upsert sozinho não basta**: quando o dia é
  reprocessado para ZERO, a Meta OMITE a linha em vez de devolver 0 — o
  valor antigo ficaria gravado e, ao sair da janela, viraria permanente. Por
  isso a janela é RECONCILIADA: o que estava lá e não voltou no retrato é
  apagado (achado do Codex no PR #123).

---

## 8. Verificação por fase (checklist)

- [ ] `nvm use` (Node 22) · `npm run typecheck` · `npm run lint` (ler
      `✖ N problems`, não a última linha) · `npm run test` ·
      `node scripts/i18n-parity.mjs` · `node scripts/i18n-chaves-usadas.mjs`
- [ ] Migration: aplica num banco VAZIO (`supabase db start`), todo `REVOKE`
      tem `GRANT` de volta, conferência troca de papel, nada exige dado
- [ ] Preview em 1440×900 (dev server em worktree herda a sessão — memória
      "preview em worktree"); dark mode; perfil `viewer`/`agent` além do admin
- [ ] Escritas de teste SÓ num funil de teste criado na conta para a fase e
      apagado ao fim (os "TESTE" existentes são de OUTRA conta); reverter o
      que alterar valor/etapa de negócio real
- [ ] Revisão 2×: (1) edge cases — funil sem `lead`, degrau sem etapa,
      transferido, pulo de degrau, coorte vazia, período personalizado
      invertido; (2) convenções — módulo puro antes de componente, `cb_*`,
      chaves nos dois dicionários, nada de `as` em JSON da RPC (parse com
      forma conhecida, como `lerFiltroSalvo`)
- [ ] Atualizar ESTE plano (Estado + seção da fase com resultado medido) e o
      CLAUDE.md (seção nova "Funil comercial") no mesmo PR
