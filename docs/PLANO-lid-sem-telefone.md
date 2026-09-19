# Plano — mensagem em `@lid` sem telefone (Fases 1 e 2)

Documento INTERNO e vivo. Atualizar a cada fase concluída.

| | |
| --- | --- |
| **Estado** | PR #226 aberto (branch `fix/lid-sem-telefone`). Revisado por duas lentes (6.2) e testado no preview contra a produção (6.1 e 6.3). Em produção: só a migration 1010 (aditiva, sem leitor até o deploy). |
| **Decisão do operador (19/09/2026)** | Fazer as Fases 1 e 2; a Fase 3 (patch na imagem da Evolution) fica de fora. "Não quero quebrar o que está funcionando" — cautela é requisito. |
| **Migration** | `1010_cb_mensagens_sem_telefone.sql` — aditiva. **Aplicada em 19/09/2026** (histórico `20260919234759`), antes do merge. |

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
| **nova** | a mensagem é a MAIS RECENTE da conversa **e** tem até 4 min | passa pelo caminho normal (`persistInboundMessage`/`persistDeviceMessage`), sem mudar uma linha dele — motores inclusive |
| **tardia** | é a MAIS RECENTE da conversa, mas tem mais de 4 min (a cópia depende de o celular pareado estar acordado) | entra como história — **nenhum motor** — e a CONVERSA passa a refleti-la: reabre se estava encerrada (sem responsável), prévia canônica e `last_message_at` (`tardia.ts`) |
| **histórica** | alguém já escreveu depois dela | só ENTRA no histórico, no lugar certo do fio. **Nenhum motor** (automação, robô, IA), não reabre, não segue canal, não mede atraso de entrega, não abre negócio, e a conversa não se mexe |

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
| R14 | Carga no banco | baixa | Uma consulta indexada (índice parcial `situacao='retida'`) por mensagem 1:1, com teto de 50 retidas por vez. A resolução do LID só roda no caso raro — medido em produção: ~5 ms (varredura de 14,4 mil linhas em cache; sem índice em `messages.remote_jid_lid`, de propósito). |
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
- cópia histórica que chega ANTES da cópia normal da mesma mensagem ganha o
  `UNIQUE`, e a normal é pulada sem rodar motor (exige: cópia sem telefone ×
  chegar primeiro × alguém ter escrito depois dela em segundos);
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
| `retidasDoLid` sem teto; log do insert com o `details` (texto do cliente) | `limit(50)`; log só com código e mensagem |
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

## 7. Ordem de entrada e volta atrás

1. PR aberto, CI verde (inclui o replay das migrations em banco vazio), revisão
   do Codex no HEAD final.
2. **Operador autoriza** → aplicar a 1010 (aditiva; nada em produção a lê).
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
- [ ] Codex no HEAD final
- [ ] Merge (autorização) + conferência pós-deploy
