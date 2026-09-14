# Plano — migração Kommo → CB CRM

> Documento vivo. Fase 1 (levantamento) **refeita em 14/09/2026**, contra o
> `main` de hoje (depois do PR #211). O levantamento de 02/09 e a conferência
> de 08/09 ficaram obsoletos nos NÚMEROS e, pior, na PREMISSA — ver "O que a
> medição de 14/09 mudou". As demais fases dependem das decisões no fim.
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
- **`pipeline_stages.degrau` segue NULO nas 28 etapas** (975) — o funil de
  eficiência não conta nada até o operador mapear. Mapear ANTES da carga faz
  os leads importados entrarem classificados.

**Ganho e perdido não são etapa** na Kommo: `status_id` 142/143, compartilhados
por todos os funis — **170 ganhos e 5.621 perdidos (46% dos leads)**. ⚠️ Os 170
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
6. ⚠️⚠️ **A carga ESTRAGA o funil de eficiência se for feita ingenuamente.**
   Continua valendo: inserir negócio dispara o trigger da 912, que grava
   `cb_lead_events` com a data da IMPORTAÇÃO, e a RPC do funil (975) lê
   exatamente essa trilha. O caminho é o do backfill da 912: eventos escritos
   com a data real e `origin = 'retroativo'` (o CHECK aceita). Hoje há **1**
   evento retroativo na conta.
7. ⚠️⚠️ **NOVA — a carga DISPARA AUTOMAÇÃO.** O gatilho
   `cb_enfileira_evento_de_funil` (933) insere em `cb_automation_events` a
   cada `INSERT` em `deals` e a cada mudança de etapa/status, e o agendador da
   VPS drena a fila a cada ~60 s. Automações ativas na conta em 14/09:
   - **"Envio Webhook CB OS - Atlas"** — `deal_stage_changed` em
     *Bancário - Comercial › Contrato Fechado*, passos `add_tag` +
     `send_webhook`. **Cada contrato importado ou movido para lá vira um
     registro no CB OS.**
   - "Calendly → Reunião agendada" (gatilho do Calendly, não do funil) e
     "Teste do plano — follow-up (pode apagar)" (palavra-chave) não escutam o
     funil.
   - As 4 da régua do Asaas estão desligadas.
   Qualquer automação de etapa criada até a carga entra na mesma conta — com
   `send_message`, é mensagem de WhatsApp para milhares de clientes antigos.
   A carga não pode depender de "ninguém ligou nada". Decisão 10.
8. ⚠️ **NOVA — nome fixado e e-mail espelhado.** A carga é um escritor de
   `contacts.name`: nos 9 contatos com `nome_fixado_em` ela não pode trocar o
   nome (a marca protege contra o automático, e a carga é automática). E
   escrever `contacts.email` aciona o espelho da 1000 — é o comportamento
   desejado, mas a carga de e-mail passa pela aparagem da 1001 e não deve
   gravar o campo "E-mail" à mão por fora.
9. **NOVA — há outros escritores de ficha ao vivo.** Calendly (977), Asaas
   (994) e as duas ingestões de WhatsApp criam ficha por telefone o dia todo.
   A carga precisa ser **reexecutável** (idempotente pelo id da Kommo) e rodar
   de novo no dia do corte para pegar o delta — o cadastro dos dois lados muda
   ~30 leads por dia.

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

## Decisões pendentes

| # | Decisão | Opções |
| --- | --- | --- |
| 1 | De‑para dos funis e das 70 etapas | tabela acima, a preencher — incluir o que vira TAG (Pediu Demissão, Ag. Demissão, Foi demitido) |
| 2 | Migrar os 5.791 leads já fechados (46%)? | sim, com `status` fechado · só os 170 ganhos · não |
| 3 | Onde vão as anotações sem conversa (412 de lead + 5 de contato) | `deals.notes` concatenado · criar conversa vazia por contato · migration nova |
| 4 | 6 campos sem destino (Marcou reunião onde, Código ID, TAGs contem, Demitida ou demissão, Tempo da demissão, Grávida) | criar no CB CRM · descartar |
| 5 | Criar as 25 tags que faltam? | todas · só as usadas acima de N · nenhuma |
| 6 | Consertar os 43 nomes corrompidos? | sim · manter como está |
| 7 | 28 sem telefone e os contatos sem lead | descartar · migrar assim mesmo |
| 8 | **Nos 979 contatos que existem nos DOIS, quem vence?** | o CB CRM (só preenche buraco) · a Kommo (sobrescreve) · por campo |
| 9 | **Data dos eventos de funil dos leads importados** | histórico real da Kommo, `origin='retroativo'` · só criação e fechamento · nenhum evento |
| 10 | **NOVA — como a carga passa pelas automações** | carga com o gatilho da 933 fora do caminho (sessão de replicação, com os eventos da 912 escritos à mão) · pausar TODAS as automações durante a carga · limpar a fila antes do agendador |
| 11 | **NOVA — os 845 leads abertos de quem já tem card aqui** | a etapa da Kommo MOVE o card daqui · o card daqui fica e o lead vira histórico · caso a caso |
| 12 | **NOVA — responsáveis** | mapear usuário → membro (e Gabriel?) · deixar sem responsável |
| 13 | **NOVA — motivo de perda (1.122)** | campo `select` novo · tag · descartar |
| 14 | **NOVA — o corte** | quais entradas religar primeiro (n8n/Typebot → CB CRM), quem substitui os 5 webhooks de conversão, quanto tempo os dois convivem, e quando a equipe para de mover card na Kommo |
| 15 | **NOVA — as 118 tarefas abertas** | migrar para as tarefas por cliente (944) · descartar |

**Recomendação para a 8:** no nome, a Kommo tende a ser melhor — foi digitado
por SDR, enquanto o daqui costuma ser o nome de perfil do WhatsApp (640 dos
979 divergem) —, **exceto nos 9 fixados**, que ficam. E-mail e empresa: a
Kommo preenche buraco (aqui não há e-mail nenhum). Tag e campo personalizado
somam, nunca substituem.

**Recomendação para a 9:** histórico real, com `origin='retroativo'` — a
Kommo guarda as 27.610 mudanças desde junho/2025, então dá para reconstruir o
funil verdadeiro em vez de fabricar um pico no dia da carga.

**Recomendação para a 10:** a carga não pode depender de estado de tela. O
caminho mais seguro é a carga escrever `deals` sem passar pelo gatilho da 933
e escrever os eventos da 912 à mão (é o mesmo caminho da decisão 9) — pausar
automações deixa uma janela em que a produção fica sem automação para os
clientes de verdade.

**Recomendação para a 11:** a etapa da Kommo move o card — o card daqui é o
esboço que a conexão criou, e o trabalho do escritório está lá. Com a
decisão 10 resolvida antes, mover não dispara nada.

## Fases

- [x] **1. Levantamento** — refeito em 14/09/2026 (este documento).
- [ ] **2. De‑para e decisões** — as 15 decisões fechadas num arquivo de mapa
      versionado (sem dado de cliente: ids de funil, etapa, campo, tag e
      usuário).
- [ ] **3. Ensaio** — a carga rodando contra um Postgres local com o schema do
      replay e o bruto da Kommo, com relatório de diferença. Não existe banco
      de homologação: o `.env.local` aponta para a produção.
- [ ] **4. Religar entradas e saídas** — formulários e Typebot passam a chamar
      o CB CRM (webhooks de entrada da 982), e os 5 webhooks de conversão
      ganham substituto no CB CRM, antes da carga final.
- [ ] **5. Carga** — idempotente, por partes (contatos → tags → campos →
      negócios → eventos → anotações), com o id da Kommo carimbado. Reexecutada
      no dia do corte para o delta.
- [ ] **6. Conferência** — contagens dos dois lados, amostra na tela, e o
      relatório do funil comercial antes/depois.
- [ ] **7. Desligar** — a equipe para de usar a Kommo; revogar token e chave
      secreta da integração.

⚠️ **Esta medição vale por poucos dias.** Os dois lados mudam ~30 leads por
dia. Remedir (os 5 passos do topo) antes de escrever a carga.

## Credenciais

`KOMMO_TOKEN` e `KOMMO_API_BASE` no `.env.local` (gitignored). ⚠️ O token
**expira em 30/09/2026** — faltam 16 dias em 14/09, e a fase 5 dificilmente
termina antes. Gerar um novo na integração da Kommo antes de vencer. Ele foi
colado num chat durante o levantamento de 02/09 — **revogar na Kommo ao fim da
migração**, junto com a chave secreta da integração.
