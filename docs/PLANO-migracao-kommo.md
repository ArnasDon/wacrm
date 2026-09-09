# Plano — migração Kommo → CB CRM

> Documento vivo. Fase 1 (levantamento) **concluída em 02/09/2026**; as demais
> dependem das decisões da seção "Decisões pendentes".
>
> Reproduzir o levantamento: `node scripts/kommo/levantamento.mjs` (só leitura,
> não escreve em lugar nenhum). A saída vai para `.kommo-levantamento/`, que é
> gitignored — **contém dado de cliente e não pode ser versionado**.
>
> ⚠️ **Conferido contra o `main` em 08/09/2026** (118 commits e 10 migrations
> depois do levantamento). O de‑para de funis, campos e a trava das anotações
> seguem VÁLIDOS; o que mudou está em "O que mudou desde o levantamento".

## Situação medida

Conta Kommo `cbadvogados` (id 34706107), moeda BRL, 7 usuários. A coluna do
destino foi remedida em 08/09; a da Kommo é do levantamento de 02/09.

| | Kommo (02/09) | CB CRM em 02/09 | CB CRM em 08/09 |
| --- | ---: | ---: | ---: |
| Contatos | 12.736 | 116 | **515** |
| Negócios / leads | 12.256 | 112 | **513** |
| Conversas | — | 118 | **518** |
| Funis | 6 (70 etapas) | 4 + 2 de teste (28 etapas) | igual |
| Tags | 30 em lead, 3 em contato | 9 | **11** |
| Campos personalizados | 35 em lead, 3 em contato | 18 (só em contato) | igual |
| Anotações internas | 543 de texto | — | 28 |

⚠️ **O destino deixou de ser vazio, e a conta está VIVA** — o WhatsApp roda
todo dia e, desde 08/09, o Calendly cria ficha de cliente sozinho. A migração
não é mais "encher um CRM vazio": é fundir 12.570 cadastros numa base que
cresce ~65 contatos por dia.

### Sobreposição medida (08/09)

Casando `contacts.phone_normalized` com o primeiro telefone de cada contato da
Kommo:

| | Contatos |
| --- | ---: |
| Já existem nos DOIS (a carga reencontra, não cria) | **313** |
| Só na Kommo (criar) | 12.257 |
| Só no CB CRM (não vêm da Kommo) | 202 |

Os 313 são o caso interessante: são clientes com quem o escritório **falou esta
semana** pelo CRM. O dado deles aqui é mais novo que o da Kommo. Ver a decisão 8.

### O destino já foi preparado

Os 18 campos personalizados e as tags que já existem no CB CRM **espelham a
Kommo quase 1:1**. Isso não é coincidência e muda a natureza do trabalho: não é
modelagem, é de‑para.

## De‑para

### Campos personalizados — de LEAD (Kommo) para CONTATO (CB CRM)

⚠️ No CB CRM campo personalizado só existe em **contato**, e só em dois tipos
(`text` e `datetime`). Todo campo rico da Kommo (`tracking_data`, `date_time`,
lista) desce para um desses dois.

| Kommo (lead) | Preenchidos | CB CRM (contato) |
| --- | ---: | --- |
| Tamanho da dívida | 2.683 | Tamanho da Divida |
| Atraso da dívida | 2.249 | Tempo de Atraso |
| Origem dívida | 2.237 | Origem da Divida |
| Marcou reunião onde | 1.321 | ❓ não existe |
| URL Reunião | 1.280 | Link Reunião |
| Reunião Marcada (`date_time`) | 1.165 | Data e Hora Reunião |
| fbclid | 949 | fbclid |
| Conjunto anuncios | 877 | Nome do conjunto |
| Campanha | 877 | Nome da campanha |
| anuncio | 877 | Nome do anúncio |
| Código ID | 671 | ❓ não existe |
| Telefone (campo de lead) | 386 | → `contacts.phone` (não é campo) |
| E-mail (campo de lead) | 382 | → `contacts.email` (não é campo) |
| Data Proposta (`date`) | 338 | Data da Proposta |
| utm_source/medium/campaign/content/term | ~305 cada | utm_* (mesmos nomes) |
| TAGs contem | 298 | ❓ não existe |
| Demitida ou demissão | 81 | ❓ não existe |
| Tempo da demissão | 81 | ❓ não existe |

