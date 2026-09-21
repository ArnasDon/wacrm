# De‑para Kommo → CB CRM (DECIDIDO)

> **Este é o mapa da carga, fechado pelo operador em 19–20/09/2026.** Ele
> encerra as decisões 1, 18 e 19 do `docs/PLANO-migracao-kommo.md` e é o
> entregável da fase 2. Nada aqui foi executado ainda.
>
> Medido em **19/09/2026** com `scripts/kommo/levantamento.mjs` (Kommo: 6
> funis, 70 etapas, 12.716 leads, 13.225 contatos) e por consulta ao banco de
> produção em 20/09 (CB CRM: 4 funis, 28 etapas, 1.209 contatos, 960 negócios,
> 15 etiquetas).
>
> Só ids e nomes de configuração — nenhum dado de cliente.

⚠️ **As contagens desta página são de LEADS da Kommo, não de cards.** Um card
pode receber mais de um lead — ver a seção 4. Os leads das quatro tabelas
somam **12.714**; com os 2 do funil Checkpoints, descartado, fecham os 12.716.

---

## 1. Trabalhista ‑ Comercial — 8 etapas → **12**

| Pos | Etapa | Degrau | Resultado | Leads | Vem de (Kommo) |
| ---: | --- | --- | --- | ---: | --- |
| 0 | Entrada Avulsa | `lead` | — | 344 | Etapa de entrada |
| 1 | Entrada Anuncios | `lead` | — | 0 | — |
| 2 | ⭐ **Ag. Demissão** | `mql` | — | 887 | Ag. Demissão |
| 3 | ⭐ **Pediu Demissão** | `mql` | — | 1.155 | Pediu Demissão |
| 4 | ⭐ **Foi Demitido** | `mql` | — | 411 | Foi demitido |
| 5 | Qualificado | `mql` | — | 47 | SUPER QUALIFICADO |
| 6 | Link Enviado | `proposta` | — | 158 | Link enviado |
| 7 | Contrato Assinado | `contrato` | — | 40 | Contrato assinado (41 − 1 com SEG. TRAB) |
| 8 | Protocolado | `contrato` | **ganho** | 679 | Protocolado (742) + Ganho (171) − 234 com SEG. TRAB |
| 9 | Não Respondeu | `perda` | **perdido** | 1.571 | Não respondeu 1ª mensagem |
| 10 | Desqualificado ‑ Sem Direito | `perda` | **perdido** | 15 | Desqualificado ‑ conferir |
| 11 | ⭐ **Perdido** | `perda` | **perdido** | 2.719 | descarte (143) |

**Total: 8.026 leads.** As três perdas descem para o fim do quadro (hoje
"Não Respondeu" e "Desqualificado" ocupam as posições 2 e 3).

⚠️ **O funil trabalhista não tem etapa de reunião.** Como o alcance é
monotônico, o Desempenho vai mostrar a linha "Reunião" com o mesmo número de
"Proposta". É honesto, mas aquela linha não pode ser lida como "reuniões
realizadas". Decisão consciente do operador.

⚠️ **"Ag. Demissão" quer dizer que a pessoa ainda NÃO foi demitida** — não há
caso ainda. São 887 dos 2.453, contados como `mql` junto com as outras duas.
Registrado porque é a primeira coisa que alguém vai questionar ao ler a taxa.

---

## 2. Trabalhista ‑ Jurídico — 5 etapas → **7**

| Pos | Etapa | Degrau | Leads | Vem de (Kommo) |
| ---: | --- | --- | ---: | --- |
| 0 | Avulso | — | 31 | Contato avulso |
| 1 | ⭐ **Pendente Documento** | — | 75 | pendente documento |
| 2 | ⭐ **Em Elaboração** | — | 35 | Em Elaboração (17) + documentos recebidos (23) − 5 com SEG. TRAB |
| 3 | Cliente Ativo | — | 0 | — |
| 4 | Cliente Finalizado | — | 0 | — |
| 5 | Contato de Emergência | — | **240** | os leads com a etiqueta CONTATO SEG. TRAB |
| 6 | Contato Acordo | — | 35 | Contato acordo |

