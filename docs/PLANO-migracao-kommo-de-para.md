# De‑para Kommo → CB CRM (PROPOSTA)

> **Este arquivo é uma PROPOSTA para o operador corrigir.** Ele fecha as
> decisões 1, 18 e 19 do `docs/PLANO-migracao-kommo.md` e é o entregável da
> fase 2. Nada aqui foi executado.
>
> Medido em **19/09/2026** com `scripts/kommo/levantamento.mjs` (Kommo: 6
> funis, 70 etapas, 12.716 leads) e por consulta ao banco de produção (CB CRM:
> 4 funis, 28 etapas, 960 negócios, 13 etiquetas, 19 campos).
>
> Só ids e nomes de configuração — nenhum dado de cliente.

## Como ler e como responder

Cada linha é uma etapa da Kommo. As colunas:

- **Leads** — quantos estão nela HOJE. Lead ganho ou perdido não fica na etapa
  de trabalho: a Kommo o move para `Ganho` (142) ou `descarte` (143), então a
  etapa por onde ele passou só existe no HISTÓRICO. É por isso que a decisão 9
  (histórico real) não é opcional nem para saber a etapa final de quem fechou.
- **Destino** — funil › etapa do CB CRM. `CRIAR` = a etapa não existe aqui.
- **Degrau** — o que a etapa vale no funil de eficiência
  (`lead` → `mql` → `reuniao` → `proposta` → `contrato`, ou `perda`). Nulo =
  não conta.
- **?** — marca as linhas em que eu chutei e você decide.

Responda na própria tabela (ou me diga por cima): trocar o destino, trocar o
degrau, ou dizer "descartar".

---

## 1. Trabalhista (18 etapas · 8.372 leads) → Trabalhista - Comercial e Jurídico

| # | Etapa da Kommo | Leads | Destino proposto | Degrau | ? |
| ---: | --- | ---: | --- | --- | :-: |
| 10 | Etapa de leads de entrada | 0 | — (etapa oculta da Kommo) | — | |
| 20 | Etapa de entrada | 344 | T‑Comercial › Entrada Avulsa | `lead` | |
| 40 | Não respondeu 1ª mensagem | 1.571 | T‑Comercial › Não Respondeu | `perda` | |
| 50 | Desqualificado ‑ conferir | 15 | T‑Comercial › Desqualificado ‑ Sem Direito | `perda` | |
| 60 | Ag. Demissão | 887 | **CRIAR** T‑Comercial › Ag. Demissão | `mql` | ❓ |
| 70 | Pediu Demissão | 1.155 | **CRIAR** T‑Comercial › Pediu Demissão | `mql` | ❓ |
| 80 | Foi demitido | 411 | **CRIAR** T‑Comercial › Foi Demitido | `mql` | ❓ |
| 90 | SUPER QUALIFICADO | 47 | T‑Comercial › Qualificado | `mql` | |
| 100 | Link enviado | 158 | T‑Comercial › Link Enviado | `proposta` | ❓ |
| 110 | Contrato assinado | 41 | T‑Comercial › Contrato Assinado | `contrato` | |
| 150 | Protocolado | 742 | T‑Comercial › Protocolado | `contrato` | |
| 120 | pendente documento | 75 | **CRIAR** T‑Jurídico › Pendente Documento | — | ❓ |
| 130 | documentos recebidos | 23 | **CRIAR** T‑Jurídico › Documentos Recebidos | — | ❓ |
| 140 | Em Elaboração | 17 | **CRIAR** T‑Jurídico › Em Elaboração | — | ❓ |
| 30 | Contato acordo | 35 | T‑Jurídico › Contato Acordo | — | |
| 160 | Contato avulso | 31 | T‑Jurídico › Avulso | — | |
| 10000 | **Ganho** (142) | 171 | T‑Comercial › Protocolado | `contrato` | ❓ |
| 11000 | **descarte** (143) | 2.719 | **CRIAR** T‑Comercial › Perdido | `perda` | ❓ |

**O que precisa de decisão aqui**

1. **Ag. Demissão / Pediu Demissão / Foi demitido — 2.453 leads (29% do
   funil).** No CB CRM elas viraram ETIQUETAS (existem, com zero uso). Como
   etiqueta, esses 2.453 leads teriam de pousar em alguma outra etapa e a
   distinção sumiria do funil. Proponho virarem etapas. Se preferir etiqueta,
   diga em qual etapa eles pousam.
2. **O funil Trabalhista não tem reunião.** Como o alcance é monotônico
   (chegar em `proposta` marca `reuniao` junto), o Desempenho vai mostrar a
   linha "Reunião" com o mesmo número de "Proposta". É cosmético e honesto —
   só não dá para ler aquela linha como "reuniões realizadas". Alternativa:
   deixar `Link enviado` como `reuniao` e `Contrato assinado` como `proposta`.