Sem origem na Kommo (ficam vazios): `ctwa_clid`, `Data do Primeiro Contato`,
`Data de Fechamento do Contrato`.

Os 14 campos restantes da Kommo têm **zero** preenchimentos — inclusive uma
segunda família `utm_*` do tipo `text`, duplicada da `tracking_data`. Não migram.

Campos de **contato** na Kommo: só os de sistema (Telefone, E-mail) e `Posição`,
com 0 preenchimentos. **Todo o dado rico está no lead.**

### Tags

⚠️ **Remedido em 08/09: são 11 tags no CB CRM, não 9.** Nasceram `Formulário` e
`Typebot`, e as duas casam com tag da Kommo — `FORMULÁRIO` (81 leads) e
`TYPEBOT` (2.425 leads, a 2ª mais usada de lá). A coluna "já existe no CB CRM?"
da planilha de de‑para está desatualizada para essas duas.

Hoje 11 das 30 tags da Kommo já existem por nome (Trabalhista, Bancário,
Cliente Fechado, Desqualificado, Typebot, Formulário…). As outras ~20 (100K a
500K, adsBLOG, PROCESSO PROT. TRAB, EM ATRASO, REVISIONAL, CONSIGNADO…)
precisariam ser criadas.

⚠️ No CB CRM a tag é do **contato**, não do negócio. Tag de lead vira tag do
contato vinculado — o que funciona porque quase todo lead tem exatamente um.

### Funis — 6 → 4, e é aqui que não há resposta automática

A Kommo separa por **função** (SDR → Closer → Onboarding → Pós-venda), com um
funil por **área** (Trabalhista). O CB CRM separa por **área × função**
(Bancário/Trabalhista × Comercial/Jurídico). Não há mapeamento óbvio.

| Funil Kommo | Leads | Destino provável |
| --- | ---: | --- |
| Trabalhista (18 etapas) | 8.115 | Trabalhista - Comercial + Trabalhista - Jurídico |
| Funil Pré Vendas (SDR) / Recuperação (14) | 3.282 | Bancário - Comercial |
| Jurídico (Atendimento Geral) (8) | 340 | Bancário - Jurídico |
| Funil de Vendas (Closer) (9) | 339 | Bancário - Comercial |
| Funil de Onboarding (12) | 178 | Bancário - Comercial? |
| Checkpoints (Pós Vendas) (9) | 2 | descartar? |

**Ganho e perdido não são etapa.** `status_id` 142 e 143 são nativos da Kommo e
compartilhados por todos os funis: **170 ganhos** e **5.093 perdidos**, ou seja
**43% dos leads já estão fechados**. No CB CRM isso é `deals.status`
(`won`/`lost`) + a etapa com `resultado` da migration 950 — não precisa de etapa
própria.

## Travas técnicas medidas

1. **Telefone é a chave e é obrigatório.** `contacts.phone` é `NOT NULL`, com
   índice único em `(account_id, phone_normalized)` (migration 022). Medido:
   - 28 contatos (0,2%) **sem telefone** — não têm como existir no CB CRM;
   - 116 números **duplicados**, envolvendo 254 contatos, que o banco funde
     sozinho (ex.: "Keyla momesso" e "Keylla Momesso" no mesmo número);
   - 95 telefones sem DDI 55 e 2 com menos de 10 dígitos;
   - **12.570 contatos distintos** ao fim, contra 12.736 na Kommo.
