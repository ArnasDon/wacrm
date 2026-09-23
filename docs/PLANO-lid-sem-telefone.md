# Plano — mensagem em `@lid` sem telefone (Fases 1 e 2)

Documento INTERNO e vivo. Atualizar a cada fase concluída.

| | |
| --- | --- |
| **Estado** | PR #226 aberto (branch `fix/lid-sem-telefone`). Revisado por duas lentes (6.2) e testado no preview contra a produção (6.1 e 6.3). Em produção: só as migrations 1010 e 1011 (aditivas, sem leitor até o deploy). |
| **Decisão do operador (19/09/2026)** | Fazer as Fases 1 e 2; a Fase 3 (patch na imagem da Evolution) fica de fora. "Não quero quebrar o que está funcionando" — cautela é requisito. |
| **Migrations** | `1010_cb_mensagens_sem_telefone.sql` (histórico `20260919234759`) e `1011_cb_historica_eco_e_resposta_concorrente.sql` (`20260920000843`) — aditivas, **aplicadas em 19/09/2026**, antes do merge. |

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

### 4.3 Os três modos de gravação (a decisão mais sensível)

| Modo | Quando | O que faz |
| --- | --- | --- |
| **nova** | a mensagem é a MAIS RECENTE da conversa — carimbo ESTRITAMENTE maior que o de qualquer outra — **e** tem até 4 min | passa pelo caminho normal (`persistInboundMessage`/`persistDeviceMessage`), sem mudar uma linha dele — motores inclusive |
| **tardia** | é a MAIS RECENTE da conversa, mas tem mais de 4 min (a cópia depende de o celular pareado estar acordado) | entra como história — **nenhum motor** — e a CONVERSA passa a refleti-la: reabre se estava encerrada (sem responsável), prévia canônica e `last_message_at` (`tardia.ts`) |
| **histórica** | alguém já escreveu depois dela — ou NO MESMO SEGUNDO (empate = não saber quem veio antes) | só ENTRA no histórico, no lugar certo do fio. **Nenhum motor** (automação, robô, IA), não reabre, não segue canal, não mede atraso de entrega, não abre negócio, e a conversa não se mexe |

Por que `nova` dispara os motores: a cópia do celular e a cópia normal (quando
as duas chegam) disputam o mesmo `UNIQUE (conversation_id, message_id)`. Se a
recuperada NUNCA disparasse motores e chegasse primeiro, a cópia normal seria
descartada como duplicata e os motores não rodariam para aquela mensagem — uma
regressão em relação a hoje. Com `nova`, quem chega primeiro recebe o tratamento
completo, uma vez só (os motores rodam DEPOIS do insert, e só para quem ganhou).

Por que `tardia` e `histórica` não disparam nada: o robô leria uma mensagem
antiga DEPOIS das mais novas (um menu consumiria a resposta errada), a IA
responderia a algo de horas atrás, e a automação de boas-vindas sairia depois de
gente já ter respondido.

Por que EMPATE de carimbo é história (Codex, 3ª rodada — 6.6): o carimbo do
WhatsApp vem em segundos, então duas falas da mesma rajada empatam; e como quem
chama já tirou a duplicata do caminho, o carimbo igual é de OUTRA mensagem, que
já passou pelos motores. Dentro do mesmo segundo não há como saber qual veio
antes, e a regra desta correção é "não saber qual é a última = não arrisca os
motores". O preço é o caso espelhado (a recuperada era mesmo a última da rajada):
ela entra no fio sem motor — e a irmã do mesmo segundo já acordou robô, IA, funil
e a caixa de entrada por ela.