3. **"Ganho" (171) versus "Protocolado" (742).** Os dois querem dizer
   contrato. Mandar os 171 para Protocolado junta as duas populações; criar
   uma etapa "Ganho" separada as mantém distintas. Note que Protocolado já
   tem `resultado = ganho`, então o card fecha sozinho ao entrar.
4. **Falta uma etapa de perda genérica no Trabalhista - Comercial.** Os 2.719
   em `descarte` não cabem em "Não Respondeu" nem em "Desqualificado ‑ Sem
   Direito" — são descarte por qualquer motivo.

---

## 2. Funil Pré Vendas (SDR) / Recuperação (14 · 3.395) → Bancário - Comercial

| # | Etapa da Kommo | Leads | Destino proposto | Degrau | ? |
| ---: | --- | ---: | --- | --- | :-: |
| 10 | Etapa de leads de entrada | 0 | — | — | |
| 20 | Contato inicial | 2 | B‑Comercial › Contato Avulso | `lead` | |
| 30 | TYPEBOT e FORMS ‑ Contato Inicial | 255 | B‑Comercial › Lead ‑ Type e Forms | `lead` | |
| 40 | DESQUALIFICADO | 0 | B‑Comercial › Desqualificado | `perda` | |
| 50 | Recebeu Link e não agendou | 31 | B‑Comercial › MQL 1 ‑ Recebeu Link | `mql` | |
| 60 | Recuperação com modelo waba | 1 | B‑Comercial › MQL 1 ‑ Recebeu Link | `mql` | |
| 90 | REUNIÃO Agendada BOT (Qualificar) | 62 | B‑Comercial › Reunião Agendada | `reuniao` | |
| 100 | Reunião Agendada ‑ Link avulso | 6 | B‑Comercial › Reunião Agendada | `reuniao` | |
| 110 | Qualificado pós Agendamento | 11 | B‑Comercial › MQL 2 ‑ Reunião Qualificada | `reuniao` | |
| 70 | no‑show ‑ reagen manual | 91 | B‑Comercial › No Show | `reuniao` | ❓ |
| 80 | No‑Show ‑ recuperar auto | 11 | B‑Comercial › No Show | `reuniao` | ❓ |
| 120 | Fechar | 1 | B‑Comercial › Proposta Realizada | `proposta` | |
| 10000 | Fechado ‑ ganho (142) | 0 | B‑Comercial › Contrato Fechado | `contrato` | |
| 11000 | Fechado ‑ perdido (143) | 2.924 | B‑Comercial › Perdido | `perda` | |

**Decisão:** o **No Show** é `reuniao` (a reunião foi marcada, o cliente
faltou — conta como reunião alcançada e o lead segue vivo) ou `perda`? Hoje a
etapa "No Show" do CB CRM não tem nem degrau nem resultado, então ela não
decide nada sozinha. São 102 leads.

---

## 3. Funil de Vendas (Closer) (9 · 352) → Bancário - Comercial

| # | Etapa da Kommo | Leads | c/ valor | Destino proposto | Degrau |
| ---: | --- | ---: | ---: | --- | --- |
| 10 | Etapa de leads de entrada | 0 | 0 | — | — |
| 20 | Reunião Sem Proposta | 20 | 5 | B‑Comercial › Reunião Sem Proposta | `reuniao` |
| 30 | reunião proposta ‑ f.u manual | 181 | 177 | B‑Comercial › Proposta Realizada | `proposta` |
| 40 | reunião proposta ‑ f.u auto | 77 | 74 | B‑Comercial › Proposta Realizada | `proposta` |
| 50 | Muito bom ‑ muito quente | 11 | 11 | B‑Comercial › Proposta Realizada | `proposta` |
| 60 | + 30d ‑ recup manual | 5 | 3 | B‑Comercial › Proposta Realizada | `proposta` |
| 70 | Contrato fechado | 1 | 1 | B‑Comercial › Contrato Fechado | `contrato` |
| 11000 | Venda perdida (143) | 57 | 19 | B‑Comercial › Perdido | `perda` |

Quatro etapas da Kommo viram a mesma "Proposta Realizada". Se a distinção
(follow‑up manual × automático × quente × 30 dias) importar para a operação,
elas viram etapas próprias — mas todas com `degrau = proposta`.

---

## 4. Funil de Onboarding (12 · 183) → Bancário - Jurídico

Onboarding é PÓS‑venda: todo lead aqui é um contrato fechado. Proposta: o
negócio nasce no **Bancário - Comercial**, alcança `contrato`, e depois é
transferido para o **Bancário - Jurídico** — a mesma trajetória que você já
usa ("fechou → transfere para o Jurídico → continua ganho"). O funil comercial
continua contando o contrato (regra 6 do funil).

