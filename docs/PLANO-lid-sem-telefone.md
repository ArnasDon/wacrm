# Plano — mensagem em `@lid` sem telefone (Fases 1 e 2)

Documento INTERNO e vivo. Atualizar a cada fase concluída.

| | |
| --- | --- |
| **Estado** | Em implementação (branch `fix/lid-sem-telefone`). Nada em produção. |
| **Decisão do operador (19/09/2026)** | Fazer as Fases 1 e 2; a Fase 3 (patch na imagem da Evolution) fica de fora. "Não quero quebrar o que está funcionando" — cautela é requisito. |
| **Migration** | `1007_cb_mensagens_sem_telefone.sql` — aditiva. Aplicar ANTES do merge. |

## 1. O problema, em uma frase

Quando a Evolution não consegue ler uma mensagem de primeira (falha de
decifragem — típico da PRIMEIRA mensagem de um contato novo), a Baileys pede uma
cópia ao celular pareado, e essa cópia chega com a chave só em `@lid`: sem
`remoteJidAlt` (o telefone), sem `addressingMode` e sem `pushName`. O CRM
identifica o cliente pelo telefone, então descarta a mensagem — com um
`console.warn` como único rastro.

## 2. Causa raiz (provada em 19/09/2026)

Baileys 7.0.0-rc13 (a de produção, lida do contêiner):

- `lib/Socket/messages-recv.js`, `sendRetryRequest` (~442–459) chama
  `requestPlaceholderResend(msgKey)` **sem o `msgData`** → o cache guarda `true`.
- `lib/Utils/process-message.js` (~315–360): quando o celular responde, sem
  `msgData` em cache, `finalMsg = webMessageInfo` — o registro CRU do aparelho,
  cuja chave não tem o telefone.
- O outro chamador (mensagem "unavailable", ~1341) passa o `msgData` e preserva
  o telefone — medido no log: 4 de 4 chegaram com `remoteJidAlt`.
- O mapa LID→telefone é gravado ANTES da tentativa de decifrar (~1277–1292): a
  Baileys sabe o telefone; só não o põe na cópia.
- O `master` do upstream tinha a mesma lacuna em 19/09/2026.
- A Evolution (commit `e273b904`) só troca LID↔telefone quando há
  `remoteJidAlt` (linha 1668) e ignora o stub da falha antes do
  `saveOnWhatsappCache`.

Segundo mecanismo, 1 caso (09/09 19:48, 1ª hora pós-upgrade): eco `fromMe` em
stanza normal que veio sem `peer_recipient_pn`. O irmão chegou 2 s depois com o
telefone.

## 3. Medição (09/09 19:02 → 19/09 18:32 BRT, banco da Evolution × CRM)

| | |
| --- | --- |
| Mensagens 1:1 de cliente | 3.875 (3.872 em LID) |
| Em LID **sem** telefone | 5 (4 contatos) |
| …das quais DUPLICATA de mensagem que também chegou normal (está no CRM) | 4 (todas de 10/09) |
| **Perda real de cliente** | **1** (18/09 13:03:54, id `ACA5A459…`, lead novo) |
| Eco do escritório perdido | 1 (09/09 19:48:17) |
| Acervo do CRM como mapa LID→telefone | 959 LIDs, **0** com mais de um telefone |

No caso de 18/09 a cópia chegou ao CRM 68,9 s depois do envio; os ecos da
resposta do escritório (com o par LID+telefone) já estavam gravados havia 48 s.

## 4. O desenho

Princípio que governa tudo: **se qualquer peça nova falhar, o comportamento é
exatamente o de hoje** (descarta + avisa no log). O caminho da mensagem normal
(com telefone) ganha UMA consulta depois de tudo gravado, dentro de `try/catch`.

### 4.1 Fase 1 — resolver pelo acervo do próprio CRM

Item em `@lid` sem telefone, nesta ordem (`receberSemTelefone`):

1. **Já gravada?** (`jaGravada`, a mesma da rota). É a duplicata — sai calada.
   Hoje ela gera um `DESCARTADA` falso no log.
