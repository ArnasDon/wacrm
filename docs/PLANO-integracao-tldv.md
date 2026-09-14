# Plano — tl;dv → histórico de reuniões transcritas na ficha do cliente (vivo e checável)

> **O que é este arquivo.** Guia retomável da integração com o tl;dv, pedida
> pelo operador em 2026-09-09: o CRM busca a transcrição das reuniões
> gravadas no tl;dv e a disponibiliza inteira na ficha do cliente, montando
> o histórico das reuniões feitas com ele — com a transcrição entrando de
> forma automática (pela sincronização e pelo link do tl;dv) ou colada à
> mão. **Ele é editado a cada fase** — quem pegar o plano depois sabe o que
> foi feito e onde parou.
>
> ⚠️ **Este documento envelhece.** Antes de decidir com base em algo aqui,
> confirme contra a realidade (grep, leitura do arquivo, query no banco).

- **Criado:** 2026-09-09 · **Medido contra:** `main` @ `5bd3899` e a doc
  pública da API do tl;dv (`https://doc.tldv.io`, `v1alpha1`, lida em 09/09).
- **Fluxo:** executar → typecheck/lint/test (Node 22) / i18n-parity /
  i18n-chaves-usadas → preview em 1440×900 → revisar 2× → PR → migration
  aplicada em produção via conector ANTES do merge, com autorização do
  operador (convenção das 972–986).

---

## Estado

