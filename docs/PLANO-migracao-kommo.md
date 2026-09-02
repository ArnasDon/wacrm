# Plano — migração Kommo → CB CRM

> Documento vivo. Fase 1 (levantamento) **concluída em 02/09/2026**; as demais
> dependem das decisões da seção "Decisões pendentes".
>
> Reproduzir o levantamento: `node scripts/kommo/levantamento.mjs` (só leitura,
> não escreve em lugar nenhum). A saída vai para `.kommo-levantamento/`, que é
> gitignored — **contém dado de cliente e não pode ser versionado**.

## Situação medida (02/09/2026)

Conta Kommo `cbadvogados` (id 34706107), moeda BRL, 7 usuários.

| | Kommo | CB CRM hoje |
| --- | ---: | ---: |
| Contatos | 12.736 | 116 |
| Negócios / leads | 12.256 | 112 |
| Conversas | — | 118 |
| Funis | 6 (70 etapas) | 4 + 2 de teste (28 etapas) |
| Tags | 30 em lead, 3 em contato | 9 |
| Campos personalizados | 35 em lead, 3 em contato | 18 (só em contato) |

A migração multiplica a base por ~100. O CB CRM de hoje é praticamente vazio.

### O destino já foi preparado

Os 18 campos personalizados e as 9 tags que já existem no CB CRM **espelham a
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

9 das 30 tags da Kommo já existem no CB CRM por nome (Trabalhista, Bancário,
Cliente Fechado, Desqualificado…). As outras ~22 (TYPEBOT, 100K a 500K, adsBLOG,
PROCESSO PROT. TRAB, EM ATRASO, REVISIONAL, CONSIGNADO…) precisariam ser criadas.

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

## Decisões pendentes

| # | Decisão | Opções |
| --- | --- | --- |
| 1 | De‑para dos funis e das 70 etapas | tabela acima, a preencher |
| 2 | Migrar os 5.263 leads já fechados (43%)? | sim, com `status` fechado · só os 170 ganhos · não |
| 3 | Onde vão as 543 anotações | `deals.notes` concatenado · criar conversa por contato · migration nova |
| 4 | 5 campos da Kommo sem destino (2.452 valores) | criar no CB CRM · descartar |
| 5 | Criar as ~22 tags que faltam? | sim · só as usadas acima de N |
| 6 | Consertar os 48 nomes corrompidos? | sim · manter como está |
| 7 | 28 sem telefone e 607 sem lead | descartar · migrar assim mesmo |

## Fases

- [x] **1. Levantamento** — `scripts/kommo/levantamento.mjs`, só leitura. Feito.
- [ ] **2. De‑para** — decisões acima fechadas, num arquivo de mapa versionado.
- [ ] **3. Carga** — script idempotente, por partes (contatos → tags → campos →
      negócios → anotações), reexecutável. Chave de reconciliação: telefone
      normalizado + o id da Kommo carimbado num campo personalizado.
- [ ] **4. Conferência** — contagens dos dois lados e amostragem na tela.

## Credenciais

`KOMMO_TOKEN` e `KOMMO_API_BASE` no `.env.local` (gitignored). O token expira em
**30/09/2026**. ⚠️ Ele foi colado num chat durante o levantamento — **revogar na
Kommo assim que a migração terminar**, junto com a chave secreta da integração.