2. **Resolver o LID** no acervo: a mensagem 1:1 mais recente da CONTA com
   `remote_jid_lid = <LID exato>` e `remote_jid` terminando em
   `@s.whatsapp.net`. Erro de consulta = não resolvido (falha fechada).
3. Resolvido → decidir o **modo** (4.3) e gravar.
4. Não resolvido → **reter** (Fase 2).

### 4.2 Fase 2 — reter, avisar e religar

- Tabela `cb_mensagens_sem_telefone` (fechada ao navegador): o payload cru fica
  guardado enquanto a situação é `retida`; ao entregar, o payload é apagado
  (minimização — o conteúdo já está em `messages`).
- **Religar**: depois de gravar QUALQUER mensagem 1:1 que traga LID + telefone
  (cliente ou celular pareado), a rota pergunta se há retidas daquele LID e as
  grava, em ordem de carimbo.
- **Corrida retenção × eco**: depois de reter, o LID é resolvido DE NOVO. Ou o
  eco enxerga a retida, ou a retida enxerga o eco — não há intervalo em que os
  dois se percam.
- **Meu dia** (bloco de correções, só admin): fonte nova "mensagens retidas sem
  telefone", com a conexão e a hora — "veja no celular". Conta só os últimos
  7 dias (a antiga continua religável; só deixa de ocupar a tela).

### 4.3 Os dois modos de gravação (a decisão mais sensível)

| Modo | Quando | O que faz |
| --- | --- | --- |
| **nova** | a mensagem é a MAIS RECENTE da conversa **e** tem até 5 min | passa pelo caminho normal (`persistInboundMessage`/`persistDeviceMessage`), sem mudar uma linha dele — motores inclusive |
| **histórica** | qualquer outro caso (alguém já escreveu depois, ou ela é velha) | só ENTRA no histórico, no lugar certo do fio. **Nenhum motor** (automação, robô, IA), não reabre, não segue canal, não mede atraso de entrega, não abre negócio |

Por que `nova` dispara os motores: a cópia do celular e a cópia normal (quando
as duas chegam) disputam o mesmo `UNIQUE (conversation_id, message_id)`. Se a
recuperada NUNCA disparasse motores e chegasse primeiro, a cópia normal seria
descartada como duplicata e os motores não rodariam para aquela mensagem — uma
regressão em relação a hoje. Com `nova`, quem chega primeiro recebe o tratamento
completo, uma vez só (os motores rodam DEPOIS do insert, e só para quem ganhou).

Por que `histórica` não dispara nada: o robô leria uma mensagem antiga DEPOIS
das mais novas (um menu consumiria a resposta errada), a IA responderia a algo
de horas atrás, e a automação de boas-vindas sairia depois de gente já ter
respondido.

Na histórica, o que acontece além do insert (função `cb_assentar_mensagem_historica`):

- `aguardando_desde` é **recalculado pela fórmula canônica da 972** (a mesma do
  gatilho de mensagem apagada). Sem isso o gatilho de INSERT — que conta por
  ordem de INSERÇÃO — acenderia "em atraso há 3 h" sobre cliente que já foi
  respondido, ou apagaria um atraso verdadeiro (eco antigo do escritório).
- **Não lida +1** só quando é mensagem de CLIENTE sem resposta de gente depois.
- `updated_at` sempre — é o que faz o realtime corrigir a lista de quem está com
  a caixa de entrada aberta.

### 4.4 O que NÃO muda

- Mensagem com telefone: mesmo código, mesma ordem, mesmos motores.
- A regra "LID nunca vira telefone" (`findExistingContact` casa por 8 dígitos):
  o LID continua sem NUNCA entrar em `contacts.phone`; só entra o telefone que
  veio de uma mensagem real já gravada.
- Grupo, Instagram, Meta: intocados.
- A imagem da Evolution: intocada (Fase 3 fora do escopo).

## 5. Análise de risco