| Fase | Escopo | Estado | Migration | PR |
| --- | --- | --- | --- | --- |
| **1** | Cartão em Integrações (chave da API, sincronização, webhook, últimas reuniões com vínculo de cliente), sincronização por cron + webhook + "colar link", vínculo automático pelo e-mail (ficha → agendamento do Calendly), seção **Transcrições** na aba Reuniões da ficha (lista, visualizador, "Do tl;dv", "Colar transcrição", desvincular/excluir/buscar de novo) | ✅ **EM PRODUÇÃO** (2026-09-09) | `987_cb_tldv` **aplicada** (09/09, via conector, antes do merge) | [#163](https://github.com/leonardocabralb/CB-CRM/pull/163) + [#172](https://github.com/leonardocabralb/CB-CRM/pull/172) (204 = "ainda não pronta") + [#174](https://github.com/leonardocabralb/CB-CRM/pull/174) (notas legíveis) |
| **1b** | O achado do Codex no #163 (rodízio do cron) aplicado também ao cron do Meta Ads | ✅ (09/09) | `988_cb_rodizio_do_cron_do_meta_ads` **aplicada** (09/09) | [#164](https://github.com/leonardocabralb/CB-CRM/pull/164) |
| **2** | Depois do deploy: chave colada pelo operador (09/09, 19:33), primeira sincronização de 30 dias conferida (31 reuniões; 24 com transcrição depois de dois ciclos; 5 vinculadas sozinhas pela ponte do Calendly), `docker stack deploy` na VPS feito (09/09, com backup do stack anterior; o agendador já loga o laço com `tl;dv`). **Falta só colar a URL do webhook no tl;dv** (opcional; adianta a importação) | ✅ (09/09) — webhook opcional pendente | — | — |
| **2b** | A aba **Reuniões** também no painel do cliente da caixa de entrada (7ª aba só-ícone, entre Tarefas e Automações): os MESMOS dois componentes da ficha — agenda em cima, transcrições embaixo —, para a transcrição estar à mão durante o atendimento sem sair da conversa. O cabeçalho da seção de transcrições passou a quebrar linha em coluna estreita | ✅ (09/09, pedido do operador) | — | [#187](https://github.com/leonardocabralb/CB-CRM/pull/187) |
| **3** (ideias, não pedidas) | busca no corpo das transcrições (índice GIN, como a 929 fez para mensagens); transcrição como contexto do Radar/IA; vínculo com a reunião AGENDADA (`cb_meetings`) por proximidade de horário; contador de transcrições na aba do painel (hoje a aba não tem etiqueta numérica — seria uma consulta de contagem a cada conversa aberta) | 💤 | — | — |

**Decisões travadas pelo pedido (09/09):**

- **A chave fica em Configurações → Integrações**, ao lado do Meta Ads e do
  Calendly, no mesmo desenho: chave cifrada com `ENCRYPTION_KEY`, testada ao
  conectar, tela nunca vê a chave.
- **A transcrição INTEIRA fica no CRM** (texto corrido + frases com orador e
  tempo + notas da IA do tl;dv), não um link: o tl;dv pode expirar o plano,
  apagar a gravação ou mudar a API, e o histórico do cliente é do escritório.
- **Duas portas de entrada**, como pedido: automática (sincronização a cada
  15 min + webhook + "colar o link do tl;dv" na ficha) e manual ("Colar
  transcrição", texto livre).

**Decisões com recomendação (o plano segue com a recomendação como hipótese
até o operador dizer o contrário):**

| # | Decisão | Recomendação | Por quê |
| --- | --- | --- | --- |
| **D1** | Onde a transcrição aparece na ficha | **dentro da aba Reuniões**, numa seção "Transcrições" abaixo das reuniões agendadas | a agenda olha para a frente e a transcrição para trás, e as duas respondem "as reuniões com este cliente"; uma 9ª aba (a lista já quebra em duas linhas) esconderia a novidade |
| **D2** | Como a reunião acha o cliente sozinha | **pelo e-mail do convidado**, tirando os e-mails da equipe (perfis da conta); primeiro contra o e-mail da FICHA, depois contra o e-mail do AGENDAMENTO do Calendly (977) que já resolveu o contato pelo telefone; vincula só quando TODOS os e-mails de fora apontam para UM contato | o tl;dv não conhece telefone — o payload tem só nome e e-mail, e MEDIDO na primeira conexão real (09/09): o convidado chega com o nome VAZIO e só o e-mail; dos 583 contatos da conta só 1 tem e-mail na ficha, enquanto 13 dos 15 agendamentos do Calendly guardam e-mail E contato. Sem a ponte, o automático quase nunca acontecia. Dois clientes na mesma reunião é decisão de gente |
| **D3** | Quando a regra automática NÃO religa | depois de um "desvincular" à mão (`vinculo_origem = 'desvinculada'`) | sem isso, desvincular seria desfeito no ciclo seguinte |
| **D4** | Janela da sincronização | 30 dias na primeira; 7 dias nas seguintes, SEMPRE (não "desde a última") | o tl;dv processa a gravação DEPOIS da reunião, e `happenedAt` é a hora da reunião; uma janela colada no último ciclo perdia a reunião de ontem que só ficou pronta hoje. A idempotência é o UNIQUE da 987 |
| **D5** | Webhook do tl;dv sem assinatura | aceitar, mas tratar o corpo como AVISO: só o id da reunião é lido, e a reunião é buscada na API com a nossa chave | a doc não tem cabeçalho de assinatura; assim, uma entrega forjada só faz o CRM consultar o tl;dv por um id — e o tl;dv devolve só o que a chave enxerga |
| **D6** | Transcrição que o tl;dv não entrega | 12 tentativas (~3h a cada 15 min) → `sem_transcricao`; 403 (plano de quem organizou) → `falhou` na hora; botão "Buscar de novo" zera | a doc diz que o endpoint só responde "quando completa" e que a exportação depende do PLANO do ORGANIZADOR — insistir num 403 não muda nada |
| **D7** | Quem pode o quê | config: admin; vincular/desvincular, colar link, colar transcrição, buscar de novo: `agent`+; excluir: só a MANUAL, pelo autor ou admin; ler: qualquer membro (RLS) | a importada do tl;dv não se apaga — a varredura a traria de volta sem cliente; dela se tira o cliente |
| **D8** | Onde a transcrição é guardada | Postgres (`texto`, `segmentos jsonb`, `notas`), não Storage | ~80 KB por hora de reunião; a lista da ficha não seleciona as três colunas pesadas, só o visualizador |
| **D9** | Ordem das contas no cron (Codex, PR #163) | por `last_sync_attempt_at` (nunca tentada primeiro), carimbada no COMEÇO de toda varredura | ordenar por `account_id` deixava a mesma cauda de fora do orçamento de 90 s em todo ciclo; carimbar só no sucesso deixaria a conta que falha na frente para sempre |

---

## 1. O que a API do tl;dv oferece (medido na doc, 09/09)

| Item | Valor |
| --- | --- |
| Base | `https://pasta.tldv.io/v1alpha1` (alpha — "expect changes") |
| Autenticação | cabeçalho `x-api-key`; chave gerada em tl;dv → Settings → Personal Settings → API Keys |
| Plano | API só em **Pro/Business**; "ver no app não garante acesso pela API" — a exportação depende do plano de quem ORGANIZOU; organização inteira exige Enterprise |
| `GET /meetings` | `query`, `page` (1..), `limit` (≤100, padrão 50), `from`/`to` (date ou date-time), `onlyParticipated`, `meetingType` (`internal`/`external`); resposta `{ page, pages, total, pageSize, results[] }`; teto de 10.000 resultados por consulta |
| `GET /meetings/{id}` | `{ id, name, happenedAt, url, duration (s), organizer {name,email}, invitees [{name,email}], template, extraProperties }` |
| `GET /meetings/{id}/transcript` | `{ id, meetingId, data: [{ speaker, text, startTime, endTime }] }` — "só devolve quando completa" |
| `GET /meetings/{id}/notes` | `{ structuredNotes[], markdownContent, topics [{ id, order, title, summary }] }` |
| Webhooks | eventos `MeetingReady` e `TranscriptReady`; envelope `{ id, event, data, executedAt }`; configurável por usuário, time ou organização, no painel do tl;dv; **sem assinatura documentada** |
| Erros | 400 `{ message, errors[] }`; demais `{ name, message }` |
| Id de reunião | 24 hexadecimais (`^[0-9a-fA-F]{24}$`, padrão declarado nos parâmetros de notas/download) |

---

## 2. O que foi construído (Fase 1)

### 2.1 Banco — `0987_cb_tldv.sql`

- `cb_tldv_config` (1 por conta, FECHADA para o navegador): `api_key`
  cifrada, `webhook_token` em claro (é endereço), `status`, `last_sync_at`,
  `last_event_at`, `last_error`.
- `cb_reunioes_transcritas` (N por conta; SELECT por membro sob RLS, escrita
  só via rota): `origem` (`tldv`/`manual`), `tldv_meeting_id` (UNIQUE por
  conta; CHECK amarra à origem), `contact_id` (FK COMPOSTA com a conta,
  `SET NULL (contact_id)`), metadados da reunião, `status`
  (`pendente`/`pronta`/`sem_transcricao`/`falhou`), `texto`/`segmentos`/
  `notas`, `tentativas`/`erro`, `vinculo_origem` (`email`/`manual`/
  `desvinculada`), autor.
- Pino: `supabase/migrations/rls-das-tabelas-do-tldv.test.ts`.

### 2.2 Código

| Peça | Arquivo(s) |
| --- | --- |
| Cliente da API (puro no que dá; `fetch` injetável) | `src/lib/tldv/cliente.ts` |
| Leitura dos payloads, id do link, aviso do webhook | `src/lib/tldv/leitura.ts` |
| Texto corrido, tempos, duração | `src/lib/tldv/texto.ts` |
| Vínculo pelo e-mail | `src/lib/tldv/vinculo.ts` |
| Janela da sincronização | `src/lib/tldv/janela.ts` |
| Modelo do cartão | `src/lib/tldv/cartao.ts` |
| Sincronizar (varredura) e importar (uma reunião) — I/O | `src/lib/tldv/sincronizar.ts` |
| Conectar/desconectar — I/O | `src/lib/tldv/conexao.ts` |
| Validação da transcrição manual | `src/lib/reunioes-transcritas/validar.ts` |
| Rotas | `src/app/api/cb/tldv/{route,config,sync,cron,importar,webhook/[token]}` e `src/app/api/cb/reunioes-transcritas/{route,[id],[id]/reprocessar}` |
| Leitura na tela (RLS) | `src/hooks/use-reunioes-transcritas.ts` |
| Cartão em Integrações | `src/components/settings/tldv-card.tsx` |
| Seção na ficha + visualizador + diálogos | `src/components/transcricoes/*.tsx` (montada em `contact-detail-view.tsx`, aba Reuniões) |
| Agendador | `docker-stack.yml` (`cb/tldv` no laço lento) |
| Dicionários | `Settings.integracoes.tldv.*` e `Transcricoes.*` (pt-BR e en) |

Testes: 59 novos (`src/lib/tldv/*.test.ts`, `validar.test.ts`, o pino da
RLS), com dublê do Supabase para a sincronização.

### 2.3 O que NÃO foi feito, de propósito

- **API pública v1**: sem escopo nem rota para transcrições. Entra quando
  houver integrador pedindo.
- **Barra lateral da conversa**: a seção vive só na ficha (aba Reuniões).
- **Vínculo com a reunião agendada** (`cb_meetings`): coluna não criada; é a
  Fase 3, se pedida.
- **Busca no texto**: a coluna não entra no índice da 929.

---

## 3. Verificação

- `npm run typecheck`, `npm run lint` (0 erros), `node scripts/i18n-parity.mjs`,
  `node scripts/i18n-chaves-usadas.mjs`: verdes em 09/09.
- Suíte inteira em Node 22 (`npx -y node@22 node_modules/vitest/vitest.mjs run`):
  verde em 09/09 (3.195 testes, 258 arquivos), incluindo o `produto-gate`.
- ✅ **Sondagem contra a API REAL (09/09, chave do operador, só leitura)**:
  listagem com `from`/`to` em data-hora aceita (31 reuniões em 30 dias; 919
  no total desde 23/06, 10 páginas de 100); transcrição com orador e tempos
  (120 frases numa reunião de 35 min); notas em markdown (15,8 mil chars, 16
  tópicos); id falso → 404 → `nao_encontrado`. Duas divergências da doc,
  ambas absorvidas: `happenedAt` vem no formato de `Date.toString()` ("Wed
  Sep 09 2026 19:19:07 GMT+0000 (…)"), não ISO — `lerReuniao` normaliza; e
  `template` não vem na listagem — não é usado. Pinos em `leitura.test.ts`.
  Terceira divergência, achada na PRIMEIRA SINCRONIZAÇÃO real (17 reuniões
  pendentes marcadas com `tldv_error`): transcrição ainda não pronta volta
  como **204 sem corpo**, não 404 — corrigido no cliente, com pino.

## 4. Depois do merge — FEITO em 09/09/2026

1. ✅ `987` e `988` aplicadas via conector antes dos merges.
2. ✅ `docker stack deploy` na VPS (backup em `/root/docker-stack.yml.bak-*`,
   `crm.env` carregado, imagem fixada na que rodava); conferido: segredo
   dentro do container, rota de cron respondendo 401, agendador logando o
   laço com `tl;dv`.
3. ✅ Chave colada pelo operador; chip "Funcionando"; primeira sincronização
   de 30 dias: 31 reuniões.
4. ⏳ URL do webhook no tl;dv — opcional. Sem ela a reunião entra no ciclo
   seguinte do agendador, e "ciclo" NÃO é um teto de 15 min: o laço lento é
   SEQUENCIAL (agendadas, fluxos, radar, Meta Ads e só então tl;dv, cada
   rota com teto de 120 s) e só dorme os 900 s depois de todas — o intervalo
   real entre duas passadas do tl;dv pode chegar a ~25 min (Codex, PR #176).
5. ✅ Testado no preview (worktree, 1440×900) contra o banco de produção:
   cartão, tabela com vínculo inline, ficha de um cliente ligado sozinho
   pela ponte do Calendly, visualizador com frases/tempos/notas, transcrição
   manual (criar, ver, excluir), "Do tl;dv" (busca, vincular pela lista,
   importar pelo link), "Tirar deste cliente" e "Sincronizar agora". A
   reunião usada nos testes de vínculo voltou ao estado original por SQL.

## 5. O que a primeira produção ensinou (para quem mexer depois)

- **204 sem corpo = "ainda não pronta"** (a doc sugeria 404): 17 das 31
  reuniões ficaram marcadas como erro no primeiro ciclo até a correção
  (#172). Depois dela, "Sincronizar agora" levou as prontas de 14 para 24.
- **A ponte pelo Calendly é o vínculo automático que funciona aqui**: dos
  583 contatos só 1 tem e-mail na ficha; 5 das 31 reuniões foram ligadas
  sozinhas, todas por agendamento do Calendly. As 26 restantes são
  anteriores à integração do Calendly (07/09) — vínculo à mão, pelo cartão
  ou pela ficha.
- **O convidado chega sem nome** (só e-mail); o cartão mostra o e-mail no
  lugar. O nome que vale é o do contato vinculado.