| # | Etapa da Kommo | Leads | c/ valor | Destino proposto | Degrau |
| ---: | --- | ---: | ---: | --- | --- |
| 20 | iniciar onboarding | 52 | 1 | B‑Jurídico › Cliente Ativo | — |
| 30 | documentos solicitados | 36 | 34 | **CRIAR** B‑Jurídico › Documentos Solicitados | — |
| 60 | docs com pendência | 16 | 14 | **CRIAR** B‑Jurídico › Docs com Pendência | — |
| 100 | Onboarding Finalizado | 78 | 61 | B‑Jurídico › Cliente Ativo | — |
| 11000 | descarte (143) | 1 | 1 | B‑Comercial › Perdido | `perda` |

As 7 etapas vazias (agendar reunião onboarding, reunião ob. realizada, docs
completos recebidos, criar tarefa advbox, pendência, e as duas de entrada) não
migram.

---

## 5. Jurídico (Atendimento Geral) (8 · 342) → Bancário - Jurídico

| # | Etapa da Kommo | Leads | Destino proposto | Degrau |
| ---: | --- | ---: | --- | --- |
| 20 | contato avulso | 31 | B‑Jurídico › Contato Avulso | — |
| 30 | Contato banco | 67 | B‑Jurídico › Contato Banco | — |
| 40 | cliente ativo | 234 | B‑Jurídico › Cliente Ativo | — |
| 50 | cliente rescindido | 10 | B‑Jurídico › Cliente Inativo | — |
| 60 | Cliente encerrado | 0 | B‑Jurídico › Cliente Inativo | — |

---

## 6. Checkpoints (Pós Vendas) (9 · 2 leads)

Proposta: **descartar o funil inteiro.** Dois leads, em "checkpoint 1 30d
feito" e "checkpoint 2 60d feito". Se quiser preservar, eles viram uma
etiqueta no contato.

---

## 7. O que precisa ser criado no CB CRM

Se a proposta acima for aceita como está:

**Trabalhista - Comercial** (hoje 8 etapas → 12)
- Ag. Demissão · Pediu Demissão · Foi Demitido (as três entre "Qualificado" e
  a entrada)
- Perdido (`resultado = perdido`, `degrau = perda`)

**Trabalhista - Jurídico** (hoje 5 → 8)
- Pendente Documento · Documentos Recebidos · Em Elaboração

**Bancário - Jurídico** (hoje 4 → 6)
- Documentos Solicitados · Docs com Pendência

**Bancário - Comercial**: nenhuma etapa nova. Falta só marcar `degrau` nas 11.

⚠️ Depois da carga, apagar qualquer uma dessas etapas fica caro (trava 12 do
plano). É por isso que a estrutura fecha na fase 2.

---

## 8. Etiquetas

O CB CRM tem 13 etiquetas e só duas em uso (`asaas` 263, `Bancário` 1). As
outras 11 foram criadas espelhando a Kommo e estão vazias.

Batem por `chaveDeTag` (sem acento, minúsculas) — a carga reusa, não duplica:
**TRABALHISTA** (8.352 leads), **TYPEBOT** (2.505), **DESQUALIFICADO** (1.472
leads + 200 contatos), **BANCÁRIO** (1.253), **CLIENTE FECHADO** (1.189),
**FORMULÁRIO** (302).

Não existem aqui, por uso: 100K a 500K (1.433), adsBLOG (652), PROCESSO PROT.
TRAB (625), EM ATRASO (355), Leads AVN (343), ‑100K (292), NÃO RESPONDEU (250
contatos), CONTATO SEG. TRAB (242), PROPOSTA RECEBIDA CHATGURU (186), CPF e
CNPJ (183), EM DIA (156), REVISIONAL (118), VÃO ENTRAR (35), DESISTIU (34),
CONSIGNADO (29), CLIENTE RESCINDIDO (15), SUPERENDIVIDAMENTO (10), SUPER
QUALIFICADO 1MM+ (4), ATENDIMENTO IA (2), REPARO AUTOMAÇÃO (2), +500K (2), NO
SHOW (1), FINALIZADO (1), ADV CAIXA (1), Forms‑ trabalhista (1).

**Proposta:** criar as que têm 10 usos ou mais (18 etiquetas) e descartar as 7
com menos — "REPARO AUTOMAÇÃO" e "ATENDIMENTO IA" são de operação interna da
Kommo, e as de 1 uso não informam nada. Mais a etiqueta `kommo` de origem
(decisão 21).

⚠️ As etiquetas do CB CRM são do CONTATO. Lead com etiqueta vira contato com
etiqueta: os 120 contatos com mais de um lead acumulam as etiquetas dos dois.

---