**Total: 416 leads.** Nenhum degrau: é pós‑venda, e quem conta o contrato é o
funil comercial.

A etapa "documentos recebidos" da Kommo **não vira etapa aqui** — decisão do
operador: os 23 leads dela entram em "Em Elaboração".

### ⚠️ Os 240 de "Contato de Emergência"

São os leads com a etiqueta **CONTATO SEG. TRAB** (242 na Kommo). Medido em
20/09, onde eles estavam:

| Etapa na Kommo | Leads |
| --- | ---: |
| Protocolado | 225 |
| Ganho | 9 |
| documentos recebidos | 3 |
| Em Elaboração | 2 |
| Contrato assinado | 1 |
| descarte | **2 — ficam em Trabalhista ‑ Comercial › Perdido** |

**234 dos 242 são contratos já protocolados.** Eles saem da coluna Protocolado
e vão para o jurídico — que é o fluxo normal do escritório ("fechou →
transfere para o jurídico → continua ganho"). **A métrica não se perde:** o
negócio transferido continua contando no funil de origem (regra 6 do funil
comercial), então os 234 seguem sendo contrato no Trabalhista ‑ Comercial.

Os **2 em descarte não são movidos** — pô‑los numa etapa ativa do jurídico
ressuscitaria lead morto.

---

## 3. Bancário ‑ Comercial — 11 etapas, **nenhuma nova**

Só o `degrau` a marcar (hoje todos nulos) e um `resultado` a acrescentar.

| Pos | Etapa | Degrau | Resultado | Leads | Vem de (Kommo) |
| ---: | --- | --- | --- | ---: | --- |
| 0 | Contato Avulso | `lead` | — | 2 | Contato inicial |
| 1 | Desqualificado | `perda` | **marcar `perdido`** | 0 | DESQUALIFICADO |
| 2 | Lead ‑ Type e Forms | `lead` | — | 255 | TYPEBOT e FORMS ‑ Contato Inicial |
| 3 | MQL 1 ‑ Recebeu Link | `mql` | — | 32 | Recebeu Link e não agendou (31) + Recuperação waba (1) |
| 4 | Reunião Agendada | `reuniao` | — | 68 | REUNIÃO Agendada BOT (62) + Link avulso (6) |
| 5 | MQL 2 ‑ Reunião Qualificada | `reuniao` | — | 11 | Qualificado pós Agendamento |
| 6 | No Show | `reuniao` | **nenhum** | 102 | no‑show reagen manual (91) + recuperar auto (11) |
| 7 | Reunião Sem Proposta | `reuniao` | — | 20 | Reunião Sem Proposta |
| 8 | Proposta Realizada | `proposta` | — | 275 | f.u manual (181) + f.u auto (77) + muito quente (11) + +30d (5) + Fechar (1) |
| 9 | Contrato Fechado | `contrato` | ganho ✓ | 1 | Contrato fechado (1) + Fechado ‑ ganho (0) |
| 10 | Perdido | `perda` | perdido ✓ | 2.982 | Fechado ‑ perdido (2.924) + Venda perdida (57) + descarte Onboarding (1) |

**Total: 3.748 leads.**

⚠️ **No Show fica `reuniao` e SEM resultado**, mais a etiqueta No‑Show. A
reunião foi marcada — isso aconteceu, e a taxa de agendamento tem de refletir.
Marcá‑lo como perdido fecharia o card e o tiraria do alcance da automação de
recuperação.

⚠️ **"Desqualificado" ganha `resultado = perdido`**, que hoje está nulo. Sem
ele, o card que cai ali fica com status "aberto" e continua sendo alvo de
automação.

⚠️ Os 183 leads de Onboarding não aparecem nesta coluna — eles pousam no
Bancário ‑ Jurídico —, mas o **histórico** deles passa por "Contrato Fechado",
que é o que faz o contrato contar no funil comercial.

---

## 4. Bancário ‑ Jurídico — 4 etapas, **nenhuma nova**

| Pos | Etapa | Degrau | Leads | Vem de (Kommo) |
| ---: | --- | --- | ---: | --- |
| 0 | Contato Avulso | — | 31 | Jurídico › contato avulso |
| 1 | Cliente Ativo | — | 416 | cliente ativo (234) + iniciar onboarding (52) + Onboarding Finalizado (78) + documentos solicitados (36) + docs com pendência (16) |
| 2 | Cliente Inativo | — | 10 | cliente rescindido (10) + Cliente encerrado (0) |
| 3 | Contato Banco | — | 67 | Contato banco |

**Total: 524 leads.** As etapas "documentos solicitados" e "docs com
pendência" do Onboarding **não viram etapa aqui** — decisão do operador: os 52
leads entram em "Cliente Ativo".

As 7 etapas vazias do Onboarding (agendar reunião, reunião realizada, docs
completos, criar tarefa advbox, pendência e as duas de entrada) não migram.

---

## 5. Etapas a criar — **6, e só estas**

| Funil | Etapas novas |
| --- | --- |
| Trabalhista ‑ Comercial | Ag. Demissão · Pediu Demissão · Foi Demitido · Perdido |
| Trabalhista ‑ Jurídico | Pendente Documento · Em Elaboração |
| Bancário ‑ Comercial | nenhuma |
| Bancário ‑ Jurídico | nenhuma |

**28 etapas hoje → 34.** ⚠️ Depois da carga, apagar qualquer etapa mapeada
fica caro: é preciso tirar o degrau antes, e isso apaga a história dela do
funil (trava 12 do plano). **A estrutura fecha aqui.**

---

## 6. Um card por PESSOA e por ÁREA

**A regra:** cada pessoa ganha **no máximo um card por área** (Trabalhista ×
Bancário). Medido:

| | Cards | Pessoas com 2+ cards |
| --- | ---: | ---: |
| um card por lead (espelho da Kommo) | 12.687 | 266 |
| um card por pessoa | 12.387 | 0 |
| **um card por pessoa e área** ← escolhido | **12.389** | **2** |
| ↳ mais os 222 extras com desfecho (seção 6b) | **12.611** | 2 |

**Os 298 leads extras se repartem em dois destinos** (fechado em 20/09, ver a
seção 6b): os **222 que têm desfecho** ganham card próprio, fechado; os **76
que continuam abertos** têm a trajetória FUNDIDA no card sobrevivente. Total:
**12.611 cards**.

**Quem sobrevive:** o lead mais recente entre os **abertos**; não havendo
aberto, o mais recente de todos. É o que responde "onde essa pessoa está hoje".

**"Pessoa" é o telefone pela régua tolerante ao nono dígito**
(`variantesDoNonoDigito`), **nunca** os últimos 8 dígitos de `phonesMatch`. A
diferença foi medida: pelos últimos 8, 14 sufixos teriam mais de uma pessoa
(32 envolvidas), 13 deles com DDD ou DDI diferente — gente diferente.

### Por que esta é a regra

Na Kommo, a mesma pessoa vira vários leads, e cada lead era elegível para a
própria sequência de automação — daí a mensagem repetida para o mesmo número.
Medido: **266 pessoas com mais de um lead** (566 leads), 85 com mais de um
lead **aberto**. O caso extremo é uma pessoa com **13 leads, todos parados na
mesma etapa** "TYPEBOT e FORMS ‑ Contato Inicial": ela preencheu o formulário
13 vezes.

| Leads por pessoa | Pessoas |
| ---: | ---: |
| 1 | 12.121 |
| 2 | 246 |
| 3 | 16 |
| 4 | 2 |
| 5 | 1 |
| 13 | 1 |

⚠️ **Consequência visível, e é a correção, não perda:** o funil histórico vai
mostrar ~300 leads a MENOS do que a Kommo reportava. A pessoa dos 13
formulários conta como **1**. Os números da Kommo estavam inflados pelo próprio
defeito.

⚠️ **O CB CRM não garante isso no banco.** `contacts` (telefone) e
`conversations` (um por contato, migration 036) têm índice único — essas duas
fusões são garantidas pelo Postgres. O **negócio** não: a regra "um card por
contato" mora no código, conferida por cada chamador antes do insert, e o
índice único da 911 só cobre `source = 'channel'`. **É responsabilidade da
carga.**

---

## 6b. Os 298 leads extras — decidido em 20/09

Todo evento de funil precisa de um `deal_id` que EXISTA. Não há chave
estrangeira, então um id inventado entra no banco — mas a trajetória some das
três vistas do funil (fica só na ficha do contato). E pendurar TODOS os eventos
no card sobrevivente faz o funil contar um contrato que não tem card: um
contato com um lead antigo GANHO e um lead novo ABERTO viraria um card parado
em "Entrada Avulsa" afirmando que alcançou contrato.

Medido em 20/09, os 298 se repartem assim:

| Situação do lead extra | Leads | Destino |
| --- | ---: | --- |
| Ganho | 123 | **card próprio, fechado** |
| Perdido | 71 | **card próprio, fechado** |
| Aberto, mas pousa em etapa com `resultado` | 28 | **card próprio** (o gatilho da 950 o fecha ao entrar) |
| **Aberto de verdade** | **76** | **trajetória fundida no card sobrevivente** |

**A régua:** *lead que chegou a um desfecho é um caso distinto e ganha o próprio
card fechado; lead ainda aberto é entrada duplicada da mesma jornada e se
funde.* Dois leads abertos da mesma pessoa na MESMA ÁREA são a duplicata que a
Kommo fabricava — é ela que a decisão C existe para desfazer. E nenhum card
ABERTO se duplica, que era o custo que fazia a opção "um card por lead" ser
recusada.

**Total: 12.611 cards.** As três saídas que foram descartadas: card para todos
os 298 (12.687, com 76 pessoas tendo dois cards abertos) e "só histórico" com
id inventado (a história dos 298 sumiria do Desempenho e da Saúde).

⚠️ **Fundir é seguro para a métrica, e o motivo é o alcance ser monotônico:** a
trajetória do lead fundido acrescenta ao sobrevivente os degraus por onde
aquela pessoa passou, o que é verdade sobre a pessoa. O caso que estragaria —
um extra que alcançou `contrato` fundido num card aberto — não existe aqui: os
26 extras abertos em "Protocolado" pousam numa etapa com `resultado = ganho` e
portanto estão entre os 28 que ganham card próprio, não entre os 76.

⚠️⚠️ **A idempotência dos eventos fundidos vem do CARD, não do evento.**
`cb_lead_events` não tem restrição única, então reexecutar a carga duplicaria os
eventos dos 76 — eles não têm `deals.kommo_lead_id` próprio, porque não têm card.
A regra que fecha isso: **se o card sobrevivente já existe (por
`kommo_lead_id`), o GRUPO inteiro é pulado — eventos fundidos inclusive.** A
procedência de cada lead fundido continua legível em
`cb_lead_events.details->>'kommo_lead_id'`.

## 7. Etiquetas — reusa 8, cria 1

| | Etiqueta do CB CRM | Recebe | De onde |
| --- | --- | ---: | --- |
| reusa | Trabalhista | 8.352 | etiqueta TRABALHISTA |
| reusa | Typebot | 2.505 | etiqueta TYPEBOT |
| reusa | Desqualificado | 1.672 | etiqueta DESQUALIFICADO |
| reusa | Bancário | 1.253 | etiqueta BANCÁRIO |
| reusa | Cliente Fechado | 1.189 | etiqueta CLIENTE FECHADO |
| reusa | Formulário | 302 | etiqueta FORMULÁRIO |
| reusa | No‑Show | 102 | **a ETAPA** de no‑show da Kommo |
| reusa | Rescindido | 15 | etiqueta CLIENTE RESCINDIDO |
| **cria** | **kommo** | ~12.980 | origem, cor `#6b7280` |

**15 etiquetas hoje → 16.** As outras 23 da Kommo **não são criadas** (decisão
do operador). Casam por `chaveDeTag` (aparado, sem acento, minúsculas), então
a carga reusa em vez de duplicar.

⚠️ A etiqueta `kommo` é o que permite excluir os importados de um disparo
"para todos", que salta de 1.209 para ~12.980 destinatários. É o precedente do
Asaas.

⚠️ **Etiqueta aqui é do CONTATO, não do negócio.** As 266 pessoas com mais de
um lead acumulam as etiquetas de todos eles.

⚠️ **A carga aplica etiqueta por INSERT DIRETO em `contact_tags`**, como a
integração do Asaas faz — nunca por `tag-events.ts`, que dispararia o gatilho
`tag_added` das automações milhares de vezes.

⚠️ As etiquetas **Ag. Demissão**, **Pediu Demissão** e **Demitida** continuam
existindo e **zeradas**: aquelas três situações viraram ETAPA. A etiqueta
"NO SHOW" da Kommo (1 uso, grafia sem hífen) é unificada na "No‑Show" daqui.

### O que se perde, e está aceito

- **Redundante** — PROCESSO PROT. TRAB (625) já é a etapa Protocolado; NÃO
  RESPONDEU (245 contatos) já é a etapa Não Respondeu; PROPOSTA RECEBIDA
  CHATGURU (186) já é Proposta Realizada; EM ATRASO (355) e EM DIA (156) o
  Asaas responde ao vivo.
- **Perde informação** — REVISIONAL (119), CONSIGNADO (29) e SUPERENDIVIDAMENTO
  (10) dizem o TIPO do caso bancário, que nenhuma etapa responde: 158 leads.
  adsBLOG (652) e Leads AVN (343) dizem a origem, parcialmente coberta pelos
  campos de anúncio. CPF e CNPJ (183), VÃO ENTRAR (35), DESISTIU (34).
- **Substituído por campo** — 100K a 500K (1.433), ‑100K (292) e +500K (2)
  viram o campo "Tamanho da Divida", que é mais preciso (2.813 leads
  preenchidos).

---

## 8. Conversas e anotações

**543 anotações de texto** (538 de lead + 5 de contato) alcançando **347
contatos**. Destes, 122 já existem no CB CRM e **64 já têm conversa**.

> **283 conversas novas, todas nascendo ENCERRADA.**

- Status encerrada, sem mensagem nenhuma: não aparecem na aba "Abertas".
- Sem `last_message_at` → vão para o fim da lista.
- `user_id` = `accounts.owner_user_id` (dono durável), nunca um membro.
- Quando o cliente escrever, a conversa **reabre sozinha** — e a anotação já
  está lá esperando.

As anotações entram em `cb_conversation_notes` com **`autor_nome`** preenchido
com o nome de quem escreveu na Kommo (a coluna é texto livre),
`author_user_id` **nulo** (o autor não é membro daqui) e `created_at`
**original**. Os 64 contatos que já têm conversa recebem as anotações **dentro
da conversa existente**, na posição cronológica delas.

⚠️ **Uma anotação não tem contato vinculado** e não tem destino possível.

⚠️ **Pré‑requisito:** o [PR #227](https://github.com/leonardocabralb/CB-CRM/pull/227)
precisa estar mesclado. A lista de conversas não paginava — 283 conversas a
mais fariam o inbox cortar em silêncio.

---

## 9. Contatos

| Situação | Contatos |
| --- | ---: |
| Novos — não existem no CB CRM | 11.989 |
| Casam **exatamente** pelo telefone | 857 |
| Casam pelo **nono dígito** (mesma pessoa, outra grafia) | 346 |
| **Ambíguos** — últimos 8 batem, o resto não | **4** |
| Sem telefone — **não migram** | 29 |

13.196 com telefone → **12.979 pessoas**. Do lado de cá, **1.150 dos 1.209**
contatos recebem dado da Kommo; 59 a Kommo não conhece.

⚠️⚠️ **`contacts.phone` é SÓ DÍGITOS COM DDI**, nunca o texto da Kommo. Gravado
com separadores ("+55 83 98874-5316"), a ficha entra no banco normalmente e **a
primeira mensagem daquele cliente é descartada em silêncio — e todas as
seguintes, para sempre.** A busca não acha a ficha, o INSERT leva violação do
índice único, a recuperação falha igual, e a ingestão desiste sem gravar; o
WhatsApp já respondeu 200 e não retenta.

**Os 4 ambíguos não são fundidos.** Cada um nasce como ficha nova, e a lista
dos 4 (com nome e número) vai para o operador no ensaio. Fundir duas pessoas é
irreversível — leva a conversa e todas as mensagens junto —, e um dos quatro é
DDD 82 contra DDD 15: gente diferente.

| Kommo | CB CRM | Leitura |
| --- | --- | --- |
| `5582…8785` | `5515…8785` | DDD 82 × 15 — **duas pessoas** |
| `5911…1769` | `5511…1769` | "59" onde devia ser "55" — erro de digitação |
| `5555…1315` (15 díg.) | `5555…1315` (12) | número malformado |
| `5548…9154` (14 díg.) | `5548…9154` (13) | um dígito a mais |

⚠️ **E eles têm um custo que o teste de esforço mediu:** com dois registros cujo
sufixo de 8 dígitos bate, a resolução de contato da ingestão é
**não-determinística** — a consulta não ordena e devolve o primeiro que passar
no teste tolerante, e a escolha pode INVERTER de um dia para o outro (qualquer
UPDATE move a tupla no heap). A mensagem do cliente pode ir para a conversa do
outro. O conserto é de CÓDIGO (preferir o telefone exato antes do tolerante) e
está na lista de consertos do plano principal.

**Nome:** o da Kommo vence nos que existem nos dois lados e fica **FIXADO**
(`contacts.nome_fixado_em`), exceto nos **297** já fixados à mão. Sem fixar, o
apelido do WhatsApp apaga 15 meses de trabalho do SDR em poucos dias. Todo nome
passa por `nomeParaFixar`, que recusa número.

**43 nomes corrompidos** são consertados (reinterpretação de bytes).

---

## 10. Valor

A Kommo tem **um** campo de valor (`price`), e ele é o da **proposta**.

| | Leads | Soma |
| --- | ---: | ---: |
| Abertos | 6.844 | **R$ 9.908.350** |
| Ganhos (142) | 171 | **R$ 0** |
| Perdidos (143) | 5.701 | R$ 669.800 |

**Decisão: trazer o `price` em TODOS os leads**, como valor de proposta.

⚠️ **O Desempenho vai mostrar R$ 0,00 de valor fechado em todos os meses
históricos**, porque os ganhos da Kommo valem zero de verdade. Não é defeito da
carga — é o que o dado diz. O **funil Trabalhista inteiro não tem valor
nenhum**: zero nas 18 etapas, inclusive nos 742 protocolados. O honorário
trabalhista nunca foi registrado na Kommo.

---

## 11. Campos personalizados

| Campo da Kommo | Preenchidos | Destino |
| --- | ---: | --- |
| O email (contato) | **1.906** | `contacts.email` — ⚠️ SÓ onde está vazio (ver abaixo) |
| Campanha | 1.224 | `nome_da_campanha` |
| Conjunto anuncios | 1.224 | `nome_do_conjunto` |
| anuncio | 1.224 | `nome_do_anuncio` |
| Tamanho da dívida | **2.813** | `tamanho_da_divida` |
| — | — | ⭐ **id do contato da Kommo**, em bloco próprio "Migração" |

**Nada mais.** Ficam de fora: Marcou reunião onde (1.371), URL Reunião (1.331),
Reunião Marcada (1.216), fbclid (1.025), Código ID (671), Data Proposta (358),
os 5 utm_* (~305 cada), Atraso da dívida (2.376), Origem dívida (2.367), TAGs
contem (298), Demitida (302), Tempo da demissão (302), Grávida (13).

⚠️ **O id do LEAD não cabe em campo personalizado** — eles só existem em
contato, e uma pessoa pode ter mais de um card. Ele vai na coluna
**`deals.kommo_lead_id`** (migration **1012**, já aplicada), com índice único
parcial `(account_id, kommo_lead_id)`: é ELA que torna a carga reexecutável.
O `cb_lead_events.details->>'kommo_lead_id'` continua sendo gravado, mas como
**procedência** na trilha — nunca como chave de idempotência.

⚠️⚠️ **A carga resolve o campo por `field_key` e ABORTA se algum faltar —
nunca cria pelo nome.** Os quatro já existem. Criar "pelo nome da Kommo" geraria
campo NOVO sem colidir: os 3.672 valores de anúncio pousariam em chaves que
ninguém lê, `{{contact.origem}}` continuaria vazio no aviso que o advogado
recebe a cada agendamento, e "Tamanho da Divida" ganharia um segundo campo com
o mesmo rótulo na ficha. São 6.485 valores fora de alcance, sem erro nenhum.

⚠️⚠️ **A carga escreve SOMENTE nesta allowlist** e aborta em qualquer outro
destino. `Data e Hora Reunião` e `Link Reunião` são do Calendly — **106 valores
vivos** — e não são território da Kommo.

⚠️⚠️ **O e-mail entra por UM lado só, e só onde está vazio.** `contacts.email`
tem espelho no banco (migrations 1000/1001): gravar os dois lados dá violação de
índice e derruba o lote. E o CRM tem **54** e-mails hoje — do Calendly e do
Asaas, os mais recentes da base —, contra um da Kommo de até 15 meses atrás.
Sobrescrevê-los faria o vínculo automático do tl;dv casar pelo e-mail errado.

⚠️ **Uma pessoa com 2 leads tem 2 valores.** O campo é do CONTATO. Regra:
vence o valor NÃO-VAZIO mais recente entre TODOS os leads da pessoa (ordem por
`updated_at` do lead, desempate pelo id), e nunca se grava linha vazia. Nos três
campos de anúncio, os três vêm do MESMO lead — o mais recente com qualquer um
deles preenchido —, para não fabricar uma tripla que nunca existiu.

---

## 12. Responsáveis — nenhum

| Usuário da Kommo | Leads |
| --- | ---: |
| Gabriel Queiroz | 8.088 |
| Leonardo Cabral | 3.871 |
| Trabalhista (login compartilhado) | 559 |
| Cabral Baptista Advocacia | 96 |

**Todos os cards nascem sem responsável.** Gabriel Queiroz responde por 64% dos
leads e não é membro do CB CRM; atribuir 8.088 cards a alguém encheria a fila
dessa pessoa com trabalho de 15 meses atrás.

---

## 13. O que é descartado

- O funil **Checkpoints (Pós Vendas)** inteiro (2 leads).
- O **motivo de perda**: dos 5.701 perdidos, 1.122 têm motivo e é sempre **o
  mesmo** (id `29511951`); 4.579 não têm nenhum.
- As **118 tarefas abertas** (são da operação da Kommo, de dono que não é
  membro daqui).
- As **23 etiquetas** da seção 7.
- Os **13 campos personalizados** da seção 11.
- As **1.481 anotações automáticas** da Kommo (`lead_auto_created`,
  `link_followed`, geolocalização) e as 19 de chamada, 18 de geolocalização,
  7 de IA e 7 de anexo.
- Os **29 contatos sem telefone**.