2. **Anotação exige conversa.** `cb_conversation_notes.conversation_id` é
   `NOT NULL` (918) e a `contact_notes` foi apagada na 922. Como só 118 conversas
   existem hoje, **nenhum contato importado terá onde receber anotação**. São
   543 anotações de texto (538 em 336 leads + 5 em contatos); o resto
   (`link_followed`, `lead_auto_created`, `call_out`) é registro de máquina e
   não se migra.
3. **A API pública v1 não escreve campo personalizado.** `POST /v1/contacts`
   aceita telefone, nome, e-mail, empresa e tags — nada além. A carga precisa ir
   por service-role direto no banco, reusando `createDeal` para os negócios.
4. **48 nomes vêm corrompidos da própria Kommo** — UTF-8 lido com a tabela
   errada, virando ideogramas: `Let铆cia Concei莽茫o`, `MARIA RITA LE脙O DA SILVA`,
   `Vanessa Val茅ria`. É recuperável por reinterpretação de bytes.
5. **607 contatos não têm lead nenhum.**
6. ⚠️⚠️ **A carga ESTRAGA o funil de eficiência se for feita ingenuamente**
   (trava NOVA, achada na conferência de 08/09). Inserir negócio dispara o
   trigger `cb_deals_log_event` (912), que grava `cb_lead_events` com
   `occurred_at = clock_timestamp()` — **a data da importação**, não a do lead.
   A RPC do funil comercial (975, em produção desde 04/09) lê exatamente
   `cb_lead_events` por `to_pipeline_id` + janela de `occurred_at`, filtrando
   só por `event_type`, **nunca por `origin`**. Resultado: 12.256 leads
   "chegando" no dia da carga, e o relatório que o operador acabou de montar
   vira ficção.
   **O caminho certo já existe no próprio repositório**: o backfill da 912
   escreve os eventos à mão, com `occurred_at = deals.created_at` e
   `origin = 'retroativo'` (o CHECK aceita esse valor justamente para isto).
   A carga faz igual — com a data real da Kommo — ou desliga o trigger e
   escreve os eventos depois. Decisão 9 diz qual das duas.

## O que mudou desde o levantamento (conferência de 08/09/2026)

118 commits e 10 migrations (972–981) entraram no `main`. Conferido item a item:

**Continua valendo, verificado ao vivo:**

- `contacts.phone` segue `NOT NULL` (lido no schema do PostgREST, não deduzido).
- `cb_conversation_notes.conversation_id` segue `NOT NULL` — **a trava das
  anotações não afrouxou**. Nenhuma migration nova tocou essa tabela.
- Os 18 campos personalizados: mesmos nomes, mesmos tipos, ainda só em contato.
- Os 4 funis e as 28 etapas: **nomes idênticos** aos de 02/09. A planilha de
  de‑para continua apontando para destinos que existem.
- `POST /v1/contacts` continua sem aceitar campo personalizado.

**Mudou, e o plano foi corrigido acima:**

- Volume do destino (515 contatos) e a sobreposição de 313.
- 11 tags, não 9.
- A trava 6 (funil de eficiência), inteiramente nova.

**Ferramenta nova que a carga deve usar:** `src/lib/contacts/telefone.ts`
(`digitosDoTelefone`), nascido para o Calendly na 977. Ele resolve exatamente
as formas que a Kommo devolve (`+55 96 99112-6767`, `(96) 99112-6767`,
`96991126767`) e decide DDI pelo `+` e pelo nono dígito na 3ª posição — a
guarda que impede um número americano de 11 dígitos virar brasileiro. A carga
usa esse módulo em vez de um normalizador próprio. ⚠️ Isso muda os números da
trava 1: os "95 telefones sem DDI 55" foram contados com um
`replace(/\D/g,'')` cru, e parte deles ganharia o 55 corretamente — **recontar
com `digitosDoTelefone` na fase 2**.

**Contexto novo que não bloqueia, mas muda o ambiente:**