Por que `tardia` existe (achado das duas lentes): tratada como história pura, a
fala de um cliente cuja conversa estava ENCERRADA entrava sem reabrir, sem
prévia e sem subir na lista — visível só para quem abrisse a aba Encerradas. O
argumento da histórica ("reabrir desfaria um encerramento decidido com
informação mais nova") não vale quando não existe nada mais novo do que ela.

Por que 4 min e não os 5 do alarme de atraso de entrega (1002): a `nova` chama
`registrarEntrega`, que mede o atraso DEPOIS da espera de 2 s do `jaGravada` e
das consultas do caminho. Com o teto colado no limiar, a cópia que chegasse aos
4:58 acendia "conexão entregando com atraso" numa conexão sadia.

Na tardia e na histórica, o que acontece além do insert (função
`cb_assentar_mensagem_historica`):

- `aguardando_desde` é **acertado de forma cirúrgica**: a função desfaz só o que
  ESTA mensagem estragou no gatilho de INSERT da 972, que decide pela ordem de
  INSERÇÃO — fala de cliente preenche a espera vazia mesmo já respondida, e
  resposta de gente limpa a espera mesmo que o cliente só tenha escrito depois
  dela. Para o eco, a função precisa da espera que havia ANTES do insert
  (`p_espera_antes`, lida em `historica.ts`): depois que o gatilho limpa, o
  banco não sabe mais o que era. ⚠️ A 1ª versão copiava o recálculo canônico do
  gatilho de mensagem apagada da 972, e a revisão MEDIU o defeito dele: a
  fórmula não sabe que ENCERRAR limpa a espera, e ressuscitava o "ok, obrigado"
  de semanas atrás como espera de 9 dias (o mesmo defeito continua naquele
  gatilho — fora do escopo).
- **Não lida +1** só quando é mensagem de CLIENTE sem resposta de gente depois.
- `updated_at` sempre — é o que faz o realtime corrigir a lista de quem está com
  a caixa de entrada aberta.

**O fio ABERTO continua acrescentando a mensagem do realtime no FIM.** A 1ª
versão inseria pelo carimbo e foi revertida na revisão: mudava o comportamento
de TODA mensagem atrasada (não só da recuperada), e na conversa aberta a não
lida é forçada a zero — a mensagem inserida acima da dobra passaria
despercebida. No fim, a recuperada aparece como a última bolha, com a hora dela,
e vai para o lugar do carimbo ao recarregar.

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
| R4 | Motor disparar em dobro, ou tarde | alta | Só no modo `nova` (mais recente + ≤ 4 min), pelo caminho normal, onde o insert vem antes dos motores. Na religação quase sempre há uma mensagem mais nova (a que trouxe o telefone); a exceção é o eco ATRASADO destravando uma fala mais recente, ou o empate no mesmo segundo — nos dois casos a retida é de fato a última, e `nova` é o certo. Default-deny de quem chama o caminho normal (`inbound-store.chamadores.test.ts`). |
| R5 | "Em atraso" falso, ou atraso verdadeiro apagado | média | Função CIRÚRGICA depois de todo insert histórico: desfaz só o que esta mensagem estragou (20 cenários num Postgres 16 com o gatilho real). NÃO é o recálculo canônico — ele ressuscita espera já limpa por um encerramento (medido pela revisão). Corrida residual: entre ler a espera de antes e assentar (~100 ms) cabe uma resposta real — a função confere "gente respondeu depois da espera?" antes de devolver qualquer coisa. |
| R6 | Alarme falso de "conexão entregando com atraso" (1002) | média | Tardia e histórica não chamam `registrarEntrega`. A `nova` tem teto de 4 min, com folga de 1 min sobre o limiar do alarme (o atraso é medido depois da espera do `jaGravada`); há teste cobrando a folga. |
| R7 | Lista/fio errados para quem está com a tela aberta | baixa | `updated_at` na conversa faz o realtime convergir a lista. O fio aberto NÃO muda: a recuperada aparece no fim, com a hora dela, até recarregar — de propósito (inserir pelo carimbo mexia em toda mensagem atrasada e podia esconder a bolha acima da dobra; revertido na revisão). |
| R8 | Deploy antes da migration | média | Tudo tolera a tabela/função ausentes: a Fase 1 funciona, a retenção cai no descarte de hoje, o religar loga UMA vez por processo. A regra continua: migration antes do merge. |
| R9 | Bloco do Meu dia degradado | baixa | Falha SÓ da fonte nova vira "não consegui conferir" daquela fonte — nunca 500 da rota inteira (o que derrubaria Calendly e webhooks junto). |
| R10 | Anexo de retida religada por OUTRA conexão | baixa | O download usa a conexão DA RETIDA, não a do webhook que destravou. Conexão apagada → o download é PULADO (com canal nulo ele cairia no canal padrão da conta, que nunca viu a mensagem); a mensagem entra sem anexo. Pino lendo a rota. |
| R11 | "Parar se o cliente responder" (#223) | baixa | A histórica NÃO chama `cancelarEsperasPorResposta` (há default-deny). A segunda linha de defesa lê `gravada_em` (= agora): a espera criada ANTES da religação para — o lado que o projeto já escolheu como seguro ("entre os dois, cancela"); a criada DEPOIS não é afetada. |
| R12 | Instrumento de atraso (1003) poluído | baixa | A recuperada aparece como atraso grande em `gravada_em − created_at` — é verdade (o CRM gravou tarde). A tabela nova lista quais são, para excluir numa medição. |
| R13 | Payload (conteúdo de cliente) guardado | média | Tabela sem policy, `REVOKE` de `anon`/`authenticated`, só service role. Payload apagado ao entregar. |
| R14 | Carga no banco | baixa | Uma consulta indexada (índice parcial `situacao='retida'`) por LID por LOTE do webhook, depois de todos os itens gravados, com teto de 10 retidas por PÁGINA. Só o LID com mais retidas que uma página paga mais: o resto é drenado DEPOIS da fase de anexos do lote, em até 5 passadas (6.6). A resolução do LID só roda no caso raro — medido em produção: ~5 ms (varredura de 14,4 mil linhas em cache; sem índice em `messages.remote_jid_lid`, de propósito). |
| R15 | `first_inbound_message` deixa de disparar para o lead cuja 1ª fala entrou como história | média | Só quando quem destrava é o ECO do escritório (gente já respondeu): a fala retida entra como `customer` antes de o cliente escrever de novo, e a mensagem seguinte dele não é mais "a primeira". Lado ESCOLHIDO — boas-vindas de robô depois de gente responder — e escrito na rota e no CLAUDE.md. Medido em 19/09: nenhuma automação nem fluxo ativo usa o gatilho. Quando quem destrava é o próprio cliente, a mensagem dele é gravada ANTES e o gatilho vale como hoje. |
| R16 | Mensagem tardia invisível em conversa encerrada | média | Modo `tardia`: reabre (sem responsável), prévia e posição — pelo mesmo helper dos caminhos normais, ENTRE o insert e o acerto da espera. |
| R17 | `nova` que perde a corrida do `UNIQUE` vira "retida" falsa no Meu dia | baixa | `entregar.ts` confere se a mensagem está na conversa antes de responder `falhou`: está → `duplicada`, nada a reter. |

**Limites conhecidos (aceitos, escritos):**

- mensagem retida que o cliente APAGOU ou EDITOU antes de religar entra como foi
  enviada; citação feita a uma retida fica sem vínculo;
- lead retido que nunca mais escreve e a quem ninguém responde pelo celular fica
  retido (visível no Meu dia por 7 dias) — só a Fase 3 resolveria na hora;
- o eco de um envio feito PELO CRM não destrava retida: ele sai no `jaGravada`
  antes do bloco de religação, e `send-message.ts` não grava `remote_jid_lid`.
  A retida espera a próxima mensagem do cliente ou um eco do celular pareado;
- a decisão do modo não é atômica: mensagem mais nova gravada por OUTRO webhook
  nos ~100 ms entre olhar "qual é a última" e o insert faz a `nova` passar pelos
  motores depois dela — a mesma desordem que duas mensagens normais quase
  simultâneas já têm hoje (a ingestão não serializa por conversa);
- o par (telefone + LID) fica durável no insert de dentro de
  `persistInboundMessage`, mas a rota só anota "religar este LID" quando a função
  VOLTA, depois dos motores: processo que morre nesse vão deixa a retida retida
  até a próxima mensagem daquele LID (visível no Meu dia). Aceito — ver 6.7;
- cópia histórica OU TARDIA que chega ANTES da cópia normal da mesma mensagem
  ganha o `UNIQUE`, e a normal é pulada sem rodar motor. ⚠️ A condição é mais
  larga do que a 1ª versão deste texto dizia (revisão final, 6.9): não precisa
  "alguém ter escrito depois dela em segundos" — basta a cópia do celular chegar
  primeiro E já ter mais de 4 min (a `tardia`). Acontece quando o celular do
  CLIENTE fica offline e a retentativa dele demora; a conversa reflete a fala
  (reabre, prévia, não lida), mas robô, automação e funil não rodam para ela;
- a tardia e a histórica não emitem o webhook de saída `message.received`
  (zero endpoints ativos hoje);
- áudio histórico pode ser recusado pela transcrição se alguém a pedir nos
  segundos antes de o anexo chegar (a janela de 2 min de `transcrever.ts` conta
  do `created_at`, que aqui é antigo);
- retida que NUNCA religa guarda o payload sem prazo, e sem vínculo com ficha
  (apagar o contato não a alcança) — **decisão pendente do operador**: expirar
  depois de N dias?

## 6. Matriz de testes

| # | O quê | Tipo |
| --- | --- | --- |
| T1 | `normalizeUpsert` com telefone resolvido: usa o telefone, guarda o LID, recusa LID/grupo/JID torto como "telefone", e sem a opção continua descartando | unidade (puro) |
| T2 | `modoDaRecuperada`: nova × tardia × histórica, fronteira dos 4 min (com folga sobre o alarme da 1002), conversa vazia, carimbo igual | unidade (puro) |
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
| T13 | Migration num Postgres 16 limpo, só com as concessões dela: tabela fechada, privilégios (as duas metades, trocando de papel), idempotência, FK composta com `SET NULL`, e a função em 14 cenários com o gatilho REAL da 972 — inclusive o achado da revisão (a espera de semanas atrás NÃO ressuscita) e a corrida (resposta real durante a janela vence) | Postgres local |
| T14 | Texto da migration: RLS ligada, zero policy, `REVOKE` | leitura do SQL |
| T15 | `tardia`: reabre sem responsável, prévia canônica, posição, nunca lança; a ORDEM insert → reabrir → assentar | unidade (banco falso) |
| T15b | Default-deny de quem chama o caminho normal de ingestão; a fase de mídia pula a retida de conexão apagada e o item normal segue sem a chave | leitura do fonte |
| T16 | Meu dia: fonte nova na ordem, ausência = "carregando", chaves nos dois dicionários | unidade + portões de i18n |
| T17 | `typecheck`, `lint` (ler "✖ N problems"), suíte em Node 22, `i18n-parity`, `i18n-chaves-usadas`, `build` | portões |
| T18 | Ponta a ponta no preview com o lead de teste autorizado — **só com autorização**: o preview usa o banco de PRODUÇÃO | manual |

### 6.1 Execução da matriz (19/09/2026, depois da revisão)

- **Unidade, rota e estruturais:** 124 testes em `sem-telefone/`, 12 na rota,
  o default-deny novo do caminho normal e os pinos do SQL — todos verdes. Suíte
  inteira em Node 22, já com o `main` de 19/09 mesclado: **353 arquivos, 4.502
  testes, zero falha**.
- **Mutação** (o teste pega o defeito que diz pegar?) — 13 regras quebradas de
  propósito, uma por vez, e desfeitas; as 13 reprovaram: dúvida sobre "qual é a
  última" virando `nova`; mensagem ANTIGA passando pelos motores; duplicata não
  filtrada na chegada; anexo sem a conexão da retida; eco do escritório
  contando não lida; LID aceito como "telefone resolvido"; a tardia sem
  reabrir; `nova` que perdeu o `UNIQUE` voltando a ser `falhou`; a conta sem a
  conferência em JS; a histórica citando `registrarEntrega`; o teto da `nova`
  colado no alarme da 1002; a rota sem religar; a fase de mídia sem pular a
  retida de conexão apagada.
- **T13:** Postgres 16 descartável (Homebrew, só TCP), banco limpo **só com as
  concessões da própria migration**: aplica, é idempotente (2ª passada sem
  erro), a conferência troca de papel — e 20 cenários com o gatilho REAL da
  972: falso "em atraso" some (S1); eco anterior à espera devolve o atraso
  verdadeiro (S2); eco no meio passa a espera para a fala seguinte (S3/S3b);
  **o achado da revisão** — a espera de 01/09 que o encerramento limpou NÃO
  ressuscita, nem por fala (S4) nem por eco (S4b); robô não conta como resposta
  (S5); encerrada e grupo ficam nulos (S6/S7); a tardia reaberta antes de
  assentar fica "em atraso" desde o carimbo dela (S6b); resposta real durante a
  janela vence (S8); espera posterior legítima fica (S9); eco onde ninguém
  esperava não muda nada (S10); mensagem apagada não conta (S11); CHECK do
  payload, UNIQUE, FK composta com `SET NULL (channel_id)`, CASCADE (T1–T5); e
  os privilégios trocando de papel (P).
- **T17:** `tsc` limpo; `eslint` 0 erros (49 avisos, todos pré-existentes — o
  único em arquivo desta branch é o `toast` sem uso de `inbox/page.tsx`, que
  ficou idêntico ao `main`); `i18n-parity` e `i18n-chaves-usadas` verdes;
  `next build` com saída 0. CI do PR #226 verde no 1º push (replay incluso).
- **Medição em produção, somente leitura (R2/R14):** 960 LIDs no acervo, ZERO
  com mais de um telefone, ZERO mensagens de grupo com LID gravado; a consulta
  que resolve o LID custa ~5 ms.
- **T18, parte 1 — preview contra a produção, ANTES da 1010 (o cenário "deploy
  antes da migration"), com autorização do operador:**
  - sem gravar nada: LID desconhecido → a retenção falha ("Could not find the
    table…", uma vez) e sai o `DESCARTADA` de sempre, com `tipo: "text"`; a
    duplicata sem telefone e a duplicata normal saem caladas; conferido por
    consulta: zero linha nova, zero contato fantasma;
  - gravando na conversa do lead de teste autorizado: a mensagem NORMAL entrou
    exatamente como sempre (cliente, `delivered`, canal carimbado, par
    telefone+LID, não lida 0→1, prévia e `last_message_at`, `aguardando_desde`
    intocado, nenhum motor, nome da ficha igual) e o log não mostrou erro
    nenhum; a cópia SEM telefone com carimbo de 20 min atrás foi resolvida pelo
    acervo e entrou como história — a linha foi aceita pelo esquema REAL de
    `messages`, no lugar certo do fio, sem mexer em não lida, prévia nem
    posição, e o erro da função ausente ficou só no log;
  - telas (operador logado, só leitura): o Meu dia abre com a fonte nova em
    "1 verificação não respondeu" (a rota devolve `retidas: null` com 200, e
    Calendly continua respondendo), a caixa de entrada lista normalmente, zero
    erro no console.
- **T18, parte 2 — depois da 1010 aplicada:** ver 6.3.

### 6.2 Revisão por duas lentes (19/09/2026) — nenhum P1

Dois revisores independentes, só leitura: **regressão do caminho quente** e
**banco/concorrência**. Conferido e certo: `normalizeUpsert` sem a opção é
idêntico ao anterior em 84 combinações de chave × corpo; os itens normais da
fase de mídia não carregam a chave nova; `religarRetidas` não altera nem derruba
a mensagem normal; sem ciclo de módulos; exatamente-uma-vez no modo `nova`; a
rota do Meu dia é compatível nos dois sentidos de deploy; todas as formas de
consulta têm precedente em produção. O que mudou por causa dela:

| Achado | O que foi feito |
| --- | --- |
| **O número da migration colidia** — nasceu 1007 (colidiu com o PR #225), virou 1009 (colidiu com o PR #228, mesclado enquanto este estava aberto; pego pelo CI) | hoje é **1010**; as duas colisões pegas ANTES de aplicar — sexto e sétimo casos de branches em paralelo |
| Fala tardia de cliente, ainda a última, **invisível em conversa encerrada** | modo `tardia` (4.3) |
| O recálculo canônico **ressuscitava espera já limpa por encerramento** (medido) | função cirúrgica + `p_espera_antes` (4.3, S4/S4b) |
| `first_inbound_message` deixa de disparar quando o ECO destrava | decisão escrita (R15) — é o lado escolhido; a documentação que afirmava o contrário foi corrigida |
| `inserirNaOrdem` mexia em TODA mensagem atrasada e podia escondê-la acima da dobra | **revertido**: o fio aberto continua acrescentando no fim |
| `nova` que perde o `UNIQUE` virava "retida" falsa no Meu dia | `entregar.ts` confere e responde `duplicada` (R17) |
| Conexão apagada: o anexo cairia no canal padrão, ao contrário do que a doc dizia | o download é pulado (R10) |
| Teto da `nova` colado no alarme da 1002 | 4 min, com folga testada (R6) |
| Sem default-deny de quem chama o caminho normal | `inbound-store.chamadores.test.ts` |
| Escopo de conta do acervo dependia só do `!inner` (invisível ao banco falso) | conferido também em JS, com teste que ignora o filtro |
| `retidasDoLid` sem teto; log do insert com o `details` (texto do cliente) | teto por vez (hoje 10 — ver 6.5); log só com código e mensagem |
| Função `SECURITY INVOKER` sem prova trocando de papel | GRANT nas duas tabelas + conferência como `service_role` na migration |

Ficaram como limite escrito (seção 5): o eco de envio do CRM não destrava; a
histórica que vence a cópia normal; sem `message.received` para a histórica;
edição de retida; janela da transcrição; retenção do payload sem prazo (decisão
pendente do operador).

### 6.3 T18, parte 2 — preview contra a produção, DEPOIS da 1010 (19/09/2026, 20:48–20:55 BRT)

Servidor local da branch contra o banco de produção, webhook simulado só para o
lead de teste autorizado, nenhum motor ativo para ele (conferido antes:
nenhuma automação de mensagem, fluxo, IA nem webhook de saída). É aqui que as
duas formas sem precedente foram medidas contra o PostgREST REAL: o
`upsert(onConflict)` do registro e o `rpc('cb_assentar_mensagem_historica')`
com os cinco argumentos nomeados — as duas funcionaram de primeira.

| Cenário | Resultado medido |
| --- | --- |
| **Tardia** — conversa ENCERRADA de propósito; cópia sem telefone de 10 min atrás, ainda a última | log `modo: tardia`; a conversa **reabriu** (sem responsável), prévia e `last_message_at` novos, não lida +1, `aguardando_desde` = o carimbo da mensagem; registro `entregue`/`acervo` sem payload; nenhuma execução de automação |
| **Nova** — cópia sem telefone de agora | log `modo: nova`; entrou pelo caminho normal (prévia, posição, não lida +1); registro `entregue`/`acervo` |
| **Histórica** — cópia de 20 min atrás, com mensagens mais novas no fio | log `modo: historica`; no lugar do carimbo; prévia e posição INTOCADAS; não lida +1 (ninguém respondeu depois); a espera recuou para o carimbo dela |
| **Retida** — LID que o acervo não conhece | log `RETIDA`; linha `retida` com o payload (chave + texto), conexão carimbada; nada em `messages`; nenhum contato fantasma |
| **Meu dia com a retida** | a rota devolve só `{ canalId, recebidaEm, daEquipe }`; a tela mostra "1 mensagem chegou sem telefone e está retida (últimos 7 dias)", o título **Mensagens retidas sem telefone**, "Bancário - Comercial · 19/09, 20:50" e a orientação. ⚠️ O título nasceu aqui: sem ele a conexão e a hora eram lidas como detalhe da linha de cima ("entradas não viraram atendimento") |
| **Religar** — mensagem normal trazendo o telefone daquele LID | a normal entrou primeiro; log `retida RELIGADA … historica`; a retida entrou na conversa certa com a hora ORIGINAL; registro `entregue`/`religacao`, payload APAGADO; Meu dia voltou a zero retidas |
| **Reentrega** da retida já religada | saiu calada; nada mudou |
| **Fio** (conversa aberta por URL) | as recuperadas na ordem do carimbo, com o rótulo da conexão; zero erro novo no console |

**Limpeza** (autorizada): apagadas as 7 mensagens de teste e as 4 linhas do
registro, por id exato; a conversa voltou ao retrato — `open`, não lida 0, sem
responsável, canal fixado, `aguardando_desde` de 14/09, prévia e posição pela
última mensagem REAL (um aviso de agendamento das 20:07, que chegou durante a
janela e não é desta sessão). Conferido por consulta: zero `TESTE-E2E-%`, zero
linha no registro, zero contato ou mensagem com o LID falso, negócio, eventos do
lead, notificações e logs de automação iguais ao retrato.

### 6.4 Codex, 1ª rodada (HEAD `50748ba`) — 1 achado (P2), corrigido

**Eco posterior à espera × resposta concorrente** (`cb_assentar_mensagem_historica`):
no ramo "o eco tem carimbo T e a espera de antes (A) começou ANTES de T", a função
punha a espera na fala de cliente mais antiga depois de T sem perguntar se ela já
tinha sido respondida. Entre `historica.ts` ler A e chamar a função cabe uma
resposta REAL da equipe: o gatilho da 972 limpa a espera (certo) e a função a
reescrevia com a fala já respondida — "em atraso" sobre cliente atendido. O ramo
irmão (eco ANTERIOR à espera) já tinha a guarda.

- **Correção:** migration **1011** (a 1010 já estava aplicada): mesma assinatura, o
  ramo passa a contar só a fala de cliente SEM resposta de gente depois dela.
- **Prova:** Postgres 16 local — o cenário do Codex REPRODUZ com a função da 1010
  ("a resposta real foi desfeita") e passa com a 1011; controles (sem resposta de
  gente, a fala continua esperando; robô não conta); 1010 + 1011 num banco limpo,
  a 1011 duas vezes; os 20 cenários de 6.1 verdes. Pinos do corpo passaram a ler a
  1011.
- **Em produção:** 1011 aplicada em 19/09/2026 21:08 BRT (histórico
  `20260920000843`), depois do CI verde; conferida no catálogo. E o caminho que
  faltava exercitar contra o banco real — o ECO do escritório sem telefone
  (`fromMe`) — foi testado no preview: entrou como `agent`/`from_device`/`sent`
  com o canal carimbado, modo `tardia`, sem contar não lida; a espera de 14/09
  foi encerrada pela regra nova (a "resposta" do escritório é posterior a ela e
  ninguém escreveu depois); registro `entregue`/`acervo`. Limpo e conferido: a
  conversa voltou ao retrato.
- **Varredura da família** (as outras janelas entre ler a espera e assentar): o
  ramo do eco anterior à espera e os dois ramos do cliente já se defendem
  perguntando "gente respondeu depois?" NA HORA da função. Sobraram duas corridas
  de UMA ida ao banco, escritas no cabeçalho da 1011 — fechá-las pede o insert
  dentro da função, com a linha da conversa travada (outra obra; o efeito é o selo
  "em atraso" errado até a próxima mensagem, nunca mensagem perdida).

### 6.5 Codex, 2ª rodada (HEAD `3ebab6a`) — 1 P1 corrigido, 1 P2 aceito por escrito

**P1 — a religação rodava DENTRO do laço dos itens da rota.** Religar são ~6 idas
ao banco por retida; o lote que destravasse muitas atrasaria — e, num corte do
`after()`, perderia — os itens seguintes do mesmo lote, que é a perda que as duas
fases da rota existem para impedir. **Corrigido:** a rota só ANOTA o par no laço
(`paraReligar`, um por LID) e religa depois de todos os itens gravados, antes da
fase de anexos; `receberSemTelefone` passou a DEVOLVER o pedido de religação em
vez de executá-lo; o teto caiu de 50 para 10 retidas por vez (é o que limita o
atraso do anexo de uma mensagem atual). Testes: lote `[a que destrava, outra
atual]` — as duas atuais entram antes de qualquer retida; três mensagens do mesmo
cliente = UMA consulta às retidas; a corrida retenção × eco dentro de um lote; e
um pino lendo a rota (a chamada fica fora do laço e antes da fase de anexos).

**P2 — a decisão do modo não é atômica.** Se OUTRO webhook grava uma mensagem mais
nova nos ~100 ms entre `ultimaDaConversa()` e o insert, uma `nova` passa pelos
motores depois dela. **Aceito por escrito (seção 5):** é a mesma desordem que duas
mensagens normais quase simultâneas já têm hoje — cada webhook roda o seu `after()`
sem serializar por conversa —, então a `nova` herda essa propriedade, não a cria; e
fechá-la exige travar a conversa DENTRO de `persistInboundMessage`, o caminho
quente que esta correção prometeu não tocar. Frequência estimada: uma janela de
~100 ms num caminho que roda ~1 vez a cada 10 dias.

### 6.6 Codex, 3ª rodada (HEAD `7ebc9fe`) — 2 P2, os dois corrigidos

**P2 — empate de carimbo era tratado como "continua sendo a última".** Com `>=`,
a fala RETIDA de uma rajada ("oi" / "quero agendar", no mesmo segundo) era
religada como `nova` DEPOIS de a irmã dela já ter passado pelos motores — o robô
iniciado pela irmã consumia a fala atrasada como resposta ao menu. **Corrigido:**
`modo.ts` passou a exigir carimbo ESTRITAMENTE maior (`>`); empate é `historica`,
inclusive horas depois (nunca `tardia`: a irmã do mesmo segundo ou veio pelo
caminho normal, ou foi tardia — as duas reabrem e sobem a conversa —, ou era
história porque já havia algo mais novo). Vale para os dois chamadores, a chegada
e a religação. Testes: três casos novos em `modo.test.ts` (empate recente, empate
de horas, 1 ms à frente).

**P2 — a cauda acima do teto ficava retida até OUTRA mensagem daquele LID.** Com
mais de 10 retidas e uma única mensagem trazendo o telefone, a rota religava as
10 mais antigas e nada agendava o resto — que são justamente as falas mais
RECENTES do lead; para quem não escreve de novo, "a próxima mensagem" é nunca.
**Corrigido, como trabalho limitado de continuação:** `religarRetidas` passou a
ser UMA página e a dizer se `haMais` (e quantas `resolvidas`); a rota guarda em
`comResto` o LID cuja página veio cheia e chama `religarOResto` numa SEGUNDA leva
da fase de anexos — depois dos anexos do lote (mensagem atual primeiro, história
depois), pelo MESMO corpo da fase de anexos (sem cópia: o laço ganhou um laço de
fora, e o `git diff -w` mostra só o invólucro). `religarOResto` repete a página
até `MAXIMO_DE_PASSADAS_DO_RESTO` (5 → 60 retidas de um LID por lote) e para
quando a página não vem cheia ou quando uma passada não resolve ninguém (cabeça
da fila presa por falha de banco: a passada seguinte leria as mesmas linhas). O
que falha continua com o destino de sempre — segue retida, e a próxima mensagem
daquele LID tenta de novo; o resto existe para quem nunca foi TENTADO, e falhar
não rende passada. (Efeito colateral da leitura "a partir da mais antiga":
havendo cauda, a que falhou volta na página seguinte e é tentada de novo, no
máximo uma vez por passada — idempotente pelo `jaGravada` e pelo `UNIQUE`. Uma
primeira versão deste texto dizia que ela "não é tentada de novo"; não era
exato.) O caso comum (uma página ou menos) não paga nada: a segunda leva não
consulta o banco.

Testes: 8 de unidade (`religar.test.ts`: página cheia avisa, página incompleta
não, drenagem completa em ordem, anexos de todas as passadas com a conexão de
cada retida, teto de passadas, parada sem progresso, falha na cabeça não prende a
cauda, leitura que falha no meio), 2 de comportamento na rota (12 retidas + uma
mensagem atual com foto: `normal → 10 históricas → anexo do lote → 2 históricas →
anexo da cauda, na conexão DELA`; e "uma página ou menos: a segunda leva não
consulta nada") e 1 pino lendo a rota. **Mutação:** 6 regras quebradas de
propósito, uma por vez — `>` de volta a `>=`; `haMais` sempre falso; sem a parada
por falta de progresso; sem o teto de passadas; o resto drenado ANTES dos anexos
do lote; a rota esquecendo quem tem resto —, as 6 reprovaram.

⚠️ Registro de um erro meu nesta rodada: o primeiro teste de "falha na cabeça da
fila" esperava que a retida que falhou fosse tentada de novo dentro do mesmo
lote. Não é o contrato (nem deveria ser — seria repetir falha em laço): o teste
estava errado, o código não. Foi corrigido o TESTE, com o motivo escrito nele.

**Preview contra a produção (19/09/2026, 21:41–21:44 BRT), só com o lead de
teste, e limpo no fim:**

- **G9 — empate.** Duas cópias sem telefone com o MESMO carimbo (10 min atrás),
  LID conhecido: a 1ª entrou `tardia`, a 2ª `historica` (log do módulo). Nenhuma
  passou por motor.
- **G8 + G5 — a pilha.** 12 cópias sem telefone de um LID desconhecido num lote
  só → 12 linhas `RETIDA`; uma mensagem normal do lead trazendo aquele LID → as
  12 `RELIGADA` no MESMO webhook, na ordem 01…12, todas `historica`. No banco: a
  ordem de gravação (`gravada_em`) bate com a do carimbo; o registro ficou com 14
  linhas, todas `entregue`, 12 por religação e 2 pelo acervo, NENHUMA com payload.
- **Motores:** `automation_logs` do contato ficou em 1 antes e depois (só há uma
  automação ativa na conta, de gatilho `calendly_booking`, e nenhum fluxo).
- **Não lidas:** com a conversa ABERTA no navegador do preview o contador ficou em
  1 depois de 14 falas recuperadas — a conversa aberta força a não lida a zero
  (4.3). Medido em seguida com a conversa FECHADA no navegador: uma histórica →
  1 → 2, exatamente +1, sem mexer em `last_message_at` nem em `aguardando_desde`.
- **Limpeza conferida:** 16 mensagens e 15 linhas do registro apagadas por id
  exato; a conversa voltou ao retrato (aberta, 0 não lidas, sem responsável,
  `aguardando_desde` de 14/09, prévia e posição pela última mensagem REAL, 110
  mensagens); 1 negócio aberto, 4 eventos do lead, 1 log de automação, 0 esperas;
  nenhum vestígio dos LIDs fictícios no acervo.
- ⚠️ **Uma diferença em relação ao primeiro retrato do dia, que eu não tinha
  registrado:** `contacts.updated_at` do lead de teste está em 19/09 23:04 UTC, e
  não no 14/09 original. Não é desta rodada (não se mexeu nela): vem da primeira
  simulação de mensagem NORMAL do dia (6.1) — o caminho normal toca a linha do
  contato, como faria qualquer mensagem real dele. Nenhum CAMPO da ficha difere
  (nome, `nome_fixado_em`, `avatar_checked_at` iguais).

Portões no HEAD desta rodada: `tsc` limpo, `eslint` 0 erros (os mesmos 49 avisos
de antes), suíte inteira em Node 22 — 353 arquivos, 4.521 testes.

### 6.7 Codex, 4ª rodada (HEAD `5a61ed6`) — nenhum P1; 1 P2 aceito por escrito

**P2 — "religar depois de um insert com o par sobreviver a um corte".** O par
fica durável no insert de dentro de `persistInboundMessage`, que roda ANTES dos
motores (robô, automações, IA, webhooks de saída); a rota só faz
`paraReligar.set(...)` quando a função volta. Se o processo morre nesse vão, o
par está gravado e as retidas daquele LID continuam retidas; e uma reentrega do
mesmo webhook não conserta, porque sai no `jaGravada` antes de chegar ali.

**O que é verdade:** tudo acima. **O que não vale nesta instalação:** o achado
supõe o corte de 60 s do `after()` e a reentrega do webhook. A rota declara
`maxDuration = 60`, mas a produção é o `standalone` do Next em contêiner — sem
corte de duração (medido em 27/08/2026; está no CLAUDE.md) —, então a morte só
vem de deploy ou queda; e o 200 sai ANTES de o `after()` rodar, logo a Evolution
não reentrega nesse caso.

**Por que fica aceito, sem mudar código:**

- Não é perda. A mensagem segue retida, aparece no Meu dia por 7 dias ("veja no
  celular") e é religada pela próxima mensagem daquele LID, do cliente ou do
  celular — o mesmo destino de qualquer religação que falha, já escrito.
- Exige duas coisas raras ao mesmo tempo: haver retida (medido: ~1 a cada 10
  dias) E o processo morrer numa janela de segundos (esta conta não tem fluxo
  ativo, e a única automação ativa não é de mensagem: o vão é curto).
- O conserto de verdade — anotar o par de forma durável ANTES dos motores —
  mora dentro de `persistInboundMessage`, o caminho quente que esta correção se
  comprometeu a não tocar, e sustentou por quatro rodadas.
- A alternativa barata (agir no ramo do `jaGravada`) acrescenta uma consulta ao
  eco de TODO envio feito pelo CRM, precisa de outra para achar a conversa, e
  aqui nem consertaria o cenário descrito, porque não há reentrega. O que ela
  traria é outra coisa — o eco de um envio do CRM passar a destravar retida —,
  que é ampliar a feature, não fechar este achado. Fica anotado como melhoria
  possível, com decisão própria.

⚠️ **Onde isto deixa de ser raro:** numa hospedagem que CORTE o `after()`
(serverless). Se o produto for instalado assim, este é o primeiro item a
revisitar, e o conserto é o do terceiro ponto.

### 6.8 Depois do merge (19/09/2026, 21:56 BRT em diante) — o que entrou, a conferência e a 5ª rodada no preview

**O merge não foi combinado.** O PR #226 foi mesclado às 21:56 BRT pela conta
`devgabrielslv` (colaborador com permissão de escrita), sem autorização do
operador — confirmado por ele depois. Head `5a61ed6`, merge `545af27`. Seis
minutos depois a mesma conta mesclou o #227 (paginação do quadro e da caixa de
entrada, de outra sessão): `4a7e658`. ⚠️ Merge no `main` é deploy de produção.

- O #227 não toca em nenhum arquivo desta correção, e o código dela no `main` é
  idêntico ao testado (`git diff 5a61ed6 origin/main` vazio em
  `src/lib/whatsapp`, `src/app/api/whatsapp`, Meu dia e `supabase/migrations`).
- Rollouts conferidos no log do Actions: `Service crm_crm converged` às 22:01:37
  (#226) e às 22:07:44 BRT (#227).
- As migrations 1010 e 1011 já estavam aplicadas — a ordem "migration antes do
  deploy" valeu por sorte, não por combinação.

**Conferência pós-deploy, por dado (sem SSH):** de 22:08 a 23:40 BRT entraram 3
mensagens de cliente, 5 do celular pareado e 1 do robô, todas gravadas com atraso
de até 7 s (`gravada_em − created_at`): o caminho normal está são com o código
novo. `cb_mensagens_sem_telefone` tinha ZERO linhas reais — nenhuma ocorrência
ainda (o esperado é ~1 a cada 2 dias). O `DESCARTADA` do log da VPS não foi
conferido (SSH não autorizado nesta conversa).

**5ª rodada no preview (23:42–23:45 BRT), o que ainda não tinha sido testado de
ponta a ponta** — webhook LOCAL, banco real, só o lead de teste, LIDs fictícios:

| Cenário | O que aconteceu |
|---|---|
| G10 — ECO do escritório (`fromMe`) sem telefone, LID desconhecido | `RETIDA` com `from_me = true`; a rota do Meu dia devolveu só `{canalId, recebidaEm, daEquipe: true}`. A mensagem normal que trouxe o par a religou como `agent` pelo celular (`from_device`), modo `historica`, 2,5 s depois. `aguardando_desde` foi de 14/09 para o carimbo da fala do cliente POSTERIOR ao eco — o ramo do eco da 1011, contra o banco real: sem a função, o eco apagaria a espera de quem acabou de escrever. Não lida: +1, só a do cliente. |
| G11 — UM lote `[sem telefone de LID desconhecido, normal com o par]` | 1º item `RETIDA`; 2º entrou normal; a retida foi `RELIGADA` no MESMO webhook, depois de todos os itens (`gravada_em` 42,53 s → 44,18 s), modo `historica`. A espera recuou para o carimbo da retida (mais antiga e sem resposta depois) — a verdade. |
| G12 — UM lote na ordem inversa `[normal com o par, sem telefone MAIS NOVA]` | O par nasceu no 1º item; o 2º foi `RESOLVIDA pelo acervo` dentro do próprio lote, modo `nova`, e virou a última da conversa. |
| Reentrega do lote do G11 (mesmos ids e carimbos) | 200; nenhuma mensagem a mais, nenhuma não lida a mais, nenhuma linha do módulo no log — a duplicata sai calada. |

Limpeza por id exato (6 mensagens + 3 linhas do registro) e a conversa de volta
ao retrato, inclusive o `last_message_at` exato (o retrato guardava o relógio do
app, `…27.885`; derivado do `created_at` da mensagem sairia `…27.832`). Nenhum
vestígio dos LIDs fictícios. ⚠️ Efeito colateral aceito das simulações pelo
caminho NORMAL: a fronteira de entrega da 1002 da conexão de teste avançou para
o carimbo da simulação (atraso de segundos, "em dia"); ela só avança, e a próxima
mensagem real a leva adiante.

**O que NÃO dá para testar de ponta a ponta, e por quê** (coberto por teste de
unidade, de rota e pelos cenários no Postgres local):

- A ocorrência REAL — depende de uma falha de decifragem na Baileys.
- O download do anexo de uma recuperada: a mensagem fictícia não existe na
  Evolution, e pedir a mídia faria a Evolution de PRODUÇÃO tentar baixar de uma
  URL falsa e pedir re-upload ao celular de um id que não existe.
- A conexão apagada (`channelId: null`) — exigiria apagar uma conexão real.
- Dois processos Node ao mesmo tempo (deploy `start-first`) e a morte do
  processo no meio do `after()`.
- O webhook de PRODUÇÃO com mensagem simulada — não autorizado.

### 6.9 Revisão final por duas lentes, DEPOIS do merge (20/09/2026) — nenhum P0 nem P1

Dois revisores independentes, só leitura, sobre o PR inteiro
(`631d064..5a61ed6`, 34 arquivos). Cada achado abaixo foi conferido no código
antes de entrar aqui. ⚠️ Nada foi mudado no código por causa desta revisão: a
correção já está em produção, e qualquer conserto é PR novo, com decisão do
operador (merge = deploy).

**Lente A — "não quebrar o que funcionava": nada acima de P3.** As provas que
ela rodou: `git diff -w` e `-b` da rota dão os mesmos 176 sinais (o corpo da fase
de anexos mudou só de indentação); `normalizeUpsert` de antes × de depois
comparados em **29.703 combinações** de chave, `fromMe`, corpo, carimbo, canal e
`pushName` — sem a opção, com `{}` e com `{telefoneResolvido: null}` —, **zero
diferenças**; 18 arquivos / 262 testes verdes em Node 22; diff VAZIO em
`inbound-store.ts`, `send-message.ts`, recibos, grupos, conexões, foto de perfil,
reabertura, caixa de entrada, robôs, automações e IA. O custo por mensagem normal
é o do R14 (uma consulta indexada por LID por lote, depois de todos os itens
gravados) — zero só para conversa que não é endereçada por LID e para a segunda
leva sem `comResto`.

**Lente B — concorrência, falha parcial e integridade: nenhum P0/P1; 2 P2 de
borda e notas.** Idempotência, duas religações do mesmo LID, a corrida do modo,
todos os ramos do SQL da 1011 (com as concessões), o laço do resto, as cercas do
resolvedor de LID e a privacidade do payload: nada encontrado além do que segue.

| # | Achado | Gravidade | Situação |
|---|---|---|---|
| B-A2 | **"Alguém escreveu depois" conta MÁQUINA.** A consulta da última mensagem (`entregar.ts`) não olha quem escreveu: se depois da fala do cliente só saiu mensagem de robô, disparo ou automação, o modo é `historica` — e, com a conversa ENCERRADA, a fala entra sem reabrir (visível só na aba Encerradas, com a não lida somada). O argumento da histórica ("reabrir desfaria um encerramento decidido com informação mais nova") não vale quando depois dela só falou máquina. Variante: quem respondeu depois foi uma pessoa PELO CRM (não pelo celular) — a não lida não é somada, e a premissa "quem respondeu viu a mensagem" só vale para resposta pelo celular. | P2, borda | Não é regressão (antes a mensagem era descartada). **Inalcançável hoje nesta conta** (medido em 20/09): nenhuma máquina escreve em conversa de cliente — a única automação ativa só tem `send_to_number` para o advogado, não há robô, a IA está desligada e a régua do Asaas também. Passa a ser alcançável com as sequências planejadas e com a régua ligada. Refino proposto: decidir `tardia` × `historica` pela última mensagem do CLIENTE ou de GENTE, mantendo `nova` pela última de TODAS (o robô não pode ler a fala antiga depois da própria mensagem). **Decisão do operador.** |
| B-A1 | **A religação apaga o payload ANTES de o anexo ser baixado.** `marcarEntregue` grava `payload: null` e só depois o anexo entra na fila; se o download falha (Evolution fora, Storage, deploy no meio), a bolha fica "indisponível" — o mesmo destino do anexo NORMAL que falha, mas aqui existia uma cópia durável das chaves da mídia e ela foi descartada cedo. | P2, borda | Raro × raro (retida com mídia × download que falha). A recuperação manual continua possível pelo banco da Evolution (~30 dias), como em qualquer anexo perdido. Conserto possível: manter o payload da retida COM mídia até o download terminar — pede migration (o CHECK `retida = payload`). **Decisão do operador.** |
| A-7 / B-A3 | **Rota de transição** (`whatsapp_config`, `route.channelId` nulo): o anexo da recuperada é sempre pulado, porque o nulo é lido como "conexão apagada"; a mensagem normal da mesma instalação baixa pelo canal padrão. | P3 | Inalcançável aqui (as 4 conexões estão em `cb_channels`). Importa para o produto instalado por terceiros. |
| B-A4 | A fila por LID não tem contador de tentativas nem expiração: a retida que falha SEMPRE é tentada a cada mensagem daquele LID; com 10 ou mais presas na cabeça, a cauda nunca é lida. | P3 | Exige insert que falhe de forma determinística — `normalizeUpsert` não devolve nulo para item retido. |
| B-A5 | Falha parcial: insert certo + `marcarEntregue` falho → o Meu dia acusa "retida" sobre conversa completa por até 7 dias, e a religação seguinte carimba `duplicada`; insert certo + processo morto antes da função → o efeito do gatilho da 972 fica sem acerto para aquela mensagem. Nenhuma mensagem se perde. | P3 | A família já aceita (morte do processo). |
| B-A6 | `jaGravada` não filtra por conta (defeito de base ANTIGO da rota); na religação um "já existe" leva a `marcarDuplicada`, que apaga o payload. | P3 | Só em instalação com duas contas trocando mensagem entre si. |
| A-1 | O eco do aparelho SEM telefone paga os 2 s do `jaGravada(id, true)` dentro do laço dos itens: os itens seguintes do MESMO lote esperam. | P3 | Só lote com mais de um item e eco sem telefone. |
| A-2 | `ehJidDeTelefone` usa `endsWith`: aceitaria `…@lid@s.whatsapp.net`. | P3 | As duas fontes reais não produzem essa forma. Endurecimento barato (regex estrita). |
| A-5 | `retidas.itens` da rota do Meu dia não passa pelo recorte de conexões do perfil: pela aba Network, um membro restrito vê conexão e hora de retida fora do escopo dele (na tela o bloco é só de admin). | P3 | Sem conteúdo, telefone nem LID. Endurecimento: devolver os itens só a admin. |

Duas suspeitas NÃO confirmadas, registradas para quem voltar aqui: dois ecos
retidos, ambos anteriores à espera ativa, entregues por dois religadores ao mesmo
tempo (a espera verdadeira se perderia — a janela praticamente não abre); e
`historica`/`tardia` gravarem na conversa onde o par foi visto enquanto a `nova`
grava pela conversa do telefone (divergem se alguém editou o telefone da ficha
para o número de outra pessoa).

O que só se garante MEDINDO, e continua sem medição possível: a função SQL contra
o gatilho da 972 (há pino de texto + os 20 cenários no Postgres local; se alguém
mudar o gatilho, a comparação `c.aguardando_desde = p_carimbo` quebra em
silêncio) e o download do anexo de uma retida contra a Evolution real.

### 6.10 Codex, rodada no commit do MERGE (`545af27`) — 1 P2 aceito por escrito

(Não confundir com a "5ª rodada no preview" da 6.8: esta é do Codex.) O "@codex
review" pedido às 21:57 BRT de 19/09 foi respondido às 22:02, já sobre o commit
do merge (`545af27`, o merge das 21:56). O achado ficou sem resposta e fora deste
plano até a auditoria de 22/09/2026 — a linha "Codex no HEAD final" do checklist
fala do HEAD do PR, e esta rodada veio depois dele.

**P2 — "reconferir a resposta de gente antes de somar a não lida".** Em
`historica.ts`, `contaNaoLida` sai de `genteRespondeuDepois()` (uma ida ao banco)
ANTES de `cb_assentar_mensagem_historica`. Dentro da função, só
`aguardando_desde` reconfere a resposta de gente; `unread_count` soma o
`p_conta_nao_lida` como veio. Resposta de gente (CRM ou celular pareado) gravada
no vão entre as duas chamadas deixa +1 de não lida sobre fala já respondida.

**O que é verdade:** tudo acima, e vale para os DOIS modos que passam por
`gravarHistorica` — `historica` e `tardia` (`entregar.ts`). `historica` é também
o desfecho normal de toda retida RELIGADA: quando ela entra, a mensagem que
trouxe o telefone já está gravada.

**Por que fica aceito, sem mudar código:**

- o estado que sobra é o MESMO que o caminho normal deixa depois de TODA
  resposta pelo celular pareado, por onde sai quase toda resposta do escritório:
  responder não zera a não lida em lugar nenhum; no app, só abrir a conversa
  zera (`message-thread.tsx`; fora dele, o encerramento em lote da 1018,
  rodado à mão). A corrida não cria um estado novo;
- a janela é de UMA ida ao banco;
- medido em 22/09/2026: desde o deploy, `cb_mensagens_sem_telefone` tem UMA
  linha — um documento de cliente resolvido pelo acervo no instante da chegada,
  como `nova` (a última da conversa, menos de 5 s depois do carimbo). Nem
  `historica` nem `tardia` rodaram em produção, e nenhuma retida foi religada;
- nenhuma mensagem se perde e nenhum motor roda;
- fechar de vez pede a pergunta "gente respondeu depois?" DENTRO da função, no
  mesmo UPDATE, ou seja, migration nova para trocar o corpo da 1011.

Se os dois modos começarem a aparecer, a migration entra. A medida é o log da
rota (`"modo":"historica"` ou `"modo":"tardia"`, em JSON), ou, pelo banco, a
recuperada (`message_id` da tabela) que NÃO entrou como `nova`: a que tem na
mesma conversa outra mensagem de carimbo IGUAL OU mais novo gravada antes dela
(empate é história; `messages.gravada_em`, 1003), ou a gravada mais de 4 min
depois do próprio carimbo.

## 7. Ordem de entrada e volta atrás

1. PR aberto, CI verde (inclui o replay das migrations em banco vazio), revisão
   do Codex no HEAD final.
2. **Operador autoriza** → aplicar a 1010 (aditiva; nada em produção a lê).
3. **Operador autoriza** → merge → deploy automático.
4. Conferir: `DESCARTADA` deixa de aparecer no log; a primeira ocorrência real
   vira linha em `cb_mensagens_sem_telefone`.

Volta atrás: reverter o merge (o deploy refaz a imagem anterior). A migration
fica — tabela e função sem leitor não fazem nada. ⚠️ Se houver linha `retida` na
tabela no momento da volta, o payload dela fica lá sem código nenhum para
entregá-lo ou apagá-lo: conferir `cb_mensagens_sem_telefone` antes de reverter, e
entregar ou apagar à mão (revisão final, 6.9).

Opcional, depois: recuperar a fala do lead de 18/09 (o payload está no banco da
Evolution) — escrita em produção, só com autorização.

## 8. Checklist

- [x] Investigação e causa raiz (19/09)
- [x] Decisão do operador: Fases 1 e 2
- [x] Análise de risco e matriz de testes (este documento)
- [x] Fase 1 — código + testes
- [x] Migration 1010 + teste em Postgres local
- [x] Fase 2 — reter, religar, Meu dia + testes
- [x] ~~Fio em tempo real na ordem do carimbo~~ — revertido na revisão (4.3): o fio aberto continua acrescentando no fim
- [x] Portões (T17)
- [x] PR #226 aberto; CI verde no 1º push (replay da migration incluso)
- [x] Revisão por duas lentes — nenhum P1; achados tratados (6.2)
- [x] T18, parte 1 — preview contra a produção ANTES da 1010 (6.1)
- [x] 1010 aplicada em produção em 19/09/2026 20:47 BRT (histórico `20260919234759`), autorizada pelo operador, DEPOIS do CI verde; conferida no catálogo
- [x] T18, parte 2 — reter, religar, tardia e Meu dia no preview (6.3) + limpeza conferida
- [x] Codex, 1ª rodada (HEAD `50748ba`): 1 P2, corrigido na migration 1011 (6.4)
- [x] 1011 aplicada em produção em 19/09/2026 21:08 BRT (histórico `20260920000843`), depois do CI verde; eco do escritório testado no preview e limpo
- [x] Codex, 2ª rodada (HEAD `3ebab6a`): P1 corrigido (religação fora do laço), P2 aceito por escrito (6.5)
- [x] Codex, 3ª rodada (HEAD `7ebc9fe`): 2 P2 corrigidos — empate de carimbo é história; o resto das retidas é drenado depois dos anexos do lote (6.6); preview contra a produção refeito e limpo
- [x] Codex, 4ª rodada (HEAD `5a61ed6`): nenhum P1; 1 P2 aceito por escrito — o vão entre o insert do par e a anotação da religação (6.7)
- [x] Codex no HEAD final (`5a61ed6`) — é a 4ª rodada (6.7)
- [x] Merge em 19/09/2026 21:56 BRT — ⚠️ feito por `devgabrielslv` SEM autorização do operador (6.8); deploy convergiu às 22:01:37 BRT
- [x] Conferência pós-deploy por dado: caminho normal são (9 mensagens reais, atraso ≤ 7 s); nenhuma ocorrência real ainda (6.8)
- [x] 5ª rodada no preview: eco retido, os dois lotes mistos e a reentrega, com limpeza conferida (6.8)
- [x] Revisão final por duas lentes — nenhum P0/P1; 2 P2 de borda e notas, com decisão do operador (6.9)
- [x] Codex, rodada no commit do MERGE (`545af27`, depois do merge): 1 P2 — a não lida das recuperadas `historica`/`tardia` decidida antes da função —, aceito por escrito em 22/09/2026 (6.10)
- [x] A primeira ocorrência real virou linha em `cb_mensagens_sem_telefone`: um documento de cliente em 21/09/2026 12:39 BRT, resolvido pelo acervo como `nova` (medido em 22/09)
- [ ] Conferência no log da VPS: `DESCARTADA` deixa de aparecer
- [ ] Decisões do operador: refino B-A2 (máquina não conta como "alguém escreveu depois"), B-A1 (payload da mídia até o download), os três endurecimentos P3, prazo de expiração do payload de retida, recuperação da fala de 18/09
