# Plano — Asaas → vínculo de clientes, aviso de inadimplência e régua de cobrança (vivo e checável)

> **O que é este arquivo.** Guia retomável da integração com o Asaas, pedida
> pelo operador em 2026-09-09. O CRM lê do Asaas os clientes e as cobranças
> do escritório, **liga** cada cliente do Asaas a um contato do CRM, **avisa
> na conversa** quando o cliente está inadimplente e com quais parcelas, e —
> numa fase posterior, desenhada agora — **cobra sozinho**, com mensagens
> programadas pelos dias de atraso. **Ele é editado a cada fase**: quem pegar
> o plano depois sabe o que foi feito e onde parou.
>
> ⚠️ **Este documento envelhece.** Antes de decidir com base em algo aqui,
> confirme contra a realidade (grep, leitura do arquivo, query no banco, a
> doc do Asaas).

- **Criado:** 2026-09-10 · **Medido contra:** `main` @ `5bb66d8`, o banco de
  produção (consultas de 09/09) e a doc pública da API v3 do Asaas
  (`https://docs.asaas.com`, lida em 09/09 e conferida de novo em 10/09).
- **Como foi desenhado:** quatro levantamentos (a API do Asaas; a receita das
  integrações tl;dv/Calendly/Meta Ads; o casamento de contato e os lugares do
  aviso; o motor de automações por tempo) e três desenhos independentes (o
  mínimo; o "dado primeiro"; o "operador primeiro"), sintetizados aqui.
  Depois, três revisões independentes (regras da casa e âncoras de código; o
  pior dia com um cliente real; fatos da API e completude), com 62 achados.
  O que mudou por causa delas, e o que foi recusado, está na §10.
- **Fluxo:** executar → typecheck/lint/test (Node 22) / i18n-parity /
  i18n-chaves-usadas → preview em 1440×900 → revisar 2× → PR → migration
  aplicada em produção via conector ANTES do merge, com autorização do
  operador (convenção das 972–990).

---

## Estado

| Fase | Escopo | Estado | Migration | PR |
| --- | --- | --- | --- | --- |
| **0** | Levantamento SÓ LEITURA da conta real: volume, formatos, simulação do vínculo, custo dos avisos e as perguntas que a doc não responde (§3.1) | ✅ **feito em 12/09** — os números estão na §2.5 e mudaram D2, D5, D10 e D11 | — | (junto da 1a-conexão) |
| **1a-conexão** | O cartão "Asaas" em Integrações: a chave cifrada, o nome dela, a validade opcional, e o botão que roda o levantamento | ✅ feito (12/09) · **migration aplicada em produção** | `992_cb_asaas_config` ✅ | `feat/asaas-conexao` |
| **1a-espelho** | Espelho das cobranças (vencidas + as que vencem hoje), vínculo automático, tela de revisão e lista de inadimplentes | 🟡 pronta para desenhar — **espera só a D2** (criar ou não a ficha de quem não tem) | `9xx_cb_asaas` (as duas tabelas restantes) | — |
| **1b** | O aviso: ícone na linha da caixa, faixa colada ao compositor, aba Cobranças no painel e na ficha, filtro "Inadimplentes" | 💤 | — | — |
| **2** | Webhook do Asaas (o pagamento some do aviso em segundos), o ciclo de vida dele e o aviso de chave desativada | 💤 | `9xx_cb_asaas_webhook` | — |
| **3** | Régua de cobrança: **o lembrete no dia do vencimento** (D17) e a cobrança do atrasado por marcos, **uma mensagem por cliente com TODAS as parcelas vencidas** (D11), pelo caminho do robô — sem reabrir conversa, sem zerar o contador de espera, sem mexer em não lidas (D16). Trava por marco com prova de envio e reconfirmação no Asaas | 💤 | `9xx_cb_asaas_regua` | — |
| **4** (ideias, não pedidas) | régua para conexão da Meta com modelo aprovado; botão "cobrar agora" na aba; condição "cliente inadimplente?" em outras automações; parcela a vencer na aba; relatório histórico de recebimento; inserir o link de pagamento direto no compositor | 💤 | — | — |

- **Número das migrations:** a última hoje é a **992** (a config do Asaas,
  aplicada em 12/09 e registrada como `20260912144829`).
  ⚠️ Ela nasceu 991 e colidiu com a `991_cb_janela_da_meta_na_conversa`, de
  outra branch, aplicada primeiro em 12/09 — a quinta colisão do projeto. Conferir
  `ls supabase/migrations/` **e** `list_migrations` imediatamente antes de
  criar cada arquivo — quatro colisões já aconteceram com branches em
  paralelo.
- **Tamanho estimado:** Fase 0, uma sessão e zero arquivos no repo ·
  Fase 1a-conexão, 1 PR (11 arquivos novos, 5 deles testes; 3 tocados; 1
  migration) — FEITO · Fase 1a-espelho, 1 PR (~14 novos; ~4 tocados; 1
  migration) ·
  Fase 1b, 1 PR (~6 novos, ~9 tocados) · Fase 2, 1 PR (~4 novos, ~7
  tocados, 1 migration) · Fase 3, 1–2 PRs (~10 novos, ~14 tocados, 1
  migration).
- **Ordem:** a Fase 2 vem ANTES da 3 por dois motivos. A cópia fresca evita
  cobrar quem acabou de pagar, e o log de eventos mede em que instante o
  Asaas marca a cobrança como vencida (C7, §2.3), um número de que a régua
  depende.

### Decisões travadas pelo pedido (09/09)

- **A chave do Asaas fica em Configurações → Integrações**, no desenho das
  outras três (Meta Ads, Calendly, tl;dv): cifrada com `ENCRYPTION_KEY`,
  testada ao conectar, e a tela nunca a vê de volta.
- **O vínculo cliente do Asaas ↔ contato do CRM é feito pelo CRM**, por
  correlação de telefone, CPF/CNPJ, e-mail e nome.
- **O aviso aparece na conversa do cliente e diz QUAIS parcelas estão
  vencidas**, não só "inadimplente".
- **A data da inadimplência fica guardada** (o vencimento de cada parcela) e
  os dias de atraso são contados a partir dela.
- **A cobrança automática é por marcos de atraso** (1 dia, 5 dias, 30 dias
  "e assim por diante"), cada marco com a sua mensagem, configurada pelo
  operador. Construída depois das outras fases; o dado de que ela precisa
  nasce na Fase 1.

### Decisões com recomendação

O plano segue com a recomendação como hipótese até o operador dizer o
contrário. As marcadas ⏳ precisam de resposta antes da Fase 1a (a D1, antes
da Fase 0); as que o operador decide reaparecem em linguagem simples na §9.

| # | Decisão | Recomendação | Por quê |
| --- | --- | --- | --- |
| **D1** ⏳ | Primeiro contato: conta de produção ou sandbox do Asaas? | **Produção.** A Fase 0 usa uma chave SÓ DE LEITURA. As Fases 1a–3 leem Clientes, Cobranças e Parcelamentos, e só escrevem em duas coisas: o aviso automático (webhook, D7) e os avisos de atraso do próprio Asaas (D10) — nunca em cliente nem em cobrança. O teste da régua usa uma cobrança real de poucos reais para o contato de teste autorizado | o vínculo só se mede com os clientes reais, e o sandbox não tem os 588 contatos do escritório. ⚠️ E o sandbox não pode ser conectado aqui: o ambiente local grava no MESMO banco da produção (§3.7) |
| **D2** ⏳ | Cliente do Asaas que não tem ficha no CRM | **MUDOU com a medição (12/09): recomendo CRIAR a ficha** (nome + telefone do Asaas, dono durável da conta), como o Calendly passou a fazer em 08/09. A que ficar sem telefone (85) continua só listada | a recomendação antiga era "só listar", e ela supunha que a maioria já tivesse ficha. Medido: **79,5% não tem**, e dos 92 devedores só 31 têm. Só listar entrega o aviso e a régua para um terço da inadimplência e deixa 264 clientes COM telefone fora, sem nada que os traga para dentro — o cliente que assinou contrato e nunca escreveu no WhatsApp nunca vai escrever sozinho. ⚠️ Criar ficha é criar conversa: 264 conversas novas na caixa de entrada de uma vez. Por isso a ficha nasce SEM conversa aberta na caixa — a conversa nasce no primeiro envio da régua (é o que o roteador de funil já faz) |
| **D3** ⏳ | CPF/CNPJ vindo do Asaas | **Guardado na tabela da integração, que é FECHADA ao navegador (todas as do Asaas são); só a rota do administrador o devolve, mascarado (`***.456.789-**`).** Não entra em `contacts` | ⚠️ o CRM não tem o CPF de ninguém (§2.1), então o CPF não liga cliente a contato: serve para achar cadastro repetido no Asaas e para conferência humana. Pôr CPF na ficha é outra decisão (§8) |
| **D4** ⏳ | Quem vê o aviso; quem liga e desliga clientes | **Aviso: todo membro que vê a conversa, visualizador incluído. Ligar, desligar e as listas do cartão: só administrador** | quem responde ao cliente precisa saber que ele deve. Ligar errado mostraria a dívida de um cliente na conversa de outro. Como toda leitura passa por rota (§3.2), mudar isso depois é trocar o papel mínimo de uma rota, sem migration |
| **D5** ✅ | Telefone que só bate pelos ÚLTIMOS 8 DÍGITOS | **Vira sugestão, nunca vínculo automático** — mantida, e agora de graça | MEDIDO em 12/09: **zero** clientes caem nesse degrau, e zero caem no de nome. A decisão deixou de ter custo: a régua frouxa não liga ninguém que a régua exata já não ligue. Fica escrita porque o dado muda (cliente novo, telefone corrigido) |
| **D6** ⏳ | Cobrança negativada no Serasa (`DUNNING_REQUESTED`) | **Conta como inadimplência no aviso, com a marca "negativada"; fica FORA da régua automática** | o cliente continua devendo e o atendente precisa saber; mas com negativação em curso, uma mensagem amigável de "1 dia de atraso" é incoerente |
| **D7** | Quem cria o aviso automático (webhook) no Asaas | **O CRM, pela API**, com a permissão Webhooks em leitura e escrita. Plano B: o operador cadastra à mão com a URL e o token que o cartão mostra | o CRM gera o token de autenticação, reaproveita o webhook que já existe, confere e religa a fila, e o apaga ao desconectar (§3.4). A permissão é editável depois: decidir antes da Fase 2 |
| **D8** | Corpo do webhook: dado ou aviso? | **Aviso.** De evento de cobrança lê só o id e relê a cobrança na API; de evento de chave lê só `accessToken.name` | a releitura devolve o estado ATUAL, então a ordem de chegada deixa de importar: sem guarda de ordem, e com envio NÃO sequencial (um evento preso não segura a fila). Custa um GET por evento |
| **D9** | Escrever no Asaas | **Nunca em cliente nem em cobrança** (`externalReference` incluído). As únicas escritas são o webhook (D7) e os avisos de atraso (D10) | o vínculo mora no CRM e sobrevive sem isso; e o `externalReference` pode estar em uso por outro sistema (a Fase 0 mede) |
| **D10** ❌ | Avisos NATIVOS de atraso do Asaas | **O CRM NÃO escreve nada em notificação — o mecanismo não funcionaria.** A duplicação se resolve com UM interruptor no painel do Asaas, do operador. A permissão Notificações sai da chave da Fase 3 | MEDIDO em 12/09: a configuração por cliente tem só e-mail ligado, com **zero** em WhatsApp, SMS e ligação — e mesmo assim a conta paga ~600 avisos de WhatsApp por mês (R$ 0,55 cada). O WhatsApp do Asaas é interruptor DA CONTA e não passa pela API de notificação por cliente, então `PUT /notifications/batch` em centenas de clientes não apagaria uma única mensagem. O custo do que se sobrepõe à régua é **R$ 92/mês** (fatia de atraso de ~R$ 403/mês); a ligação de robô, o pior risco do plano, custou **R$ 3,85 em seis meses**. Some do plano toda a máquina de desligar-e-religar |
| **D11** ⏳ | Régua: uma mensagem por parcela ou por cliente | **Uma mensagem por CLIENTE, listando TODAS as parcelas vencidas dele** — não só as que cruzam o marco. Quem está há cinco meses em atraso recebe UMA mensagem com as cinco parcelas, nunca cinco mensagens | regra do operador (12/09). E a medição a torna a regra principal, não um detalhe: **40 dos 92 devedores têm mais de 3 parcelas vencidas** e 29 têm 6 ou mais — por parcela, o pior caso manda 6+ mensagens seguidas ao mesmo cliente. Clientes do Asaas diferentes ligados ao mesmo contato (a pessoa e a empresa dela) continuam com mensagens separadas, cada uma com o seu nome — nunca parcelas de CPFs diferentes juntas (1 caso na base) |
| **D12** | Horário da régua | **Sai no dia-alvo, entre `hora_envio` (09:00 por padrão; aceita de 08:00 a 17:00) e 18:00, só em dia útil: sábado, domingo e feriado nacional de data fixa passam para o dia útil seguinte.** Agendador parado até as 18:00 = marco perdido naquele dia | cobrança de madrugada, no domingo ou no Natal é o erro que ninguém perdoa; perder um marco é melhor. Feriado de data móvel (Carnaval, Sexta-feira Santa, Corpus Christi) fica fora da v1 |
| **D13** | Cobrança já vencida quando a régua foi ligada | **Nada automático**: a régua só dispara no marco que a parcela cruzar DEPOIS de ligada. O atrasado antigo aparece no aviso, no filtro e na lista de inadimplentes, e a equipe cobra à mão | ligar a régua não pode despejar 100 mensagens de uma vez. E o texto de "1 dia de atraso" mentiria para quem deve há três meses |
| **D14** ❌ | Acordo com o cliente | **Fora da v1** (decisão do operador, 12/09): "acordo não pausa a cobrança, pois pra isso precisaremos inserir uma forma de registrar o acordo" | pausar por data exigiria antes um lugar onde o acordo é REGISTRADO (valor, prazo, quem fechou) — senão a pausa é um campo solto que ninguém sabe explicar depois. `cb_asaas_pausas` sai da Fase 3 inteira; volta junto com o registro de acordo. Ver §8 |
| **D15** | A mensagem da régua e a IA | **Aceitar e documentar**: a mensagem da cobrança fica em `messages` como mensagem do robô, e por isso entra no transcrito do Radar (nas conexões com o Radar ligado) e no histórico que a resposta automática lê | é o mesmo tipo de dado que já está nas conversas, e a IA precisa saber que houve cobrança para responder coerente a um "já paguei". Nenhuma TABELA do Asaas vai a provedor de IA |
| **D16** ⏳ | A mensagem da régua e o estado da conversa | **Não reabre conversa encerrada, não zera o contador de espera e não mexe em não lidas.** A régua sai SEMPRE pelo caminho do robô (`engineSendText`), nunca por `sendMessageToConversation` — com teste estrutural default-deny cobrando isso | regra do operador (12/09). Conferido no código em 12/09, e as três saem de graça pelo mesmo lugar: `engineSendText` grava `sender_type: 'bot'`, e o gatilho da 972 só limpa `aguardando_desde` em `sender_type='agent'` COM `sender_id` ou `from_device`; `unread_count` só sobe na entrada, nenhum caminho de envio o toca; e quem reabre é o núcleo de envio, que o robô não usa. ⚠️ É a MESMA razão pela qual broadcast e automação não reabrem — e o teste existe porque "reusar o núcleo de envio" parece limpeza de código e traz as três regressões juntas |
| **D17** ⏳ | Lembrete no DIA DO VENCIMENTO | **Escopo novo, pedido em 12/09**: todo dia às 8h o robô avisa quem tem parcela vencendo NAQUELE dia. Gatilho próprio (`asaas_cobranca_vence_hoje`), mensagem própria, sem marco e sem trava por dias de atraso | "a gente faz uma cobrança ativa na data do vencimento". Muda o espelho: hoje ele guarda só o que o CRM já viu VENCIDO, e passa a precisar do que VENCE hoje (`PENDING` com `dueDate` = hoje). Medido: 0 vencendo hoje e 98 nos próximos 30 dias, então o volume diário é de unidades. ⚠️ O Asaas JÁ manda aviso no dia do vencimento — 620 em 180 dias, R$ 341 — e é o mesmo interruptor da D10: se o escritório quer o lembrete pelo WhatsApp do CRM, o do Asaas tem de ser desligado no painel, senão o cliente recebe dois |

---

## 1. O pedido, traduzido para o que já existe