| # | Risco | Gravidade | Como é contido |
| --- | --- | --- | --- |
| R1 | Quebrar o caminho da mensagem normal | alta | Nenhuma linha dele muda. `normalizeUpsert` ganha parâmetro OPCIONAL. A única adição (religar) roda depois de tudo gravado, em `try/catch`, e nunca lança. Pino de regressão no teste da rota: mensagem com telefone chama os mesmos persistidores com os mesmos argumentos. |
| R2 | Mensagem cair no contato ERRADO | alta | LID exato, escopo de conta, só 1:1, só JID de telefone, a mais recente. Medido: 0 LIDs ambíguos em 959. O LID jamais vira `phone`. |
| R3 | Mensagem duplicada no fio | média | `jaGravada` antes de tudo + `UNIQUE (conversation_id, message_id)` como árbitro; quem perde a corrida não faz mais nada. |
| R4 | Motor disparar em dobro, ou tarde | alta | Só no modo `nova` (mais recente + ≤ 5 min), pelo caminho normal, onde o insert vem antes dos motores. Religação nunca é `nova` na prática (há sempre uma mensagem mais nova: a que trouxe o telefone). |
| R5 | "Em atraso" falso, ou atraso verdadeiro apagado | média | Recalcular pela fórmula canônica depois de todo insert histórico. Corrida residual (mensagem nova do cliente no mesmo instante do recálculo) aceita: é a MESMA instrução que o gatilho de mensagem apagada roda desde 02/09. |
| R6 | Alarme falso de "conexão entregando com atraso" (1002) | média | A histórica não chama `registrarEntrega`. A `nova` tem teto de 5 min = o limiar do alarme (que é "maior que 5 min"). |
| R7 | Lista/fio errados para quem está com a tela aberta | baixa | `updated_at` na conversa faz o realtime convergir a lista; o fio passa a inserir a mensagem atrasada na ORDEM do carimbo (só muda algo quando ela é mais antiga que a última — hoje ela apareceria no fim). |
| R8 | Deploy antes da migration | média | Tudo tolera a tabela/função ausentes: a Fase 1 funciona, a retenção cai no descarte de hoje, o religar loga UMA vez por processo. A regra continua: migration antes do merge. |
| R9 | Bloco do Meu dia degradado | baixa | Falha SÓ da fonte nova vira "não consegui conferir" daquela fonte — nunca 500 da rota inteira (o que derrubaria Calendly e webhooks junto). |
| R10 | Anexo de retida religada por OUTRA conexão | baixa | O download usa a conexão DA RETIDA, não a do webhook que destravou. Conexão apagada → sem anexo (mensagem entra). |
| R11 | "Parar se o cliente responder" (#223) | baixa | A histórica NÃO chama `cancelarEsperasPorResposta` (há default-deny). A segunda linha de defesa lê `gravada_em` (= agora): a espera criada ANTES da religação para — o lado que o projeto já escolheu como seguro ("entre os dois, cancela"); a criada DEPOIS não é afetada. |
| R12 | Instrumento de atraso (1003) poluído | baixa | A recuperada aparece como atraso grande em `gravada_em − created_at` — é verdade (o CRM gravou tarde). A tabela nova lista quais são, para excluir numa medição. |
| R13 | Payload (conteúdo de cliente) guardado | média | Tabela sem policy, `REVOKE` de `anon`/`authenticated`, só service role. Payload apagado ao entregar. |
| R14 | Carga no banco | baixa | Uma consulta indexada (índice parcial `situacao='retida'`) por mensagem 1:1. A resolução do LID só roda no caso raro (sem índice em `messages.remote_jid_lid`, de propósito: não se mexe em índice da tabela quente por ~5 consultas/mês). |

**Limites conhecidos (aceitos, escritos):** mensagem retida que o cliente APAGOU
antes de religar entra como se não tivesse sido apagada; citação feita a uma
retida fica sem vínculo; lead retido que nunca mais escreve e a quem ninguém
responde pelo celular fica retido (visível no Meu dia por 7 dias) — só a Fase 3
resolveria na hora.

## 6. Matriz de testes

| # | O quê | Tipo |
| --- | --- | --- |
| T1 | `normalizeUpsert` com telefone resolvido: usa o telefone, guarda o LID, recusa LID/grupo/JID torto como "telefone", e sem a opção continua descartando | unidade (puro) |
| T2 | `modoDaRecuperada`: mais recente × antiga, fronteira dos 5 min, conversa vazia, carimbo igual | unidade (puro) |
| T3 | `resolverTelefoneDoLid`: a mais recente vence; ignora grupo e JID que não é telefone; escopo de conta; erro → nulo | unidade (banco falso) |
| T4 | Retidas: inserir idempotente, tabela ausente tolerada, listar só `retida`, marcar com cerca | unidade (banco falso) |
| T5 | `gravarHistorica`: forma do insert (cliente × celular), 23505 = duplicata sem efeitos, flag de não lida, RPC chamada | unidade (banco falso) |
| T6 | `receberSemTelefone`: duplicata cala; resolvida+nova → caminho normal UMA vez; resolvida+antiga → histórica; não resolvida → retida; qualquer estouro → o aviso de hoje, sem lançar | unidade |
| T7 | `religarRetidas`: sem LID não consulta; ordem por carimbo; duplicata marcada; falha de uma não trava as outras; nunca lança; devolve o anexo com a conexão DA RETIDA | unidade |
| T8 | **Rota, regressão**: mensagem com telefone → mesmos chamados de sempre | rota (harness do `route.recibo.test.ts`) |
| T9 | Rota: LID conhecido → entra; LID desconhecido → retida; mensagem seguinte com o LID → religada | rota |
| T10 | Rota: tabela ausente → a mensagem normal continua entrando | rota |
| T11 | Estrutural: o escritor histórico NÃO importa motores, funil, reabertura, atraso de entrega nem o cancelamento de esperas | leitura do fonte |
| T12 | Estruturais existentes continuam verdes (canal no insert, reabertura, funil, dono durável, nome fixado, parar-se-responder, transporte) | suíte |
| T13 | Migration num Postgres 16 limpo: tabela fechada, privilégios (as duas metades), idempotência, FK composta com `SET NULL`, e a função nos cenários R5 (falso atraso some; atraso verdadeiro volta; encerrada/grupo → nulo; não lida) | Postgres local |
| T14 | Texto da migration: RLS ligada, zero policy, `REVOKE` | leitura do SQL |
| T15 | `inserirNaOrdem` (fio em tempo real) | unidade (puro) |
| T16 | Meu dia: fonte nova na ordem, ausência = "carregando", chaves nos dois dicionários | unidade + portões de i18n |
| T17 | `typecheck`, `lint` (ler "✖ N problems"), suíte em Node 22, `i18n-parity`, `i18n-chaves-usadas`, `build` | portões |
| T18 | Ponta a ponta no preview com o lead de teste autorizado — **só com autorização**: o preview usa o banco de PRODUÇÃO | manual |

## 7. Ordem de entrada e volta atrás

1. PR aberto, CI verde (inclui o replay das migrations em banco vazio), revisão
   do Codex no HEAD final.
2. **Operador autoriza** → aplicar a 1007 (aditiva; nada em produção a lê).
3. **Operador autoriza** → merge → deploy automático.
4. Conferir: `DESCARTADA` deixa de aparecer no log; a primeira ocorrência real
   vira linha em `cb_mensagens_sem_telefone`.

Volta atrás: reverter o merge (o deploy refaz a imagem anterior). A migration
fica — tabela e função sem leitor não fazem nada.

Opcional, depois: recuperar a fala do lead de 18/09 (o payload está no banco da
Evolution) — escrita em produção, só com autorização.

## 8. Checklist

- [x] Investigação e causa raiz (19/09)
- [x] Decisão do operador: Fases 1 e 2
- [x] Análise de risco e matriz de testes (este documento)
- [ ] Fase 1 — código + testes
- [ ] Migration 1007 + teste em Postgres local
- [ ] Fase 2 — reter, religar, Meu dia + testes
- [ ] Fio em tempo real na ordem do carimbo
- [ ] Portões (T17)
- [ ] PR + Codex
- [ ] 1007 aplicada em produção (autorização)
- [ ] Merge (autorização) + conferência pós-deploy