- `pipeline_stages.degrau` (975) existe e está **NULO em todas as 30 etapas** —
  o operador ainda não mapeou. Se o mapeamento acontecer antes da carga, os
  leads importados entram já classificados; se depois, o funil de eficiência
  simplesmente não os conta até lá.
- Calendly (977–980) cria ficha de cliente sozinho desde 08/09, usando o mesmo
  `findExistingContact` — não conflita com a carga, mas é um segundo escritor.
- Apagar contato virou de admin (981). Importa para desfazer uma carga errada.

## Decisões pendentes

| # | Decisão | Opções |
| --- | --- | --- |
| 1 | De‑para dos funis e das 70 etapas | tabela acima, a preencher |
| 2 | Migrar os 5.263 leads já fechados (43%)? | sim, com `status` fechado · só os 170 ganhos · não |
| 3 | Onde vão as 543 anotações | `deals.notes` concatenado · criar conversa por contato · migration nova |
| 4 | 5 campos da Kommo sem destino (2.452 valores) | criar no CB CRM · descartar |
| 5 | Criar as ~20 tags que faltam? | sim · só as usadas acima de N |
| 6 | Consertar os 48 nomes corrompidos? | sim · manter como está |
| 7 | 28 sem telefone e 607 sem lead | descartar · migrar assim mesmo |
| 8 | **Nos 313 contatos que existem nos DOIS, quem vence?** | o CB CRM (só preenche buraco) · a Kommo (sobrescreve) · caso a caso por campo |
| 9 | **Data dos eventos de funil dos leads importados** | data real da Kommo, `origin='retroativo'` · sem evento nenhum (trigger desligado) |

As decisões **8** e **9** nasceram da conferência de 08/09 e não existiam no
plano original. A 8 porque o destino deixou de ser vazio; a 9 porque o funil de
eficiência entrou em produção no dia 04/09 e passou a ler a mesma trilha que a
carga vai escrever.

**Recomendação para a 8**, se ajudar a decidir: o CB CRM vence em nome, e-mail
e empresa (são 313 clientes com quem o escritório falou nesta semana — o dado
de lá é mais velho), e a Kommo entra só onde o campo está vazio. Tag e campo
personalizado somam, nunca substituem. Mas é chamada sua.

**Recomendação para a 9:** data real da Kommo com `origin='retroativo'`. Isso
reconstrói meses de histórico comercial verdadeiro em vez de fabricar um pico
no dia da carga — e é exatamente o que a própria 912 fez quando precisou.

## Fases

- [x] **1. Levantamento** — `scripts/kommo/levantamento.mjs`, só leitura. Feito
      em 02/09; conferido contra o `main` em 08/09.
- [ ] **2. De‑para** — decisões acima fechadas, num arquivo de mapa versionado.
      Refazer aqui a contagem de telefone com `digitosDoTelefone`.
- [ ] **3. Carga** — script idempotente, por partes (contatos → tags → campos →
      negócios → anotações), reexecutável. Chave de reconciliação: telefone
      normalizado + o id da Kommo carimbado num campo personalizado. Os eventos
      de funil seguem a decisão 9, nunca o trigger cru.
- [ ] **4. Conferência** — contagens dos dois lados, amostragem na tela **e o
      relatório do funil comercial antes/depois** (é o que a trava 6 ameaça).

⚠️ **A conferência de hoje vale por poucos dias.** O destino cresce ~65
contatos por dia e o `main` recebeu 118 commits em seis. Se a fase 3 não
começar nesta semana, remedir contagens e sobreposição antes de escrever a
carga — o resto do plano (schema, funis, campos) tem se mostrado estável.

## Credenciais

`KOMMO_TOKEN` e `KOMMO_API_BASE` no `.env.local` (gitignored). O token expira em
**30/09/2026**. ⚠️ Ele foi colado num chat durante o levantamento — **revogar na
Kommo assim que a migração terminar**, junto com a chave secreta da integração.