| O que o operador pediu | O que reusa | O que é novo |
| --- | --- | --- |
| "Quando eu te der a chave" | o molde das três integrações: config fechada ao navegador, `encrypt()`, cartão em Integrações, cron do laço lento com rodízio (`987_cb_tldv.sql`, `src/lib/tldv/*`); as tabelas fechadas lidas por rota, como as do Calendly (977) | `cb_asaas_config`, `src/lib/asaas/{cliente,conexao,cartao}.ts` |
| "Verifique e faça o link dos clientes", por nome, CPF, CNPJ, telefone ou e-mail | `digitosDoTelefone` + `variantesDoNonoDigito` (`src/lib/contacts/telefone.ts`); `chaveDeTag` para nome; `normalizarEmail` e a ponte do Calendly, a mesma que fez o tl;dv ligar reuniões sozinho; a regra "um candidato só" (`contatoParaVincular`, `src/lib/tldv/vinculo.ts`) | o levantamento da Fase 0, `cb_asaas_clientes`, `src/lib/asaas/vinculo.ts`, a tela de revisão |
| "Badge ou aviso na caixa de entrada, na conversa, com quais parcelas" | a régua pura + selo da linha (`src/lib/inbox/atraso.ts`); a faixa colada ao compositor (`ScheduledBar` e a faixa de divergência de canal em `message-thread.tsx`); `AbaDeIcone` com `badge` no painel; o chip "Em atraso" como molde do filtro; a rota em lote `/api/cb/execucoes/resumo` como molde da leitura | `src/lib/asaas/inadimplencia.ts`, as rotas de resumo e de contato, a faixa, a aba Cobranças, o filtro |
| "A data da inadimplência e quantos dias" | a regra do `aguardando_desde` (972): o banco guarda o dado, a tela conta; `diaNoFuso`/`paraInstante` de `src/lib/agenda/fuso.ts` | `cb_asaas_cobrancas.vencimento` (DATE), `diasDeAtraso()` na leitura, e a lista de inadimplentes do cartão, ordenada pelos dias |
| "Mensagens programadas com 24 h, 5 dias, 30 dias de atraso, configuradas" | o motor de automações (passo `send_message`, `{{vars.*}}`, desfecho no fio); o molde do gatilho por data (935/947/952) e do gatilho externo com variáveis (Calendly, 977) | gatilho `asaas_cobranca_vencida`, varredura própria, `cb_asaas_regua_envios` |

---

## 2. O que foi medido antes de desenhar

### 2.1 Produção (09/09/2026)

| Medida | Valor | O que decide |
| --- | --- | --- |
| Contatos | 590 no banco, 588 na conta do escritório | — |
| Com telefone | 590 (589 com DDI 55) | **o casamento que funciona hoje é por telefone** |
| Com e-mail | **1** | e-mail só ajuda pela ponte do Calendly |
| Com CPF/CNPJ | **0** — nem coluna, nem campo personalizado, nem valor com cara de CPF | CPF só existe do lado do Asaas, e não liga ninguém (D3) |
| Nome só numérico | **172** | nome nunca liga sozinho; a mensagem da régua usa o nome do Asaas |
| Números sem o nono dígito | **380 de 589** (12 dígitos) | a irmã do nono dígito é obrigatória no casamento |
| Sufixos de 8 dígitos repetidos | **0** | o sufixo não gera ambiguidade DENTRO da base, mas não prova identidade com o Asaas (D5) |
| Negócios | 589, **0 marcados ganho**, 3 com valor | nem etapa nem "ganho" acham quem paga honorários (§2.4) |
| Contatos do Instagram | 0 | — |
| Ambiente local | o `.env.local` aponta para o MESMO projeto Supabase da produção | nada de sandbox conectado nesta instalação (§3.7) |
| Campos `origem_da_divida`, `tamanho_da_divida`, `tempo_de_atraso` | existem, com 0 valores | ⚠️ são sobre a dívida BANCÁRIA do cliente (o caso jurídico), **não** sobre a inadimplência com o escritório — não reusar |

### 2.2 A API do Asaas (doc v3, lida em 09/09, conferida em 10/09)

