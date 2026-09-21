# Plano — migração Kommo → CB CRM

> Documento vivo. Fase 1 (levantamento) **refeita em 14/09/2026**, contra o
> `main` daquele dia (depois do PR #211). O levantamento de 02/09 e a
> conferência de 08/09 ficaram obsoletos nos NÚMEROS e, pior, na PREMISSA —
> ver "O que a medição de 14/09 mudou". As demais fases dependem das decisões
> no fim.
>
> ⚠️ **Conferido de novo em 19/09/2026 contra o `main` dos PRs #212–#224**
> (migrations 1002–1006), por seis varreduras de código com revisão
> adversarial. O que mudou está em "O que o código mudou de 14/09 a 19/09": a
> decisão 9 deixou de ter três opções viáveis, a decisão 10 foi reescrita como
> 17 (ganhou uma opção e perdeu duas), e nasceram treze decisões novas (16 a
> 28) — são 27 ao todo. Os NÚMEROS da Kommo continuam os de 14/09 — remedir
> antes de escrever a carga.
>
> Reproduzir (tudo só leitura; a saída tem dado de cliente e fica FORA do
> repositório):
>
> 1. `node scripts/kommo/levantamento.mjs --saida <pasta>` — a Kommo inteira
>    (~6 min a 5 req/s).
> 2. `scripts/kommo/destino-contatos.sql` — a foto dos contatos do CB CRM,
>    salva como JSON (API de gerenciamento do Supabase ou SQL Editor).
> 3. `node scripts/kommo/cruzamento.mjs --kommo <pasta>/kommo-bruto.json --destino <destino.json>`
>    — sobreposição, entrada recente e anotações, só agregados.
> 4. `node scripts/kommo/historico.mjs --saida <arquivo.jsonl>` — o histórico
>    de etapas (decisão 9).
> 5. `node scripts/kommo/entradas.mjs` — o que alimenta a Kommo hoje.

## O que a medição de 14/09 mudou

1. ⚠️⚠️ **A Kommo NÃO é um sistema parado esperando carga — é o CRM em uso.**
   Nos 7 dias até 14/09 ela recebeu **241 leads novos (~30 por dia), todos
   criados por integração**, **652 leads antigos foram mexidos** (445 pelo
   login compartilhado "Trabalhista", 181 por robô) e **437 foram fechados**. O plano
   anterior tratava a migração como "fundir um cadastro"; ela é uma **troca de
   sistema com dois CRMs vivos ao mesmo tempo**, e a parte difícil deixa de ser
   a carga e passa a ser o **corte**.
2. ⚠️⚠️ **O CB CRM virou quase um SUBCONJUNTO da Kommo.** 979 dos 1.024
   contatos daqui existem lá (96%); só 45 são exclusivos do CB CRM. Dos 241
   leads novos da semana, **217 já tinham ficha aqui** — o mesmo cliente
   entra pelos dois lados em paralelo (WhatsApp aqui, formulário/Typebot lá).
3. ⚠️⚠️ **O funil do CB CRM não é trabalhado; o da Kommo é.** Dos 766
   negócios daqui, **740 estão parados na etapa de entrada** (Contato Avulso,
   Entrada Avulsa, Avulso), 25 em Reunião Agendada (o Calendly os move) e 1 em
   Proposta — **zero ganhos, zero perdidos**. Enquanto isso, **845 leads
   ABERTOS da Kommo pertencem a contatos que já têm card aqui**. Ou seja: o
   card daqui é um esboço criado pela conexão, e a etapa verdadeira está lá.
   Decisão nova (11).
4. **Duas travas novas** (7 e 8, abaixo): a carga **dispara automação** — o
   gatilho de funil da 933 enfileira evento a cada card criado ou movido, e há
   automação ATIVA mandando webhook ao CB OS quando o card entra em "Contrato
   Fechado" —, e a carga precisa respeitar o **nome fixado** (999) e o
   **e-mail espelhado** (1000/1001), que não existiam em 08/09.
5. **Duas travas eram menores do que o plano de 08/09 dizia**: campo
   personalizado tem também `select` e `number` (948), e a API v1 escreve
   campo personalizado (`PATCH /api/v1/contacts/{id}/custom-fields`). A de telefone mudou de forma
   mas não de efeito (989: `contacts.phone` é anulável, com CHECK "telefone OU
   Instagram" — contato da Kommo sem telefone continua sem como existir).

## O que o código mudou de 14/09 a 19/09

Cinco dias, treze PRs (#212–#224) e cinco migrations (1002–1006). Três deles
mexem no plano; os outros não (celular/PWA, sonda de atraso de entrega, foto de
perfil da Evolution, régua do Asaas rodada 4 — conferidos um a um).

1. ⚠️⚠️ **O funil passou a DATAR cada degrau, e a contagem POR PERÍODO virou o
   padrão da tela** (PR #224, Fase 6 do funil comercial, 18–19/09). Antes, a
   única data que importava era a ENTRADA do lead no funil; hoje
   `FatosDoNegocio.alcancouEm[k]` guarda a primeira vez que o negócio alcançou
   cada degrau e `perdidoDesde` guarda o começo da estadia atual em perda
   (`src/lib/funil/trajetoria.ts`, regras 7 e 8). As duas saem
   EXCLUSIVAMENTE de `cb_lead_events`. O docstring de
   `src/lib/funil/por-periodo.ts` já cita este plano por escrito: *"carga que
   carimbe `now()` despeja tudo no dia da importação"*.
   **Consequência: a decisão 9 deixou de ter três opções.** "Nenhum evento"
   some com o lead das três vistas (a RPC só acha o negócio pelo CTE
   `tocados`, que exige evento apontando para o funil); "só criação e
   fechamento" não é meio caminho — ela empilha MQL, Reunião, Proposta e
   Contrato todos na data do fechamento, e as transições intermediárias saem
   cravadas em 100% nos meses históricos, no modo que o operador escolheu como
   padrão. Sobra o histórico real.
2. ⚠️⚠️ **O funil NUNCA lê `deals.status`** — nem a RPC, que filtra
   `event_type IN ('deal_created','stage_changed','pipeline_changed')` e deixa
   `status_changed` de fora (`0975:104` e `:161`). Quem decide ganho, perda e
   "em andamento" é o `degrau` da etapa ATUAL (`situacaoDe`). Na Kommo,
   ganho/perdido é `status_id` 142/143 e **não é etapa**. A tradução literal
   (`deals.status = 'won'/'lost'` + um `status_changed`) deixa os 5.791
   fechados como pipeline ABERTO para sempre: zero contratos, zero perdas,
   ticket e CAC zerados. Decisão 18.
3. ⚠️⚠️ **Automação de etapa pode se INTERROMPER quando o card sai da etapa**
   (PR #223, migrations 1004/1005/1006, 19/09). A trava 7 descrevia um sentido
   só — "a carga dispara automação". Existe agora o oposto: mover card ou
   drenar evento **cancela execução viva**. São duas pontas:
   `cancelarEsperasAoSairDaEtapa`, chamada pelo dreno, busca as execuções
   vivas por **contato** (um card novo de um contato que tem sequência rodando
   a mata); e `cardSaiuDaEtapa`, na retomada, pergunta a `cb_automation_events`
   se o card se mexeu — e **ignora `processado_em`**. Ou seja: marcar o evento
   como processado silencia o disparo e **não** silencia a interrupção. Hoje o
   risco é zero (nenhuma automação de etapa tem a caixa marcada, e a fila de
   esperas está vazia); ele nasce no dia em que a recuperação de No Show for
   ligada.
4. **Dois números da trava 7 estavam errados desde sempre**: o dreno tem
   `LOTE = 50` e o laço rápido do agendador é `sleep 15`, não 60 s — são
   **200 eventos/min**, e a opção "limpar a fila antes do agendador" (decisão
   10) não tem 60 s de folga, tem 15. E o gatilho da 933 **não** enfileira em
   todo INSERT: ele sai antes quando `source = 'automation'` (`0933:157-159`).
   O UPDATE de etapa/status não tem saída equivalente.
5. **Nada do que entrou toca a carga por outro lado.** `messages.gravada_em`
   (1003) e o atraso de entrega (1002) só importam se um dia a carga trouxer
   mensagem — o que está fora do escopo. A régua do Asaas continua DESLIGADA e
   não é retroativa (`entrouNaRegua` só aceita parcela vista vencida depois de
   `regua_ativada_em`), mas a carga cria ~11.890 fichas e o ciclo seguinte liga
   clientes que hoje estão em "Sem ficha" — eles entram no universo da régua
   sem ter passado pela curadoria dos 38 da lista de exceção.

### Medido na produção em 19/09/2026

| | 14/09 | 19/09 |
| --- | ---: | ---: |
| Contatos | 1.024 | **1.196** |
| Negócios (todos ABERTOS) | 766 | **960** |
| Conversas | 772 | **967** |
| Contatos com `nome_fixado_em` | 9 | **29** |
| Contatos com e-mail | 0 | **1** |
| Etapas com `degrau` | 0 de 28 | **0 de 28** |
| Etapas com `resultado` | 5 | **5** |
| Eventos em `cb_lead_events` | — | **1.301** |
| ↳ dos quais mudança de etapa | — | **14** |
| Fila `cb_automation_events` (nada pendente) | — | 1.009 |

⚠️ A trilha inteira do CB CRM são 959 `deal_created`, 288 `tag_added` e **14**
mudanças de etapa. As 27.610 mudanças da Kommo seriam **99,9% de todo o
histórico de funil do sistema** — o argumento mais forte a favor da decisão 9.

⚠️⚠️ **As 8 automações da conta foram desligadas em bloco em 19/09 às
21:23:46–48Z**, a "Calendly → Reunião agendada" e a "Envio Webhook CB OS -
Atlas" incluídas. Conferir com o operador se foi deliberado: enquanto estiver
assim, agendamento novo do Calendly fica `sem_automacao`. Muda a trava 7 (a
automação do Atlas não está mais ativa) e a decisão 10 (a janela existe).

## Situação medida

Conta Kommo `cbadvogados` (id 34706107), moeda BRL, 7 usuários.

| | Kommo 02/09 | **Kommo 14/09** | CB CRM 08/09 | **CB CRM 14/09** |
| --- | ---: | ---: | ---: | ---: |
| Contatos | 12.736 | **13.110** | 515 | **1.024** |
| Leads / negócios | 12.256 | **12.614** | 513 | **766** |
| ↳ abertos | — | **6.823** | — | 766 |
| ↳ ganhos | 170 | **170** | — | 0 |
| ↳ perdidos | 5.093 | **5.621** | — | 0 |
| Conversas | — | — | 518 | **772** |
| Funis (etapas) | 6 (70) | 6 (70) | 4 (28) | 4 (28) |
| Tags | 30 lead + 3 contato | **31 no total** | 11 | **12** |
| Campos personalizados | 35 lead + 3 contato | 36 lead + 3 contato | 18 | **19** |
| Anotações de texto | 543 | **543** | 28 | 32 |
| Empresas | — | 26 | — | — |

Do crescimento do CB CRM, **262 contatos têm a etiqueta `asaas`** — são as
fichas que a integração do Asaas criou em 12/09 (D2 daquele plano).

### Sobreposição (14/09)

Casando pela chave de telefone **sem o nono dígito** (a régua de
`findExistingContact`), com o telefone normalizado por `digitosDoTelefone`:

| | Contatos |
| --- | ---: |
| Nos DOIS (a carga reencontra, não cria) | **979** |
| Só na Kommo (criar) | **11.890** |
| Só no CB CRM | **45** |

Dos 979 que existem nos dois:

| | |
| ---: | --- |
| 751 | têm conversa com mensagens aqui |
| 749 | têm negócio aqui (quase todos na etapa de entrada) |
| 640 | têm **nome diferente** nos dois lados (ver decisão 8) |
| 233 | nasceram da integração do Asaas |
| 26 | têm algum campo personalizado preenchido aqui |
| 9 | têm o **nome fixado** (999) — a carga não pode trocá-lo |

### A Kommo ainda recebe e trabalha lead

| Dia | Leads novos |
| --- | ---: |
| 07/09 | 36 |
| 08/09 | 43 |
| 09/09 | 36 |
| 10/09 | 30 |
| 11/09 | 30 |
| 12/09 (sáb) | 17 |
| 13/09 (dom) | 22 |
| 14/09 (até 13h58) | 27 |

- **Todos** criados por integração (`created_by = 0`), com as etiquetas
  TRABALHISTA (179), FORMULÁRIO (137) e TYPEBOT (38).
- Entram sobretudo em **Trabalhista › Etapa de entrada** (68), no
  **Pré-Vendas › TYPEBOT e FORMS** (25) e no **Pré-Vendas › Reunião Agendada
  BOT** (10) — e 66 já nasceram ou caíram em PERDIDO na mesma semana.
- **652 leads antigos foram mexidos** na semana: 445 pelo usuário
  "Trabalhista", 181 por robô, 26 por "Cabral Baptista Advocacia".
- **Nenhuma anotação** foi escrita na Kommo desde 02/09 — as 543 são acervo
  congelado.

O que alimenta essas entradas — e os webhooks que a Kommo dispara a cada
mudança de etapa — está em "Entradas e saídas da Kommo", mais abaixo.

## De‑para

### Campos personalizados — de LEAD (Kommo) para CONTATO (CB CRM)

> ⚠️⚠️ **LEVANTAMENTO SUPERADO — não é instrução.** O que migra está em
> `docs/PLANO-migracao-kommo-de-para.md`, seção 11, que é a fonte de
> verdade. Esta tabela é a foto do que EXISTE na Kommo, levantada em
> 14/09. Lida como mapa, ela manda a carga escrever em `Data e Hora
> Reunião` e `Link Reunião` — que são do Calendly, têm 106 valores vivos e
> não são território da Kommo.

⚠️ No CB CRM campo personalizado só existe em **contato**. Os tipos agora são
`text`, `datetime`, `select` e `number` (948) — lista da Kommo pode virar
`select` em vez de texto solto.

| Kommo (lead) | Preenchidos 14/09 | CB CRM (contato) |
| --- | ---: | --- |
| Tamanho da dívida | 2.773 | Tamanho da Divida |
| Atraso da dívida | 2.337 | Tempo de Atraso |
| Origem dívida | 2.327 | Origem da Divida |
| Marcou reunião onde | 1.354 | ❓ não existe |
| URL Reunião | 1.314 | Link Reunião |
| Reunião Marcada (`date_time`) | 1.199 | Data e Hora Reunião |
| Campanha / Conjunto anuncios / anuncio | 1.152 cada | Nome da campanha / do conjunto / do anúncio |
| fbclid | 1.004 | fbclid |
| Código ID | 671 | ❓ não existe |
| Telefone (campo de lead) | 443 | → `contacts.phone` (não é campo) |
| E-mail (campo de lead) | 439 | → `contacts.email` (não é campo) |
| Data Proposta (`date`) | 353 | Data da Proposta |
| utm_source/medium/campaign/content/term | ~305 cada | utm_* (mesmos nomes) |
| TAGs contem | 298 | ❓ não existe |
| Demitida ou demissão | 268 | ❓ não existe (mas há TAGS "Demitida", "Pediu Demissão", "Ag. Demissão" aqui) |
| Tempo da demissão | 268 | ❓ não existe |
| Grávida | 4 | ❓ não existe |

Os 14 campos restantes da Kommo seguem com **zero** preenchimentos (inclusive
a família `utm_*` duplicada do tipo `text`). Não migram.

Campo de **contato** na Kommo: Telefone (13.082), **E-mail (1.831)** e
Posição (0). ⚠️ O CB CRM tem **zero** contatos com e-mail hoje — os 1.831
entram em `contacts.email`, e o gatilho da 1000 os espelha sozinho no campo
"E-mail" do bloco Geral. De quebra, o vínculo automático do tl;dv (987), que
casa por e-mail, ganha base.

### Tags

Medido com `chaveDeTag` (sem acento, minúsculas): **6 das 31 tags da Kommo já
existem** no CB CRM — TRABALHISTA (8.291 usos), TYPEBOT (2.482),
DESQUALIFICADO (1.664), BANCÁRIO (1.250), CLIENTE FECHADO (1.185) e
FORMULÁRIO (268). ⚠️ O plano de 08/09 dizia 11; estava errado.

As outras 25, por uso: 100K a 500K (1.433), adsBLOG (652), PROCESSO PROT.
TRAB (623), EM ATRASO (355), Leads AVN (343), -100K (292), NÃO RESPONDEU
(250), CONTATO SEG. TRAB (240), PROPOSTA RECEBIDA CHATGURU (186), CPF e CNPJ
(183), EM DIA (156), REVISIONAL (116) e 13 com menos de 40 usos.

As tags "Ag. Demissão", "Pediu Demissão" e "Demitida" do CB CRM **não existem
como tag na Kommo** — lá são ETAPAS do funil Trabalhista (882, 1.144 e 398
leads). Ao montar o CB CRM, essas etapas parecem ter virado tag; o de‑para de
funil precisa dizer se um lead em "Pediu Demissão" lá vira tag aqui.

⚠️ No CB CRM a tag é do **contato**. Tag de lead vira tag do contato vinculado
— e a gravação vai DIRETO em `contact_tags` (como o Asaas faz), nunca por
`tag-events.ts`, que dispararia o gatilho `tag_added` das automações milhares
de vezes.

### Funis — 6 → 4

A Kommo separa por **função** (SDR → Closer → Onboarding → Pós-venda) com um
funil por **área** (Trabalhista); o CB CRM separa por **área × função**.

| Funil Kommo | Leads | Abertos | Destino provável |
| --- | ---: | ---: | --- |
| Trabalhista (18 etapas) | 8.381 | 5.572 | Trabalhista - Comercial + Trabalhista - Jurídico |
| Funil Pré Vendas (SDR) / Recuperação (14) | 3.358 | 434 | Bancário - Comercial |
| Funil de Vendas (Closer) (9) | 352 | 295 | Bancário - Comercial |
| Jurídico (Atendimento Geral) (8) | 341 | 341 | Bancário - Jurídico |
| Funil de Onboarding (12) | 180 | 179 | Bancário - Comercial? |
| Checkpoints (Pós Vendas) (9) | 2 | 2 | descartar? |

As etapas do CB CRM (28) seguem com os mesmos nomes de 08/09, e várias têm par
óbvio na Kommo — Link Enviado, Contrato Assinado, Protocolado, Cliente Ativo,
Contato Banco, Contato Avulso, Reunião Sem Proposta. ⚠️ Três armadilhas no par
"óbvio":

- **"Não Respondeu" (Trabalhista - Comercial) tem `resultado = perdido`**
  (950). Os **1.542 leads** da Kommo em "Não respondeu 1ª mensagem" estão
  ABERTOS lá; entrar nessa etapa aqui os carimba perdidos pelo gatilho.
- **"Protocolado" tem `resultado = ganho`**: 738 leads.
- **`pipeline_stages.degrau` segue NULO nas 28 etapas** (975, reconferido em
  19/09) — o funil de eficiência não conta nada até o operador mapear.
  ⚠️ Correção ao que este plano dizia: o `degrau` é lido em TEMPO DE CONSULTA
  e reclassifica a história inteira, então mapear DEPOIS da carga funciona
  igual. Ele é pré-requisito da CONFERÊNCIA (fase 6), não da carga. O que
  precisa vir antes é a ESTRUTURA das etapas e o `resultado` de cada uma
  (trava 12).

**Ganho e perdido não são etapa** na Kommo: `status_id` 142/143, compartilhados
por todos os funis — **170 ganhos e 5.621 perdidos (46% dos leads)**.
⚠️⚠️ E o funil do CB CRM **não lê `deals.status`**: quem decide ganho, perda e
"em andamento" é o `degrau` da etapa ATUAL. Traduzir 142/143 para
`deals.status` deixa os 5.791 fechados como pipeline ABERTO para sempre. Cada
um precisa pousar numa ETAPA com `degrau` e `resultado` — decisão 18. ⚠️ Os 170
ganhos têm **valor zero** (o `price` preenchido está em 423 leads, quase todos
abertos, somando R$ 10,46 mi — a conferir com o operador se é honorário ou o
tamanho da dívida).
**1.122 perdidos têm motivo de perda**, e o CB CRM não tem onde guardá-lo
(decisão 13).

### Responsáveis

| Usuário da Kommo | Leads como responsável |
| --- | ---: |
| Gabriel Queiroz | 8.088 |
| Leonardo Cabral | 3.871 |
| Trabalhista (login compartilhado) | 559 |
| Cabral Baptista Advocacia | 96 |

O CB CRM tem **3 membros** (Leonardo, Isa Lenier, Estephany Dias).
`deals.assigned_to` guarda `profiles.id` e só aceita membro. Gabriel, o
responsável por 64% dos leads, não é membro. Decisão 12.

## Travas técnicas medidas

1. **Telefone é a chave.** Medido com `digitosDoTelefone` e com o nono dígito:
   - 28 contatos **sem telefone** e 1 com telefone que não parece telefone —
     não têm como existir no CB CRM;
   - **181 números duplicados, envolvendo 393 contatos** (em 02/09 eram
     116/254 contando só dígitos crus: o nono dígito esconde parte das
     duplicatas);
   - 37 telefones de fora do Brasil;
   - **12.869 contatos distintos** ao fim.
   ⚠️ O índice único `(account_id, phone_normalized)` NÃO funde as duas
   grafias do nono dígito — a carga precisa casar pela chave de
   `findExistingContact`, senão cria a segunda ficha de quem já está aqui.
2. **Anotação exige conversa.** `cb_conversation_notes.conversation_id` segue
   `NOT NULL`. São **543 anotações de texto** (538 em 336 leads + 5 em
   contatos); **126 das de lead já têm onde pousar** (o contato tem conversa
   aqui). As outras 412 de lead, e as 5 de contato, dependem da decisão 3.
3. **Campo personalizado pela API v1: existe.** O plano de 08/09 dizia que
   não; há `PATCH /api/v1/contacts/{id}/custom-fields` (escopo
   `custom_fields:write`).
   Mesmo assim, a carga segue melhor por service-role direto no banco: são
   ~13 mil contatos, e a rota v1 pede uma requisição por contato.
4. **43 nomes corrompidos** na própria Kommo (UTF-8 lido com a tabela errada:
   `Let铆cia Concei莽茫o`). Recuperável por reinterpretação de bytes.
5. **Um card por contato.** 118 contatos têm mais de um lead na Kommo, **6 com
   mais de um ABERTO**. `createDeal` não impõe a regra (cada chamador decide),
   mas o CB CRM trabalha supondo um aberto por contato: o motor escolhe o mais
   recente (`negocioAlvo`), a rota v1 recusa o segundo com 409 e o roteador da
   conexão desiste quando já há card. Os outros abertos ficariam órfãos de
   atenção.
6. ⚠️⚠️ **A carga ESTRAGA o funil de eficiência se for feita ingenuamente —
   e desde 19/09 estraga MAIS.** Inserir negócio dispara o trigger da 912, que
   grava `cb_lead_events` com a data da IMPORTAÇÃO, e a RPC do funil (975) lê
   exatamente essa trilha. Com a contagem por período (acima), a data errada
   não desloca só a coorte: desloca cada degrau, a perda e o dinheiro. O
   caminho é o do backfill da 912 — eventos escritos com a data real e
   `origin = 'retroativo'` (o CHECK aceita). Hoje há **1** evento retroativo
   na conta. **Três armadilhas que o plano de 14/09 não nomeava:**
   - **`to_pipeline_id` é obrigatório em TODO evento**, inclusive no
     `stage_changed` — e o CHECK `cb_lead_events_shape` **não o cobra**. A RPC
     acha o negócio por `to_pipeline_id = <funil>` e o trajeto filtra por ele
     (`trajetoria.ts:290`). Sem essa coluna a linha entra no banco, aparece na
     ficha do contato e **o funil não conta nenhuma**, sem erro em lugar nenhum.
   - **`reconstructed = true`** é o ÚNICO campo que tira o evento do fio da
     conversa (`apareceNaConversa`, `describe.ts:68`). `origin='retroativo'`
     só troca o autor exibido. Sem a marca, as 27.610 mudanças caem
     intercaladas nas conversas de WhatsApp dos 751 contatos que já têm
     conversa aqui. A semente da própria 912 grava `true`.
   - **`deals.created_at`** é uma segunda fonte de data, fora da trilha: a aba
     LISTA recorta o período por ela (`lista.ts:131-137`), e `perdidoDesde`
     cai nela quando falta o passo de perda. Com o `DEFAULT now()`, os 12.614
     cards aparecem todos em "Este mês".
7. ⚠️⚠️ **A carga DISPARA automação — e, desde o PR #223, também INTERROMPE
   as que estão rodando.**
   - **Dispara:** `cb_enfileira_evento_de_funil` (933) insere em
     `cb_automation_events` a cada `INSERT` em `deals` (⚠️ **menos** quando
     `source = 'automation'`, `0933:157-159`) e a cada mudança de
     etapa/status (aqui **sem** saída). O laço rápido do agendador drena a
     cada **15 s**, em lotes de **50** — 200 eventos/min, FIFO global e sem
     rodízio por conta. Despejar ~13 mil eventos leva ≥65 min: a primeira hora
     dispara de verdade, o resto é descartado por idade (`IDADE_MAXIMA_MS`,
     60 min) — **e os eventos de clientes REAIS criados na janela ficam atrás
     na fila e vencem junto**, com `erro = 'evento atrasado Nh'` como único
     rastro. Isso torna "deixar o agendador drenar" inviável, não lento.
   - **Interrompe:** o dreno chama `cancelarEsperasAoSairDaEtapa` ANTES das
     guardas de ciclo e de idade, e ela busca as execuções vivas **por
     CONTATO** — um card novo de um contato com sequência rodando a mata. E
     `cardSaiuDaEtapa` **ignora `processado_em`**: marcar como processado
     silencia o disparo, não a interrupção. A carga não pode deixar linha
     nenhuma em `cb_automation_events` — tem de **apagar**, não marcar.
   - **Escopo de conexão não é defesa:** `channelInScope` falha ABERTA com
     canal nulo, e todo evento da carga nasce sem canal.
   - Estado em 19/09: **as 8 automações da conta estão desligadas** (ver
     acima), nenhuma automação de etapa tem `parar_ao_sair`, e a fila de
     esperas está vazia. Vale medir de novo na véspera: a caixa
     `parar_ao_sair` nasce MARCADA nas automações de etapa criadas pela grade
     do funil, e a recuperação de No Show (dez esperas por cliente) é
     exatamente o que enche `automation_pending_executions`.
8. ⚠️ **Nome fixado e e-mail espelhado.** A carga é um escritor de
   `contacts.name`, e **nenhum pino a alcança**: `nome-fixado.chamadores.test.ts`
   e `dono-duravel.test.ts` varrem só `src/`. Concretamente: ela confere
   `nome_fixado_em IS NULL` por conta própria (29 contatos hoje), passa todo
   nome por `nomeParaFixar` (que recusa valor que é só número) e decide se
   grava a marca. E escrever `contacts.email` aciona o espelho da 1000 — é o
   comportamento desejado; o mapa de campos tem de **excluir explicitamente**
   o campo com `espelho = 'contacts.email'`, senão a escrita do campo
   sobrescreve a coluna. A aparagem da 1001 já cuida dos dois lados.
9. **Há outros escritores de ficha ao vivo, e parar o agendador NÃO fecha a
   janela.** Ele cobre Asaas, agendadas, Radar, Meta Ads e tl;dv; não cobre a
   ingestão da Evolution nem o webhook da Meta (dirigidos pelo provedor, não
   dá para pausar sem perder mensagem), nem o Calendly, nem os webhooks de
   entrada, nem os três caminhos de gente. A carga precisa ser
   **reexecutável** (idempotente pelo id da Kommo) e rodar de novo no dia do
   corte — o cadastro dos dois lados muda ~30 leads por dia.
10. ⚠️⚠️ **NOVA — não existe onde carimbar o id da Kommo, e `cb_lead_events`
    não tem chave única nenhuma.** `contacts` e `deals` não têm coluna de id
    externo, e `deals.source` é CHECK fechado em `manual|automation|channel`.
    Sem resolver isso a carga não pode ser reexecutada: a segunda passada
    duplica negócio e evento, sem erro. Decisão 16.
11. ⚠️⚠️ **NOVA — o QUADRO do funil não pagina.** `pipelines/page.tsx` busca
    os negócios com `.select().eq('pipeline_id', …).order('created_at')` —
    sem `range`, sem `limit`, sem `count`. O PostgREST corta em 1.000 linhas
    **sem avisar**: com 8.381 leads no Trabalhista, o quadro passa a mostrar
    os 1.000 mais recentes e as colunas contam errado, em silêncio. A lista
    de conversas do inbox tem o mesmo defeito (`conversation-list.tsx`, a
    consulta de `conversations`), e é ele que mata a opção "criar conversa
    vazia" da decisão 3. **São dois consertos de código a fazer ANTES da
    carga**, não decisões.
12. ⚠️ **NOVA — depois da carga, o de‑para vira mão única.** A tela de Funis
    recusa apagar etapa que tenha `degrau` preenchido e qualquer evento
    apontando para ela; apagar etapa também tira o `stage_id` do escopo das
    automações, em silêncio. Com 27.610 eventos distribuídos pelas 28 etapas,
    reorganizar os funis deixa de ser barato. O desenho tem de estar fechado
    ANTES. (Correção ao que este plano dizia: mapear o `degrau` **depois**
    funciona — ele é lido em tempo de consulta e reclassifica a história
    inteira. O que não pode vir depois é a ESTRUTURA.)
13. ⚠️ **NOVA — a carga muda o público de "todos os contatos" do disparo**, de
    1.196 para ~12.900. É o precedente do Asaas, que etiquetou as 262 fichas
    dele justamente para poder excluí-las. Decisão 21.
14. ⚠️ **NOVA — a régua de "o mesmo contato" do projeto mudou em 12/09.**
    `findExistingContact` casa pelos ÚLTIMOS 8 DÍGITOS — medido:
    `5583988745316` e `5511988745316` casam entre si. Desde a integração do
    Asaas a doutrina escrita é outra: sufixo de 8 **sugere**, o vínculo é
    `mesmoNumero` (o número ou a irmã do nono dígito), e o que não bate vai
    para uma lista "para confirmar". A carga usa o sufixo como pré-filtro
    barato e `mesmoNumero` como régua, colhendo TODOS os candidatos numa
    consulta ordenada (o retorno de `findExistingContact` não é determinístico
    com mais de um). Decisão 22.

## Entradas e saídas da Kommo

Medido com `entradas.mjs` em 14/09. ⚠️ É o que precisa ser religado ao CB CRM
ANTES de a Kommo sair do ar — senão lead para de chegar, ou conversão para de
ser contada, sem erro em lugar nenhum.

- **Fontes (`/sources`): nenhuma.** Os 241 leads da semana entram pela API,
  por integração externa (`created_by = 0`); a Kommo não diz qual. Pelas
  etiquetas são formulário (137) e Typebot (38). **Descobrir com quem mantém
  o n8n e o Typebot** para onde eles escrevem hoje — é a primeira porta a
  apontar para os webhooks de entrada do CB CRM (982).
- **Widgets ativos:** `amocrm_whatsapp` (o WhatsApp da própria Kommo) e
  `gotoconnect` (telefonia). A integração de WhatsApp da Kommo segue ligada:
  conferir qual número ela ainda atende — o 5199‑8229 da API oficial foi
  conectado ao CB CRM em 10/09 com a previsão de sair da Kommo.
- ⚠️⚠️ **Webhooks de SAÍDA ativos: 5, todos em `status_lead`** (a cada mudança
  de etapa):
  - 4 para um n8n em `editor.trafegoedu.com.br` (fluxos
    `cbadvogados-n8n-kommo-arven_*`), da agência de tráfego;
  - 1 para uma função de outro projeto Supabase
    (`…supabase.co/functions/v1/track-webhook`), dono a confirmar.
  Pelo nome e pelo evento, são **rastreamento de conversão** (etapa do funil
  → plataforma de anúncio). Quando a equipe parar de mover card na Kommo,
  esses cinco param de receber — e o Meta Ads perde o sinal de conversão. O
  CB CRM tem as duas peças para substituí-los (webhooks de saída da 028 e o
  passo `send_webhook` numa automação de etapa), mas o formato que cada
  destino espera precisa ser levantado com a agência. Decisão 14.
  (Há mais 2 webhooks desativados, em `add_message`.)
- **Motivos de perda:** só os 4 genéricos de fábrica ("Orçamento
  insuficiente", "O produto não se encaixa à necessidade", "Não satisfeito com
  as condições", "Comprado do concorrente") — o que pesa na decisão 13.
- **Tarefas abertas:** 118. O CB CRM tem tarefas por cliente (944); não
  estavam no escopo original.

## Histórico de etapas na Kommo (decisão 9)

Medido com `historico.mjs` em 14/09: **a Kommo guarda o histórico inteiro**,
desde a abertura da conta.

| | |
| ---: | --- |
| 40.832 | eventos de lead (`lead_added` + `lead_status_changed`) |
| 13.222 | criações de lead (mais que os 12.614 vivos: inclui apagados) |
| 27.610 | mudanças de etapa ou de status |
| 11.510 | leads com pelo menos uma mudança |
| 06/06/2025 → 14/09/2026 | do mais antigo ao mais recente |

Cada mudança traz etapa e funil de antes e de depois, com o instante. Por mês
foram de 1.000 a 3.400 eventos, com um pico de 8.133 em setembro/2025. Ou seja:
**a decisão 9 tem a opção boa disponível** — reconstruir a trilha real em
`cb_lead_events` com `origin = 'retroativo'`, e o funil de eficiência dos
últimos 15 meses sai verdadeiro. O custo é o de‑para de etapa valer também
para as etapas por onde o lead PASSOU, não só para a atual.

⚠️ A varredura leva ~12 min a 5 req/s e passa do teto de 400 páginas do
`api.mjs`: `historico.mjs --continuar` retoma de onde parou.

## O teste de esforço de 20/09/2026

Com as decisões fechadas e antes de escrever uma linha da carga, o conjunto foi
submetido a seis lentes lendo o código real — trilha e funil, gatilhos e fila,
contatos e conversas, campos personalizados, escala, e integrações vivas — cada
achado refutado por um segundo leitor que tentou derrubá-lo no arquivo.

**60 achados sobreviveram, 58 confirmados linha a linha. 8 escreveriam dado
errado em produção.** O que eles mudaram no plano:

| | O que se descobriu | Onde isso mudou o plano |
| --- | --- | --- |
| 1 | **A decisão 17 não é executável**: o PostgREST não tem transação de várias instruções | contrato A.1 — RPC por lote |
| 2 | **Transação única derruba o CRM** por volta da 32ª linha (estouro de subtransação) | contrato A.1 — lotes de 1.000–2.000 |
| 3 | **Os gatilhos escrevem trilha datada de hoje** com `reconstructed = false`: ela cai no fio do cliente, ancora "na etapa desde" e acende "ganhos hoje" no Meu dia | contrato A.5 — reparo por lote |
| 4 | **Falta o evento de criação**: ~1.100 leads nunca mudaram de etapa e ficariam invisíveis nas três vistas do funil | contrato C.12 |
| 5 | **Telefone com separadores faz a ingestão DESCARTAR a mensagem do cliente**, para sempre e em silêncio | contrato D.18 |
| 6 | **Os 4 telefones ambíguos tornam a resolução de contato não-determinística** — a mensagem pode ir para a ficha errada, e alternar | conserto de código 3 |
| 7 | **O Kanban renderiza os 8.400 cards de uma vez** — o #227 consertou o dado, não o render | conserto de código 1 |
| 8 | **O disparo "todos os contatos" corta em 1.000** — e a exclusão pela etiqueta `kommo`, que era a rede da decisão 21, corta junto | conserto de código 2 |

**Três correções factuais ao próprio plano**, que estavam mentindo:

- O CRM tem **54** contatos com e-mail, não 1 nem zero — são os do Calendly e do
  Asaas, os mais recentes da base. O e-mail da Kommo não pode sobrescrevê-los.
- A tabela de campos personalizados das linhas 220-236 é **levantamento
  superado**, não instrução. A fonte de verdade do que migra é o de-para. Lida
  como instrução, ela mandaria a carga sobrescrever os **106 valores vivos** de
  `Data e Hora Reunião` e `Link Reunião`, que são do Calendly.
- A conferência que existia para pegar a trilha escrita pelos gatilhos
  procurava evento **anterior** ao dia da carga — e as linhas dos gatilhos são
  de hoje. Ela passava verde exatamente sobre o defeito que existia para pegar.

**Duas coisas que a carga não controla e o operador precisa saber:**

- **O roteador de funil está VIVO em 5 das 7 conexões.** Os cards que a carga
  NÃO criar ganham card automaticamente na primeira mensagem trocada — inclusive
  os leads que o operador decidiu deixar só como histórico. Zerar
  `default_pipeline_id` durante a janela é barato e sem perda (o roteador
  dispara por ESTADO, não por evento).
- **A automação do Calendly, a única ligada, passa a TRANSFERIR card entre
  funis.** O passo 5 vê que já existe card em qualquer funil e desiste; o passo
  6 move esse card para Bancário - Comercial › Reunião Agendada — arrancando do
  Trabalhista o card de um cliente que agendou uma reunião. Hoje o risco é
  quase nulo (quase todos os 976 cards já são do Bancário); depois da carga, a
  maioria dos 12.687 está fora do Bancário. Ela tem de ser desligada na janela,
  e o comportamento do passo 6 decidido por escrito antes de religar.


## Contrato de carga

Levantado em 19/09 lendo o código e **reescrito em 20/09** depois do teste de
esforço (seção anterior). Cada regra falha em SILÊNCIO se for ignorada —
nenhuma delas dá erro.

### A. A mecânica da escrita

⚠️⚠️ **1. A carga escreve POR LOTE, por uma função no banco
(`SECURITY DEFINER`) — nunca por INSERT solto do PostgREST, nunca numa
transação única.** As duas formas óbvias estão erradas, em direções opostas:

- **INSERT solto pelo supabase-js**: o PostgREST não tem transação de várias
  instruções. Inserir os cards numa requisição e apagar `cb_automation_events`
  noutra são duas transações, com uma janela real entre os commits em que o
  agendador (que drena a cada 15 s) enxerga e reivindica os eventos. A
  atomicidade que a decisão 17 promete **não existe** por esse caminho.
- **Uma transação única para tudo**: por volta da **32ª linha** de `deals` o
  Postgres estoura o cache de subtransações, e a
  partir daí toda leitura concorrente — webhook, tela, cron — paga uma consulta
  de SLRU por tupla. A carga leva minutos a dezenas de minutos nesse estado, e
  o CRM inteiro fica progressivamente mais lento, sem erro e sem log.

A forma que resolve as duas: **uma chamada de RPC por lote de 1.000 a 2.000
cards**, e dentro de cada chamada, na mesma transação curta: inserir o lote →
reparar os eventos que os gatilhos escreveram → apagar as linhas de
`cb_automation_events` daquele lote. Cada commit zera a contagem de
subtransações.

⚠️⚠️ **A frase "nunca `ALTER TABLE ... DISABLE TRIGGER`" que estava aqui foi
RETIRADA em 21/09** (achado do Codex no PR #232): ela contradiz a tabela de
saídas medidas da regra 5, onde desligar gatilho é a única opção que dispensa
o reparo E mata o estouro de subtransação. **A escolha entre reparar e
desligar é decisão de projeto da 1013** — as duas metades deste plano têm de
dizer a mesma coisa, e até a 1013 existir a decisão está ABERTA. O que o lote
por RPC resolve continua valendo de qualquer jeito: transação curta, commit
frequente.

⚠️⚠️ **2. Todo recorte de reparo e de limpeza é POR ID, nunca por janela de
tempo.** `deal_id = ANY(<ids do lote>)` (ou `contact_id = ANY(...)`). O recorte
por `criado_em >= now()` que a versão anterior deste contrato mandava usar é
mais largo que a carga: um agendamento do Calendly que chegue na janela tem o
`deal_stage_changed` dele apagado junto. Hoje isso não deixa de disparar nada
(as automações de etapa estão desligadas), mas a mesma tabela é o que
`cardSaiuDaEtapa` consulta para responder "o card saiu da etapa?" — e o
operador vai religar as automações depois da carga.

⚠️⚠️ **3. A idempotência é GARANTIDA PELO BANCO, não conferida pelo script.**
`deals.kommo_lead_id` com índice único parcial, criado ANTES da carga. Sem
ele, a pergunta "já migrei este lead?" vira uma varredura completa por card
(12.611) sobre uma tabela de ~62.000 linhas, e quem pular a pergunta duplica
28.316 eventos em silêncio. O id do CONTATO continua no campo personalizado (decisão 16) —
**mas ele responde por contato, não por lead**, e por isso não serve de chave
de reexecução para `deals`.

⚠️ **4. São SEIS gatilhos em `deals`, mas só QUATRO abrem subtransação — e
por OPERAÇÃO são DOIS.** Conferido no catálogo em 21/09 (`prosrc` com bloco
`EXCEPTION`): `cb_deals_log_event`, `cb_deals_log_event_update`,
`cb_deals_enfileira_evento` e `cb_deals_enfileira_evento_update` abrem;
`set_updated_at` e `cb_deals_aplica_resultado_trigger` não. Um INSERT dispara
dois dos que abrem; um UPDATE, os outros dois. Com o cache de 64 subxids, o
estouro é por volta da **32ª linha** do lote, não da 64ª — uma versão anterior
desta seção dizia "cada gatilho abre a sua" e contava seis. Os seis são: `set_updated_at` (0001),
`cb_deals_log_event` e `..._update` (912), `cb_deals_enfileira_evento` e
`..._update` (933) e `cb_deals_aplica_resultado_trigger` (**BEFORE** INSERT OR
UPDATE OF stage_id, 950). O último reescreve `NEW.status` a partir do
`resultado` da etapa e **vence** o status que a carga mandar.

⚠️ **5. Os gatilhos escrevem trilha PRÓPRIA, datada de hoje e com
`reconstructed = false`** — e é ela que aparece no fio do cliente, que ancora
"na etapa desde" (a ordenação PADRÃO da Lista) e que acende "ganhos hoje" no
Meu dia. Cada lote tem de **reparar** o que os seus gatilhos escreveram, na
mesma transação:

⚠️⚠️ **E o reparo tem de alcançar SÓ o que ESTA transação escreveu.** A
primeira versão desta regra filtrava por `deal_id = ANY(<ids do lote>) AND
origin = 'sistema'`, e isso é o histórico INTEIRO daquele card, não as linhas
do lote. Os 1.150 que já existem aqui não nascem na carga: eles são
**movidos** (decisão 11), e já têm trilha nossa — criada pelo roteador, pelas
automações, pelo carimbo da 950. Medido em produção em 20/09: o filtro por
`deal_id` pegaria **9** eventos antigos e o de etiqueta, **311** — as 320
linhas seriam datadas com a data da Kommo e marcadas `reconstructed = true`,
que é a ÚNICA porta de saída do fio do cliente (`apareceNaConversa`). Ou seja:
apagaria do histórico de conversa 311 etiquetas reais e reescreveria a data de
9 movimentos que aconteceram aqui. (Achado do Codex no PR #232.)

⚠️⚠️ **E o `xmin` NÃO serve — medido, e é a lição desta seção.** A primeira
correção deste achado usava
`WHERE xmin = pg_current_xact_id()::xid`, com um teste que parecia provar a
coisa: numa transação de rollback, o recorte casava as 3 linhas que a própria
transação tinha inserido e zero linhas antigas. **O teste estava errado porque
inseria as linhas À MÃO.** Com o INSERT de verdade em `deals` — deixando os
gatilhos escreverem — o mesmo recorte devolve **ZERO**:

```
eventos do card por deal_id : 1
eventos do card por xmin    : 0
xmin da linha do gatilho    : 368534
pg_current_xact_id()::xid   : 368532
```

O motivo é o que este plano já dizia noutro parágrafo, sem que a ligação
fosse feita: **cada gatilho abre uma SUBTRANSAÇÃO** (o `cb_deals_log_event`
tem bloco de exceção — a política de falha assimétrica da 912). A linha
escrita lá dentro recebe o **subxid**, e `pg_current_xact_id()` devolve o id
do TOPO. Eles nunca são iguais. Um reparo por `xmin` não repararia nada, e a
carga sairia com a trilha inteira datada de hoje e `reconstructed = false` —
o defeito original, agora silencioso.

**As três saídas que sobram, todas MEDIDAS em 21/09 contra a produção (com
rollback):**

| Saída | Isola? | Repara? | Subtransações | FK de pé | Lock | Afeta outras sessões |
| --- | --- | --- | --- | --- | --- | --- |
| `xmin` do topo | **não funciona** | — | — | — | — | — |
| **anti-join de ids** — guardar os ids que já existiam para os cards do lote e reparar o resto | sim | sim | sim (6 por linha) | sim | não | não |
| **piso de tempo** — `occurred_at >= clock_timestamp()` do início do lote | sim | sim | sim | sim | não | não |
| **`ALTER TABLE deals DISABLE TRIGGER USER`** ← **ESCOLHIDA** | n/a | **não** | **não** | sim | `ShareRowExclusive` (leitor não espera) | só ENQUANTO o lote dura, e é transacional |
| **`SET LOCAL session_replication_role = 'replica'`** | n/a | **não** | **não** | **NÃO** | não | não |

Medidos lado a lado no mesmo lote (um card novo + um card movido que já tinha
1 linha de trilha): anti-join e piso de tempo acharam as mesmas **3** linhas a
reparar e contaminaram **0** antigas. Os dois resolvem o P1 — o do HISTÓRICO.

⚠️⚠️ **Mas nenhum dos dois isola de ESCRITOR CONCORRENTE, e a coluna "isola"
da tabela acima diz respeito só ao histórico** (achado do Codex no PR #232).
Nem o anti-join nem o piso de tempo identificam a transação que escreveu: um
operador que aplique uma etiqueta a um contato do lote DEPOIS da foto de ids
(ou depois do piso) cria um evento que as duas cercas englobam — e o reparo o
data com a data da Kommo e o marca `reconstructed = true`, que é o mesmo dano
do P1, agora vindo da janela em vez do passado. Com o CRM vivo durante a
carga, isso não é hipótese: são 265 contatos com evento de etiqueta hoje.
Quem escolher reparar tem de fechar isso — por marca de lote gravada pelo
próprio gatilho, ou quiesceendo a escrita concorrente. Quem escolher desligar
o gatilho não tem o problema.

⚠️ `session_replication_role = 'replica'` silencia os SEIS gatilhos de uma vez
(0 eventos, 0 linhas de fila, e o `status` fica `open` — o carimbo da 950
também para) **sem lock e sem afetar quem está usando o CRM**. O preço é caro
e foi medido: **as FKs também param** — um INSERT com `stage_id` inexistente
NÃO foi barrado. Numa carga de 12.611 linhas isso troca uma violação que o
banco pegaria na hora por cards apontando para nada.

⚠️ Desligar os gatilhos é a única saída que também mata o **estouro de
subtransação** (dois por linha) e dispensa apagar `cb_automation_events` — os
três problemas de uma vez. `DISABLE TRIGGER USER` preserva as FKs, ao
contrário do modo replica; em troca vale para TODAS as sessões enquanto durar,
o que numa janela de carga controlada (conexões sem funil padrão, Calendly
desligado) é aceitável, e até desejável.

**DECIDIDO em 21/09, e o número é 1014 — não 1013** (a outra sessão aplicou
`1013_cb_cancelamento_do_calendly` em produção às 01:39Z enquanto isto era
escrito; conferir `ls` E o histórico IMEDIATAMENTE antes de criar o arquivo,
porque já divergiram sete vezes).

⚠️⚠️ **A saída é a (c): `ALTER TABLE deals DISABLE TRIGGER USER` DENTRO da
transação de cada lote** — e o que a escolheu foi uma medição que derruba a
objeção óbvia e um argumento que nenhuma das outras saídas resolve:

1. **É DDL TRANSACIONAL — rollback religa sozinho.** Era esta a objeção:
   "se a carga morrer entre o DISABLE e o ENABLE, o CRM fica sem os 16
   gatilhos, em silêncio". MEDIDO em 21/09 contra a produção: um bloco que
   desliga os 6 gatilhos de `deals` e termina em `RAISE` deixa os **sete**
   (contando `contact_tags`) de volta em `ligado`. Não existe estado
   "desligado e esquecido" se o DISABLE estiver dentro do lote.
2. ⚠️⚠️ **É a ÚNICA saída em que a regra 8 do contrato é alcançável.**
   `set_updated_at` é `BEFORE UPDATE` **sem lista de colunas** e faz
   `NEW.updated_at = now()` em qualquer escrita. MEDIDO: pedindo
   `2024-03-15`, com o gatilho ligado a coluna ficou `2026-09-21 02:06`; com
   ele desligado, ficou `2024-03-15` exato. Ou seja: **com os gatilhos
   ligados, os ~1.150 cards MOVIDOS não têm como receber a data da Kommo** —
   e o cabeçalho do Kanban conta "ganhos/perdidos este mês" por `updated_at`.
   Nenhuma das duas saídas de reparo toca nisso: elas mexem em
   `cb_lead_events`, não em `deals`. (Achado do painel de projeto.)
3. **A trava é `ShareRowExclusiveLock`, não `ACCESS EXCLUSIVE`** — MEDIDO.
   Leitor concorrente **não espera**; escritor de `deals` espera o lote
   terminar. Com lotes curtos isso é uma pausa, não uma perda: o CRM
   enfileira e escreve depois, com trilha e fila normais. É muito melhor que
   a alternativa de "os gatilhos não rodaram para ele", que seria silenciosa.
4. **As FKs continuam de pé**: os gatilhos de integridade são INTERNOS e
   `DISABLE TRIGGER USER` não os toca — ao contrário do modo replica.
5. Some o reparo (e com ele o furo de concorrência do P1 do Codex), some o
   estouro de subtransação e some a limpeza de `cb_automation_events`.

**O preço, escrito:** a carga passa a dever escrever à mão o que os gatilhos
faziam — o `status` a partir do `resultado` da etapa (o que a 950 fazia), o
`updated_at`, e a trilha retroativa. É exatamente o que se quer: escrita certa
de primeira, em vez de escrita errada e depois remendada.

⚠️ **Sobre a (d), `session_replication_role = 'replica'`: FICA FORA, e há uma
contradição de medição registrada de propósito.** Eu medi duas vezes contra a
produção que o `SET` funciona (pela Management API, como `postgres`, inclusive
numa função `SECURITY DEFINER` chamada com `SET ROLE service_role`). O painel
mediu o catálogo e achou o oposto: `postgres` tem `rolsuper = false`,
`pg_parameter_acl` está vazia e
`has_parameter_privilege('postgres','session_replication_role','SET')`
responde **false** (conferido por mim: é verdade). As duas medições são reais;
o que nenhuma das duas cobriu é o caminho de PRODUÇÃO — PostgREST entrando
como `authenticator` e assumindo `service_role`. Como a (d) foi recusada por
mérito (derruba as FKs e silencia TODO gatilho da sessão, o espelho de e-mail
da 1000/1001 inclusive), a contradição fica anotada e não precisa ser
resolvida. Quem quiser ressuscitá-la resolve primeiro.

O que está fechado de qualquer forma é o que NÃO se usa: `xmin`.

Se o caminho for REPARAR (as duas primeiras linhas da tabela), o `tag_added`
do gatilho da 912 grava `deal_id` NULO e é alcançado por
`contact_id = ANY(...)` com a MESMA cerca escolhida — e **sem** o
`origin <> 'usuario'` da versão antiga, que era uma tentativa de adivinhar o
que a transação tinha escrito e deixava passar as 311 linhas medidas acima.

**6. UM INSERT por negócio, já no estado FINAL.** Nenhum `UPDATE` de
`pipeline_id`/`stage_id`/`status` depois. A decisão 11 (a etapa da Kommo move o
card dos 1.150 que já existem aqui) é um UPDATE por definição e entra na mesma
função de lote, com o mesmo reparo da regra 5.

### B. `deals`

7. `account_id`; **`user_id = accounts.owner_user_id`**, resolvido uma vez no
   início e **sem queda** (`if (!dono) throw`) — nunca o login de quem roda:
   `contacts.user_id`, `conversations.user_id` e `custom_fields.user_id`
   cascateiam de `auth.users`, e apagar aquele login FORA do app (o passo
   normal de offboarding) levaria os 12.980 contatos, as conversas e todas as
   mensagens junto. `assigned_to` fica NULO (decisão 12).
8. **`created_at` = a data real da Kommo**, sempre — a coluna é anulável com
   default e aceita valor explícito. E `updated_at` também: o cabeçalho do
   Kanban conta "ganhos/perdidos este mês" por `updated_at ?? created_at`.
9. `source = 'manual'`. `'channel'` ativaria o índice único parcial da 911 e
   falharia com 23505 nos contatos que já têm card; `'automation'` escaparia da
   fila da 933 no INSERT mas gravaria procedência falsa na trilha.
⚠️⚠️ **9b. A etapa de ORIGEM é `(pipeline_id, status_id)`, NUNCA `status_id`
    sozinho.** Na Kommo, **142 (ganho) e 143 (perdido) são status GLOBAIS**:
    existem em TODOS os seis funis, com o mesmo id. Um mapa chaveado só pelo
    status guarda o ÚLTIMO funil que o definiu e manda **o lead perdido do
    Bancário para o funil do Trabalhista** — sem erro, sem log, com o card
    pousando numa etapa que existe. Medido em 21/09:

    | status | funil da Kommo | leads | vai para |
    | ---: | --- | ---: | --- |
    | 142 | Trabalhista | 171 | Trabalhista ‑ Comercial › Protocolado |
    | 143 | Pré Vendas (SDR) | 2.924 | Bancário ‑ Comercial › Perdido |
    | 143 | Trabalhista | 2.719 | Trabalhista ‑ Comercial › Perdido |
    | 143 | Closer | 57 | Bancário ‑ Comercial › Perdido |
    | 143 | Onboarding | 1 | Bancário ‑ Comercial › Perdido |

    Fecha a conta: 6.844 em etapa própria + 171 + 5.701 = **12.716**, os leads
    vivos. É a mesma repartição que o de‑para já descrevia — o risco não está
    na decisão, está na IMPLEMENTAÇÃO. O bug já foi cometido uma vez, no
    script que escolheu os leads do piloto, e só apareceu porque as contagens
    por funil foram conferidas contra o de‑para.

10. O par `(stage_id, pipeline_id)` conferido no script — a FK é COMPOSTA e
    devolve 23503 cru.
    ⚠️ **`pipeline_stages` NÃO tem `account_id`** (conferido no catálogo em
    21/09; `pipelines` tem). Guarda escrita como `s.account_id = p_account_id`
    morre em **42703**, e o recorte por conta tem de passar por `pipelines`.
    (P0 do painel de projeto.)
11. `currency` pode ficar no default: o app formata em BRL e não lê a coluna.

### C. `cb_lead_events`

⚠️⚠️ **12. Um `deal_created` retroativo por card, SEMPRE** — e não só um evento
por mudança de etapa, como dizia a versão anterior. A RPC do funil só enxerga
negócio que tenha ao menos um evento, e **~1.100 leads nunca mudaram de etapa
na Kommo**: sem o evento de criação eles ficam invisíveis na Lista, no
Desempenho e na Saúde, aparecendo só no Kanban. E, para todos os outros, a
entrada no funil passaria a ser datada pelo PRIMEIRO MOVIMENTO em vez da
criação, inflando a transição lead→MQL para perto de 100% nos 15 meses
históricos. O evento leva `occurred_at` = a criação real, `to_stage_id` = a
etapa inicial (o campo `from` do 1º `lead_status_changed`; sem movimento, a
etapa atual) e `to_pipeline_id` = o funil daquela etapa.

13. Toda linha leva `account_id`, `deal_id`, **`contact_id`** (é por ele que a
    ficha lê a trilha), `occurred_at` explícito, `origin = 'retroativo'`,
    **`reconstructed = true`**, **`to_pipeline_id`** e `to_stage_id`, mais os
    rótulos e a posição da etapa.
    ⚠️ O CHECK de forma aceita `stage_changed` **sem** `to_pipeline_id`. Se a
    carga esquecer essa coluna, os 28.316 eventos passam no banco e ficam
    **invisíveis para o funil inteiro**, em silêncio — a ficha do contato
    continua mostrando a história completa, e as duas telas discordam sem nada
    ligando uma à outra.
⚠️ **14. Movimento entre FUNIS é `pipeline_changed`, nunca `stage_changed`.**
    Vale para os 240 do CONTATO SEG. TRAB e para os 183 do Onboarding
    bancário. É o único tipo que `direcaoDoMovimento` recusa ler como
    "avanço"/"retorno" — escrito como `stage_changed`, a ficha compara a
    posição de uma etapa do funil comercial com a de outra do jurídico, que são
    réguas distintas, e afirma uma direção que não existe. É também o que o
    gatilho real grava. Leva `from_pipeline_id`/`to_pipeline_id`,
    `from_stage_id`/`to_stage_id`, as duas posições e os rótulos.
15. Ganho e perda da Kommo viram movimento para uma etapa com `degrau` —
    `status_changed` não é lido pelo funil.
16. **Desempate de ordem:** a Kommo carimba em segundos e a RPC ordena por
    `(occurred_at, id)`; dois movimentos do mesmo lead no mesmo segundo saem em
    ordem sorteada. A carga desempata com microssegundos incrementais na ordem
    em que a Kommo devolveu.
17. **Os 298 leads extras: 222 ganham card fechado, 76 se fundem.** Todo
    evento precisa de um `deal_id` que EXISTA; sem FK, um id inventado entra no
    banco mas a trajetória some das três vistas do funil, e pendurar todos no
    card sobrevivente faz o funil contar um contrato que não tem card. A régua
    fechada em 20/09 (seção 6b do de-para): **lead com desfecho é caso distinto
    e ganha card próprio** (123 ganhos + 71 perdidos + 28 que fecham ao pousar
    numa etapa com `resultado`); **lead ainda aberto é entrada duplicada da
    mesma jornada e a trajetória dele se funde no sobrevivente** (76). Total de
    cards: **12.611**.
    ⚠️ Fundir é seguro porque o alcance é monotônico — a trajetória fundida
    acrescenta ao sobrevivente os degraus por onde aquela pessoa passou, o que
    é verdade sobre a pessoa. O caso que estragaria (um extra que alcançou
    `contrato` fundido num card aberto) não existe: os 26 extras abertos em
    "Protocolado" pousam numa etapa com `resultado = ganho` e estão entre os 28
    que ganham card próprio.
    ⚠️⚠️ **A idempotência dos eventos fundidos vem do CARD.** Os 76 não têm
    `deals.kommo_lead_id` porque não têm card, e `cb_lead_events` não tem
    restrição única — reexecutar duplicaria os eventos deles em silêncio. A
    regra: **se o card sobrevivente já existe, o grupo inteiro é pulado,
    eventos fundidos inclusive.** A procedência de cada lead fundido continua
    legível em `cb_lead_events.details->>'kommo_lead_id'`.


### D. Contato, etiqueta, campo

⚠️⚠️ **18. `contacts.phone` é SÓ DÍGITOS COM DDI**, exatamente o que
`digitosDoTelefone` produz — nunca o texto da Kommo. Gravado com separadores
(`+55 83 98874-5316`), a ficha entra no banco normalmente e **a primeira
mensagem daquele cliente é descartada em silêncio, e todas as seguintes, para
sempre**: a busca por telefone não acha a ficha, o INSERT leva 23505 do índice
único, a recuperação falha pelo mesmo motivo, e a ingestão desiste sem gravar.
O WhatsApp já respondeu 200 — não há retentativa. Vale para os dois
transportes, para o Calendly e para o Asaas. Conferência de pré-voo sobre o
conjunto a inserir e de pós-voo sobre a tabela.

⚠️⚠️ **18b. Lead SEM telefone aproveitável NÃO vira card — e nunca vira card
ÓRFÃO.** Medido em 21/09: são **32 leads** (0,25%): 16 sem contato nenhum e 16
cujo contato não tem telefone com 10+ dígitos. Sem pessoa não há `contacts`
(o CHECK da 989 exige telefone OU Instagram), e sem contato o card nasceria com
`deals.contact_id` NULO — que o Kanban **desenha em branco** e que não abre
conversa nenhuma (é a armadilha já documentada no CLAUDE.md para o roteador de
grupo). A carga PULA esses leads e emite a lista dos não migrados, com o
motivo, para o operador decidir caso a caso.

⚠️ **E a carga NÃO tenta salvar o telefone do campo NOME**, embora dê vontade:
em 8 deles o número está no nome do lead ou do contato ("83998185823",
"(51) 98060-8345", "+55 91 99190-9141"), porque quem cadastrou digitou no campo
errado. Adivinhar ali é inventar identidade — e `findExistingContact` casa
pelos ÚLTIMOS 8 DÍGITOS, então um número reconstruído errado FUNDE a ficha com
a de um cliente real, que é o dano irreversível desta migração.

⚠️ **DECIDIDO pelo operador em 21/09: os 32 ficam de fora, os dois com
desfecho inclusive.** A carga pula e lista; ninguém preenche telefone na Kommo
para recuperá-los. Consequência aceita e escrita: o funil de fechados nasce com
**dois contratos a menos** do que a Kommo mostra (um Protocolado e um Ganho), e
é por isso que a conferência de contagem do bloco E tem de somar 32 aos não
migrados em vez de exigir igualdade com a Kommo. Os dois são:
| Lead | Nome | Etapa | O que é |
| --- | --- | --- | --- |
| #27593737 | Kailane Silva Gomes | Trabalhista › Protocolado | contrato (a etapa carimba `ganho`); o contato se chama "91985184761" |
| #27963311 | Lead #27963311 | Trabalhista › Ganho | ganho; o contato se chama "Luzia" |
O conserto barato é **na Kommo, antes do corte**: preencher o telefone dos dois
contatos. Aí eles entram pela porta normal, sem exceção no código. O resto dos
32 é lixo declarado ("APAGAR" ×3, "Teste" ×3, "test4", "Autolead: Teste",
"Lead #NNNNN") e pode ser descartado sem perda.

⚠️⚠️ **18c. A PESSOA é resolvida pela régua do NONO DÍGITO, nunca por
    igualdade de `phone_normalized`.** MEDIDO em 21/09 rodando o módulo
    `src/lib/migracao/pessoas.ts` sobre os 13.046 telefones distintos da
    Kommo: **821** casam com uma ficha daqui por igualdade e **outros 336
    casam SÓ pela variante do nono dígito** — `553172090560` na Kommo é
    `5531972090560` aqui, a mesma pessoa. Uma carga que resolva por igualdade
    cria **336 fichas novas para clientes que já estão no CRM**, com o
    histórico repartido entre as duas, e o índice único não impede nada (são
    chaves diferentes).
    ⚠️ A conta fecha: **1.157 já existem** + 11.888 a criar + 1 a pular =
    13.046 — e é 1.157, não os "~1.150" que este plano estimava.
    ⚠️ Quantas se perdem depende do que se chame de "igualdade", e as duas
    contas foram medidas: comparando o telefone CRU da Kommo contra
    `phone_normalized`, **336**; normalizando por `digitosDoTelefone` e então
    comparando por igualdade, **333** (os 3 de diferença são números escritos
    sem DDI, que casam só depois do `55`). O que não muda é o total: **1.157
    já existem**. Uma primeira estimativa à mão, sem o helper da casa, dizia
    320 e "~1.150" — errava por não acrescentar o DDI. A decisão sempre foi esta; o risco é a IMPLEMENTAÇÃO —
    a mesma família do `(pipeline_id, status_id)` da regra 9b. (P0 do painel
    de projeto, remedido por mim.)

19. Casar por `mesmoNumero` sobre TODOS os candidatos do sufixo, numa consulta
    **ordenada**. Um só candidato → liga; nenhum → cria; mais de um → "para
    confirmar".
20. **Toda escrita é reexecutável**: `ON CONFLICT ... DO NOTHING` (ou
    `DO UPDATE`) e o id resolvido por SELECT em seguida, **nunca pelo
    RETURNING**, que vem vazio para quem perdeu a corrida. Em `contacts` a
    cláusula `WHERE phone_normalized <> ''` é obrigatória, porque o índice é
    parcial. A carga roda com a ingestão viva: entre apurar "estes contatos não
    têm conversa" e escrever, qualquer um deles pode mandar mensagem.
21. Etiqueta por INSERT direto em `contact_tags`, com
    `userId = accounts.owner_user_id`. **Nunca** `tag-events.ts`. ⚠️ O INSERT
    direto foge do gatilho das AUTOMAÇÕES e **não** do de AUDITORIA: são
    dezenas de milhares de linhas `tag_added` datadas de hoje, que a regra 5
    repara.
⚠️ **22. Os campos personalizados são resolvidos por `field_key`, e a carga
    ABORTA se algum faltar — nunca cria pelo nome.** As chaves de destino:
    `tamanho_da_divida`, `nome_da_campanha`, `nome_do_conjunto`,
    `nome_do_anuncio`. Criar "pelo nome da Kommo" gera campo NOVO sem colidir:
    os 3.672 valores de anúncio pousariam em chaves que ninguém lê, e
    `{{contact.origem}}` — que a ÚNICA automação ligada hoje usa no aviso ao
    advogado — continuaria vazio. Em "Tamanho da Divida" nasceria um segundo
    campo com o mesmo rótulo na ficha. Total: 6.485 valores fora de alcance,
    sem erro nenhum.
⚠️ **23. A carga escreve SOMENTE nos `field_key` de uma allowlist explícita** e
    aborta em qualquer outro destino. `Data e Hora Reunião` e `Link Reunião`
    são do Calendly — hoje com **106 valores vivos** — e não são território da
    Kommo.
⚠️ **24. O e-mail entra por UM lado só.** `contacts.email` tem espelho no banco
    (1000/1001): gravar os dois lados dá 23505 e derruba o lote. A carga grava
    `contacts.email` e deixa o gatilho criar o valor do campo.
    ⚠️ E **só onde está vazio**: são **54** e-mails no CRM hoje, os mais
    recentes e melhores da base (Calendly e Asaas), e o da Kommo tem até 15
    meses. Upsert com `EXCLUDED.email` nulo APAGARIA a ficha e a linha do campo
    espelhado.
25. **`cb_conversation_notes` leva `contact_id`**, não só `conversation_id`:
    sem ele a anotação some da ficha de `/contatos` — exatamente onde o
    advogado vai procurar o histórico — e não pode ser fixada.
26. Campo de data vai em ISO com `Z`: o cast do banco engole erro e devolve
    NULL, ou lê no fuso do servidor e erra por 3 horas, sem aviso.
⚠️ **27. Fixar o nome exige um SNAPSHOT antes e um filtro mais estrito que
    `nomeParaFixar`**, que só recusa NÚMERO. Rótulos automáticos da Kommo
    ("Lead 12345", "Contato WhatsApp") ficariam congelados para sempre, e nos
    1.150 já existentes o nome que a equipe lê hoje seria destruído sem cópia.
    O snapshot custa uma linha e torna tudo reversível — **mas não em `public`
    e não sem fechar os papéis**. ⚠️⚠️ `CREATE TABLE ... AS` em `public` nasce
    com a concessão padrão do Supabase para `anon`/`authenticated` e **sem
    RLS**: a tabela teria id e nome de TODO contato, legível do navegador, sem
    nem o recorte de conta que as outras tabelas têm. É o mesmo buraco que a
    901, a 906 e a 912 abriram e que a 931 fechou (achado do Codex no PR
    #232). A forma correta é schema próprio, fora do que o PostgREST expõe, e
    o REVOKE nas DUAS metades:

    ```sql
    CREATE SCHEMA IF NOT EXISTS migracao_kommo;
    REVOKE ALL ON SCHEMA migracao_kommo FROM PUBLIC, anon, authenticated;
    CREATE TABLE migracao_kommo.nomes_antes AS
      SELECT id, name, nome_fixado_em FROM contacts WHERE account_id = <conta>;
    REVOKE ALL ON TABLE migracao_kommo.nomes_antes FROM PUBLIC, anon, authenticated;
    ```

    Vale para TODA tabela de apoio da carga, o livro-razão de desfazer
    inclusive — ele guarda id de contato e de negócio da conta inteira. Nos 1.150, só sobrescrever quando o nome atual estiver vazio ou
    for telefone; o resto vira CSV para o operador decidir.

### E. Conferências do ensaio (fase 3) e do pós-carga (fase 6)

28. `cb_lead_events` retroativo com `to_pipeline_id` ou `to_stage_id` nulo = 0.
29. **`cb_lead_events` com `reconstructed = false`, `origin = 'sistema'` e
    `deal_id`/`contact_id` da carga = 0.** ⚠️ A versão anterior desta
    conferência procurava evento com `occurred_at` **anterior** ao dia da
    carga — e as linhas dos gatilhos são de HOJE, então ela passava verde sobre
    o defeito que existia para pegar.
30. Nº de `deal_created` retroativos = nº de cards; `min(occurred_at)` por card
    = `deals.created_at`.
31. `deals` com `created_at` **nulo** = 0 — e, para a data, a conferência é
    contra a FONTE: nenhum card importado pode ter `created_at` diferente do
    `created_at` do lead dele na Kommo.
    ⚠️ A versão anterior exigia "nenhum card com `created_at` igual ao dia da
    carga", e isso **nunca poderia dar zero**: a Kommo continua recebendo ~30
    leads por dia, e o delta final importa leads criados NAQUELE dia — que
    legitimamente têm a data do dia. A conferência acusaria migração falhada
    sobre dado correto (achado do Codex no PR #232, 2ª rodada). O que se quer
    saber é se a coluna foi ESCRITA ou se caiu no default, e só a comparação
    com a origem responde isso.
32. `cb_automation_events` da janela da carga = 0, medido por
    `count: 'exact', head: true` — **nunca** pelo retorno do DELETE, que não
    conta o que saiu.
33. Nenhum card importado sem ao menos um evento apontando para o funil dele.
34. `select count(*) from contacts where phone ~ '[^0-9+]'` = 0.
35. `contacts`, `conversations` e `custom_fields` com
    `user_id <> accounts.owner_user_id` = 0.
36. `cb_conversation_notes` com `contact_id` nulo = o mesmo de antes da carga.
37. `contact_custom_values` agrupado por `field_key`: nenhuma chave nova,
    nenhum `*_2`, e `data_e_hora_reuniao`/`link_reuniao` com os mesmos 106.
38. Abrir o Meu dia **no dia** da carga: o bloco "ganhos" zerado.
39. Consulta de colisão de sufixo de 8 dígitos: qualquer par devolvido é uma
    ficha que o WhatsApp vai resolver por sorteio.
40. Taxa acima de 100% no modo por período é razão de fluxo e está CERTA —
    não "consertar".

## Decisões — 23 das 27 fechadas

As 27 (a antiga 10 foi reescrita como 17) estão fechadas, menos as do bloco C,
que dependem da data do corte. **O mapa da carga é
`docs/PLANO-migracao-kommo-de-para.md`** — é lá que estão as tabelas por etapa,
as contagens e as regras. Esta seção é o índice.

### ✅ Fechadas pelo operador em 19–20/09/2026

**Estrutura e funil (bloco A)**

- **1 e 19 — o de‑para das 70 etapas e o desenho FINAL dos funis.** 28 etapas
  hoje → **34**: criar 4 no Trabalhista ‑ Comercial (Ag. Demissão, Pediu
  Demissão, Foi Demitido, Perdido) e 2 no Trabalhista ‑ Jurídico (Pendente
  Documento, Em Elaboração). Bancário ‑ Comercial e ‑ Jurídico não ganham etapa
  nenhuma; o Comercial ganha os 11 `degrau` e um `resultado = perdido` em
  "Desqualificado", que hoje está nulo. Os 240 leads da etiqueta CONTATO SEG.
  TRAB — 234 deles contratos protocolados — vão para Trabalhista ‑ Jurídico ›
  Contato de Emergência, menos os 2 em descarte.
- **18 — ganho e perdido pousam em ETAPA**, com `degrau` e `resultado`. Os 171
  "Ganho" do Trabalhista vão para Protocolado; os 2.719 em descarte, para a
  nova "Perdido".
- **9 — histórico real**: um evento por mudança de etapa (28.316),
  `origin='retroativo'`, `reconstructed=true`.
- **11 — a etapa da Kommo MOVE o card** dos que já existem aqui (1.150 dos
  1.209 contatos daqui recebem dado).
- **16 — o id da Kommo vira CAMPO PERSONALIZADO** de contato, num bloco próprio
  "Migração" (`kommo_contact_id`, já criado em produção).
  ⚠️⚠️ **Campo personalizado só existe em CONTATO, e ele NÃO é a chave de
  reexecução.** Uma pessoa pode ter mais de um card, então o id do contato não
  responde "já migrei este LEAD?". Quem responde é **`deals.kommo_lead_id`**,
  com o índice único parcial `(account_id, kommo_lead_id)` da **migration
  1012**, já aplicada (histórico `20260921003408`). O
  `cb_lead_events.details->>'kommo_lead_id'` continua sendo gravado, mas só
  como **procedência** na trilha — nunca como chave.
  ⚠️ A versão anterior desta linha aceitava "sem índice único, a idempotência
  fica por conta do script". O teste de esforço mediu o preço e a decisão caiu:
  sem a coluna, a pergunta vira uma varredura completa por card (12.611) sobre
  uma tabela de ~62.000 linhas, e quem pular a pergunta duplica 28.316 eventos
  em silêncio.
  Quem implementar a carga seguindo o texto antigo reintroduz as duas coisas —
  ver a regra A.3 do contrato. (Achado do Codex no PR #232.)
- **17 — apagar as linhas de `cb_automation_events` na mesma transação**, com
  `deals.source = 'manual'`. Mantém a trilha (912), o carimbo de resultado
  (950) e as FKs de pé.

**A REGRA DO CARD — fechada em 20/09, e é a que conserta o defeito da Kommo**

- **Um card por PESSOA e por ÁREA** (Trabalhista × Bancário): **12.389 cards**,
  2 pessoas com dois, e **298 leads extras** que NÃO viram card por esta regra.
  Sobrevive o lead mais recente entre os ABERTOS; não havendo aberto, o mais
  recente de todos.
  ⚠️⚠️ **Os 298 extras não viram todos "só histórico" — essa foi a versão
  RECUSADA.** A régua fechada em 20/09 (seção 6b do de-para, contrato C.17)
  reparte: **lead com desfecho é caso distinto e ganha card próprio, fechado**
  (123 ganhos + 71 perdidos + 28 que fecham ao pousar numa etapa com
  `resultado` = 222); **só o lead ainda ABERTO de verdade** (76) tem a
  trajetória fundida no sobrevivente. **O total é 12.611 cards**, e é esse
  número que o contrato e o de-para usam. Quem implementar pelo texto antigo
  perde 222 casos encerrados como card e subconta o funil de fechados.
  (Achado do Codex no PR #232, 2ª rodada.)
  "Pessoa" é o telefone pela régua do nono dígito (`variantesDoNonoDigito`),
  **nunca** os últimos 8 de `phonesMatch` — medido: pelos últimos 8, 14 sufixos
  teriam mais de uma pessoa, 13 com DDD ou DDI diferente.
  ⚠️ Na Kommo, **266 pessoas têm mais de um lead** (566 leads), 85 com mais de
  um ABERTO, e uma delas tem **13 leads na mesma etapa** — ela preencheu o
  formulário 13 vezes. Cada lead era elegível para a própria sequência, e é daí
  que vinha a mensagem repetida para o mesmo número. Aqui, `contacts` (telefone)
  e `conversations` (036) fundem por índice único do Postgres; o **negócio não**
  — a regra "um card por contato" mora no código, e é responsabilidade da carga.

**O que entra (bloco B)**

- **2 — migrar os 5.791 fechados** (46%): é deles que sai o histórico do funil.
- **8 e 20 — o nome da Kommo vence e fica FIXADO** (`nome_fixado_em`), exceto
  nos 297 já fixados à mão. Todo nome passa por `nomeParaFixar`, que recusa
  número.
- **5 e 21 — reusa 8 etiquetas, cria só `kommo`** (cor `#6b7280`). As outras 23
  da Kommo não são criadas. A No‑Show sai da ETAPA, não de etiqueta.
- **3 — 283 conversas novas, nascendo ENCERRADA**, para abrigar as 543
  anotações; `autor_nome` da Kommo preservado, `author_user_id` nulo,
  `created_at` original. **Não** houve migration anulando `conversation_id`.
- **25 — o `price` é valor de PROPOSTA e vem em TODOS os leads.** Os 171 ganhos
  valem R$ 0 e o funil Trabalhista inteiro não tem valor nenhum: o Desempenho
  vai mostrar R$ 0,00 de valor fechado nos meses históricos, e isso é o dado.
- **22 — os 4 telefones ambíguos NÃO são fundidos**: nascem fichas novas, e a
  lista dos 4 vai para o operador no ensaio.
- **4 — campos**: entram e‑mail (1.906), Campanha/Conjunto/anuncio (1.224 cada),
  "Tamanho da Divida" (2.813) e o id da Kommo. Os outros 13 ficam de fora.
- **6 — consertar os 43 nomes corrompidos** (reinterpretação de bytes).
- **7 — os 29 contatos sem telefone não migram.**
- **12 — nenhum responsável.** Gabriel Queiroz responde por 64% dos leads e não
  é membro do CB CRM.
- **13 — motivo de perda descartado**: 1.122 dos 5.701 têm motivo, e é sempre o
  mesmo.
- **15 — as 118 tarefas abertas são descartadas.**

### ⏳ Em aberto — dependem da data do corte


### Bloco C — o corte e a operação

| # | Decisão | Opções | Recomendação |
| --- | --- | --- | --- |
| 23 | **A carga roda com o CRM em uso?** | janela de baixo movimento, resolvendo colisão na ida · parar o que der (agendador) e aceitar o resto | não dá para congelar: a ingestão do WhatsApp e o Calendly são dirigidos por quem manda mensagem. A carga tem de nascer tolerante |
| 24 | **Quais automações podem estar LIGADAS na janela da carga** | nenhuma · só as que não são de etapa | nenhuma automação de etapa e nenhuma com "Aguardar" ativa. Hoje as 8 estão desligadas — conferir na véspera |
| 26 | **Régua do Asaas** | desligar durante a carga e o ciclo seguinte · deixar como está | a carga liga clientes que hoje estão em "Sem ficha"; eles nunca passaram pela curadoria dos 38 da lista de exceção |
| 27 | **Reuniões históricas da Kommo** (1.199 com data) | só o campo "Data e Hora Reunião" (uma por contato — perde as repetidas) · linhas sintéticas em `cb_calendly_eventos` (fiel, mas inventa registro num log de integração) | decidir junto com a Fase 8 do funil: se for linha sintética, a Fase 8 precisa existir ANTES da carga. ⚠️ Data FUTURA no campo arma o gatilho de lembrete quando o relógio a alcança |
| 14 | **O corte** | — | quais entradas religar primeiro (n8n/Typebot → webhooks de entrada da 982), quem substitui os 5 webhooks de conversão, quanto tempo os dois convivem, quando a equipe para de mover card na Kommo |
| 28 | **Onde a carga vive** | `scripts/kommo/` · módulo em `src/lib/migracao/` chamado por script | em `src/` ela herda de graça os pinos de dono durável e nome fixado, que hoje NÃO a alcançam (trava 8) |

### Consertos de código antes da carga (não são decisões)

✅ **Paginar o quadro do funil, a lista de conversas e o contador de não lidas**
— feito no [PR #227](https://github.com/leonardocabralb/CB-CRM/pull/227)
(`src/lib/supabase/paginar.ts`), **mesclado em 20/09**. Os três cortavam em
1.000 linhas sem avisar.

✅ **Os cinco abaixo saíram do teste de esforço e foram feitos no
[PR #231](https://github.com/leonardocabralb/CB-CRM/pull/231), mesclado em
21/09.** Nenhum é da migração — são defeitos que já existem e que a carga
torna graves. O Codex achou dois P2 antes do merge (a busca pela coluna
`phone_normalized` e os tetos por coluna viajando no retorno do funil) e um
terceiro **51 segundos depois** dele, consertado no
[PR #233](https://github.com/leonardocabralb/CB-CRM/pull/233): a outra saída
para o inbox — o link do formulário do negócio — gravava o retorno sem os
tetos, e a volta caía num quadro de 100 cards.

- [x] **1. Teto por coluna no Kanban** (`pipeline-board.tsx`). O #227 consertou
      o DADO, não o RENDER: a tela monta um componente React e um registro do
      dnd-kit por card, e a coluna "Perdido" (2.719) estica a página para
      centenas de milhares de pixels. No computador trava a thread principal;
      no app do iPhone, o provável é ser morto. **A tela principal do funil
      deixa de abrir.** O padrão já existe no repositório
      (`lista-de-leads.tsx`, `PAGINA = 100` + "carregar mais") e não pede
      dependência nova. O contador do cabeçalho vem de `deals.length` e
      continua certo.
- [x] **2. Paginar as quatro consultas de audiência do disparo** e chunkear
      `fetchCustomValueIndex` (`use-broadcast-sending.ts`). As duas andam
      JUNTAS, no mesmo PR: consertar só a audiência leva o `.in()` a uma URL de
      ~480 KB e faz o índice de campos truncar — e aí o cliente recebe
      "Olá , sobre sua dívida de ". `linhas === null` tem de ABORTAR o disparo.
- [x] **3. Preferir o telefone EXATO em `findExistingContact`**
      (`dedupe.ts`). Hoje a consulta busca pelo sufixo de 8 dígitos **sem
      `.order()`** e devolve o primeiro que passar no teste tolerante: com os 4
      pares ambíguos, a mensagem do cliente pode ser anexada à ficha errada — e
      a escolha pode INVERTER de um dia para o outro, porque qualquer UPDATE
      numa das linhas move a tupla no heap. Preferir o exato antes do tolerante
      não muda nada onde não há colisão e torna a resolução determinística.
- [x] **4. Agregar no banco o painel do funil** (`dashboard/queries.ts`). O
      cartão "Valor do funil" e o donut por etapa somam no máximo 1.000
      negócios abertos e publicam o resultado como total: um número plausível,
      estável entre recarregamentos, e errado para baixo. O mínimo aceitável é
      `count: 'exact'` e ESCONDER o cartão quando o count passar do que veio —
      a régua que o Meu dia já usa.
- [x] **5. Busca no servidor nos seletores de contato** (`deal-form.tsx`,
      `task-form.tsx`). Os dois carregam `contacts` sem limite e já estão
      cortados hoje; com 12.980 contatos, do meio do alfabeto em diante o
      cliente não aparece — e o operador cadastra de novo, gerando a ficha
      duplicada que a carga passou semanas evitando. O padrão a copiar é
      `seletor-de-cliente.tsx` (busca digitada com debounce + `.limit`), e o
      comentário do próprio `task-form.tsx` já mandava fazer isso.

**Migrations que a carga exige** (nenhuma delas é dado — dado é a fase 2c):

- [x] **`deals.kommo_lead_id`** com índice único parcial: é o que torna a
      reexecução garantida pelo banco (contrato A.3). **Migration 1012,
      aplicada em 20/09** (histórico `20260921003408`) e conferida no catálogo
      — o índice renderizado tem `UNIQUE`, `account_id` e o `WHERE`.
- [ ] **A função de lote** (`SECURITY DEFINER`, será a **1013** — número
      conferido nos arquivos E no histórico do banco) que insere os cards, repara a
      trilha dos gatilhos e apaga `cb_automation_events` na mesma transação
      curta (contrato A.1). `REVOKE` de PUBLIC **e** dos papéis, com `GRANT`
      de volta só para `service_role` — as duas metades, conferidas.

**Medir no ensaio, não antes:** abrir o Desempenho de um funil com ~8.400
negócios faz 9 chamadas sequenciais à RPC, cada uma trazendo o trajeto inteiro
em jsonb. O teto é 25.000 negócios por funil, e acima dele as três vistas caem
em "falhou". A margem caiu de ~90× para ~3×.


## Fases

- [x] **1. Levantamento** — refeito em 14/09/2026, remedido em 19/09 e
      conferido contra o código de 20/09 (este documento).
- [x] **2. Decisões e de-para** — fechadas em 19–20/09 pelo operador e
      gravadas em `docs/PLANO-migracao-kommo-de-para.md`, que é o mapa: as
      tabelas por etapa, os degraus, as etiquetas, a regra do card e o que é
      descartado.
- [x] **2a. Teste de esforço** — as decisões contra o código real, seis lentes
      com refutação adversarial. 60 achados, 8 que bloqueiam. Estão na seção
      "O teste de esforço de 20/09/2026" e reescreveram o contrato de carga.
- [x] **2b. Consertos de código** — os cinco da seção anterior, feitos no
      [#231](https://github.com/leonardocabralb/CB-CRM/pull/231) (mesclado em
      21/09) e no [#233](https://github.com/leonardocabralb/CB-CRM/pull/233).
      Mais a migration **1012** (`deals.kommo_lead_id`), aplicada. **Falta só a
      função de lote (1013)**, que nasce junto com a carga — a assinatura dela
      É o contrato da carga, e inventá-la antes seria adivinhar a forma que o
      script vai querer. Nenhum dos cinco é da migração: são defeitos que já
      existem e que a carga torna graves.
- [x] **2c. Estrutura em produção — FEITA em 21/09.** As 6 etapas novas, os
      degraus das 34, o `resultado` de "Desqualificado", o campo
      `kommo_contact_id` e o bloco "Migração" na posição 2 (depois de
      Traqueamento). É DADO, não migration — e o desfazer exato, com os ids
      reais das 24 etapas, foi escrito ANTES de aplicar.
      ⚠️ Conferido depois: 34 etapas na ordem certa e **nenhum card deslocado**
      (406, 269, 227, 53, 21 e 1 inalterados). E na tela: o Desempenho saiu do
      estado "configure" e passou a medir — `LEAD 272 → MQL 53 → REUNIÃO 53 →
      PROPOSTA 0 → CONTRATO 0` —, exatamente como esta linha avisava que
      aconteceria. É a mudança que a equipe vê.
- [x] **3. Piloto em produção — FEITO em 21/09, e ele DERRUBOU a 1014.**
      Os 33 leads, a carga de verdade com filtro, duas passadas, conferência na
      tela e desfazer. Resultado na seção "O piloto — os 33 leads".
- [x] **4. Ensaio com volume — SUBSTITUÍDO pela revisão adversarial + a carga
      em lotes.** O estouro de subtransação não chegou a ser risco: com os
      gatilhos silenciados dentro do lote não há subtransação para estourar, e
      os 20 lotes de 250 cards rodaram em 0,4–0,6 s cada. O Kanban cheio foi
      medido na tela DEPOIS da carga (3.645 negócios no Trabalhista -
      Comercial, com a paginação de 100 do PR #231 segurando o render).
- [ ] **5. Religar entradas e saídas** — formulários e Typebot passam a chamar
      o CB CRM (webhooks de entrada da 982), e os 5 webhooks de conversão
      ganham substituto, antes do corte. **Continua pendente** — a carga rodou
      antes dela de propósito: ela é reexecutável, e o delta do dia do corte é
      uma segunda passada.
- [x] **6. Carga — FEITA em 21/09/2026**, no recorte que o operador fechou no
      mesmo dia. Detalhes e números na seção "A carga — 21/09/2026".
- [x] **7. Conferência — FEITA**, no banco e na tela. Mesma seção.
- [ ] **8. Desligar** — a equipe para de usar a Kommo; revogar token e chave
      secreta da integração.

**Ordem em relação às Fases 7 e 8 do funil comercial:** a Fase 7 (ciclo de
vendas) pode vir depois — ela lê a trilha que já estará lá — e serve bem como
instrumento da conferência. A Fase 8 (mapas de reunião) precisa vir ANTES se a
decisão 27 for "linhas sintéticas".

⚠️ **A medição vale por poucos dias.** Os dois lados mudam ~30 leads por dia:
em 14/09 o CB CRM tinha 1.024 contatos, em 19/09 tinha 1.196, em 20/09 tinha
1.212. Remedir antes de escrever a carga. A varredura completa leva ~6 min mais
~12 min do histórico.

## O piloto — os 33 leads, escolhidos em 21/09

Escolhidos por COBERTURA, não à mão: `escolher-piloto.py` (scratchpad, não
versionado — lê dado de cliente) enumera **31 variações** e escolhe o menor
conjunto que cobre **cada uma três vezes**, com leads diferentes: **33 leads**.

⚠️ **Três vezes, e não uma, de propósito.** Cobrir cada variação uma vez dá
**8 leads** — isso é cobertura de tabela, não piloto. O que quebra uma carga
costuma ser a INTERAÇÃO entre variações: a pessoa com vários leads que TAMBÉM
tem um extra com desfecho; o contato que já existe aqui E muda de etapa; a
etapa nova que recebe um lead sem nenhuma mudança de etapa no histórico. Com
três amostras por variação as interações aparecem sem inflar o piloto.

As 31 variações cobertas: contato novo × existente · desfecho aberto × ganho ×
perdido × fecha-ao-pousar · área trabalhista × bancário · as **6 etapas novas**
(Ag. Demissão, Pediu Demissão, Foi Demitido, Pendente Documento, Em Elaboração,
Perdido) × etapa existente · com e sem anotação · com e sem valor · sem
mudança de etapa × trajetória longa · sobrevivente-com-extras ×
extra-com-desfecho × extra-aberto-fundido · telefone ambíguo pelos 8 dígitos ·
etiquetas SEG. TRAB e Rescindido · campo de anúncio · tamanho da dívida ·
e-mail · **lead sem telefone (que não pode virar card — regra 18b)**.

⚠️ O conjunto inclui o lead **#27179365, do próprio operador** ("Leonardo
Cabral Baptista"), que é o contato de teste autorizado para envio real.

**Conferir na tela, não só no banco** — e rodar DUAS vezes seguidas, que é a
prova de idempotência.

### O que o piloto encontrou (21/09/2026)

⚠️⚠️ **A 1014 tinha passado em DOIS ensaios contra a produção — carga +
reexecução e carga + desfazer — e o piloto a derrubou na PRIMEIRA tentativa.**
É a diferença entre dado escolhido a dedo e dado de verdade, e é a
justificativa inteira desta fase. Os três achados viraram a **1015**:

1. **`deals.value` é NOT NULL com DEFAULT 0**, e a função passava NULL
   explícito — que ANULA o default. Todo lead sem valor derrubava o lote com
   23502. Os ensaios não pegaram porque os dois grupos escritos à mão tinham
   valor.
2. **`deals.currency` tem DEFAULT `'USD'`.** Medido: **980 dos 982** cards da
   conta são BRL. A regra 11 deste contrato dizia "pode ficar no default" e
   estava errada na prática — poria os 12.611 cards importados em dólar.
3. **O livro-razão não cobria `contacts`.** A ficha é criada fora da função
   (com os gatilhos LIGADOS, porque o espelho de e-mail depende deles), e
   ficava fora do livro: o desfazer não a alcançava. Medido: a função abortou
   e sobraram **24 contatos órfãos**.

### O resultado depois da 1015

| Prova | Medido |
| --- | --- |
| Carga | 30 cards, 112 eventos, 24 fichas · **62 ms** |
| 2ª passada | **0/0/0** — os 30 `ja_migrado`; as 13 medidas idênticas |
| Trilha escrita por gatilho | **0** — o silenciamento funcionou |
| Cards fora de BRL · sem valor · sem contato | **0 · 0 · 0** |
| Fila de automação na janela | **0** |
| Datas dos cards | 2025‑06‑20 a 2026‑07‑20 · **0 datados de hoje** |
| **Desfazer** | 30 cards, 24 fichas, 112 eventos, **0 retidas** |
| Depois do desfazer | contatos 1216 · cards 980 · eventos 1326 — **o ponto exato** |

**Na tela:** as três etapas novas do Trabalhista ‑ Comercial apareceram com
**3 cards cada** e nomes reais; o Desempenho contou **408 leads "este mês"**
(só os pré-existentes) e **423 no "Total"** com **3 contratos** — ou seja, os
importados entram no funil **com as datas da Kommo**, sem poluir o mês
corrente. Depois do desfazer, o quadro voltou a R$ 18.000,00 e as colunas às
contagens originais.

**Pré-requisito que não se dispensa:** o **livro-razão** de desfazer, escrito e
ensaiado ANTES — cada linha criada, com tabela e id, gravada conforme escreve;
desfazer é lê-lo de trás para frente, na ordem da receita de fusão do CLAUDE.md
(apagar o negócio explicitamente antes do contato).

## Credenciais

`KOMMO_TOKEN` e `KOMMO_API_BASE` no `.env.local` (gitignored). ⚠️ O token
**expira em 30/09/2026** — faltam **10 dias** em 20/09, e a fase 5 não termina
antes. Gerar um novo na integração da Kommo é pré-requisito da remedição, não
só da carga. Ele foi colado num chat durante o levantamento de 02/09 —
**revogar na Kommo ao fim da migração**, junto com a chave secreta da
integração.

## A carga — 21/09/2026

### O recorte que o operador fechou

Pedido dele, no meio da execução: *"para diminuir sua carga, vamos limitar um
pouco as informações"* — só os leads **da qualificação para frente**. Traduzido
contra as etapas de destino e medido sobre os 12.714 leads vivos:

| Funil | Entra | Leads |
| --- | --- | ---: |
| Trabalhista ‑ Comercial | Ag. Demissão · Pediu Demissão · Foi Demitido · Qualificado · Link Enviado · Contrato Assinado · Protocolado · Desqualificado‑Sem Direito | **3.392** |
| Trabalhista ‑ Jurídico | tudo | **416** |
| Bancário ‑ Comercial | Recebeu Link · Reunião Agendada · Reunião Qualificada · No Show · Reunião Sem Proposta · Proposta Realizada · Contrato Fechado | **509** |
| Bancário ‑ Jurídico | tudo | **524** |

**Fica de fora: 7.873** — a etapa de ENTRADA dos dois funis (Entrada Avulsa
344, Lead‑Type e Forms 255, Contato Avulso 2) e as três colunas de PERDA (Não
Respondeu 1.571, Perdido trabalhista 2.719, Perdido bancário 2.982).

⚠️⚠️ **A consequência foi posta antes da decisão e o operador escolheu assim:
sem as perdas, o denominador some e as taxas históricas ficam perto de 100%.**
Medido depois, no "Total" do Desempenho trabalhista: LEAD 4.069 → MQL 3.701
(**91,0%**). A alternativa oferecida era trazer as perdas (12.113 cards) ou só
as dos últimos 6 meses.

⚠️ **O funil Onboarding entra inteiro, e isso foi levantado pelo operador**
("os clientes que mandaram documentos e passaram por contrato fechado não estão
em cliente ativo, mas são clientes ativos"). Já estava coberto pelo de‑para, e
agora está MEDIDO: as 4 etapas vivas do Onboarding — iniciar onboarding 52,
documentos solicitados 36, docs com pendência 16, Onboarding Finalizado 78 —
pousam todas em **Bancário ‑ Jurídico › Cliente Ativo**, que por isso soma 416
e não 234. Só o único "descarte" fica de fora. E a trilha deles PASSA por
"Contrato Fechado", que é o que faz o contrato contar no funil comercial.

### O que a revisão adversarial achou antes de a carga rodar

Cinco lentes sobre a 1016 e o carregador, cada achado refutado por um segundo
leitor: **18 levantados, 15 confirmados**. Os que mudavam dado em produção
viraram a **1017** (banco) e correções no carregador:

| | Achado | O que teria acontecido |
| --- | --- | --- |
| **P0** | A carga **nunca olhava `deals`** | 562 das 4.635 pessoas já tinham negócio aqui; a carga criaria 583 cards por cima. A decisão 11 ("a etapa da Kommo MOVE o card") tinha o ramo de UPDATE pronto na 1014, atrás do campo `deal_id`, e ninguém o alimentava |
| P1 | O gatilho do título (1007) escrevia em `deals` no passo de PESSOAS | `updated_at = hoje` nos cards que já existiam, fora do livro-razão. A 1016 dizia que a ordem pessoas→cards resolvia — resolve para o card que a carga CRIA, não para os 983 que já existiam |
| P1 | O desfazer apagava do livro as linhas que ele **reteve** | cliente que escreve durante a carga impede a ficha de sair; a linha saía do livro assim mesmo, e a segunda tentativa respondia "0 linhas" sobre uma ficha de pé |
| P1 | O sobrevivente era recalculado do DUMP a cada execução | no delta do corte, um lead FUNDIDO podia virar sobrevivente e ganhar card próprio — dois cards para a mesma pessoa, sem nada no banco impedindo |
| P1 | Rótulo automático da Kommo virava nome **FIXADO** | 415 fichas presas em "Lead #21438851", "." ou "oi" para sempre: os três caminhos de ingestão respeitam `nome_fixado_em` (999) e o `pushName` nunca mais corrigiria |
| P1 | Os 12.308 eventos nasciam **mudos** | `useLeadEventText` faz `?? '—'`: a aba Histórico leria "Transferido de — (—) para — (—)" doze mil vezes |

**E um achado que saiu da conferência à mão, não da revisão:** o lead com a
etiqueta CONTATO SEG. TRAB e SEM histórico nascia já no jurídico, então a
trilha nunca passava por Protocolado e **o contrato sumia do Desempenho do
comercial** — o oposto do que a seção 6 do de‑para promete. A etapa inicial de
reserva passou a ser a etapa MAPEADA do lead, e a perna final virou o
`pipeline_changed` da regra 14. São 67 contratos.

### O que rodou

Janela aberta (os 5 `default_pipeline_id` zerados e a automação do Calendly
desligada) e **devolvida idêntica** no fim.

| Passo | Resultado |
| --- | --- |
| **pessoas** | 3.874 fichas · 71 nomes · 577 e‑mails · 5.691 valores de campo · 12 lotes de ~0,3 s |
| **cards** | **4.219 criados + 562 MOVIDOS** · 12.307 eventos · 10.415 etiquetas · 20 lotes de 0,4–0,6 s |
| **conversas** | 216 conversas encerradas · 473 anotações |
| **2ª passada** | **0 / 0 / 0** — 4.781 `ja_migrado`, 473 anotações reconhecidas como repetidas |

**Conferências:** 0 telefone com separador · 0 dono errado · 0 card sem
contato · 0 fora de BRL · 0 evento sem destino · 0 evento sem rótulo · 0 card
datado de hoje · 0 gatilho desligado · **1** par de cards ABERTOS no mesmo
funil, o mesmo que já existia antes da carga.

⚠️ **Três números da conferência precisam de leitura, e nenhum é defeito.** Os
562 cards MOVIDOS têm **duas** criações (a do CRM, de quando o roteador os
abriu, e a retroativa da Kommo) e trilha própria anterior — por isso
`trilha_por_gatilho` dá 570 e `data_da_criacao_diverge` dá 562. Nenhum desses
eventos é de hoje: a conferência 29 procura escrita de gatilho DURANTE a carga,
e essa é zero. E `dois_cards_no_mesmo_funil` = 93 são 79 pares `won+won` e 13
`open+won` — a regra 6b ("lead com desfecho ganha card próprio").

### Na tela

- **Trabalhista ‑ Comercial: 3.645 negócios.** Ag. Demissão 886, Pediu Demissão
  1.152. Cards com nome real e as etiquetas `kommo`/`Trabalhista`/`Formulário`.
- **Desempenho, Total:** LEAD 4.069 → MQL 3.701 (91,0%) → PROPOSTA 1.194
  (32,3%) → **CONTRATO 1.008** (84,4%). Valor fechado R$ 48.000 — o funil
  trabalhista nunca registrou honorário na Kommo, como a seção 10 do de‑para
  avisava.
- **Desempenho, este mês:** 364 leads, 16 contratos. O Meu dia abriu com
  "Nada de novo" — a carga não inundou ninguém.
- **Aba Histórico de uma ficha:** "Transferido de Trabalhista ‑ Jurídico (Em
  Elaboração) para Trabalhista ‑ Comercial (Protocolado)", datado de out/2025,
  marcado RETROATIVO.

⚠️ **O cabeçalho do Kanban conta "ganhos no mês" por `updated_at`, que na Kommo
é "última vez que alguém tocou", não "ganho em".** O Trabalhista ‑ Comercial
mostra 136 ganhos no mês. É a melhor aproximação disponível e foi o que a regra
8 do contrato pediu — a alternativa (deixar `updated_at` no dia da carga) poria
os 677 ganhos todos neste mês.

### O que a carga NÃO fez

- Os **20 leads sem telefone aproveitável** do recorte não viraram card (regra
  18b), com a lista emitida. Dois deles têm desfecho e o operador já decidiu
  deixá-los de fora: #27593737 (Kailane, Protocolado) e #27963311 (Ganho).
- **Reuniões históricas** (decisão 27) e os campos fora da allowlist continuam
  fora.
- **A Fase 5 não foi feita.** A Kommo continua recebendo ~30 leads/dia, e o
  delta do dia do corte é uma segunda passada da mesma carga.

### Desfazer

O livro-razão tem **26.170 linhas** e `cb_kommo_desfazer` (1017) sabe reverter
as nove tabelas. Ele é REPETÍVEL: a linha cujo objeto não pôde sair — ficha que
ganhou conversa porque o cliente escreveu durante a carga — **fica no livro** e
sai na tentativa seguinte.

**Desde a 1022 (21/09, achados do Codex no PR #232), ele só devolve o que
continua INTOCADO desde a carga.** Card criado ou movido, título, ficha (nome e
e-mail) e valor de campo que alguém mexeu depois FICAM — retidos no livro e
contados em `editadas_depois`, para decisão de gente. Apagar ou devolver a foto
de antes por cima levaria o trabalho feito depois da carga, sem aviso.

- `deals`: `updated_at <= criado_em` da linha do livro. A carga gravou a data
  da Kommo (no passado), e qualquer escrita posterior o empurra para a frente.
- `contacts`: a mesma régua — a carga escreveu com os gatilhos ligados, então
  `updated_at` ficou igual a `criado_em`. O desfazer cala SÓ o
  `set_updated_at` de `contacts` (o espelho de e-mail continua ligado) e
  devolve `updated_at` à mão; sem isso, devolver o e-mail empurrava
  `updated_at` para agora e a linha do nome da mesma ficha era lida como
  "editada depois".
- `contact_custom_values` não tem `updated_at`: a prova é o VALOR, que o livro
  passou a guardar em `detalhe.valor`. As linhas que já existiam foram
  preenchidas com o valor do dia da 1022 — uma edição feita entre a carga e a
  1022 passou a contar como "o valor da carga".

Ensaiado contra a produção em rollback antes de aplicar: o card e o valor
editados depois ficaram, os intocados saíram, e a ficha voltou exata
(`updated_at` inclusive).

**E desde a 1023 a ficha CRIADA pela carga também** (Codex, PR #232): ela só
sai se continua intocada (`updated_at <= criado_em`; medido em 21/09: 3.872
das 3.874 fichas estavam assim — as duas outras foram mexidas depois e
ficariam). A ficha é TRAVADA antes das perguntas "tem conversa? tem card?":
sem a trava, uma conversa sendo criada naquele instante não aparecia para a
pergunta e o DELETE a apagava em cascata, com as mensagens. Na mesma
migration, a CARGA passou a decidir sob trava — nome e e-mail só são
preenchidos se continuam vazios/telefone no instante da escrita, e o card
movido é lido travado —, e `status_changed` sem funil é recusado na entrada
do lote, nomeando o lead, em vez de derrubar o lote inteiro depois de
escrever.

**Desde a 1025** (acompanhamento do #232): a troca de funil também exige as
duas etapas na entrada — sem etapa, a transferência sumia das métricas do
funil (medido: os 1.509 eventos da carga têm as duas).

⚠️ **Limite conhecido, registrado em 21/09 e NÃO corrigido** (o outro achado do
Codex no head 657b78d): "intocado" é `updated_at <= criado_em`, e `updated_at`
é a hora em que a transação de quem escreveu COMEÇOU. Um salvamento que já
estava em voo quando um lote da carga começou, esperou a trava e gravou depois,
fica com `updated_at` anterior à operação e passaria por intocado. Medido na
carga de 21/09: nenhuma ficha nem card tem essa assinatura. Fechar de vez é
guardar a imagem da linha depois da carga e comparar a linha inteira — obra
desproporcional para uma ferramenta de emergência.
