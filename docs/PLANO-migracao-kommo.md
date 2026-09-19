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

## Contrato de carga

Levantado em 19/09 lendo o código, com revisão adversarial. Cada regra falha em
SILÊNCIO se for ignorada — nenhuma delas dá erro.

**Forma da escrita**

1. **UM INSERT por negócio, já no estado FINAL.** Nenhum `UPDATE` de
   `pipeline_id`/`stage_id`/`status` depois: cada um deles dispara a trilha
   (912), a fila (933) e o carimbo de resultado (950). Replayar a trajetória
   por updates sucessivos dispararia a esteira inteira por lead.
   ⚠️ Isto **conflita com a decisão 11** ("a etapa da Kommo move o card
   daqui"), que é um UPDATE por definição — ver a decisão 17.
2. **São SEIS gatilhos em `deals`**, não dois: `set_updated_at` (0001),
   `cb_deals_log_event` e `..._update` (912), `cb_deals_enfileira_evento` e
   `..._update` (933) e `cb_deals_aplica_resultado_trigger` (**BEFORE** INSERT
   OR UPDATE OF stage_id, 950). O último reescreve `NEW.status` a partir do
   `resultado` da etapa e **vence** o status que a carga mandar.
3. **Nenhuma linha em `cb_automation_events`.** Apagar na mesma transação, não
   marcar como processada (`cardSaiuDaEtapa` ignora `processado_em`). O DELETE
   precisa ser estreito — `origem = 'sistema' AND criado_em >= now()` da
   própria transação —, senão apaga o evento legítimo de um card que alguém
   arrastou na mesma janela.

**`deals`**

4. `account_id`; `user_id = accounts.owner_user_id` (nunca o login de quem
   roda: `contacts.user_id` cascateia de `auth.users`); `assigned_to` é
   `profiles.id`, não o id do login; o par `(stage_id, pipeline_id)` conferido
   no script (a FK é COMPOSTA e devolve 23503 cru).
5. **`created_at` = a data real da Kommo**, sempre. E `updated_at` também: o
   `PipelineAnalytics` do cabeçalho do Kanban conta "ganhos/perdidos este mês"
   por `updated_at ?? created_at`.
6. `source`: a escolha tem três consequências. `'channel'` ativa o índice
   único parcial da 911 (um card por contato) e **falha com 23505** nos 749
   contatos que já têm card; `'automation'` escapa da fila da 933 no INSERT
   mas grava procedência falsa na trilha; `'manual'` não faz nem uma coisa nem
   outra. Não há valor para "veio da Kommo".
7. `currency` pode ficar no default — o app formata em BRL e não lê a coluna.

**`cb_lead_events`**

8. Toda linha leva `account_id`, `deal_id`, **`contact_id`** (é por ele que a
   ficha lê a trilha — sem ele os 15 meses ficam invisíveis na tela),
   `occurred_at` explícito, `origin = 'retroativo'`, **`reconstructed = true`**,
   **`to_pipeline_id`** e `to_stage_id`, mais os rótulos e a posição da etapa
   (a semente da 912 é o gabarito das COLUNAS — não do conteúdo: ela aponta
   para a etapa ATUAL, que num lead com 15 meses de trajeto seria mentira).
9. Um evento **por mudança de etapa**, não dois por lead. Ganho e perda da
   Kommo viram `stage_changed` para uma etapa com `degrau` — `status_changed`
   não é lido pelo funil.
10. **Desempate de ordem:** a Kommo carimba em segundos e a RPC ordena por
    `(occurred_at, id)`; dois movimentos do mesmo lead no mesmo segundo saem
    em ordem sorteada. A carga desempata com microssegundos incrementais na
    ordem em que a Kommo devolveu.
11. A trilha é append-only por desenho (`authenticated` só tem SELECT), mas a
    service role mantém UPDATE/DELETE — é por lá que se limpa o que os
    gatilhos escreverem por cima.

**Contato, etiqueta e campo**

12. Casar por `mesmoNumero` sobre TODOS os candidatos do sufixo, numa consulta
    ordenada. Um só candidato → liga; nenhum → cria; mais de um → "para
    confirmar".
13. Etiqueta por `resolveImportTagIds` + `assignImportedContactTags` (upsert
    idempotente em lotes), com `userId = accounts.owner_user_id`. **Nunca**
    `tag-events.ts`. ⚠️ O INSERT direto foge do gatilho das AUTOMAÇÕES e
    **não** do gatilho de AUDITORIA: `cb_contact_tags_log_event` grava uma
    linha `tag_added` datada de hoje, com `reconstructed = false` — ou seja,
    no fio do cliente. São dezenas de milhares.
14. Campo de data (`Data e Hora Reunião`, `Data da Proposta`) vai em ISO com
    `Z`: o cast do banco engole erro e devolve NULL, ou lê no fuso do
    servidor e erra por 3 horas, sem aviso.
15. E-mail entra só por `contacts.email`; o campo "E-mail" fica fora do mapa.

**Conferências do ensaio (fase 3) e do pós-carga (fase 6)**

16. `cb_lead_events` retroativo com `to_pipeline_id` ou `to_stage_id` nulo = 0.
17. `cb_lead_events` com `reconstructed = false` e `occurred_at` anterior ao
    dia da carga = 0 (pega o que os gatilhos escreveram por cima).
18. `deals` com `created_at` nulo ou igual ao dia da carga = 0.
19. `cb_automation_events` com `processado_em` nulo = 0, e nenhuma linha da
    janela da carga.
20. Nenhum negócio importado sem ao menos um evento apontando para o funil
    dele (senão ele some da Lista, do Desempenho e da Saúde).
21. Abrir o Meu dia **no dia** da carga: o bloco "ganhos" tem de estar zerado.
22. Taxa acima de 100% no modo por período é razão de fluxo e está CERTA —
    não "consertar".

## Decisões pendentes

São **27**, em três blocos (a antiga 10 foi reescrita como 17). As do bloco A
travam a ESCRITA da carga: sem elas, não há o que programar.

### ✅ Fechadas pelo operador em 19/09/2026

- **16 — o id da Kommo vira CAMPO PERSONALIZADO**, não coluna. ⚠️ Campo
  personalizado só existe em CONTATO: ele resolve o id do contato e **não** o
  id do lead. Para o negócio, a chave vai no `details` do `deal_created`
  retroativo (`details->>'kommo_lead_id'`), que é invisível na tela e
  consultável. Preço aceito: sem índice único, a idempotência fica por conta
  do script (conferir antes de inserir) — o que basta para uma carga que roda
  sozinha, e não bastaria para duas rodando ao mesmo tempo. O campo nasce num
  bloco próprio ("Migração"), fora do Geral, para não poluir a ficha.
- **17 — apagar as linhas de `cb_automation_events` na mesma transação**, com
  `deals.source = 'manual'`. Mantém a trilha (912), o carimbo de resultado
  (950) e as FKs de pé.
- **18 — ganho e perdido pousam em ETAPA**, com `degrau` e `resultado`. Quais
  etapas, por funil: no de‑para.
- **9 — histórico real**, um evento por mudança de etapa, `origin='retroativo'`
  e `reconstructed=true`.
- **11 — a etapa da Kommo MOVE o card** dos 845 que já existem aqui.
- **1 e 19 — em aberto, decisão conjunta.** A proposta está em
  `docs/PLANO-migracao-kommo-de-para.md`, montada sobre a medição de 19/09.

**Escopo declarado pelo operador (19/09):** nome do lead, etapa atual,
etiquetas, etapas pelas quais passou (histórico), valor do contrato
(proposta/fechamento) e anotações das conversas. Campos personalizados,
e‑mail, responsáveis, motivo de perda, tarefas e data de reunião ficaram de
fora da lista — o que cada um custa está na seção 10 do de‑para.

### Bloco A — travam a escrita

| # | Decisão | Opções | Recomendação |
| --- | --- | --- | --- |
| 16 | **Onde carimbar o id da Kommo** (sem isso a carga não é reexecutável — trava 10) | migration nova com `contacts.kommo_contact_id` + `deals.kommo_lead_id`, índice único parcial · campo personalizado · nada (carga de uma passada só) | **migration**: some da tela, é a única que sobrevive a uma carga interrompida no meio, e `deals` não tem alternativa (campo personalizado só existe em contato) |
| 17 | **Como a carga passa pelos gatilhos** (reescreve a antiga 10) | (a) apagar as linhas de `cb_automation_events` na MESMA transação · (b) `source='automation'` no INSERT (escapa da fila, grava procedência falsa) · (c) `SET session_replication_role='replica'` (desliga os 6 gatilhos e as FKs; exige conexão direta ao Postgres, não passa por PostgREST) · ~~pausar todas as automações~~ · ~~limpar a fila antes do agendador~~ (são 15 s, não 60) | **(a)**, e a carga insere com `source='manual'`. Mantém 912, 950 e as FKs de pé e não deixa rastro na fila. O DELETE é estreito (`origem='sistema'` + `criado_em >= now()` da transação) |
| 18 | **Ganho e perdido da Kommo → qual ETAPA, em cada funil de destino** (o funil não lê `deals.status`) | usar as que já existem ("Protocolado"/`ganho`, "Não Respondeu"/`perdido`, "Perdido", "Desqualificado - Sem Direito") · criar etapas próprias de destino | a etapa escolhida precisa das DUAS marcas: `degrau='contrato'`/`'perda'` **e** `resultado='ganho'`/`'perdido'`. Sem a segunda, os 5.621 perdidos ficam `status='open'` e voltam a ser alvo das automações |
| 9 | **Data dos eventos de funil** (era uma decisão com três opções; hoje só uma funciona) | histórico real (27.610 mudanças, `origin='retroativo'`) · ~~só criação e fechamento~~ · ~~nenhum evento~~ | **histórico real.** "Só criação e fechamento" crava as transições intermediárias em 100% nos meses históricos; "nenhum evento" some com o lead da Lista, do Desempenho e da Saúde |
| 1 | **De‑para dos funis e das 70 etapas**, com o `degrau` de cada uma das 28 do destino | tabela acima, a preencher — incluindo o que vira TAG e a etapa de ganho/perda da 18 | é aqui que se decide se "Reunião Agendada BOT" é `reuniao` e "Proposta" é `proposta` — sem isso a Fase 7 (ciclo de vendas) nasce vazia para os 15 meses |
| 19 | **O desenho atual dos 4 funis (28 etapas) é o final?** | sim · a migração é a hora de reestruturar | decidir AGORA: depois da carga, apagar etapa mapeada exige tirar o degrau antes, e isso apaga a história dela do funil (trava 12) |
| 11 | **Os 845 leads abertos de quem já tem card aqui** | a etapa da Kommo MOVE o card daqui · o card daqui fica e o lead vira histórico · caso a caso | **mover** — mas repare que mover é UPDATE, o que contraria a regra 1 do contrato de carga: são 845 updates que precisam da mesma proteção (transação com o DELETE da fila) e de eventos retroativos próprios, senão esses 845 "alcançam" os degraus HOJE |

### Bloco B — mudam o que o cliente e a equipe veem

| # | Decisão | Opções | Recomendação |
| --- | --- | --- | --- |
| 8 | **Nos 979 que existem nos dois, quem vence?** | CB CRM · Kommo · por campo | Kommo no nome (640 divergem; o daqui é o push name do WhatsApp), **exceto nos 29 fixados**. E-mail e empresa preenchem buraco. Tag e campo somam |
| 20 | **O nome importado fica FIXADO?** (sem fixar, dura até a próxima mensagem do cliente) | fixar todos · fixar só onde o nome da Kommo parece nome de gente · não fixar | fixar — senão o trabalho do SDR de 15 meses é apagado pelo push name em poucos dias. Todo nome passa por `nomeParaFixar`, que recusa número |
| 3 | **Anotações sem conversa** (412 de lead + 5 de contato) | `deals.notes` concatenado · ~~criar conversa vazia~~ · migration anulando `conversation_id` | **migration**: a FK é MATCH SIMPLE, então basta `DROP NOT NULL`; a ficha já lê por `contact_id`, e autor e data ficam preservados. "Conversa vazia" está fora: a lista do inbox não pagina (trava 11) |
| 21 | **Etiqueta de origem nos importados** | criar uma tag `kommo` · não criar | **criar** — é o que permite excluí-los de um disparo "para todos", que passa de 1.196 para ~12.900 destinatários. É o precedente do Asaas |
| 2 | **Migrar os 5.791 fechados (46%)?** | sim · só os 170 ganhos · não | sim: é deles que sai o histórico do funil. Com a 18 resolvida, eles entram como perda/contrato datados |
| 25 | **O `price` da Kommo é honorário ou tamanho da dívida?** (R$ 10,46 mi em 423 leads) | honorário → `deals.value` · dívida → campo "Tamanho da Divida" | os 170 ganhos têm valor ZERO; carregar dívida em `value` faria o Desempenho mostrar "valor fechado" que não é receita. O ticket médio sai **R$ 0,00** (não "—") nos meses históricos de qualquer jeito |
| 22 | **Contato cujo sufixo bate mas o número não** | lista "para confirmar" revisada à mão (como o Asaas) · criar ficha nova | "para confirmar": fundir duas pessoas é irreversível |
| 4 | 6 campos sem destino | criar · descartar | — |
| 5 | Criar as 25 tags que faltam? | todas · acima de N usos · nenhuma | — |
| 6 | Consertar os 43 nomes corrompidos? | sim · não | sim, é reinterpretação de bytes |
| 7 | 28 sem telefone e contatos sem lead | descartar · migrar | — |
| 13 | Motivo de perda (1.122) | campo `select` novo · tag · descartar | — |

### Bloco C — o corte e a operação

| # | Decisão | Opções | Recomendação |
| --- | --- | --- | --- |
| 23 | **A carga roda com o CRM em uso?** | janela de baixo movimento, resolvendo colisão na ida · parar o que der (agendador) e aceitar o resto | não dá para congelar: a ingestão do WhatsApp e o Calendly são dirigidos por quem manda mensagem. A carga tem de nascer tolerante |
| 24 | **Quais automações podem estar LIGADAS na janela da carga** | nenhuma · só as que não são de etapa | nenhuma automação de etapa e nenhuma com "Aguardar" ativa. Hoje as 8 estão desligadas — conferir na véspera |
| 12 | **Responsáveis** | mapear usuário → membro · deixar sem responsável | Gabriel Queiroz responde por 8.088 leads e não é membro. `assigned_to` é `profiles.id` |
| 26 | **Régua do Asaas** | desligar durante a carga e o ciclo seguinte · deixar como está | a carga liga clientes que hoje estão em "Sem ficha"; eles nunca passaram pela curadoria dos 38 da lista de exceção |
| 27 | **Reuniões históricas da Kommo** (1.199 com data) | só o campo "Data e Hora Reunião" (uma por contato — perde as repetidas) · linhas sintéticas em `cb_calendly_eventos` (fiel, mas inventa registro num log de integração) | decidir junto com a Fase 8 do funil: se for linha sintética, a Fase 8 precisa existir ANTES da carga. ⚠️ Data FUTURA no campo arma o gatilho de lembrete quando o relógio a alcança |
| 14 | **O corte** | — | quais entradas religar primeiro (n8n/Typebot → webhooks de entrada da 982), quem substitui os 5 webhooks de conversão, quanto tempo os dois convivem, quando a equipe para de mover card na Kommo |
| 15 | As 118 tarefas abertas | migrar (944) · descartar | — |
| 28 | **Onde a carga vive** | `scripts/kommo/` · módulo em `src/lib/migracao/` chamado por script | em `src/` ela herda de graça os pinos de dono durável e nome fixado, que hoje NÃO a alcançam (trava 8) |

### Consertos de código antes da carga (não são decisões)

- **Paginar o quadro do funil** (`pipelines/page.tsx`): hoje corta em 1.000
  cards sem avisar. Com 8.381 no Trabalhista, o Kanban passa a mentir.
- **Paginar a lista de conversas do inbox**, se a decisão 3 for "conversa
  vazia" — e o contador de não lidas (`use-total-unread.ts`), que lê
  `conversations` sem `order` e sem `limit`.
- **Medir a leitura do funil com volume real** no ensaio: abrir o Desempenho
  de um funil com ~8.400 negócios faz 9 chamadas sequenciais à RPC, cada uma
  trazendo o trajeto inteiro em jsonb. O teto é 25.000 negócios por funil, e
  acima dele as três vistas caem em "falhou". A margem caiu de ~90× para ~3×.

## Fases

- [x] **1. Levantamento** — refeito em 14/09/2026, conferido contra o código
      de 19/09/2026 (este documento).
- [ ] **2. Decisões e de‑para** — as 27 decisões fechadas num arquivo de mapa
      versionado (sem dado de cliente: ids de funil, etapa, campo, tag e
      usuário). **Entra junto: a ESTRUTURA final das 28 etapas** (criar,
      renomear, reposicionar — depois da carga fica caro, trava 12) e o
      `resultado` de cada uma, que o gatilho da 950 lê no INSERT.
- [ ] **2b. Migration do id da Kommo** (decisão 16) e os dois consertos de
      paginação. Sem a primeira, a carga não é reexecutável; sem os segundos,
      o Kanban mente depois da carga.
- [ ] **3. Ensaio** — a carga rodando contra um Postgres local com o schema do
      replay e o bruto da Kommo, com relatório de diferença e as 7
      conferências do contrato de carga. Não existe banco de homologação: o
      `.env.local` aponta para a produção. **Medir aqui também o lado da
      LEITURA** (o tempo de abrir o Desempenho com ~8.400 negócios).
- [ ] **4. Religar entradas e saídas** — formulários e Typebot passam a chamar
      o CB CRM (webhooks de entrada da 982), e os 5 webhooks de conversão
      ganham substituto, antes da carga final. Entra aqui o "Reassinar" do
      Calendly, se a Fase 8 do funil (que passa a receber `invitee.canceled`)
      entrar antes.
- [ ] **5. Carga** — idempotente, por partes (contatos → tags → campos →
      negócios → eventos → anotações), com o id da Kommo carimbado e o
      contrato de carga obedecido. Reexecutada no dia do corte para o delta.
- [ ] **6. Conferência** — as contagens dos dois lados, as conferências do
      contrato, amostra na tela, e o relatório do funil comercial
      antes/depois. **Mapear os `degrau` das 28 etapas é pré-requisito
      DESTA fase**, não da carga: enquanto eles forem nulos, o Desempenho e a
      Saúde mostram "configure" e não há o que conferir.
- [ ] **7. Desligar** — a equipe para de usar a Kommo; revogar token e chave
      secreta da integração.

**Ordem em relação às Fases 7 e 8 do funil comercial:** a Fase 7 (ciclo de
vendas) pode vir depois — ela lê a trilha que já estará lá —, e serve bem como
instrumento da fase 6 daqui. A Fase 8 (mapas de reunião) precisa vir ANTES se
a decisão 27 for "linhas sintéticas": escrever registro num log cujo leitor
ainda não existe é adivinhar a forma que ele vai esperar.

⚠️ **Esta medição vale por poucos dias.** Os dois lados mudam ~30 leads por
dia — em 19/09 o CB CRM já estava com 1.196 contatos e 960 negócios, contra os
1.024/766 de 14/09. Remedir (os 5 passos do topo) antes de escrever a carga. A
saída da varredura de 14/09 **não existe mais** (era scratchpad de sessão), e
a varredura completa leva ~6 min mais ~12 min do histórico.

## Credenciais

`KOMMO_TOKEN` e `KOMMO_API_BASE` no `.env.local` (gitignored). ⚠️ O token
**expira em 30/09/2026** — faltam **11 dias** em 19/09, e a fase 5 não termina
antes. Gerar um novo na integração da Kommo é pré-requisito da remedição, não
só da carga. Ele foi colado num chat durante o levantamento de 02/09 —
**revogar na Kommo ao fim da migração**, junto com a chave secreta da
integração.