| Item | Valor | Fonte |
| --- | --- | --- |
| Base | produção `https://api.asaas.com/v3` · sandbox `https://api-sandbox.asaas.com/v3` | [comece-por-aqui](https://docs.asaas.com/reference/comece-por-aqui) |
| Autenticação | cabeçalho **`access_token`** (não é Bearer). Chave `$aact_prod_…` / `$aact_hmlg_…`; chave anterior a 10/03/2025 pode não ter prefixo; o `$` faz parte dela. `User-Agent` obrigatório para conta criada desde 13/06/2024. Chave no ambiente errado = 401 `invalid_environment` | [autenticação](https://docs.asaas.com/docs/autentica%C3%A7%C3%A3o-1) · [breaking-changes](https://docs.asaas.com/page/breaking-changes) |
| Ciclo da chave | criada só na tela, por administrador, exibida UMA vez; até 10 por conta; **3 meses sem uso = desabilitada, 6 = expirada**. ⚠️ O aviso de "chave expirando" só existe no ciclo de inatividade: **chave com data de validade definida à mão não recebe aviso antes de expirar** | [chaves-de-api](https://docs.asaas.com/docs/chaves-de-api) · [eventos-para-chaves-de-api](https://docs.asaas.com/docs/eventos-para-chaves-de-api) |
| Permissões | por recurso, `READ` ou `READ_WRITE`; na tela: Clientes, Cobranças, Parcelamentos, Notificações, Webhooks, Negativação… A doc diz que a chave criada pela API sem `permissions` nasce com tudo em `READ_WRITE`; na tela, conferir a lista antes de salvar. Falta de permissão = 403 `insufficient_permission`, com o escopo na descrição | [permissões](https://docs.asaas.com/docs/gerenciamento-de-permiss%C3%B5es-de-chaves-de-api) |
| Restrição de IP | ⚠️ é da **CONTA** (Integrações → Mecanismos de segurança) e vale para todas as chaves; IP fora da lista = 403 "Acesso negado" | [whitelist-de-ips](https://docs.asaas.com/docs/whitelist-de-ips) |
| Limites | ⚠️ **por CONTA, somando todas as chaves**: 25.000 requisições a cada 12 h e 50 GET simultâneos; limite por endpoint nos cabeçalhos `RateLimit-*`; tudo em 429, e "não retente logo após o 429". A doc pede webhook em vez de consulta repetida, e não aumenta a cota de quem faz polling | [rate-e-quota-limit](https://docs.asaas.com/reference/rate-e-quota-limit) · [api-limits](https://docs.asaas.com/docs/api-limits-1) |
| Paginação | `offset` + `limit` (≤ 100, padrão 10); `{ hasMore, totalCount, data[] }`. ⚠️ **GET com corpo = 403**. ⚠️ **404 também quando o id é de outra conta** | [listagem-e-paginacao](https://docs.asaas.com/reference/listagem-e-paginacao) · [códigos HTTP](https://docs.asaas.com/reference/codigos-http-das-respostas) |
| Clientes | `GET /customers`, filtros `name`, `email`, `cpfCnpj`, `groupName`, `externalReference` — ⚠️ **NÃO há filtro por telefone** (o casamento é feito no CRM, em memória). Campos `id` (`cus_…`), `name`, `email`, `phone`, `mobilePhone`, `cpfCnpj`, `personType`, `deleted`, `externalReference`, `notificationDisabled`. **Cadastro duplicado é permitido.** Apagar cliente leva junto as cobranças pendentes e vencidas dele, e restaurar não as devolve | [listar-clientes](https://docs.asaas.com/reference/listar-clientes) · [criar-novo-cliente](https://docs.asaas.com/reference/criar-novo-cliente) · [remover-cliente](https://docs.asaas.com/reference/remover-cliente) |
| Cobranças | `GET /payments`, filtros `customer`, `status`, `installment`, `dueDate[ge]/[le]`, `paymentDate[ge]/[le]`, `dateCreated[ge]/[le]`…; campos `id` (`pay_…`), `customer`, `status`, `value`, `interestValue`, `dueDate`, `originalDueDate`, `paymentDate`, `clientPaymentDate`, `installment`, `installmentNumber`, `invoiceUrl`, `bankSlipUrl`, `billingType`, `canBePaidAfterDueDate`, `daysAfterDueDateToRegistrationCancellation`, `deleted`. Não há filtro "alterada desde" | [listar-cobrancas](https://docs.asaas.com/reference/listar-cobrancas) · [recuperar-uma-unica-cobranca](https://docs.asaas.com/reference/recuperar-uma-unica-cobranca) |
| `status` | `PENDING`, `RECEIVED`, `CONFIRMED`, **`OVERDUE`**, `REFUNDED`, `RECEIVED_IN_CASH`, `REFUND_REQUESTED`, `REFUND_IN_PROGRESS`, `CHARGEBACK_REQUESTED`, `CHARGEBACK_DISPUTE`, `AWAITING_CHARGEBACK_REVERSAL`, **`DUNNING_REQUESTED`**, `DUNNING_RECEIVED`, `AWAITING_RISK_ANALYSIS`. Vencida paga sai de `OVERDUE` para `CONFIRMED`/`RECEIVED` | [recuperar-uma-unica-cobranca](https://docs.asaas.com/reference/recuperar-uma-unica-cobranca) · [webhook-para-cobrancas](https://docs.asaas.com/docs/webhook-para-cobrancas) |
| Parcelas | cada parcela é uma cobrança própria, com `installment` (id do parcelamento) e `installmentNumber`. O TOTAL de parcelas (`installmentCount`) só existe em `GET /installments/{id}` | [recuperar-um-unico-parcelamento](https://docs.asaas.com/reference/recuperar-um-unico-parcelamento) |
| Webhook | autenticação por IGUALDADE de token no cabeçalho **`asaas-access-token`** (sem HMAC). `POST /webhooks` exige `name`, `url`, `email`, `enabled`, `interrupted`, `apiVersion`, `authToken` (32 a 255 caracteres), `sendType` e `events`; até 10 por conta; a resposta traz `penalizedRequestsCount`. **Só HTTP 200 conta como entrega**, com prazo de 10 s; entrega "pelo menos uma vez", o mesmo `id` no reenvio; **15 falhas seguidas interrompem a fila**, com e-mails de alerta, e evento com mais de 14 dias parado é apagado. Não há evento de cliente nem de parcelamento. Os eventos de chave (`ACCESS_TOKEN_CREATED`, `_ENABLED`, `_DISABLED`, `_DELETED`, `_EXPIRED`, `_EXPIRING_SOON`) valem para QUALQUER chave da conta e trazem `accessToken.name` | [sobre-os-webhooks](https://docs.asaas.com/docs/sobre-os-webhooks) · [criar-novo-webhook](https://docs.asaas.com/reference/criar-novo-webhook) · [penalização](https://docs.asaas.com/docs/penaliza%C3%A7%C3%A3o-de-filas) · [idempotência](https://docs.asaas.com/docs/como-implementar-idempotencia-em-webhooks) · [eventos-para-chaves-de-api](https://docs.asaas.com/docs/eventos-para-chaves-de-api) |
| Avisos nativos | ao cadastrar um cliente, o Asaas cria **8 avisos padrão**: cobrança criada, 10 dias antes do vencimento, no dia do vencimento, linha digitável no vencimento, cobrança atualizada, cobrança recebida, **cobrança vencida** e **7 dias após o vencimento** (periódico enquanto não pagar). Estes dois vão por e-mail, SMS e **ligação de robô** (R$ 0,55 por ligação); WhatsApp desligado por padrão. A configuração é POR CLIENTE, e `PUT /notifications/batch` altera um cliente por chamada. `notificationDisabled` no cliente cala todos | [notificacoes-padroes](https://docs.asaas.com/docs/notificacoes-padroes) · [alterando-notificacoes-de-um-cliente](https://docs.asaas.com/docs/alterando-notificacoes-de-um-cliente) · [preços](https://www.asaas.com/precos-e-taxas) |
| Negativação | aparece no `status`. Criar pela API exige a conta liberada pelo gerente; R$ 9,90 por cobrança; "só pessoa jurídica" vem da Central de Ajuda — a confirmar. O CRM não negativa | [criar-uma-negativacao](https://docs.asaas.com/reference/criar-uma-negativacao) · [preços](https://www.asaas.com/precos-e-taxas) |
| Sandbox | conta e chave próprias; webhooks funcionam; `POST /sandbox/payment/{id}/overdue` força o vencimento; a FAQ em inglês nega endpoint para CONFIRMAR pagamento (usar o botão da tela); e-mail e SMS podem sair de verdade; juros e multa não são testáveis lá | [forcar-vencimento](https://docs.asaas.com/reference/forcar-vencimento) · [sandbox](https://docs.asaas.com/docs/sandbox-1) · [o-que-pode-ser-testado](https://docs.asaas.com/docs/o-que-pode-ser-testado) |

### 2.3 O que a doc não responde

| # | Pergunta | Onde se responde |
| --- | --- | --- |
| C1 | Formato de saída de `phone`/`mobilePhone`/`cpfCnpj` (só dígitos? com DDI?) | Fase 0 |
| C2 | A listagem devolve cliente e cobrança com `deleted: true`? | Fase 0 |
| C3 | `status` aceita vários valores numa consulta? | Fase 0 |
| C4 | `externalReference` já está em uso nos clientes do escritório? | Fase 0 |
| C5 | Todo 4xx vem na forma `{ errors: [{ code, description }] }`? | Fase 0 |
| C6 | Qual permissão cobre `GET /customers/{id}/notifications`? Não afeta a v1: a chave da Fase 3 tem Clientes e Notificações | — |
| C7 | **Em que instante `PENDING` vira `OVERDUE`** — meia-noite do dia seguinte? espera o dia útil quando vence no fim de semana? | Fase 1a dá um limite (o primeiro ciclo que lista como vencida uma cobrança de vencimento D−1, com margem de um ciclo); a Fase 2 mede pelo `evento_criado_em`. A régua já se protege (§3.6, dia-alvo) |
| C8 | O aviso nativo "7 dias após" repete a cada 7 dias? | Fase 0 lê a configuração; a repetição, só observando |
| C9 | Vencida cujo vencimento é empurrado para a frente (`PAYMENT_UPDATED`) volta a `PENDING`? | Fase 2 |
| C10 | Os termos de uso e o acordo de dados (DPA) do Asaas restringem copiar dado do pagador para outro sistema? | o operador lê; a doc da API não fala disso |
| C11 | Cobrança removida responde 404 ou vem com `deleted: true`? | Fase 0 |
| C12 | Listar `status=DUNNING_REQUESTED` exige a permissão Negativação? A chave da Fase 0 não a tem: 200 = Cobranças basta; 403 = acrescentar Negativação (leitura) à chave de produção | Fase 0 |
| C13 | O painel do Asaas tem um ajuste da CONTA para os avisos dos clientes novos? | Fase 0, olhando o painel (o operador) |
| C14 | A cota de 12 h tem cabeçalho próprio, ou só se vê pelo 429? | Fase 0 |

### 2.4 O motor de automações (código)

- **O gatilho por data (`date_field_offset`, 935/947/952) é o molde.** Uma
  varredura periódica pergunta ao banco quem cruzou o instante-alvo agora,
  grava uma TRAVA antes de disparar (a INSERT é a própria reivindicação) e
  dispara só a automação carimbada — `triggerMatches` compara
  `automation_id` (`src/lib/automations/engine.ts:1695`). O Asaas reusa o
  desenho, não a fonte (§3.6).
- ⚠️ **A hora do envio tem de estar DENTRO do instante-alvo.** O vencimento
  do Asaas é uma DATA. Uma condição de horário dentro da automação não
  serve: a trava já foi gravada antes do disparo, e condição falsa vira ramo
  vazio — a mensagem nunca sai.
- ⚠️ **"Aguardar" não reconfere nada**: a espera retoma às cegas (só confere
  se a automação continua ligada). `[mensagem][aguardar 4 dias][mensagem]`
  mandaria a de 5 dias a quem pagou no dia 2, e ignoraria a pausa. Por isso
  a régua são automações independentes, uma por marco, e o "ainda
  vencida?" é conferido a cada disparo.
- ⚠️ **Três portas disparam uma automação sem o gatilho**: o diálogo
  "Executar automação" (lista toda automação ativa), o passo `run_automation`
  — os dois por `runAutomationById`, que pula `triggerMatches` de propósito —
  e `POST /api/automations/engine`, que repassa o `context` recebido. Uma
  automação da régua disparada por elas sairia com as `{{vars.*}}` vazias
  ("Olá, ! Consta em aberto:"), sem reconfirmação e sem trava.
- ⚠️ **Recorte por etapa não acha quem cobrar**: `stageInScope` só olha
  negócio ABERTO e devolve falso para contato sem card aberto; e em produção
  nenhum negócio está marcado ganho. E esconder o seletor de etapa no editor
  NÃO limpa `stage_ids` — a armadilha que o CLAUDE.md registra para a grade
  do funil.
- `dispararAutomacoes` devolve o que aconteceu (`candidatas`,
  `foraDoEscopo`, `executadas`, `comFalha`, `emEspera`, `erro`); e
  `automation_logs` guarda o desfecho de cada execução (985). A régua usa os
  dois para saber se a mensagem saiu (§3.6).
- `automations.trigger_type` não tem CHECK no banco: gatilho novo não pede
  migration para isso.
- O passo `send_message` sai pelo remetente do robô
  (`src/lib/flows/meta-send.ts`): não reabre conversa encerrada, não abre
  negócio, grava a bolha como robô e recusa contato só do Instagram. Pela
  Evolution, sai sem janela; pela Meta, texto livre fora das 24 h da última
  mensagem do cliente é recusado.

### 2.5 O levantamento — MEDIDO em 12/09/2026

Rodado contra a conta real com a chave de produção, só GET, nada gravado.
São estes números que mudaram as decisões abaixo — e dois deles derrubam
desenhos que estavam no plano.

**A conta**

| | |
| --- | --- |
| Clientes ativos | **439** (nenhum `deleted: true` veio na listagem — **C2**) |
| Sem telefone NENHUM | **85** (19%) |
| Com e-mail | 352 · com `mobilePhone` 354 · com `phone` 2 |
| Documento | **100% preenchido**: 339 CPF (11 dígitos) e 100 CNPJ (14) |
| Formato do telefone (**C1**) | **sem DDI**: 350 com 11 dígitos, 2 com 10; só 2 já vêm com o 55 |
| `notificationDisabled` | **0** |
| `externalReference` (**C4**) | **0** — livre, mas a D9 segue: o CRM não escreve |
| Cobranças | 4.084 no total: **405 vencidas**, 474 a vencer, 2.988 recebidas, 60 confirmadas |
| `DUNNING_REQUESTED` (**C12**) | **200 com 0 cobranças** — a permissão Cobranças basta; Negativação não é necessária |
| Cota (**C14**) | a resposta **não traz cabeçalho `RateLimit-*`**: só se vê pelo 429 |

**A inadimplência hoje**

| | |
| --- | --- |
| Vencidas | **405 cobranças de 92 clientes**, **R$ 499.963,94** |
| Vencimento mais antigo | **06/06/2024** — dívida de mais de dois anos |
| Parcelas vencidas por cliente | 1: 26 · 2: 16 · 3: 10 · 4: 5 · 5: 6 · **6 ou mais: 29** |
| **Mais de 3 parcelas vencidas** | **40 clientes** (43% dos devedores) |
| Boleto que o Asaas já não deixa pagar | **0** |
| Clientes com 2+ parcelas vencendo no mesmo dia | 3 |
| Vencendo HOJE | 0 · nos próximos 30 dias: 98 |

**⚠️ O vínculo — o número que muda o produto**

| Régua | Clientes do Asaas |
| --- | --- |
| Telefone idêntico ao da ficha | 31 |
| Igual a menos do nono dígito | 59 |
| E-mail da ficha | 0 |
| E-mail vindo do Calendly | 0 |
| Só os últimos 8 dígitos | **0** |
| Mesmo nome | **0** |
| Ambíguo | 0 |
| **Nenhuma ficha corresponde** | **349 (79,5%)** |

**O vínculo automático alcança 90 de 439 — 20,5%.** E, dos 92 clientes com
parcela vencida, só **31 (33,7%)** têm ficha no CRM: o aviso na conversa
nasceria aceso em um terço dos devedores, e a régua de cobrança alcançaria
um terço. A causa é medida: 85 clientes do Asaas não têm telefone nenhum, e
outros 264 têm telefone que **não existe** na base de 705 fichas do CRM —
são clientes que assinaram contrato sem nunca ter escrito no WhatsApp do
escritório. As duas réguas frouxas que existiam para salvar esse caso
(sufixo de 8 e nome) não salvam nada: **zero** casos cada uma. A ponte do
Calendly, que salvou o tl;dv, também não: são 20 e-mails ligados a ficha, e
nenhum deles bate com cliente do Asaas. Só 1 das 705 fichas tem e-mail.

**⚠️ Os avisos do Asaas — quanto custam, e por onde saem**

Extrato de 180 dias, 5.570 lançamentos:

| Tipo | Qtd | Valor | Unitário |
| --- | --- | --- | --- |
| `INSTANT_TEXT_MESSAGE_FEE` (WhatsApp) | 3.623 | **R$ 1.992,65** | R$ 0,55 |
| `PAYMENT_MESSAGING_NOTIFICATION_FEE` | 475 | R$ 422,75 | R$ 0,89 |
| `PHONE_CALL_NOTIFICATION_FEE` (ligação) | **7** | **R$ 3,85** | R$ 0,55 |

Cruzando cada aviso pago com o vencimento da cobrança que ele cita:

| Momento | Qtd | Valor |
| --- | --- | --- |
| Antes (cobrança criada / aviso de proximidade) | 1.472 | R$ 809,60 |
| No dia do vencimento | 620 | R$ 341,00 |
| **Depois do vencimento (atraso)** | **1.007** | **R$ 553,85 → R$ 92,31/mês** |
| Não casou com cobrança da janela | 1.006 | R$ 714,80 |

São ~**R$ 403/mês** no total, dos quais a fatia de ATRASO é ~**R$ 92/mês**.
A ligação de robô, que o plano tratava como o pior risco, custou **R$ 3,85
em seis meses**.

⚠️⚠️ **E o mecanismo da D10 não funcionaria.** Lidos 12 clientes em
`GET /customers/{id}/notifications`, a configuração POR CLIENTE tem **só
e-mail** ligado (cobrança recebida e cobrança vencida) e **zero** em SMS,
ligação e WhatsApp — enquanto a conta paga ~600 avisos de WhatsApp por mês.
Ou seja, o WhatsApp do Asaas é interruptor **DA CONTA**, no painel, e não
passa pelo campo por cliente que a API expõe. `PUT /notifications/batch`
em centenas de clientes não apagaria uma única dessas mensagens.

---

## 3. Desenho

### 3.1 Fase 0 — levantamento só de leitura

Antes de qualquer código no repo, um script local (fora do repo, no
scratchpad da sessão) roda com a chave do operador e responde:

1. **Volume.** Clientes ativos e apagados; cobranças por status; quantas
   vencidas; parcelamentos; cobranças de assinatura (contadas pelo campo
   `subscription` das cobranças, sem `GET /subscriptions`).
2. **Formatos.** Amostra MASCARADA de `phone`/`mobilePhone`/`cpfCnpj` (C1);
   `deleted` nas listagens (C2); `status` múltiplo (C3); forma do erro (C5);
   cobrança removida (C11); permissão de `DUNNING_REQUESTED` (C12); cabeçalho
   de cota (C14).
3. **Simulação do vínculo** — o "verifique" do pedido. Para cada cliente do
   Asaas: casa com UM contato pelo telefone igual? pela irmã do nono dígito?
   só pelo sufixo? por e-mail (ficha e Calendly)? por nome? fica ambíguo?
   dois clientes de CPFs diferentes cairiam no mesmo contato? não casa com
   ninguém? É o número que diz se o vínculo automático resolve 90% ou 30% —
   e se a D5 está calibrada.
4. **Inadimplência hoje.** Quantos clientes têm parcela vencida; quantos
   deles casam com um contato (= quantas conversas acendem o aviso no dia
   da estreia); quantos têm duas parcelas vencendo no mesmo dia; quantas
   vencidas o Asaas diz que o boleto não pode mais ser pago
   (`canBePaidAfterDueDate`); quantos clientes têm `notificationDisabled`.
5. **O que o Asaas já manda.** A configuração de avisos de uma amostra de
   clientes (C8). O operador olha no painel se há ajuste da conta para os
   clientes novos (C13).
6. **`externalReference`** em uso? (C4, D9)
7. **Webhooks já cadastrados** (`GET /webhooks`): quantos (o teto é 10),
   para onde apontam, com que eventos.

Saída: um relatório com CONTAGENS e exemplos mascarados (primeiro nome +
quatro últimos dígitos), mostrado no próprio cartão e copiável num clique.
As contagens viram a §2.5.

⚠️ O que o levantamento **ainda não responde** e ficou para a Fase 2, por
não ter como ser medido só com GET: C7 (em que instante `PENDING` vira
`OVERDUE`), C9 (vencida com o vencimento empurrado para a frente) e C11
(cobrança removida: 404 ou `deleted: true`? — exigiria um id sabidamente
removido). A sonda de C12 (negativadas) e a de C3 (status múltiplo) estão
lá.

**A chave não passa pelo chat — e desde 12/09 também não passa por
arquivo nenhum.** O desenho original mandava o operador colar a chave numa
linha do `.env.local` para um script solto ler. Ele pediu, com razão, um
lugar SEGURO para a chave, e a saída foi adiantar a metade da Fase 1a que
resolve isso: o cartão em Integrações existe primeiro, a chave entra por ele
(cifrada, como as outras quatro integrações), e o levantamento roda DENTRO do
CRM com a chave já guardada — `POST /api/cb/asaas/levantamento`, botão
"Rodar levantamento" no cartão. Some, junto, a armadilha do `$` inicial da
chave, que o carregador de variáveis do Next expandiria.

⚠️ O levantamento **não grava nada**, nem no Asaas (só GET) nem no banco: o
relatório volta na resposta, é lido e some. E **nada identificável sai
inteiro** — nome vira primeiro nome, telefone vira os 4 últimos dígitos, e
CPF/CNPJ nunca aparece, só a contagem por tamanho: o relatório é lido por
gente e pode acabar colado num chat.

Se a conta já tiver lista de IPs ligada, a primeira chamada volta 403 e o
cartão diz isso em português (o mesmo código `sem_permissao` cobre a
permissão que falta e o IP fora da lista — é o que o Asaas devolve nos
dois).

### 3.2 Banco — Fase 1 (`9xx_cb_asaas.sql`)

Molde: `987_cb_tldv.sql` para a forma, e `977_cb_calendly.sql` para o
acesso. **Todas as tabelas do Asaas são FECHADAS ao navegador**: RLS ligada,
nenhuma policy, `REVOKE ALL` de `PUBLIC`, `anon` e `authenticated`, e
`GRANT ALL` a `service_role` por escrito. A tela lê por rotas em service role
(§3.5), que devolvem também o que o membro não enxergaria: se o Asaas está
conectado e se a leitura é fresca. Tudo `IF NOT EXISTS`, idempotente, com o
cabeçalho explicando cada decisão.

```sql
-- 1) config
CREATE TABLE IF NOT EXISTS cb_asaas_config (
  account_id             uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  api_key                text NOT NULL,   -- encrypt(); rotacionar ENCRYPTION_KEY invalida esta junto com as outras
  ambiente               text NOT NULL DEFAULT 'producao' CHECK (ambiente IN ('producao', 'sandbox')),
  chave_expira_em        date,            -- só se o operador pôs validade na chave: o Asaas não avisa (§3.7)
  status                 text NOT NULL DEFAULT 'conectado' CHECK (status IN ('conectado', 'erro')),
  last_sync_at           timestamptz,     -- só no SUCESSO
  last_sync_attempt_at   timestamptz,     -- carimbado no COMEÇO de toda varredura: o rodízio do cron (988)
  vencidas_listadas_em   timestamptz,     -- INÍCIO da última listagem COMPLETA das vencidas (§3.4)
  last_full_sync_at      timestamptz,     -- última listagem completa de clientes (diária)
  last_error             text,            -- CÓDIGO, nunca a mensagem do Asaas
  created_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- 2) clientes do Asaas e o VÍNCULO com a ficha
CREATE UNIQUE INDEX IF NOT EXISTS contacts_id_account_idx ON contacts (id, account_id);  -- da 945; idempotência

CREATE TABLE IF NOT EXISTS cb_asaas_clientes (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id               uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  asaas_customer_id        text NOT NULL,                       -- `cus_…`
  contact_id               uuid,                                -- o vínculo; NULL = sem ficha, desligado ou ignorado
  nome                     text NOT NULL DEFAULT '',
  cpf_cnpj                 text,                                -- só dígitos; só sai mascarado, pela rota do admin (D3)
  email                    text,                                -- minúsculas
  celular                  text,                                -- digitosDoTelefone(mobilePhone)
  telefone                 text,                                -- digitosDoTelefone(phone)
  notificacoes_desligadas  boolean NOT NULL DEFAULT false,      -- `notificationDisabled` (§3.6)
  deleted                  boolean NOT NULL DEFAULT false,      -- soft-delete do Asaas
  vinculo_origem           text CHECK (vinculo_origem IS NULL OR vinculo_origem IN
                             ('telefone', 'cpf', 'email', 'manual', 'desvinculado')),
  vinculado_por            uuid REFERENCES auth.users(id) ON DELETE SET NULL,   -- NULL = a regra automática
  vinculado_por_nome       text,                                -- carimbado pela rota: sobrevive à saída do login
  vinculado_em             timestamptz,
  contatos_recusados       uuid[] NOT NULL DEFAULT '{}',        -- desligados por gente: a regra nunca religa
  candidatos               jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{contact_id, motivo}] que a regra NÃO aplicou
  visto_em                 timestamptz NOT NULL DEFAULT now(),  -- última listagem que o trouxe
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cb_asaas_clientes_uk UNIQUE (account_id, asaas_customer_id),       -- TOTAL: alvo do upsert
  CONSTRAINT cb_asaas_clientes_contato_fk FOREIGN KEY (contact_id, account_id)
    REFERENCES contacts (id, account_id) ON DELETE SET NULL (contact_id)        -- coluna NOMEADA (966)
);
CREATE INDEX IF NOT EXISTS cb_asaas_clientes_contato_idx
  ON cb_asaas_clientes (account_id, contact_id) WHERE contact_id IS NOT NULL;

-- 3) cobranças — toda cobrança que o CRM JÁ VIU vencida, com o estado atual
CREATE TABLE IF NOT EXISTS cb_asaas_cobrancas (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  asaas_payment_id            text NOT NULL,          -- `pay_…`
  asaas_customer_id           text NOT NULL,
  status                      text NOT NULL,          -- o enum do Asaas CRU, SEM CHECK
  deleted                     boolean NOT NULL DEFAULT false,
  valor                       numeric(12,2) NOT NULL, -- `value` (sem juros)
  juros_e_multa               numeric(12,2),          -- `interestValue`
  vencimento                  date NOT NULL,          -- `dueDate`: A DATA DA INADIMPLÊNCIA desta parcela
  vencimento_original         date,                   -- `originalDueDate`
  vista_vencida_em            timestamptz,            -- a PRIMEIRA vez que o espelho a viu vencida; nunca reescrito
  pago_em                     date,                   -- `clientPaymentDate`, senão `paymentDate`
  forma                       text,                   -- `billingType`
  pode_pagar_apos_vencimento  boolean,                -- `canBePaidAfterDueDate` (boleto)
  dias_ate_cancelar_registro  integer,                -- `daysAfterDueDateToRegistrationCancellation`
  descricao                   text,
  parcelamento_id             text,                   -- `installment`
  parcela_numero              integer,                -- `installmentNumber`
  parcela_total               integer,                -- de GET /installments/{id}; NULL até a sync buscar
  link_fatura                 text,                   -- `invoiceUrl`
  link_boleto                 text,                   -- `bankSlipUrl`
  visto_em                    timestamptz NOT NULL DEFAULT now(),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cb_asaas_cobrancas_uk UNIQUE (account_id, asaas_payment_id),       -- TOTAL: alvo do upsert
  CONSTRAINT cb_asaas_cobrancas_cliente_fk FOREIGN KEY (account_id, asaas_customer_id)
    REFERENCES cb_asaas_clientes (account_id, asaas_customer_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS cb_asaas_cobrancas_vencidas_idx
  ON cb_asaas_cobrancas (account_id, asaas_customer_id, vencimento)
  WHERE status IN ('OVERDUE', 'DUNNING_REQUESTED') AND NOT deleted;

-- 4) as três FECHADAS (uma instrução por tabela: é a forma que o teste de RLS lê)
ALTER TABLE cb_asaas_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_asaas_clientes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_asaas_cobrancas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_asaas_config    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE cb_asaas_clientes  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE cb_asaas_cobrancas FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_asaas_config    TO service_role;
GRANT ALL ON TABLE cb_asaas_clientes  TO service_role;
GRANT ALL ON TABLE cb_asaas_cobrancas TO service_role;
```

Conferências no fim, em `DO $$`, todas válidas em banco vazio: as três
tabelas existem com RLS ligada; `anon` e `authenticated` sem SELECT, INSERT,
UPDATE nem DELETE; `service_role` com INSERT e SELECT; os UNIQUE e as FKs
pelo nome em `pg_constraint`. O teste estrutural é cópia do
`rls-das-tabelas-do-calendly.test.ts`: nada para `authenticated` e nenhuma
`CREATE POLICY`.

Escolhas que parecem detalhe e não são:

- **Tudo fechado, lido por rota.** A primeira versão deste plano deixava o
  navegador ler clientes e cobranças sob RLS, e a revisão mostrou três
  furos: a aba não saberia se o Asaas está conectado nem se a leitura está
  fresca (a config é fechada), então "Em dia" viraria afirmação sobre dado
  parado — a mesma fresta que o Meta Ads tem hoje; qualquer membro leria o
  espelho inteiro pelo PostgREST, fornecedores ignorados e clientes sem
  ficha incluídos; e o CPF exigiria GRANT por coluna, que quebra
  `select('*')` em silêncio. Com as rotas, o CPF simplesmente não sai, e a
  D4 muda sem migration.
- **O espelho é "toda cobrança que o CRM já viu vencida"**, não o Asaas
  inteiro. O cron lista só as vencidas; o webhook (Fase 2) só grava cobrança
  vencida ou que já está na tabela. A tabela responde "quem deve" e "quem
  regularizou", sem copiar parcela futura de assinatura.
- **O vínculo NÃO é copiado para a cobrança.** O contato da cobrança se
  resolve por `cb_asaas_clientes`. Uma cópia exigiria reescrever todas as
  cobranças a cada ligar/desligar, e duas fontes divergem na primeira falha.
- **`status` sem CHECK.** "Atributos novos podem aparecer a qualquer
  momento", diz a doc; um CHECK derrubaria a sincronização inteira por causa
  de um status novo. Quem interpreta é `classificar()` (§3.5), que devolve
  `desconhecida` e conta no cartão.
- **`vista_vencida_em` nunca é reescrito.** É o que protege a régua quando o
  Asaas marca a cobrança como vencida mais tarde do que o esperado (§3.6).

**A data da inadimplência e os dias de atraso.** A data é o `vencimento` de
cada parcela; "inadimplente desde" é o MENOR vencimento entre as vencidas do
contato. "Está vencida" é o `status` do Asaas, **nunca** `vencimento < hoje`:
o instante da virada não está documentado (C7), e um boleto de sábado pode
ser pago na segunda sem multa. Os dias de atraso **não são gravados**: são a
diferença, em dias de calendário, entre o vencimento e o dia de hoje em
`America/Sao_Paulo`, calculada na leitura. Gravado, o número ficaria errado
em toda linha que o cron não tocasse depois da meia-noite — a mesma razão de
`atraso.ts` contar a espera na tela. E `vencimento` nunca passa por
`new Date("2026-09-01")`, que é meia-noite UTC e retrocede um dia no Brasil.
Renegociar (vencimento empurrado para a frente) reinicia a contagem, como
reinicia a régua; a aba mostra o vencimento original quando for diferente.

### 3.3 Vínculo cliente do Asaas ↔ contato

**Algoritmo** (`src/lib/asaas/vinculo.ts`, puro e testado). A sincronização
monta índices em memória uma vez por ciclo — contatos da conta por
`phone_normalized`, por sufixo de 8 dígitos, por e-mail da ficha e dos
agendamentos do Calendly, por `chaveDeTag(nome)` sem os nomes numéricos; e
os clientes do Asaas já ligados, por CPF e por contato — e decide cliente a
cliente:

| Ordem | Sinal | Como casa | Resultado |
| --- | --- | --- | --- |
| 1 | Telefone igual | `digitosDoTelefone(mobilePhone)` e `(phone)`, cada um com `variantesDoNonoDigito`, contra `phone_normalized` | um contato só → **liga** (`telefone`); dois ou mais → para confirmar |
| 2 | CPF/CNPJ | outro cliente do Asaas da conta, com o mesmo CPF, já ligado a um contato | **liga** ao mesmo contato (`cpf`): é o cadastro duplicado no Asaas |
| 3 | E-mail | `contacts.email` e `cb_calendly_eventos` que já resolveu o contato | um contato só → **liga** (`email`) |
| 4 | Sufixo de 8 dígitos | como `findExistingContact`, mas colhendo TODOS os candidatos | só **sugere** (D5) |
| 5 | Nome | `chaveDeTag` igual; fora os 172 nomes numéricos e os nomes de uma palavra só | só **sugere**; e desempata a lista "para confirmar" |

Regras que não se negociam:

- **Quem a regra olha:** cliente com `contact_id` nulo e origem nula ou dada
  pela própria regra (`telefone`, `cpf`, `email`). Em SQL,
  `contact_id IS NULL AND (vinculo_origem IS NULL OR vinculo_origem IN
  ('telefone', 'cpf', 'email'))`. ⚠️ Nunca `vinculo_origem <> 'desvinculado'`:
  com a coluna nula (todo cliente novo), a comparação dá NULL e exclui o
  cliente sem erro nenhum. O UPDATE é cercado pelas mesmas condições, e um
  vínculo manual feito entre a leitura e a escrita vence.
- **Vínculo feito à mão que perde o contato volta para gente.** Origem
  `manual` com o contato apagado vai para "Para confirmar", com "o contato
  ligado à mão foi apagado"; a regra não religa.
- **Desligado por gente nunca volta.** O contato desligado entra em
  `contatos_recusados`, e a regra nunca liga aquele cliente a ele de novo —
  nem depois de um novo vínculo manual. "Ignorar" (o fornecedor cadastrado
  no Asaas) grava a origem `desvinculado`, que a regra não olha.
- **Conflito vira pergunta.** Só liga sozinho quando nenhum outro sinal
  forte (1–3) aponta para um contato DIFERENTE. Telefone dizendo A e e-mail
  dizendo B vai para "Para confirmar", com os dois.
- **Um contato, um CPF, pela regra.** A regra não liga um cliente a um
  contato já ligado a outro cliente de CPF/CNPJ DIFERENTE ("este contato já
  está ligado a {nome}"): dois clientes com o mesmo celular (o do cônjuge, o
  do escritório preenchido na recepção) mostrariam a dívida de um na conversa
  do outro. Mesmo CPF liga — é o cadastro duplicado. A pessoa e a empresa
  dela no mesmo contato só por decisão de gente, e aí cada uma aparece e é
  cobrada separada (D11).
- **Consulta que falha é "não sei"**: não grava `candidatos = []` nem "sem
  ficha" (a régua de `findExistingContact`: `falhou` não é "não achei").
- Número com menos de 8 ou mais de 15 dígitos não casa por nada
  (`digitosDoTelefone` devolve `null`) — a proteção que a 906 escreveu para o
  JID de grupo.
- A fusão de contatos do upstream (`merge_duplicate_contacts`) é segura: ela
  agrupa por telefone idêntico.

**O cartão** (Configurações → Integrações, só administrador). Exemplo do
resumo:

> 412 clientes no Asaas · **371 ligados** (358 pelo telefone, 9 pelo CPF,
> 4 à mão) · **9 para confirmar** · **32 sem ficha no CRM** · **38
> inadimplentes** · atualizado há 4 min

Cinco listas, paginadas por `GET /api/cb/asaas/clientes?lista=…`:

- **Para confirmar** — "Maria Aparecida Silva · CPF ***.123.456-** ·
  (83) 9 8874-5316 → parece ser **Maria A. Silva** (mesmo telefone sem o 9 ·
  nome parecido)". Botões **Ligar**, **Outro contato…** (o `SeletorDeCliente`
  de `src/components/agenda/seletor-de-cliente.tsx`) e **Ignorar**. Com dois
  candidatos, os dois aparecem para escolher.
- **Sem ficha no CRM** — nome, CPF mascarado, telefone formatado com botão
  de copiar, e **Vincular a um contato…** / **Ignorar**. Rodapé: "Cliente sem
  ficha não aparece em nenhuma conversa. Quando ele escrever pelo WhatsApp,
  ou alguém abrir a conversa pela Nova conversa, o CRM liga sozinho pelo
  telefone."
- **Ligados** — busca por nome, a origem ("pelo telefone", "à mão por
  {nome carimbado} em 10/09") e **Desligar** (confirmação: "O cliente do
  Asaas deixa de aparecer na conversa de {nome}. A sincronização não religa
  sozinha.").
- **Ignorados** — com **Desfazer**.
- **Inadimplentes** — todos os clientes com parcela vencida, COM e SEM
  ficha: parcelas, total, "desde" e dias, ordenados pelos dias, com recortes
  de 1 a 5, de 6 a 30 e mais de 30 dias. É a resposta para "controlar quantos
  dias de inadimplência existem" fora de uma conversa, e o único lugar onde
  aparece a dívida de quem não tem ficha.

Na aba Cobranças da conversa e da ficha, o administrador também desliga
("Não é este cliente") e liga ("Ligar a um cliente do Asaas…", busca entre
os clientes sem vínculo). Toda escrita passa por
`PUT/DELETE /api/cb/asaas/clientes/[id]/vinculo` (administrador), confere o
contato contra a conta, carimba o nome de quem fez e confere o ROWCOUNT.

### 3.4 Sincronização

**Cliente HTTP (`src/lib/asaas/cliente.ts`, molde `src/lib/tldv/cliente.ts`).**

- `ORIGEM_ASAAS = { producao: 'https://api.asaas.com', sandbox:
  'https://api-sandbox.asaas.com' }`; `doAsaas(url, ambiente)` prende o host
  antes de TODO pedido.
- Cabeçalhos `access_token: <chave>`, `User-Agent: <NOME_DO_APP>` (de
  `src/lib/marca.ts`, nunca literal — o `produto-gate` reprova) e `Accept:
  application/json`. **GET sempre sem corpo.** Chave nunca na URL.
- `AsaasError { codigo }`: `chave_invalida` (401 `invalid_access_token*`),
  `ambiente_errado` (401 `invalid_environment`: a cura é trocar o seletor,
  não a chave), `sem_permissao` (403 `insufficient_permission`, com o escopo
  que a descrição nomeia), `acesso_negado` (outro 403: provável lista de IPs
  da conta), `nao_encontrado`, `limite` (429, "pode ser outro sistema na
  mesma conta"), `rede`, `asaas_error`.
- `semSegredo(texto, chave)` em tudo que vira `message`; o log e a rota
  levam o CÓDIGO.
- Lê `RateLimit-Remaining` e encerra o ciclo abaixo de uma reserva: a cota é
  da CONTA do Asaas e pode estar dividida com outro sistema do escritório.
- Paginação `offset`/`limit=100` enquanto `hasMore`, com teto de páginas
  que **estoura** em vez de devolver meia lista.
- A fábrica recebe `fetchFn` para o teste injetar, como as outras três.

**Conexão (`src/lib/asaas/conexao.ts`).** `conectarAsaas` testa a chave com
a chamada mais barata (`GET /customers?limit=1`) e a grava cifrada, com
`upsert` por `account_id`. ⚠️ **Chave de outra conta do Asaas:** com espelho
já existente, antes de gravar ela relê um `cus_…` conhecido; 404 → recusa
("esta chave é de outra conta do Asaas"). Trocar de ambiente com dados no
espelho também é recusado. Nos dois casos, o cartão oferece "Desconectar e
apagar os dados do Asaas", com a contagem na pergunta. Desconectar comum
apaga só a config (e, a partir da Fase 2, o webhook no Asaas); o espelho
fica.

**O ciclo** (`GET /api/cb/asaas/cron`, laço LENTO do `docker-stack.yml`). A
rota é cópia da do tl;dv: `x-cron-secret` com `timingSafeEqual`, contas
ordenadas por `last_sync_attempt_at` (nunca tentada primeiro), orçamento de
90 s contra o `-m 120` do curl. `sincronizarAsaas(admin, accountId, {
prazoMs })` faz, nesta ordem, conferindo o prazo antes de cada passo:

1. Carimba `last_sync_attempt_at` ANTES de tudo. Chave que não decifra →
   `chave_ilegivel`.
2. **Cobranças vencidas, sempre completas:** `GET /payments?status=OVERDUE`
   e `?status=DUNNING_REQUESTED`, paginadas (uma consulta só se C3 disser
   que dá). ⚠️ **Mais, desde a D17: `?status=PENDING&dueDate[ge]=hoje&
   dueDate[le]=hoje`** — o que vence HOJE, que é o alvo do lembrete das 8h.
   É uma listagem barata (0 hoje, 98 nos próximos 30 dias — medido) e é a
   ÚNICA parcela a vencer que entra no espelho: o resto do futuro continua
   fora (§8), senão a tabela vira cópia do Asaas. A cobrança que vence hoje
   entra com `vista_vencida_em` NULO — ela não está vencida —, e é isso que
   a separa das outras nas consultas do aviso. Cliente desconhecido → `GET /customers/{id}` antes, porque a FK
   exige a linha. Cada cobrança passa por `aplicarCobranca`
   (`src/lib/asaas/aplicar.ts`), a MESMA função que o webhook usa, que
   carimba `vista_vencida_em` na primeira vez. Terminada a listagem inteira,
   e só então, `vencidas_listadas_em` recebe o instante em que ela COMEÇOU.
3. **Reconciliação:** toda cobrança local vencida com `visto_em` anterior a
   `vencidas_listadas_em` não voltou na listagem — pagou, foi apagada,
   renegociada, ou saiu junto com o cliente — e é relida uma a uma
   (`GET /payments/{id}`), sem teto por contagem, só pelo orçamento, e
   começando pelas de clientes LIGADOS. Até ser relida, ela fica "em
   conferência" e sai do aviso (§3.5). ⚠️ 404 só vira `deleted` depois que
   `GET /customers/{dono}` responder 200: se o cliente também der 404, a
   chave é de outra conta, e o ciclo termina em `conta_trocada` sem gravar
   nada.
4. **Total de parcelas:** para cada parcelamento ainda sem `parcela_total`,
   um `GET /installments/{id}`, com teto por ciclo. Falhar aqui não derruba o
   ciclo; a tela mostra "parcela 3" até vir o total.
5. **Clientes, uma vez por dia** (o primeiro ciclo depois das 03:00, a
   primeira sincronização e o botão "Sincronizar tudo"): `GET /customers`
   completo, upsert levando SÓ metadados — **nunca** `contact_id`,
   `vinculo_origem`, `contatos_recusados` nem `candidatos` (a lição do tl;dv:
   o que já é conhecido mantém o que tem). Cliente que sumiu da listagem
   vira `deleted`, conforme C2.
6. **Vínculo automático** para os clientes elegíveis (§3.3). Só lê o banco;
   roda todo ciclo, então o cliente que acabou de mandar a primeira mensagem
   no WhatsApp é ligado no ciclo seguinte.
7. Sucesso → `status = 'conectado'`, `last_sync_at`, `last_error = null`.
   Falha → `status = 'erro'`, `last_error = <código>`; o que já foi aplicado
   fica. 429, ou a reserva de `RateLimit-Remaining`, encerra o ciclo com
   `limite`, sem retentar na hora.

Custo por ciclo, numa conta com algumas centenas de vencidas: uns 10 a 30
pedidos, contra 25.000 a cada 12 h. Com a Fase 2 no ar, a listagem completa
das vencidas passa a uma vez por hora: o webhook é o caminho rápido, a
listagem é a garantia. Nenhuma poda na v1: o volume é o de cobranças que um
dia venceram.

**Webhook (Fase 2, `POST /api/cb/asaas/webhook/[token]`).** A migration da
Fase 2 acrescenta à config `webhook_token` (em claro: é o ENDEREÇO, o
segmento da URL), `webhook_auth_token` (cifrado: é a CREDENCIAL que chega em
`asaas-access-token` — a lição da 982: o token da URL não basta),
`webhook_asaas_id`, `webhook_email`, `webhook_state` (`ausente`, `ativo`,
`penalizado`, `interrompido` ou `desligado`), `webhook_religado_em`,
`chave_nome` e `last_event_at`; e cria `cb_asaas_eventos (account_id,
asaas_event_id, evento, asaas_payment_id, evento_criado_em, recebido_em,
processado_em, resultado)`, fechada ao navegador, com UNIQUE `(account_id,
asaas_event_id)`, sem o corpo do evento (ele traz valor, descrição e links
da cobrança, que já vão para a tabela dela), e com o `dateCreated` cru em
`evento_criado_em` (é o carimbo que mede C7; o `recebido_em` atrasa com as
retentativas).

1. Forma do token (`^[A-Za-z0-9_-]{16,64}$`) e conta resolvida por
   `webhook_token` → senão 404.
2. `asaas-access-token` comparado em tempo constante com o token decifrado →
   senão 401.
3. Limite por token estourado → **200 `{ adiado: true }`**, sem gravar nem
   processar: um 429 contaria como falha e ajudaria a interromper a fila, e
   o cron reconcilia de qualquer jeito.
4. Leitura tolerante (D8): evento de cobrança → `payment.id`; evento de
   chave → `accessToken.name`.
5. INSERT em `cb_asaas_eventos` com `ignoreDuplicates`; reentrega →
   `200 { duplicado: true }` sem processar.
6. `last_event_at` e `webhook_state = 'ativo'` (entrega chegando é prova de
   vida) → **200 em menos de 10 s**, e o trabalho vai para `after()`: um
   `GET /payments/{id}` com a nossa chave e `aplicarCobranca`, que só grava
   cobrança vencida ou já existente; no máximo 4 GET simultâneos, para uma
   fila religada que despeja 14 dias de eventos não esgotar os 50 da conta.
   Evento de chave só conta se `accessToken.name` for o `chave_nome` do CRM
   (os eventos de chave são da conta inteira) → `last_error` com
   `chave_desabilitada`, `chave_expirada` ou `chave_apagada`.

404 e 401 são as únicas respostas que não são 200, e as duas só acontecem
com URL ou token errados.

**Ciclo de vida do webhook (D7).** Criar com `name`, `url`, `email` (o
cartão pede; padrão, o do administrador que conecta — é para ele que o Asaas
manda os alertas de falha), `enabled: true`, `interrupted: false`,
`apiVersion: 3`, `authToken` de 48 caracteres aleatórios, `sendType:
NON_SEQUENTIALLY` (D8) e `events`. Antes de criar, `GET /webhooks` procura um
com a mesma URL e o reaproveita (`PUT` com o token novo): trocar a chave não
pode criar um segundo webhook e dobrar as entregas. Desconectar faz
`DELETE /webhooks/{id}`; se a chave já não funcionar, o cartão manda apagar
no painel do Asaas — senão o Asaas insiste por umas 13 horas, interrompe a
fila e manda três e-mails. A cada ciclo, o cron lê `GET /webhooks/{id}` e
grava o estado (`penalizado` quando `penalizedRequestsCount > 0`; `ausente`
no 404, e o cartão oferece recriar). Fila interrompida → o CRM religa UMA
vez (`PUT { interrupted: false }`); interrompida de novo depois disso →
"precisa de atenção" no cartão, e o CRM para de religar (a doc manda corrigir
a causa antes).

Eventos assinados: `PAYMENT_OVERDUE`, `PAYMENT_UPDATED`, `PAYMENT_CONFIRMED`,
`PAYMENT_RECEIVED`, `PAYMENT_RECEIVED_IN_CASH_UNDONE`, `PAYMENT_DELETED`,
`PAYMENT_RESTORED`, `PAYMENT_REFUNDED`, `PAYMENT_DUNNING_REQUESTED`,
`PAYMENT_DUNNING_RECEIVED`, `ACCESS_TOKEN_DISABLED`, `ACCESS_TOKEN_EXPIRED`
e `ACCESS_TOKEN_DELETED`.

**Fonte da verdade:** o Asaas. O cron é o que garante; o webhook só
antecipa. Nunca se conclui "está em dia" porque não chegou evento.

### 3.5 O aviso de inadimplência (Fase 1b)

**A régua pura — `src/lib/asaas/inadimplencia.ts`** (testada; nasce na Fase
1a, porque a lista de inadimplentes do cartão já a usa). Uma régua para os
cinco lugares, pelo mesmo motivo de `atrasoDeResposta` alimentar o selo E o
chip: duas réguas divergiriam e o operador leria "o aviso sumiu".

- `classificar(status, deleted)` → `vencida` (`OVERDUE`), `negativada`
  (`DUNNING_REQUESTED`), `paga` (`RECEIVED`, `CONFIRMED`,
  `RECEIVED_IN_CASH`, `DUNNING_RECEIVED`), `estornada` (`REFUNDED`,
  `REFUND_REQUESTED`, `REFUND_IN_PROGRESS`), `contestada` (os três
  `CHARGEBACK`), `em_analise` (`AWAITING_RISK_ANALYSIS`), `a_vencer`
  (`PENDING`), `apagada` (qualquer uma com `deleted`) ou `desconhecida`.
- `diasDeAtraso(vencimento, agoraMs)` — dias de calendário entre o
  vencimento e `diaNoFuso(agora, 'America/Sao_Paulo')`, por aritmética de
  data em texto. Negativo (vencimento prorrogado, C9) vira "vencimento
  prorrogado para …".
- `resumirPorContato(parcelas, agoraMs)` → por contato: as parcelas
  `vencida` (e `negativada`, D6) VISTAS na última listagem completa
  (`visto_em >= vencidas_listadas_em`), ordenadas pelo vencimento; total;
  "desde"; dias. As que não voltaram na listagem ficam "em conferência" e
  não entram no total.
- `rotuloDaParcela(p)` → `3/12`; `parcela 3` sem o total; a descrição
  quando a cobrança é avulsa.
- `rotulosDasParcelas(lista)` → "3/12 e 4/12"; "3/12, 4/12, 5/12 e mais 2".
- Dinheiro por `formatCurrency` (`src/lib/currency.ts`, pt-BR fixo).

**Leitura fresca.** `leituraFresca` = conectado, último ciclo sem erro, e a
última listagem completa das vencidas começou há menos de duas vezes o seu
intervalo (30 min antes da Fase 2; 2 h depois). Sem leitura fresca, nada
afirma "em dia": a aba diz "Sem leitura recente do Asaas (última: 09/09
18:40)"; a faixa mantém a dívida conhecida com o acréscimo âmbar "dados do
Asaas de 09/09 18:40"; e o filtro é neutralizado.

**De onde a tela lê.** Duas rotas, as duas para qualquer membro (D4), com
`getCurrentAccount()` como `/api/cb/execucoes/resumo`, em service role:

- `GET /api/cb/asaas/resumo` — para a caixa inteira: `{ conectado,
  leituraFresca, atualizadoEm, contatos: { [contactId]: parcela[] } }`.
  Pagina a leitura e ESTOURA acima do teto, nunca lista parcial. Erro → 500,
  nunca `{}`. Os DIAS são calculados no navegador, com a régua e o relógio da
  tela, que já tem um tique de um minuto.
- `GET /api/cb/asaas/contato/[contactId]` — para a aba: `{ conectado,
  leituraFresca, atualizadoEm, clientes: [{ nome, origem, ligadoPorNome }],
  vencidas, emConferencia, regularizadas, estornadas }`, e na Fase 3 também
  os envios da régua e a pausa. Sem CPF.
- `useInadimplencia(resyncToken)` — montado UMA vez na página do inbox, que
  é irmã da lista, do fio e do painel, e passa o dado aos três por prop.
  `null` = "não sei": nada afirma "em dia", a faixa cala, o ícone não
  aparece, o filtro é neutralizado. Recarrega no `resyncToken`, no evento
  global `cb:asaas-mudou` (ligar, desligar ou sincronizar numa outra árvore)
  e a cada 5 minutos com a aba visível.
- `useCobrancasDoContato(contactId)` — lê a rota de contato; guarda `{ de,
  … }` com o contato, e `carregando` é derivado de `de !== contactId` — a
  armadilha do efeito passivo, que o CLAUDE.md registra cinco vezes.

**Os lugares e o texto.**

| Lugar | Forma | Texto e regra |
| --- | --- | --- |
| **Linha da caixa** (`conversation-list.tsx`, fileira direita da linha de cima, ANTES do raio do robô) | só ícone, vermelho em par claro/escuro (`text-red-700 dark:text-red-300`) | o `title` leva a frase inteira. Só aparece em quem deve — presente demais é o mesmo que ausente. Grupo fica de fora |
| **Faixa colada ao compositor** (`message-thread.tsx`, irmã da `ScheduledBar`, no visual da faixa de divergência, em vermelho) | uma linha com botão | "**Inadimplente** · parcelas 3/12 e 4/12 · R$ 1.240,00 · desde 23/08 (17 dias)" + **Ver cobranças** (abre a aba do painel). Acréscimos quando cabem: "· negativada no Serasa"; "· cobrança automática pausada até 30/09" (Fase 3); em âmbar, "· dados do Asaas de 09/09 18:40" sem leitura fresca. É o último lugar por onde o olho passa antes de responder |
| **Painel da conversa** (`painel-do-contato.tsx`, 360 px) | 8ª aba só-ícone, "Cobranças", com `badge` = nº de parcelas vencidas; só existe com `conectado` vindo da rota | cabeçalho "Cliente no Asaas: Maria Aparecida Silva · ligado pelo telefone"; resumo em vermelho, "**Em dia** no Asaas às 14:05" (só com leitura fresca), ou "Sem leitura recente"; por parcela: rótulo, vencimento, dias, valor original e, quando o Asaas informar, o atualizado com juros e multa, **Copiar link**, **Abrir fatura ↗**, **Boleto ↗**; "em conferência no Asaas" à parte; "Regularizadas nos últimos 30 dias" (só `paga`), recolhidas; "Estornadas" à parte ("o valor voltou ao cliente"); para o administrador, **Não é este cliente**. Sem vínculo: "Este contato não está ligado a um cliente do Asaas" + **Ligar…** (administrador) |
| **Ficha em `/contacts`** (`contact-detail-view.tsx`) | 9ª aba, o MESMO componente, a mesma rota | idem |
| **Filtro "Inadimplentes"** (painel de ajustes da caixa, grupo fixo; salvo em visão) | booleano em `FiltrosDoInbox`; `ctx.inadimplentes: Set<string> \| null`, campo OBRIGATÓRIO | `ctx.inadimplentes = resumo?.conectado && resumo.leituraFresca ? new Set(ids) : null`: desconectado ou sem leitura fresca NEUTRALIZA, como durante a carga (senão uma visão salva devolveria "nenhuma conversa" com cara de resposta certa); o campo continua no painel com "Asaas desconectado — filtro sem efeito". Respeita a aba, como todo filtro (a lista completa, com as encerradas e os sem ficha, está no cartão). Fica fora de `limparOrfaos`. Toca `FILTROS_VAZIOS`, `contarFiltrosAtivos` e `aplicarFiltros` (`filtros.ts`); `lerFiltroSalvo` (só o booleano `true` liga), `escreverFiltroSalvo`, `mesmoFiltro` e `descreverFiltro` (`filtros-salvos.ts`); e `AMOSTRAS` (`filtros-salvos.test.ts:456`). A barra já tem quatro chips em ~290 dos 296 px do `lg`: o quinto não cabe |

O cabeçalho do fio NÃO ganha badge: já carrega janela de 24 h, avatares,
lupa, canal e situação — e "quais parcelas" não cabe num badge.

"Copiar link" leva o link da fatura (`invoiceUrl`), que mostra o valor
ATUALIZADO e todas as formas de pagamento.

### 3.6 Régua de cobrança (Fase 3)

> **Reescrita em 12/09/2026** com quatro regras do operador e com o
> levantamento na mão. O que mudou, em uma linha cada:
>
> 1. **São DOIS momentos, não um.** Antes só havia atraso; agora há também o
>    **lembrete no dia do vencimento** (D17): todo dia de manhã, quem tem
>    parcela vencendo naquele dia recebe uma mensagem.
> 2. **Uma mensagem por CLIENTE, com TODAS as parcelas vencidas** (D11) —
>    não uma por parcela, e não só as que cruzam o marco. Medido: 40 dos 92
>    devedores têm mais de 3 parcelas vencidas.
> 3. **A mensagem não mexe no estado da conversa** (D16): não reabre
>    encerrada, não zera o contador de espera, não conta como não lida.
> 4. **Não há pausa por acordo** (ex-D14, agora §8): ela dependia de um
>    registro de acordo que não existe.


**Gatilho novo `asaas_cobranca_vencida`, não uma terceira fonte do
`date_field_offset`.** O código de risco é o mesmo nas duas opções; a
diferença é o que a tela diz. "120 horas depois da data" não é como o
escritório pensa cobrança, e a regra da casa é que nenhuma opção da tela
pode mentir (D2 de `docs/PLANO-automacoes-multicanal-e-funil.md`). O custo
extra são arquivos mecânicos, todos cobrados por teste (`TRIGGER_META` é
`Record`; `rotulo-do-gatilho.test.ts` cobra rótulo e dica). E a lógica do
Asaas fica num módulo próprio, sem entrar em `lembretes.ts`.

```ts
// src/types/index.ts — entram no union AutomationTriggerType e no de trigger_config
| 'asaas_cobranca_vence_hoje'   // o lembrete (D17)
| 'asaas_cobranca_vencida'      // a cobrança do atrasado

export interface AsaasVenceHojeTriggerConfig {
  hora_envio?: string            // 'HH:MM', padrão '08:00', entre 07:00 e 17:00
  somente_dias_uteis?: boolean   // padrão true
}

export interface AsaasCobrancaTriggerConfig {
  dias_de_atraso: number         // 1..365, dias CORRIDOS depois do vencimento
  hora_envio?: string            // 'HH:MM', padrão '09:00', entre 08:00 e 17:00
  somente_dias_uteis?: boolean   // padrão true: fim de semana e feriado nacional fixo passam para o dia útil seguinte
}
```

⚠️ **São dois gatilhos, e não um com um sinalizador**, porque as duas
mensagens são coisas diferentes para quem escreve o texto: o lembrete fala
de UMA parcela que vence hoje, no tom de lembrete; a cobrança fala de TODAS
as vencidas, no tom de cobrança. Um gatilho só com "dias = 0" faria o editor
oferecer "0 dias de atraso" para dizer "no vencimento" — a tela mentindo, que
é o que a regra da casa proíbe. E o lembrete não tem marco, não tem trava por
dias de atraso e não reconfirma nada além do status.

O gatilho NÃO entra em `GATILHOS_SEM_DISPARO` (ele tem call site), e a grade
do funil não precisa de nada.

**A régua só dispara pela varredura.** O diálogo "Executar automação" não
lista automação deste gatilho; `runAutomationById` a recusa ("a régua de
cobrança só roda pela varredura do Asaas"), o que fecha a rota manual e o
passo `run_automation`; e `POST /api/automations/engine` também recusa.
Cobrança fora da régua a equipe escreve à mão, com o link da parcela copiado
da aba; um botão "cobrar agora" que passe pelo caminho da varredura é ideia
da Fase 4.

**O editor e a validação.** Trocar uma automação para este gatilho LIMPA
`stage_ids`, e as rotas de criar e editar gravam `stage_ids = null` para ele
— esconder o seletor não bastaria. `validate.ts` recusa, neste gatilho,
"Aguardar" de mais de 10 minutos em qualquer escopo, ramos incluídos: a
retomada só confere se a automação continua ligada, e sairia sem reconferir
pagamento nem pausa.

**O dia-alvo** (`src/lib/asaas/regua.ts`, puro). É `vencimento +
dias_de_atraso` — ou, se for mais tarde, o dia em que o espelho viu a
cobrança vencida pela primeira vez (`vista_vencida_em`), desde que esse dia
não passe de `vencimento + dias_de_atraso + 3`; passado disso é atrasado
antigo, e vale a D13. Com `somente_dias_uteis`, sábado, domingo e feriado
nacional de data fixa (01/01, 21/04, 01/05, 07/09, 12/10, 02/11, 15/11, 20/11,
25/12, numa lista pura no código) empurram para o dia útil seguinte. ⚠️ O
`vista_vencida_em` é o que protege o marco de 1 dia quando o Asaas só marca
vencida no dia útil seguinte (C7): sem ele, todo vencimento de sábado
perderia o primeiro aviso, em silêncio.

**A janela.** Dispara quando o relógio está entre
`paraInstante(diaAlvo, hora_envio, 'America/Sao_Paulo')` (de
`src/lib/agenda/fuso.ts`) e as 18:00 do dia-alvo. Agendador parado até as
18:00 = marco perdido naquele dia.

**Onde roda:** dentro do `/api/cb/asaas/cron`, logo depois da sincronização
da conta — com o espelho recém-atualizado, e sem outro `docker stack deploy`
na Fase 3. O laço lento dá granularidade de uns 15 a 20 minutos, que basta
para uma mensagem das 09:00. A régua usa o que sobrar do orçamento de 90 s do
ciclo; se não sobrar, o ciclo seguinte a roda, dentro da mesma janela.

**As candidatas.** Uma cobrança só é candidata quando:

- `classificar` diz `vencida` (a negativada fica fora, D6) e ela foi vista
  na última listagem completa;
- o cliente está ligado a uma ficha (pela regra automática ou à mão);
- o boleto ainda pode ser pago (`pode_pagar_apos_vencimento` e
  `dias_ate_cancelar_registro`); a que o Asaas diz que não pode mais fica
  fora e é contada no cartão, porque precisa de gente para gerar outra;
- o contato tem telefone e conversa 1:1 com `channel_id` definido — a
  conversa sem canal fica fora e é contada como "sem conexão definida": um
  link de pagamento vindo de um número com que o cliente nunca falou tem
  cara de golpe do boleto;
- o canal é Evolution (a conexão da Meta fica fora na v1: texto livre fora
  das 24 h não sai, e o modelo aprovado é Fase 4) e está conectado
  (`cb_channels.instance_state` = `open`); desconectado, a candidata é
  pulada SEM travar, e o ciclo seguinte tenta dentro da janela.

`notificacoes_desligadas` (o `notificationDisabled` do Asaas) é guardado e
mostrado na aba, e **não** vira "não cobrar": medido em 12/09, **nenhum**
cliente da conta o tem ligado, então ele não separa ninguém. ⚠️ E não confunda
com a D10: aquele campo cala TODOS os avisos daquele cliente; o WhatsApp que
a conta paga não passa por ele nem pela configuração por cliente — é
interruptor do painel.

**A varredura** (`src/lib/asaas/varrer-regua.ts`), para cada automação
ligada deste gatilho:

1. **Recolhe travas órfãs.** `reservado` há mais de 10 minutos SEM linha em
   `automation_logs` daquela automação e contato criada depois da trava =
   nada rodou → a trava é apagada, e o ciclo seguinte tenta dentro da
   janela. COM log = pode ter saído → `incerto`, nunca reenviado, visível na
   aba e contado no cartão. (O deploy `start-first` para a task antiga 10 s
   depois de a nova subir, e cada merge no `main` é um deploy.)
2. Lê as candidatas, calcula o dia-alvo e fica com as que estão na janela.
3. Tira as que já têm trava deste MARCO para este vencimento.
4. **Reconfirma no Asaas** cada uma (`GET /payments/{id}`, e decide por
   `classificar(status, deleted) === 'vencida'`). Não está mais vencida →
   aplica o estado novo ao espelho e sai. `rede` ou `limite` → para a
   varredura sem travar nada; o ciclo seguinte tenta enquanto a janela
   durar. É a única garantia forte contra "pagou há três minutos".
5. **Agrupa por cliente do Asaas** (D11) e **trava o grupo inteiro num
   INSERT só**, uma linha por parcela: é atômico, e 23505 em qualquer
   parcela quer dizer que outro processo pegou — o grupo inteiro sai. São dois
   processos Node vivos durante o deploy, e só o banco serializa.
   ⚠️⚠️ **O MARCO decide QUANDO; o conteúdo é SEMPRE tudo** (regra do
   operador, 12/09). O grupo é travado pelas parcelas que CRUZAM o marco
   hoje, mas a mensagem lista **todas** as vencidas daquele cliente — as
   antigas inclusive. O exemplo que ele deu é o caso real: quem atrasou a
   parcela deste mês e já devia a do mês passado recebe UMA mensagem dizendo
   as duas. Sem isso, o cliente com 6 parcelas vencidas (29 na base hoje)
   receberia uma mensagem por parcela toda vez que uma nova cruzasse um
   marco, e o escritório pareceria um robô quebrado.
   ⚠️ As parcelas ANTIGAS entram no texto **sem** rearmar trava nenhuma: a
   trava continua sendo `(cobranca_id, marco, vencimento)` das que cruzaram
   hoje. Sem essa separação, citar a parcela antiga a marcaria como cobrada
   naquele marco e ela perderia o marco dela.
6. **Dispara** `dispararAutomacoes({ accountId, triggerType:
   'asaas_cobranca_vencida', contactId, context: { automation_id, vars } })`.
   `triggerMatches` compara `automation_id`, como no `date_field_offset` —
   sem isso, o disparo por tipo rodaria a de 5 dias junto com a de 1.
7. **Mede o resultado** no `automation_logs` daquela automação e contato
   criado depois da trava: `desfecho = 'concluida'` com o `send_message`
   bem-sucedido em `steps_executed` → `enviado`; `barrada` → `barrada`;
   `falhou` → `falhou`; barrada pelo escopo sem execução → `fora_do_escopo`;
   sem log → `sem_automacao` (desligada entre a seleção e o disparo). Grava
   com cerca de posse: `WHERE id IN (<ids devolvidos pelo INSERT>) AND
   resultado = 'reservado'`. Falha depois da trava NÃO é tentada de novo: o
   tempo esgotado da Evolution pode ter entregado (a lição da 926).

**A trava é do MARCO, não da automação:** `UNIQUE (cobranca_id, marco,
vencimento)`, com `marco` = `dias_de_atraso`. Duas automações do mesmo marco
— uma duplicada e esquecida, ou a "régua padrão" criada duas vezes —
disputam a mesma trava, e só uma envia. Editar o marco de uma automação (de
1 para 3 dias) não herda as travas do marco antigo. A chave inclui o
vencimento: parcela renegociada rearma a régua, como reunião remarcada. O
cartão avisa quando duas automações ligadas têm o mesmo marco.

**Variáveis** (`{{vars.*}}`, montadas em `regua.ts`):

| Variável | Conteúdo |
| --- | --- |
| `cliente_nome`, `cliente_primeiro_nome` | o nome **no Asaas** — 172 contatos do CRM têm o número como nome, e `{{contact.name}}` sairia "Olá, 5583988…" |
| `cobranca_detalhe` | ⚠️ **TODAS as vencidas do cliente**, da mais antiga para a mais nova, uma linha cada: "• Parcela 3/12 — R$ 620,00 (valor original) — venceu em 23/08/2026 — https://www.asaas.com/i/…"; com juros e multa informados, "R$ 648,20 (atualizado)". É o que a D11 exige, e é a variável que o texto padrão usa |
| `cobranca_parcelas` | "3/12" ou "3/12, 4/12 e 5/12" — todas as vencidas |
| `cobranca_valor` | a soma de TODAS as vencidas, com a mesma regra de "original" e "atualizado" |
| `cobranca_vencimento` | o vencimento MAIS ANTIGO em aberto, "23/08/2026" — é o "inadimplente desde" |
| `cobranca_quantidade` | quantas parcelas estão vencidas ("1", "6") — deixa o texto escolher singular e plural |
| `dias_de_atraso` | os dias REAIS da parcela que CRUZOU o marco — vencida numa sexta, o marco de 1 dia sai na segunda com "3" |
| `dias_de_atraso_maior` | os dias da parcela mais ANTIGA em aberto: é o número que descreve a situação do cliente |
| `marco_detalhe` | só as parcelas que cruzaram o marco HOJE, para quem quiser um texto que separe "esta venceu agora" de "e ainda constam estas" |

Não há `cobranca_link` solto: com várias parcelas, um link pagaria só uma, e o
link de cada parcela já está em `cobranca_detalhe`. Datas por aritmética de
texto (DATE não tem fuso); dinheiro por `formatCurrency`. A caixa de
variáveis aparece no editor do gatilho (`asaas-trigger-config.tsx`, molde de
`calendly-trigger-config.tsx`).

**"Criar régua padrão"** (bloco no cartão, administrador): cria as
automações DESLIGADAS que ainda faltam — "Cobrança · 1 dia", "· 5 dias",
"· 30 dias", pulando o marco que já existe — cada uma com um passo de
mensagem editável:

> Olá, {{vars.cliente_primeiro_nome}}! Tudo bem? Constam em aberto no seu
> cadastro {{vars.cobranca_quantidade}} parcela(s), num total de
> {{vars.cobranca_valor}}:
> {{vars.cobranca_detalhe}}
> Se já pagou, pode desconsiderar esta mensagem. Qualquer dúvida, é só
> responder por aqui.

O operador troca o texto no editor de sempre e liga uma a uma. Mais marcos
(60, 90 dias) são automações novas do mesmo gatilho.

**Pausa por acordo (D14).** Tabela `cb_asaas_pausas`, uma linha por contato,
e a rota `PUT/DELETE /api/cb/asaas/pausa/[contactId]` (`agent` para cima),
que carimba o nome de quem pausou. A aba mostra "Cobrança automática pausada
até 30/09 · {nome} · acordo de parcelamento", com **Retomar**; a faixa ganha
o acréscimo. A data expira sozinha.

**Avisos nativos do Asaas (D10).** `src/lib/asaas/avisos-nativos.ts`, rodando
no mesmo ciclo: com alguma automação da régua ligada, para cada cliente que
a régua alcança, `GET /customers/{id}/notifications`, e os dois
`PAYMENT_OVERDUE` (0 e 7 dias) desligados por `PUT /notifications/batch`;
`cb_asaas_clientes.avisos_asaas_desligados_em` carimba onde o CRM desligou.
Cliente ligado depois recebe o mesmo tratamento. Sem nenhuma automação da
régua ligada, o CRM religa os avisos onde ELE os desligou, e limpa o carimbo.
Se a Fase 0 achar no painel um ajuste da conta para os clientes novos (C13),
ele poupa o tratamento dos novos; os existentes continuam precisando da
chamada.

**Histórico:** `cb_asaas_regua_envios` é a trava E o registro — não é podada
em 90 dias como a trava dos lembretes. A aba mostra "Cobrança automática: 1
dia · enviada em 07/09 09:05" (ou `barrada`, `falhou`, `incerto`); o fio já
mostra a bolha do robô e o desfecho da execução (985).

**Mais regras:** sem canal no disparo (o escopo de canal deixa passar, e a
mensagem sai pelo canal da conversa); conversa **encerrada** recebe a
cobrança sem reabrir, e a resposta do cliente reabre; **grupo** e contato
só do **Instagram** ficam fora já na lista de candidatas; e **três
automações, nunca uma com "Aguardar"** (§2.4).

Migration da Fase 3:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS cb_asaas_cobrancas_id_account_idx
  ON cb_asaas_cobrancas (id, account_id);                -- para a FK composta abaixo

ALTER TABLE cb_asaas_clientes
  ADD COLUMN IF NOT EXISTS avisos_asaas_desligados_em timestamptz;   -- D10: onde o CRM desligou

CREATE TABLE IF NOT EXISTS cb_asaas_pausas (
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL,
  ate          date NOT NULL,
  nota         text,
  por          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  por_nome     text,                                     -- carimbado pela rota
  criado_em    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cb_asaas_pausas_pk PRIMARY KEY (account_id, contact_id),
  CONSTRAINT cb_asaas_pausas_contato_fk FOREIGN KEY (contact_id, account_id)
    REFERENCES contacts (id, account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cb_asaas_regua_envios (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  cobranca_id      uuid NOT NULL,
  marco            integer NOT NULL,     -- `dias_de_atraso` da automação: a trava é do MARCO
  vencimento       date NOT NULL,        -- o vencimento que cruzou o marco
  automation_id    uuid REFERENCES automations(id) ON DELETE SET NULL,
  automation_nome  text NOT NULL,        -- congelado: apagar a automação não apaga o que saiu
  contact_id       uuid,
  resultado        text NOT NULL DEFAULT 'reservado' CHECK (resultado IN
                     ('reservado', 'enviado', 'barrada', 'falhou', 'fora_do_escopo', 'sem_automacao', 'incerto')),
  criado_em        timestamptz NOT NULL DEFAULT now(),
  finalizado_em    timestamptz,
  CONSTRAINT cb_asaas_regua_envios_uk UNIQUE (cobranca_id, marco, vencimento),
  CONSTRAINT cb_asaas_regua_envios_cobranca_fk FOREIGN KEY (cobranca_id, account_id)
    REFERENCES cb_asaas_cobrancas (id, account_id) ON DELETE CASCADE,
  CONSTRAINT cb_asaas_regua_envios_contato_fk FOREIGN KEY (contact_id, account_id)
    REFERENCES contacts (id, account_id) ON DELETE SET NULL (contact_id)
);
CREATE INDEX IF NOT EXISTS cb_asaas_regua_envios_contato_idx
  ON cb_asaas_regua_envios (account_id, contact_id, criado_em DESC);

-- as duas novas FECHADAS, como as da Fase 1
ALTER TABLE cb_asaas_pausas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_asaas_regua_envios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_asaas_pausas       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE cb_asaas_regua_envios FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE cb_asaas_pausas       TO service_role;
GRANT ALL ON TABLE cb_asaas_regua_envios TO service_role;
-- DO $$: anon e authenticated sem nada; service_role com INSERT; UNIQUE e FKs pelo nome.
```

**Por onde a mensagem SAI — e o que ela não pode mexer (D16).** A régua
manda pelo caminho do ROBÔ (`engineSendText`, o passo `send_message` do
motor), nunca por `sendMessageToConversation`. Conferido no código em
12/09/2026, e as três exigências do operador saem todas do mesmo lugar:

| Exigência | Por que ela já vale, e o que a quebraria |
| --- | --- |
| **não reabre conversa encerrada** | quem reabre é `sendMessageToConversation` (os quatro caminhos da 972/reopen). O robô não passa por lá — é a mesma razão pela qual broadcast, fluxo e IA não reabrem: um disparo para 500 encerradas devolveria as 500 à caixa |
| **não zera o contador de espera** | `engineSendText` grava `sender_type: 'bot'`, e o gatilho da 972 só limpa `aguardando_desde` no ramo `sender_type = 'agent'` COM `sender_id` ou `from_device`. Cobrar não é responder: o cliente que espera resposta há dois dias continua marcado como esperando |
| **não conta como não lida** | `unread_count` só sobe na ENTRADA (`bump_conversation_on_inbound`); nenhum caminho de envio o toca. Medido por varredura: zero ocorrências de `unread_count` nos módulos de envio |

⚠️ **Isso precisa de teste estrutural, não de cuidado.** `src/lib/asaas/
regua.chamadores.test.ts`, no molde de `pipeline-routing.chamadores.test.ts`:
varredura default-deny sobre `src/lib/asaas/**` reprovando qualquer citação
de `sendMessageToConversation`, com allowlist vazia. "Reusar o núcleo de
envio" parece limpeza de código e traz as três regressões de uma vez — e as
duas primeiras são invisíveis na tela de quem manda: quem paga é o atendente,
que perde o alerta de atraso, e o cliente, cuja conversa encerrada volta para
a caixa.

⚠️ **A conversa encerrada é cobrada assim mesmo, e isso é decisão.** Encerrar
é tirar da caixa de entrada, não é "não deve mais". O aviso da Fase 1b já
segue essa regra (a tela é que esconde o selo na aba Encerradas).

**O lembrete do dia do vencimento (D17).** Mesma varredura, mesmo cron, outro
recorte e outro gatilho:

1. As candidatas são as cobranças **`PENDING` com `vencimento` = hoje** no
   fuso do escritório, do espelho recém-sincronizado (é por isso que a §3.4
   passou a listar também o que vence hoje).
2. Sem marco e sem dias de atraso: a trava é `(cobranca_id, 'vence_hoje',
   vencimento)`, na mesma tabela — parcela renegociada para outro dia ganha
   lembrete novo, e o mesmo dia nunca manda duas vezes.
3. **Uma mensagem por cliente**, como a da cobrança: quem tem duas parcelas
   vencendo hoje (3 clientes na base) recebe uma só. ⚠️ Mas o texto do
   lembrete fala **só do que vence hoje** — `cobranca_detalhe` aqui é o do
   dia, não o acervo de vencidas. Misturar "vence hoje" com "e você ainda
   deve estas seis" transforma um lembrete gentil numa cobrança, e o
   operador pediu as duas coisas separadas.
4. A reconfirmação no Asaas continua, e agora é `classificar(...)` dizendo
   que a cobrança **ainda não foi paga**: quem pagou de manhã não recebe
   lembrete à tarde.
5. As mesmas cercas da cobrança: contato ligado, telefone, conversa 1:1 com
   canal definido, canal Evolution conectado, caminho do robô (D16).

⚠️ **O lembrete do Asaas continua saindo em paralelo enquanto o interruptor
do painel estiver ligado** — 620 avisos em 180 dias, R$ 341. É a mesma
decisão da D10, e ela agora é do operador, no painel do Asaas, não do CRM.

### 3.7 Segurança e LGPD

- **Chave:** por conta, cifrada, testada ao conectar, nunca devolvida por
  rota nenhuma, nem mascarada; o campo do cartão nasce vazio sempre.
- **Menor privilégio, com os nomes da tela do Asaas.** Chave "CRM —
  levantamento" (Fase 0): leitura em Clientes, Cobranças, Parcelamentos,
  Notificações e Webhooks — sem Negativação, para a C12 se responder
  sozinha. Chave "CRM — produção": leitura em Clientes, Cobranças e
  Parcelamentos; Webhooks em leitura e escrita a partir da Fase 2 (D7).
  ⚠️ **Notificações NÃO entra mais** — a D10 morreu na medição de 12/09 (o
  WhatsApp do Asaas não passa pela API de notificação por cliente), e a
  chave fica com uma permissão de ESCRITA a menos. **Negativação também
  não**: a C12 respondeu 200 sem ela. Nada de transferência, pagamento de conta ou
  Pix. A permissão se edita depois, na tela do Asaas.
- ⚠️ **A restrição de IP é da CONTA, não da chave.** A lista fica em
  Integrações → Mecanismos de segurança e vale para todas as chaves: ligá-la
  bloqueia qualquer outro sistema do escritório que use a API por outro
  endereço. É opcional, e só depois da Fase 1a verde e de confirmar que
  nenhum outro sistema usa a API (se usar, o IP dele entra junto).
- ⚠️ **Chave de produção SEM data de validade.** O Asaas só avisa antes de
  expirar no ciclo de inatividade, que o cron nunca deixa começar; com
  validade definida à mão, a integração morreria no último dia sem aviso.
  Se o operador exigir validade, o cartão guarda a data (`chave_expira_em`)
  e avisa 30 dias antes.
- **Eventos de chave são da conta inteira.** O cartão pede o NOME da chave
  junto com ela, e o webhook só marca a conexão quando o evento é da chave
  do CRM.
- ⚠️ **Sandbox nunca neste banco.** O ambiente local e a produção usam o
  MESMO projeto Supabase (`.env.local`), e a config é uma linha por conta:
  conectar o sandbox no cartão local trocaria a conexão da produção, e o
  cron da VPS passaria a reler as vencidas reais no sandbox — 404 em tudo,
  o escritório inteiro "em dia", e clientes fictícios ligados pelo telefone
  a contatos reais. Até existir um banco separado, o sandbox fica restrito a
  testes com `fetchFn` falso; o `ambiente` existe para outras instalações.
- **A cota é da conta do Asaas**, dividida com qualquer outro sistema que use
  a API; o cliente HTTP guarda reserva (§3.4), e o cartão, no `limite`, diz
  "pode ser outro sistema na mesma conta".
- **Papéis (D4):** configurar, sincronizar, ligar e desligar clientes e
  criar a régua é `requireRole('admin')`; pausar a régua é `agent`; ver o
  aviso, a aba e o filtro é qualquer membro. O cartão mora dentro do
  `<RequireRole min="admin">` de `integracoes-panel.tsx`, e as rotas usam
  `requireRole('admin')`; o `ESCRITA_DA_SECAO` de
  `src/lib/perfis/poderes.ts:167` é só o espelho no editor de perfis.
  Nenhuma seção nova em Configurações.
- **O mínimo necessário:** do cliente, nome, CPF/CNPJ (que nunca sai
  inteiro), e-mail e telefones; da cobrança, valor, juros, vencimento,
  status, parcela, descrição, links e as duas informações do boleto. Fora:
  cartão, endereço, `nossoNumero`, comprovantes, split. O corpo do webhook
  não é guardado.
- **LGPD:** o escritório já é o controlador dos dados dos próprios
  clientes; trazer CPF e e-mail do Asaas é tratamento para a mesma
  finalidade, cobrar honorários. O operador confere os termos do Asaas
  (C10). Nenhuma TABELA do Asaas vai a provedor de IA; a mensagem da régua,
  sim, como qualquer mensagem do robô (D15).
- **Log:** prefixo `[asaas]`, com ids (`cus_…`, `pay_…`) e códigos; nunca a
  chave, nunca o CPF.

---

## 4. Arquivos por fase

**Fase 1a-conexão — a chave num lugar seguro e o levantamento** ✅ (12/09)

- `supabase/migrations/992_cb_asaas_config.sql` — SÓ `cb_asaas_config`
  (§3.2). ⚠️ As outras duas tabelas ficaram de fora de propósito: a forma
  delas é o que o levantamento pode mudar (D2, D5, D9), e migration aplicada
  não se reescreve.
- `supabase/migrations/rls-da-config-do-asaas.test.ts` — cópia do teste do
  Calendly: RLS ligada, `REVOKE` das três metades, nada para `anon` nem para
  `authenticated`, `GRANT ALL` a `service_role`, nenhuma `CREATE POLICY`.
- `src/lib/asaas/cliente.ts` (+ teste) — `criarClienteAsaas`, `AsaasError`,
  `doAsaas`, `codigoDoErro`, `semSegredo`, `lerErro`, paginação com teto que
  ESTOURA, e os cabeçalhos `RateLimit-*` guardados (C14).
- `src/lib/asaas/leitura.ts` (+ teste) — parse tolerante de cliente e
  cobrança; campo novo ignorado; `installmentNumber` em texto ou número;
  `diaParaData` contra a armadilha do DATE em UTC.
- `src/lib/asaas/conexao.ts` — `conectarAsaas` (só produção),
  `desconectarAsaas`, `clienteDaConta`.
- `src/lib/asaas/cartao.ts` (+ teste) — `cartaoDoAsaas` e a lista exportada
  `CODIGOS_DO_ASAAS`; o teste cobra `Settings.integracoes.asaas.motivo.<codigo>`
  e `…asaas.vinculoMotivo.<motivo>` nos dois dicionários (o buraco que o
  cartão do tl;dv deixou, porque lá a lista mora no componente).
- `src/lib/asaas/levantamento.ts` (+ teste) — o levantamento da Fase 0
  (§3.1): índices do CRM, `decidirVinculo`, as contagens e as sondas.
- `src/app/api/cb/asaas/route.ts` (GET, admin — o cartão),
  `config/route.ts` (PUT/DELETE), `levantamento/route.ts` (POST).
- `src/components/settings/asaas-card.tsx` — o cartão, montado em
  `integracoes-panel.tsx` ao lado do tl;dv. O chip não afirma "não
  conectado" durante a carga; "Sandbox" em âmbar.
- Tocados: `integracoes-panel.tsx`, `src/lib/rate-limit.ts` (balde
  `asaasLevantamento`), `messages/{en,pt-BR}.json`.

**Fase 1a-espelho — cron, vínculo, listas**

- `supabase/migrations/9xx_cb_asaas.sql` — `cb_asaas_clientes` e
  `cb_asaas_cobrancas` (§3.2), com a forma ajustada pelos números da Fase 0.
- `src/lib/asaas/aplicar.ts` (+ teste com dublê do admin) —
  `aplicarCobranca`, a função única do cron e do webhook.
- `src/lib/asaas/vinculo.ts` (+ teste) — a decisão de produção (§3.3), com
  uma linha de `vinculo_origem` nula no teste. O `decidirVinculo` do
  levantamento é o ensaio dela.
- `src/lib/asaas/inadimplencia.ts` (+ teste) — a régua (§3.5).
- `src/lib/asaas/sincronizar.ts` (+ teste com dublê do admin e cliente
  falso) — o ciclo (§3.4), carimbo ANTES do trabalho, prazo por
  `Date.now()`.
- `src/lib/asaas/aviso.ts` — o evento global `cb:asaas-mudou`, fora dos
  hooks.
- `src/app/api/cb/asaas/sync/route.ts` (POST, 202), `cron/route.ts` (GET,
  `x-cron-secret`), `clientes/route.ts` (GET, as cinco listas, CPF
  mascarado), `clientes/[id]/vinculo/route.ts` (PUT/DELETE).
- Tocados: `asaas-card.tsx` (as listas), `docker-stack.yml` (`cb/asaas` no
  laço lento e no banner), `messages/{en,pt-BR}.json`, e a doc de quem
  instala (`docs/INSTALACAO.md`: onde criar a chave, que permissões, e o
  `docker stack deploy`).

**Fase 1b — o aviso**

- `src/app/api/cb/asaas/resumo/route.ts`,
  `src/app/api/cb/asaas/contato/[contactId]/route.ts`.
- `src/hooks/use-inadimplencia.ts`, `src/hooks/use-cobrancas-do-contato.ts`.
- `src/components/inbox/faixa-de-inadimplencia.tsx`,
  `src/components/inbox/painel/aba-cobrancas.tsx` (painel e ficha, com
  `carregando` obrigatório).
- Tocados: `src/app/(dashboard)/inbox/page.tsx` (monta o hook e passa por
  prop), `conversation-list.tsx` (ícone e `ctx.inadimplentes`),
  `message-thread.tsx` (a faixa), `painel-do-contato.tsx` (8ª aba),
  `contact-detail-view.tsx` (9ª aba), `src/lib/inbox/filtros.ts` (+ teste),
  `inbox-filters.tsx`, `src/lib/inbox/filtros-salvos.ts` (+ `AMOSTRAS`),
  `messages/*`.

**Fase 2 — webhook**

- `supabase/migrations/9xx_cb_asaas_webhook.sql` — colunas da config e
  `cb_asaas_eventos` (fechada).
- `src/lib/asaas/webhook.ts` (+ teste) — leitura do aviso.
- `src/app/api/cb/asaas/webhook/[token]/route.ts`.
- Tocados: `conexao.ts` (criar, reaproveitar, conferir e apagar o webhook),
  `sincronizar.ts` (estado da fila; listagem das vencidas de hora em hora),
  `cliente.ts` (limite de 4 GET simultâneos no `after()`), `asaas-card.tsx`
  (bloco do webhook, e-mail e nome da chave), `rate-limit.ts`
  (`asaasWebhook`), o teste de RLS, `messages/*`.

**Fase 3 — régua**

- `supabase/migrations/9xx_cb_asaas_regua.sql` (§3.6).
- `src/lib/asaas/regua.ts` (+ teste: dia-alvo, `vista_vencida_em`, fim de
  semana e feriado, janela, agrupamento, variáveis),
  `src/lib/asaas/varrer-regua.ts` (+ teste com dublê: trava de grupo,
  recolhimento de órfã, medição do resultado),
  `src/lib/asaas/avisos-nativos.ts` (+ teste).
- `src/components/automations/asaas-trigger-config.tsx`.
- `src/app/api/cb/asaas/pausa/[contactId]/route.ts`,
  `src/app/api/cb/asaas/regua/route.ts` (criar a régua padrão).
- Tocados: `src/types/index.ts`, `src/lib/automations/trigger-meta.ts`,
  `validate.ts` (+ teste: "Aguardar"), `engine.ts` (`triggerMatches` e a
  recusa em `runAutomationById`, + teste), `automation-builder.tsx`
  (`TRIGGER_OPTIONS`, o bloco e a limpeza de `stage_ids`),
  `src/components/inbox/executar-automacao-dialog.tsx` (não lista o gatilho),
  `src/app/api/automations/engine/route.ts` (recusa),
  `src/app/api/automations/route.ts` e `[id]/route.ts` (`stage_ids = null`),
  o cron do Asaas, a aba e a faixa (pausa e histórico), `asaas-card.tsx`,
  `messages/*` (`Automations.builder.triggers.asaas_cobranca_vencida.{label,hint}`).

**Portões que já existem e passam sem mudança de escopo:**
`env-documentado` (nenhuma variável nova no `src/` — a chave é por conta e o
cron usa `AUTOMATION_CRON_SECRET`; a chave do levantamento só vive no
script), `produto-gate`, `i18n-parity` + `messages.test.ts` +
`i18n-chaves-usadas`, `rotulo-do-gatilho` (Fase 3), `dono-duravel` (nada
cria contato), `pipeline-routing.chamadores` e `reopen.chamadores` (a régua
chama `dispararAutomacoes`, que não é vigiado).

---

## 5. Riscos e armadilhas

| Risco | Mitigação |
| --- | --- |
| **Automação da régua disparada à mão** (diálogo, passo `run_automation`, rota do motor), com as variáveis vazias | a régua só dispara pela varredura: o diálogo não a lista, `runAutomationById` e a rota do motor a recusam |
| **Dois clientes do Asaas no mesmo contato** (o mesmo celular) mostrando a dívida de um na conversa do outro | "um contato, um CPF" pela regra; CPFs diferentes no mesmo contato só à mão, e aí cada um aparece e é cobrado separado |
| **Sandbox conectado no banco da produção** | proibido nesta instalação; o cartão recusa trocar de ambiente com dados; 404 só vira "apagada" com o dono respondendo 200 |
| **Chave de outra conta do Asaas** zerando o aviso de todo mundo | `conectarAsaas` relê um cliente conhecido; `conta_trocada` interrompe o ciclo sem gravar |
| **Mensagem em dobro** (duas automações do mesmo marco, dois processos no deploy, dois ciclos) | trava do MARCO, do grupo inteiro, num INSERT só, antes do disparo; "Criar régua padrão" pula marco existente; o cartão avisa marco repetido |
| **Trava órfã** (processo morto entre a trava e o disparo, ou entre o disparo e o resultado) | recolhimento pela prova do `automation_logs`: sem log apaga e tenta de novo; com log vira `incerto`, visível e nunca reenviado |
| **"Enviado" sem mensagem** (condição barrou; automação desligada no meio) | o resultado é MEDIDO no `automation_logs`: `barrada`, `sem_automacao` |
| **Cobrar quem acabou de pagar** | reconfirmação no Asaas antes da trava; webhook; pausa |
| **Marco de 1 dia perdido em todo vencimento de fim de semana** (C7) | o dia-alvo usa `vista_vencida_em` quando ela é mais tarde; a verificação da Fase 2 exige um vencimento de sábado ou domingo no log |
| **Cobrança de madrugada, no domingo ou no feriado** | hora dentro do alvo; janela até as 18:00; fim de semana e feriado nacional fixo empurrados; `validate.ts` só aceita `hora_envio` de 08:00 a 17:00 |
| **Régua despejando 100 cobranças ao ser ligada** | sem retroativo (D13); `vista_vencida_em` antiga não conta |
| **Avisos do Asaas cobrando em dobro** (e-mail, SMS e ligação) | D10: o CRM desliga os dois avisos de atraso nos clientes que a régua alcança, e religa ao desligar a régua |
| **"Aguardar" dentro da régua** mandando sem reconferir | `validate.ts` recusa espera de mais de 10 minutos neste gatilho |
| **Escopo de etapa esquecido** barrando a régua para todo contato sem negócio aberto | trocar para o gatilho limpa `stage_ids`; as rotas gravam `null` |
| **Link de pagamento vindo de um número desconhecido** (conversa sem canal) | conversa sem `channel_id` fica fora da régua, contada no cartão |
| **Conexão caída às 09:00** queimando o marco | canal com `instance_state` diferente de `open` é pulado SEM travar |
| **Conexão da Meta fora das 24 h** | fora da régua na v1; modelo aprovado é Fase 4 |
| **Boleto que não pode mais ser pago** | fora da régua, contado no cartão |
| **Aviso "inadimplente" sobre quem pagou** (reconciliação atrasada) | só conta parcela vista na última listagem completa; a outra fica "em conferência" |
| **"Em dia" sobre leitura parada ou nunca feita** | `leituraFresca` exigida; sem ela, "Sem leitura recente" e filtro neutralizado |
| **Filtro salvo com o Asaas desconectado** devolvendo "nenhuma conversa" | desconectado neutraliza, com o aviso no painel |
| **Efeito passivo**: a faixa ou a aba mostrando a dívida do cliente ANTERIOR | o resumo é um mapa por contato, lido no render; a aba guarda `{ de }` e deriva `carregando` |
| **Teto de 1000 do PostgREST** | as rotas paginam e ESTOURAM acima do teto; nunca lista parcial |
| **Coluna DATE lida como UTC** | aritmética de data em texto; `diaNoFuso`; teste com a virada do dia |
| **Status novo do Asaas** | sem CHECK; `classificar` devolve `desconhecida` e o cartão conta |
| **Paginação por `offset` instável** (uma cobrança paga no meio da listagem desloca as seguintes) | a listagem só vale se terminar inteira; a reconciliação relê quem "sumiu"; a pulada volta no ciclo seguinte |
| **Fila do webhook interrompida** (15 falhas; um 429 nosso ajudaria) | o limite estourado responde 200 `adiado`; o cron confere e religa uma vez; o cron é a fonte da verdade |
| **Webhook duplicado ou órfão** | reaproveita pela URL ao criar; `DELETE` ao desconectar |
| **Evento de chave de outro sistema** acendendo alarme falso | só conta o evento cujo `accessToken.name` é a chave do CRM |
| **Chave com validade expirando sem aviso** | chave de produção sem validade; se houver, o cartão avisa 30 dias antes |
| **Lista de IPs** bloqueando outro sistema do escritório | é da conta: opcional, e só depois de conferir os outros sistemas |
| **Cota dividida com outro sistema** | reserva no cliente HTTP; 4 GET simultâneos no webhook; listagem de hora em hora depois da Fase 2 |
| **`$` da chave expandido pelo `.env`** no script da Fase 0 | o script lê a linha crua |
| **Migration em banco vazio** | todo REVOKE com GRANT de volta; conferências sem dado; `supabase db start` antes do PR |
| **`upsert` sobre índice parcial** | só `(account_id)`, `(account_id, asaas_customer_id)`, `(account_id, asaas_payment_id)` e `(account_id, asaas_event_id)`, todos TOTAIS |
| **Vínculo manual perdido** quando o contato é apagado, e religado pela regra à pessoa errada | manual órfão volta para "Para confirmar"; `contatos_recusados` nunca é religado |
| **`docker stack deploy` esquecido** | as tabelas ficam vazias e o cartão, em "nunca sincronizado"; checklist da Fase 1a |
| **Chave montada de i18n** fora do portão | `CODIGOS_DO_ASAAS` exportado e testado nos dois dicionários |
| **Node 22 × 24** (`Intl` em `formatCurrency`) | suíte com `npx -y node@22 …` antes do push |
| **8 abas só-ícone no painel de 360 px** | medir a 1024, 1280 e 1440; se apertar, "Cobranças" vira seção da aba Principal, abaixo do negócio |
| **Rotacionar `ENCRYPTION_KEY`** | invalida a chave do Asaas junto com as outras — já documentado |

---

## 6. Verificação por fase

**Fase 0**

- [ ] Relatório entregue; as categorias do vínculo somam o total de
      clientes do Asaas.
- [ ] C1–C5, C8, C11, C12 e C14 respondidas neste plano; C13 respondida pelo
      operador; §2.5 escrita com as contagens.
- [ ] A linha da chave apagada do `.env.local` quando a Fase 1a entrar.

**Fase 1a**

- [ ] Migration aplicada via conector antes do merge; conferências verdes;
      `authenticated` sem privilégio nenhum nas três tabelas.
- [ ] Chave errada → "Chave inválida"; chave de sandbox em produção →
      "Chave do outro ambiente"; chave de outra conta com espelho existente →
      recusada; chave certa → "Conectado".
- [ ] Contagens do cartão batem com o levantamento da Fase 0; a lista de
      inadimplentes bate com o painel do Asaas.
- [ ] Ligar e desligar à mão persistem (ROWCOUNT), com o nome carimbado;
      desligado não religa no ciclo seguinte; contato recém-criado pela Nova
      conversa é ligado no ciclo seguinte; dois clientes de CPFs diferentes
      com o mesmo celular vão para "Para confirmar".
- [ ] `docker stack deploy` feito com o `crm.env` carregado e o
      `CRM_IMAGE` fixado (§7); banner do agendador cita `cb/asaas`; `curl`
      sem segredo → 401, não 503.
- [ ] Log `[asaas] ciclo:` sem chave nem CPF.

**Fase 1b**

- [ ] Conversa de um inadimplente conhecido: ícone, faixa com parcelas,
      valor e dias, aba com a lista e os links — números iguais aos do
      painel do Asaas.
- [ ] Conta sem Asaas: nada aparece, nem a aba.
- [ ] Durante a carga e com a sincronização parada, nada afirma "em dia"
      (rede lenta no preview; cron parado); trocar de conversa rápido nunca
      mostra a dívida do cliente anterior.
- [ ] Filtro "Inadimplentes" = as mesmas conversas com ícone, na aba
      aberta; salvo e reaplicado numa visão; neutralizado com o Asaas
      desconectado.
- [ ] Painel com 8 abas a 1024, 1280 e 1440 px.

**Fase 2**

- [ ] Webhook criado pela API, id guardado; um segundo "conectar" reaproveita
      o mesmo webhook; desconectar o apaga no Asaas.
- [ ] Pagar uma cobrança de teste → a faixa some em segundos.
- [ ] Reenvio do mesmo evento → `duplicado`; `curl` sem
      `asaas-access-token` → 401; rajada acima do limite → 200 `adiado`.
- [ ] Fila interrompida no painel do Asaas → o cartão mostra e religa uma
      vez no ciclo seguinte.
- [ ] **C7 medido**: o `evento_criado_em` dos primeiros `PAYMENT_OVERDUE`
      reais anotado neste plano, **incluindo um vencimento de sábado ou
      domingo**.

**Fase 3**

- [ ] Ponta a ponta com o contato de teste autorizado: cobrança de poucos
      reais com vencimento hoje → no dia útil seguinte, depois de 09:00, a
      mensagem de 1 dia sai UMA vez, com `enviado` medido no log.
- [ ] Pagar antes do marco de 5 dias → a de 5 dias não sai.
- [ ] Nada sai antes de `hora_envio`, depois das 18:00, no fim de semana ou
      em feriado nacional fixo.
- [ ] Ligar uma automação não cobra quem já estava atrasado; duplicar uma
      automação e ligar as duas não dobra a mensagem.
- [ ] "Executar automação" não lista a régua; o passo `run_automation`
      apontando para ela é recusado.
- [ ] **Agregação (D11):** contato com 3 parcelas vencidas em marcos
      diferentes recebe UMA mensagem listando as três, e a trava é só das
      que cruzaram o marco hoje — a antiga continua livre para o marco dela.
- [ ] **Estado da conversa (D16):** com a conversa ENCERRADA e o contador
      de espera aceso, a mensagem sai e, depois dela, a conversa continua
      encerrada, `aguardando_desde` continua preenchido e `unread_count`
      não muda. Medido no banco, não na tela.
- [ ] **Lembrete do vencimento (D17):** cobrança de teste com vencimento
      hoje → a mensagem sai depois das 08:00, fala só do que vence hoje, e
      não sai de novo no mesmo dia. Paga de manhã → não sai à tarde.
- [ ] A aba mostra "Cobrança automática: 1 dia · enviada em …".

---

## 7. Passos do operador

**Fase 1a-conexão + Fase 0** (a mesma sessão: a chave entra no cartão e o
levantamento roda a partir dele)

1. No Asaas (Integrações → Chaves de API), criar a chave **"CRM —
   levantamento"**: leitura em Clientes, Cobranças, Parcelamentos,
   Notificações e Webhooks; **sem** Negativação; validade de 7 dias. A chave
   aparece uma vez só. ⚠️ Escolher as permissões uma a uma e conferir a
   lista antes de salvar.
2. Autorizar a aplicação da migration `992_cb_asaas_config` pelo conector,
   antes do merge.
3. Colar a chave no cartão (Configurações → Integrações → Asaas), com o
   NOME que ela tem na tela do Asaas e a validade, se houver, e clicar em
   **Rodar levantamento**. ⚠️ A chave nunca vai para o chat nem para
   arquivo nenhum.
4. Olhar no painel do Asaas se há um ajuste da conta para os avisos dos
   clientes novos (C13).
5. Com o relatório na mão, responder às perguntas da §9.

**Fase 1a-espelho**

6. Criar a chave **"CRM — produção"**: leitura em Clientes, Cobranças e
   Parcelamentos; **sem data de validade** (§3.7). No cartão, **Desconectar**
   e conectar de novo com ela — trocar a chave é isso, porque o campo só
   aparece quando não há conexão (e a de levantamento expira em 7 dias). Não
   ligar a lista de IPs da conta sem antes conferir os outros sistemas
   (§3.7).
7. Autorizar a aplicação da migration das duas tabelas do espelho, antes do
   merge.
8. Depois do merge, o `docker stack deploy` (o CI não relê o agendador),
   feito na sessão, com autorização, como no tl;dv — sempre as três linhas:

   ```bash
   set -a; . /root/crm.env; set +a
   export CRM_IMAGE="$(docker service inspect crm_crm --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' | cut -d@ -f1)"
   docker stack deploy -c /root/docker-stack.yml crm
   ```

   Depois, dentro do contêiner, `printenv SUPABASE_SERVICE_ROLE_KEY | wc -c`
   diferente de 0, e o cron sem segredo respondendo 401.
9. Revisar as listas "Para confirmar" e "Sem ficha" do cartão.

**Fase 2**

10. Acrescentar Webhooks em leitura e escrita à chave de produção, e
    informar no cartão o nome da chave e o e-mail que recebe os alertas do
    Asaas.

**Fase 3**

11. **Decidir o interruptor do WhatsApp no painel do Asaas.** É o único
    jeito de o cliente não receber a cobrança duas vezes — pelo Asaas e
    pelo CRM. Medido em 12/09: a conta gasta ~R$ 403/mês em avisos, dos
    quais ~R$ 92/mês são os de ATRASO e ~R$ 341 em 180 dias são os do DIA
    DO VENCIMENTO. ⚠️ NÃO é mais coisa que o CRM faça pela API (a D10 caiu):
    a configuração por cliente já está com WhatsApp desligado, e as
    mensagens saem assim mesmo — o interruptor é da conta, na tela do
    Asaas.

---

## 8. Fora da v1

| Item | Motivo |
| --- | --- |
| **Registro de acordo, e a pausa da régua por causa dele** | decisão do operador (12/09): "acordo não pausa a cobrança, pois pra isso precisaremos inserir uma forma de registrar o acordo". Pausar sem registrar é um campo solto que ninguém sabe explicar depois; os dois voltam juntos (ex-D14) |
| **Tratar o cliente com mais de 3 parcelas vencidas** (tarefa de revisão de contrato, régua própria, corte da cobrança automática) | pedido como PLANEJAMENTO FUTURO em 12/09. O dado já existe desde a Fase 1a-espelho — são **40 clientes hoje**, 43% dos devedores — e a aba já os mostra; o que falta é decidir o que ACONTECE com eles |
| CPF em `contacts`, campo personalizado de CPF, busca por CPF | tabela do upstream, API v1, CSV e LGPD juntos — decisão própria, não carona |
| Escrever em cliente ou cobrança do Asaas (`externalReference`, "recebido em dinheiro", criar ou alterar cobrança) | o Asaas segue sendo o sistema de cobrança (D9) |
| Negativação pelo CRM | custo, requisitos e decisão jurídica caso a caso — não é botão |
| Régua na conexão da Meta | fora das 24 h só sai modelo aprovado; Fase 4 |
| Botão "cobrar agora" na aba | teria de passar pelo caminho da varredura (reconfirmação, trava, pausa); Fase 4 |
| Parcelas a vencer (ALÉM da de hoje) e assinaturas na aba | não são inadimplência; a parcela futura de assinatura nasce 40 dias antes. ⚠️ A que vence HOJE entrou no espelho pela D17 — é o lembrete das 8h —, mas só ela |
| Realtime nas tabelas do Asaas | fechadas ao navegador por desenho; a caixa recarrega sozinha a cada 5 min e no resync |
| Condição "cliente inadimplente?" em outras automações | a régua não precisa; ideia da Fase 4 |
| Régua com "Aguardar" | a espera retoma às cegas (§2.4); recusada pela validação |
| Feriados de data móvel e estaduais | pedem tabela própria; a v1 empurra fim de semana e feriado nacional fixo |
| Relatório histórico de recebimento e valor em atraso no card do funil | tela de gestão à parte; o quadro redesenha 120 cards por tecla e o card só recebe número por prop |
| Chave por conexão | decisão de 28/08: configuração por módulo, uma para a conta |
| Pix copia-e-cola e linha digitável na mensagem | o link da fatura já leva a todas as formas de pagamento |
| Renomear o contato de nome numérico com o nome do Asaas | o nome do contato segue regra própria (push name); a aba e a mensagem já usam o nome do Asaas |
| Sandbox nesta instalação | o ambiente local grava no banco da produção (§3.7) |

---

## 9. Perguntas ao operador

**Respondidas pela medição de 12/09 — não precisam mais de você:** a 1 (o
levantamento foi feito na conta real), a 5 (o sufixo de 8 não liga ninguém:
zero casos) e a 9 (o CRM não desliga aviso nenhum — o mecanismo não
funcionaria; ver a nova 3 abaixo).

**A que trava a próxima fase:**

1. ⚠️ **Cliente que está no Asaas e não tem ficha no CRM: o CRM cria a ficha
   ou só lista para você?** A recomendação MUDOU com a medição. São **349 de
   439 clientes (79,5%)** sem ficha, e **61 dos 92 devedores**. Se ficar só
   listando, o aviso na conversa e a cobrança automática valem para um terço
   da inadimplência, e os outros 264 que TÊM telefone nunca entram — quem
   assinou contrato e nunca escreveu no WhatsApp não vai escrever sozinho.
   **Recomendo criar a ficha** (nome e telefone do Asaas), como o Calendly
   passou a fazer. A ficha nasce sem conversa na caixa de entrada; a conversa
   nasce no primeiro envio. Os 85 sem telefone nenhum continuam só listados.
   (D2)

**As que decidem a cobrança, e podem esperar a Fase 3:**

2. **A cobrança automática sai a partir das 9h (e o lembrete do vencimento
   às 8h), só em dia útil, e nunca depois das 18h nem em feriado nacional?**
   Recomendo que sim. (D12/D17)
3. ⚠️ **O WhatsApp de cobrança do próprio Asaas vai ser desligado no painel?**
   Não é mais coisa que o CRM faça — medido: a configuração por cliente já
   está com WhatsApp desligado e as mensagens saem assim mesmo, então o
   interruptor é da CONTA, na tela do Asaas. Hoje a conta gasta **~R$ 403/mês**
   em avisos, dos quais **~R$ 92/mês** são os de atraso e ~R$ 341 em 180 dias
   são os do dia do vencimento. Se ele ficar ligado, o cliente recebe DUAS
   mensagens pela mesma parcela — a do Asaas e a do escritório. É decisão
   sua, e o plano segue nos dois casos. (D10/D17)
4. **Quem já estava atrasado quando a cobrança automática for ligada fica de
   fora dela?** Recomendo que sim: aparece no aviso e na lista, e a equipe
   cobra à mão. ⚠️ Pesa mais do que parecia: são **92 devedores, 405
   parcelas e R$ 499.963,94**, com a mais antiga de **06/06/2024** — ligar
   sem essa trava dispararia centenas de mensagens de uma vez. (D13)
5. **Cliente negativado no Serasa aparece no aviso?** Recomendo que apareça,
   com a marca "negativada", e que fique fora da cobrança automática. Hoje
   não há nenhum na conta. (D6)

**As de cadastro e acesso:**

6. **O CPF do Asaas fica guardado, visível só para administradores e
   mascarado?** Ele não liga ninguém (o CRM não tem CPF de nenhum contato),
   mas **100% dos clientes do Asaas têm** — serve para achar cadastro
   repetido lá e para conferência humana. Recomendo sim. (D3)
7. **Quem pode ver que um cliente está devendo?** Recomendo toda a equipe
   que atende a conversa; ligar e desligar clientes fica só com
   administradores. (D4)
8. **Posso deixar o CRM ligar sozinho o "aviso na hora" do Asaas
   (webhook)?** Quando um pagamento cai, o Asaas avisa o CRM em segundos. A
   chave precisa de uma permissão a mais, que só mexe nesse aviso — não em
   dinheiro nem em cadastro. Recomendo sim. (D7)
9. **O escritório usa uma conta só no Asaas, ou mais de uma (por área, por
   CNPJ)? Algum outro sistema — contador, ERP, automação — já usa a API do
   Asaas?** O CRM liga uma conta por vez, e o limite de uso e a trava por
   endereço valem para a conta inteira.

---

## 10. A revisão (10/09) — o que mudou e o que foi recusado

Três revisões independentes leram a primeira versão deste plano contra o
código, o CLAUDE.md e a doc baixada do Asaas: 17 achados sobre regras da
casa e âncoras (47 de 49 âncoras corretas), 22 sobre o pior dia com um
cliente real e 23 sobre fatos da API e completude. Cada achado que mudou
desenho foi conferido no código antes de entrar.

**O que mudou:**

- Todas as tabelas do Asaas ficaram fechadas ao navegador, lidas por duas
  rotas: o "conectado" e o frescor passaram a existir para a tela, o CPF
  deixou de precisar de GRANT por coluna, e a D4 deixou de pedir migration.
- A régua só dispara pela varredura (três portas manuais fechadas).
- A trava passou a ser do MARCO e do grupo, com recolhimento de órfã e
  resultado medido no `automation_logs`.
- O dia-alvo passou a usar `vista_vencida_em`, para o Asaas marcar tarde sem
  perder o marco.
- O horário ficou numa regra só (de `hora_envio` às 18:00, dia útil, feriado
  nacional fixo).
- "Um contato, um CPF"; vínculo manual órfão e contatos recusados não voltam
  pela regra; a elegibilidade usa `IS NULL OR IN (…)`, nunca `<>`.
- D10 revista: os avisos de atraso do Asaas são dois, com ligação, e por
  cliente; o CRM os desliga pela API na Fase 3.
- A restrição de IP é da conta; a chave de produção fica sem validade; os
  eventos de chave são filtrados pelo nome.
- Sandbox proibido neste banco; chave de outra conta detectada.
- Webhook com ciclo de vida completo; limite estourado responde 200.
- Leitura fresca exigida para "em dia"; parcela não vista na última
  listagem fica "em conferência".
- Lista de inadimplentes no cartão (com e sem ficha, pelos dias).
- Conversa sem canal, conexão da Meta, conexão caída e boleto que não pode
  mais ser pago ficam fora da régua.
- D15 nova (a mensagem da régua e a IA); a frase que dizia "nenhum dado de
  cobrança vai à IA" estava errada.
- Detalhes: `DROP POLICY` deixou de ser necessário (não há policy); os
  nomes de quem ligou e de quem pausou são carimbados; `CODIGOS_DO_ASAAS` sai
  do módulo puro para o teste alcançar; o painel tem 360 px, não 288; as
  pastilhas do filtro saíram da caixa em 03/09; o `docker stack deploy` leva
  as três linhas.

**O que foi recusado, e por quê:**

- **O filtro "Inadimplentes" atravessar a aba**, como a busca: a regra da
  casa é que só a busca atravessa; a lista completa, com as encerradas e os
  sem ficha, está no cartão.
- **Tirar a mensagem da régua do Radar e da resposta automática:** a IA
  precisa saber que houve cobrança (D15).
- **Esconder o ícone da linha quando a leitura não é fresca:** ele fica, e a
  faixa diz de quando é o dado; só o filtro é neutralizado.
- **Régua com modelo aprovado na conexão da Meta já na v1:** a produção roda
  Evolution; fica para a Fase 4.
- **Restringir as policies a clientes ligados:** superado por fechar as
  tabelas.
- **Tratar `notificationDisabled` como "não cobrar" por padrão:** só se o
  operador disser que é isso, depois da contagem da Fase 0.

---

## 11. A revisão de 12/09 — a conta medida e quatro regras novas

O que provocou esta rodada: o operador pediu um lugar seguro para a chave, a
conexão foi construída antes da hora, a chave entrou, e com ela o
levantamento rodou contra a conta REAL. Os números estão na §2.5. O que
mudou por causa deles e das quatro regras que ele fixou no mesmo dia:

| # | O que mudou | Por quê |
| --- | --- | --- |
| 1 | **A Fase 0 deixou de ser script com a chave num arquivo** e virou uma rota do próprio CRM (`POST /api/cb/asaas/levantamento`), com a chave já cifrada no banco | pedido do operador; some junto a armadilha do `$` inicial da chave, que o carregador do Next expandiria |
| 2 | **A Fase 1a foi partida em conexão e espelho**, e só a primeira foi construída | a forma das duas tabelas do espelho é justamente o que o levantamento podia mudar — e mudou. Migration aplicada não se reescreve |
| 3 | **D2 inverteu a recomendação**: de "só listar" para "criar a ficha" | medido: 79,5% dos clientes do Asaas não têm ficha, e 61 dos 92 devedores. "Só listar" entregaria a feature para um terço da inadimplência |
| 4 | **D10 morreu** e levou junto a permissão Notificações da chave, o `PUT /notifications/batch`, o religar ao desligar a régua e uma linha do checklist | medido: a configuração por cliente já está com WhatsApp desligado e a conta paga ~600 avisos por mês assim mesmo. O interruptor é da conta, no painel — o CRM não tem como mexer nele |
| 5 | **D11 endureceu**: a mensagem lista TODAS as parcelas vencidas, não só as do marco | regra do operador, e a medição a torna o caso comum: 40 dos 92 devedores têm mais de 3 parcelas vencidas, 29 têm 6 ou mais |
| 6 | **D14 saiu da v1** (pausa por acordo) | decisão do operador: sem um lugar onde o acordo é registrado, a pausa é um campo solto |
| 7 | **D16 (nova)**: a mensagem sai pelo caminho do robô e não mexe no estado da conversa | regra do operador; as três exigências já valem no código de hoje, e o que as protege é um teste estrutural default-deny |
| 8 | **D17 (nova)**: lembrete no dia do vencimento, às 8h | escopo novo. Muda o espelho, que passa a guardar também o que vence HOJE — e só isso do futuro |
| 9 | **D5 virou barata** | zero clientes casam só pelo sufixo de 8, e zero por nome: as duas réguas frouxas não ligam ninguém que a exata já não ligue |
| 10 | **C1, C2, C4, C12 e C14 respondidas** na §2.5; C3 medida em parte | o levantamento fazia isso |

**Pendências que nasceram aqui, e são do operador:**

- ⚠️ **Rotacionar a chave do Asaas e o token do Supabase** — os dois passaram
  pelo chat em 12/09 e estão no transcrito da sessão. O operador assumiu a
  rotação no mesmo dia.
- Responder à pergunta 1 da §9 (a D2), que é a única que trava a próxima
  fase.
- Decidir o interruptor do WhatsApp no painel do Asaas (pergunta 3).