## 9. Valor — o que a Kommo tem, medido

Você pediu "valor do contrato: o valor da proposta e o valor do fechamento". A
Kommo tem **um** campo de valor por lead (`price`), e a medição de 19/09 diz
onde ele está:

| | Leads | Soma |
| --- | ---: | ---: |
| Abertos | 6.844 | **R$ 9.908.350** |
| Ganhos (142) | 171 | **R$ 0** |
| Perdidos (143) | 5.701 | R$ 669.800 |

Concentração: "reunião proposta ‑ f.u manual" R$ 5,31 mi (177 leads),
"reunião proposta ‑ f.u auto" R$ 1,08 mi (74), "Onboarding Finalizado"
R$ 1,01 mi (61), "documentos solicitados" R$ 790 mil (34), "Muito bom ‑ muito
quente" R$ 713 mil (11).

**Três conclusões:**

1. O `price` é o **valor da proposta**, preenchido pelo Closer e carregado
   adiante pelo Onboarding. Não existe um segundo campo de "valor fechado".
2. **O funil Trabalhista não tem valor nenhum** — zero em todas as 18 etapas,
   inclusive nos 742 Protocolados e nos 171 Ganhos. Se o contrato trabalhista
   tem honorário, ele nunca foi registrado na Kommo.
3. Os **171 "Ganho" valem R$ 0**. O dinheiro fechado de verdade está nos 183
   leads de Onboarding (R$ 2,2 mi) — que na Kommo nunca foram marcados como
   ganhos.

**Decisão:** o que vai para `deals.value`?
- (a) o `price` como está, em todos os leads — o Desempenho passa a mostrar
  "valor fechado" só onde o lead pousar num degrau de contrato;
- (b) só nos leads que viram contrato;
- (c) nenhum, e o valor entra depois, à mão, nos que importam.

---

## 10. Campos — o que a sua lista de escopo deixa de fora

Você pediu: nome, etapa atual, etiquetas, histórico de etapas, valor e
anotações. Isso **não inclui** os campos personalizados. O que se perde:

| Campo da Kommo | Preenchidos | Destino aqui | O que se perde ao não migrar |
| --- | ---: | --- | --- |
| O email (contato) | **1.906** | `contacts.email` | o vínculo automático do tl;dv casa por e‑mail; hoje o CB CRM tem **1** contato com e‑mail |
| Campanha / Conjunto / anúncio | 1.224 cada | os 3 campos de Traqueamento | `{{contact.origem}}` nas automações e a atribuição do Meta Ads |
| Reunião Marcada (`date_time`) | 1.216 | Data e Hora Reunião | a Fase 8 do funil (mapas dia×hora das reuniões) |
| Tamanho da dívida / Atraso / Origem | 2.813 / 2.376 / 2.367 | os 3 campos que já existem | contexto do caso na ficha |
| URL Reunião | 1.331 | Link Reunião | — |
| fbclid + 5 utm_* | ~1.025 / ~305 | os 6 campos de Traqueamento | rastreamento de origem |
| Data Proposta | 358 | Data da Proposta | — |
| Marcou reunião onde | 1.371 | não existe | — |
| Código ID / TAGs contem / Demitida / Tempo da demissão / Grávida | 671 / 298 / 302 / 302 / 13 | não existem | — |

**Recomendação:** trazer pelo menos o **e‑mail** (1.906) e os **três campos de
anúncio** (1.224) — são baratos, os campos já existem aqui, e os dois
alimentam coisa que já está construída. Os demais são uma linha a mais no mapa
cada um.

---

## 11. Anotações

538 anotações de texto em leads e 5 em contatos (as outras 1.481 são
automáticas da Kommo — `lead_auto_created`, `link_followed`, geolocalização —
e não migram). **Uma** não tem contato vinculado e não tem destino possível.

O resto depende da decisão 3 (onde elas pousam, já que
`cb_conversation_notes.conversation_id` é `NOT NULL`).

---

## 12. Responsáveis

| Usuário da Kommo | Leads |
| --- | ---: |
| Gabriel Queiroz | 8.088 |
| Leonardo Cabral | 3.871 |
| Trabalhista (login compartilhado) | 559 |
| Cabral Baptista Advocacia | 96 |

O CB CRM tem 3 membros e `deals.assigned_to` só aceita membro da conta
(decisão 12). Sua lista de escopo não menciona responsável — se ficar de fora,
os 12.716 cards nascem sem responsável.

---

## 13. Motivo de perda

Medido: dos 5.701 perdidos, **1.122 têm motivo** e todos com o MESMO motivo
(id `29511951`); 4.579 não têm nenhum. Ou seja, o campo praticamente não foi
usado — a decisão 13 fica barata: uma etiqueta resolve, ou descarta-se.
