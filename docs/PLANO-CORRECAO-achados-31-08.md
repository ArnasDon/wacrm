# Plano de correção — os 32 achados da revisão dos PRs de 31/08/2026

> **O que é este arquivo.** Guia retomável e **VIVO** das correções dos achados
> da revisão de código dos 11 PRs mesclados em 31/08/2026 (#73–#83). Ele é
> editado a cada frente concluída: registra-se aqui o que foi feito, o
> resultado MEDIDO e o PR, para que qualquer agente (ou uma sessão nova, com
> outro modelo) pegue o plano e saiba exatamente o que falta, onde está e por
> quê.
>
> ⚠️ **Este documento envelhece.** Antes de decidir com base em algo aqui,
> confirme contra a realidade (grep, leitura do arquivo, query no banco). Ao
> achar divergência, corrija este arquivo no mesmo PR. **Nota mentindo é pior
> que ausência de nota.**

- **Criado:** 2026-08-31
- **Medido contra:** `origin/main` @ `b9ceca8` (merge do PR #83 — os 11 PRs do dia já dentro)
- **Projeto Supabase:** `hxnhakmyxyhalbsktzwe`
- **Fluxo por frente:** executar → `npm run typecheck` / `lint` / `test` /
  `node scripts/i18n-parity.mjs` / `node scripts/i18n-chaves-usadas.mjs` →
  **testar no preview em 1440×900+** → revisar 2× → PR para o CB-CRM →
  **atualizar ESTE arquivo antes da frente seguinte**.

---

## 0. Como ler este arquivo (leia antes de tudo)

### 0.1 Procedência dos achados

Revisão em profundidade máxima dos 11 PRs abertos e mesclados em 31/08/2026,
rodada em 31/08/2026. Método: ~90 ângulos de busca independentes (varredura
linha a linha, auditoria de comportamento removido, rastreamento entre
arquivos, armadilhas de linguagem/framework, invariantes de produto do
CLAUDE.md, reuso, simplificação, eficiência, altitude e convenções), seguidos
de verificação **adversarial** (agentes instruídos a REFUTAR cada candidato de
ângulo único) sobre uma worktree de `origin/main` com os 11 PRs já mesclados.

**Os 32 achados abaixo já passaram por esse filtro.** A convergência vai de 1 a
6 ângulos independentes (o topo é 6, empatado entre #08 e #16); os de ângulo
único foram verificados um a um. Quatro candidatos foram **REFUTADOS** e estão
na §5 — não os reporte de novo.

**Os dois vereditos:**
- **CONFIRMADO** — o verificador nomeou entrada/estado concretos que produzem a
  saída errada, e citou a linha. Pode corrigir direto.
- **PLAUSÍVEL** (só **#27** e **#28**) — o mecanismo é real e está no código,
  mas o gatilho depende de timing/ambiente que a revisão não conseguiu medir.
  **Meça antes de abrir o PR**; se a medição refutar, registre ⏭️ com o motivo
  em vez de apagar o item.

### 0.2 Âncoras de linha — conferidas

Todos os `arquivo:linha` deste documento foram conferidos contra
`origin/main` @ `b9ceca8` em 31/08/2026, com o conteúdo real da linha
transcrito em cada achado no campo **Evidência**. Se você chegou aqui depois
de novos merges, **confira a evidência antes do número**: o texto da linha é
estável, o número não.

Para reproduzir exatamente o estado revisado:

```bash
git worktree add --detach /tmp/cb-revisao b9ceca8
```

### 0.3 ⚠️ Estado do repositório quando a revisão terminou

Havia uma leva de correções **NÃO COMMITADA** na branch
`fix/achados-do-codex-31-08` (achados do Codex nos PRs #78, #80 e #81). Tudo
que ela já corrigia foi **descartado** da revisão e não está aqui. O que ela
continha:

| Arquivo | O que a leva pendente corrigia |
| --- | --- |
| `messages/{en,pt-BR}.json` | chave `sessionExpiredBlocked` |
| `src/app/(dashboard)/inbox/page.tsx` | cancelar `conversaRecemAbertaRef` no clique explícito e no "voltar" |
| `src/app/api/v1/contacts/[id]/custom-fields/route.ts` | remove `.order('posicao')` da lista PLANA (contrato alfabético com o n8n) |
| `src/components/automations/automation-builder.tsx` | idem (lista plana) |
| `src/components/broadcasts/step{2,3}-*.tsx` | idem (lista plana) |
| `src/components/contacts/custom-fields-manager.tsx` | vazio do catálogo por `fields.length === 0 && grupos.length === 0` |
| `src/components/inbox/message-thread.tsx` | `janelaExpiradaRef` — portão da janela de 24h no instante do disparo |
| `src/lib/contacts/grupos-de-campos.{ts,test.ts}` | bloco Geral vazio FICA no catálogo (destino de volta do seletor) |

**Antes de começar qualquer frente, confira se essa leva já foi commitada e
mesclada** (`git log --oneline origin/main | head -20`). Se ainda não foi, ela
tem prioridade sobre este plano. Quem tem **sobreposição de ARQUIVO** com ela
é o **#02** e o **#31** (os dois em `custom-fields-manager.tsx`) — rebase antes
de tocar nesses dois. O **#03** é vizinhança de branch, não de arquivo: vive em
`campo-personalizado-input.tsx`, mas fica no mesmo caminho de gravação, então
convém ir junto.

> **Estado conferido em 31/08 (início da execução):** a leva virou o
> **PR #84**, ABERTO (2 commits, `619ca8a` + `3a724c6` — o segundo estende o
> portão da janela de 24h à interativa, cobrindo o M13). Aguarda mesclagem
> pelo operador. O #02 foi implementado no PR #86 **sem tocar a linha que o
> #84 reescreve** (o ramo de erro entrou ACIMA da linha do vazio), então os
> dois mesclam limpos em qualquer ordem — mas mesclar o #84 primeiro continua
> sendo a ordem certa.

### 0.4 Os 11 PRs revisados

Todos mesclados em `main` em 31/08/2026 e **em produção**. A coluna "achados"
diz quantos dos 32 saíram de cada um.

| PR | Título | Tamanho | Achados |
| --- | --- | --- | --- |
| #73 | feat(inbox): filtro de etapa em dois níveis (funil → etapa) | +547/-122 | 2 (#25 #26) |
| #74 | fix: os 15 achados da revisão profunda das 48h (#43–#72) | +1272/-251 | 6 (#01 #05 #15 #21 #30 #32) |
| #75 | fix: a fila da revisão 48h — os itens reais e visíveis | +390/-68 | 2 (#07 #27) |
| #76 | fix(radar,acervo): fecha as 3 decisões de produto e o custo das miniaturas | +710/-40 | 3 (#22 #23 #28) |
| #77 | ci: Node do CI = Node de produção, e o rollout ganha segunda tentativa | +75/-14 | 1 (#29) |
| #78 | feat(campos): blocos de campos personalizados, com menu horizontal na ficha | +2097/-459 | 2 (#02 #31) |
| #79 | feat(inbox,funil): iniciar conversa pelo CRM e negócio também na saída | +898/-57 | 3 (#04 #08 #14) |
| #80 | fix(inbox): dono durável do contato e seleção sem corrida (achados do #79) | +127/-6 | 3 (#11 #12 #13) |
| #81 | fix(inbox): canal ainda carregando não é "janela da Meta expirada" | +42/-3 | 1 (#06) |
| #82 | chore(i18n): os dois checadores de tradução viram portão no CI | +295/-30 | 4 (#18 #19 #20 #24) |
| #83 | feat(inbox,campos): filtros salvos com padrão por pessoa + campo que salva sozinho | +3459/-253 | 5 (#03 #09 #10 #16 #17) |

Para reler qualquer diff: `gh pr diff <N> --patch`. Os arquivos que a revisão
usou viviam num scratchpad de sessão (efêmero) e não devem ser procurados.

⚠️ **Note o padrão:** #74, #75, #76 e #80 são eles próprios PRs de CORREÇÃO, e
juntos produziram **14 dos 32** achados (6+2+3+3). Contando o #81, que também é
um `fix:`, são 15. Ver §8.1.

### 0.5 Convenções obrigatórias (do CLAUDE.md) que estas correções tocam

- Branch nova SEMPRE a partir de `main` atualizado; PR só para o CB-CRM.
- Migration nossa na faixa `900+` com prefixo `cb_`; conferir `ls supabase/migrations/`
  **e** `list_migrations` imediatamente antes de escolher o número (já houve
  três colisões: 906, 963, 966).
- Migration tem de aplicar em banco **VAZIO**: todo `REVOKE` com o `GRANT` de
  volta; nenhuma conferência que exija dado presente.
- Chave nova de i18n entra nos **DOIS** dicionários na mesma passada (o
  fallback do next-intl é por ARQUIVO).
- `git push origin main` **DISPARA DEPLOY DE PRODUÇÃO**.

---

## 0.6 Decisões do operador (31/08/2026 — fechadas, não reabrir)

Tomadas ao fim da primeira sessão de execução, delegando à recomendação:

- **#12 → opção (a):** resolver o dono da conta NO CLIENTE
  (`accounts.owner_user_id` é legível por RLS ao membro; buscar uma vez e
  cachear junto do contexto de auth) nos dois escritores — `contact-form.tsx`
  e `import-modal.tsx`. Nada de rota nova, nada de trigger.
- **#22 → opção (b):** a régua de 48h da insatisfação na LEITURA passa a
  contar horas ÚTEIS (`horario-comercial.ts` é o único lugar dessa régua).
  Na implementação, avaliar se a régua de ESCRITA (validação do parser)
  precisa de simetria e REGISTRAR o que se decidiu; admitir nas notas que as
  duas réguas se somam. A aba "Todos" NÃO volta, em nenhuma hipótese.
- **#23 → opção (b):** descarte sobre linha `failed` é ACEITO, e o worker
  REABRE (`estado='aberto'`) ao gravar análise BEM-SUCEDIDA quando o
  `estado_em` do descarte for POSTERIOR ao `analisado_em` da tentativa falha
  — o operador descartou uma NÃO-análise. Exceção estreita, escrita ao lado
  das três assimetrias do ciclo de vida no CLAUDE.md.

### Estado de integração (sonda de 01/09, TODAS as frentes entregues)

Ordem de merge (11 branches): `#84 → F1 #86 → F2 #90 → F3 #87 → F7 #88 →
F4 #89 → F6 #91 → F8 #92 → F10 #93 → F11 #94 → docs #85`. Sonda em HEAD
destacado: **mescla limpa de ponta a ponta**, e o estado INTEGRADO passa
174 arquivos / **2304 testes**, typecheck, lint (0 erros) e os dois portões
de i18n. CI verde nos 11 PRs.

⚠️ **Três conflitos reais foram resolvidos DENTRO das branches** para o
operador nunca os ver: `#84 × F1` (render do catálogo), `#84 × F4` (tabela
do CLAUDE.md) e `F2 × F7` (`use-broadcast-sending.ts` — as duas frentes
acrescentaram coisas diferentes na mesma linha do `useAuth()`).

⚠️ **Duas armadilhas de LINT que só o CI pegou** (o `npm run lint` local
imprime a linha "0 errors and 2 warnings potentially fixable" DEPOIS do
resumo real — ler `✖ N problems (E errors, …)`, nunca a última linha):
o React Compiler recusa memo cuja dep saia de um `.find()` não memoizado
("Existing memoization could not be preserved" — F8), e `setState` síncrono
no corpo de um `useEffect` é ERRO, não aviso (F11). As duas foram
corrigidas e o comportamento remedido na tela.

### Estado de integração (sonda de 31/08, fim da sessão 1)

As branches de **F1 (#86)** e **F4 (#89)** contêm o merge do **PR #84** — os
dois conflitos reais (render do catálogo; tabela do CLAUDE.md) foram
resolvidos DENTRO delas para o operador nunca os ver. Sonda de trem em HEAD
destacado: `#84 → F1 → F3 → F7 → F4 → docs` mescla limpa, e o estado
INTEGRADO passa a suíte inteira (171 arquivos / 2278 testes), typecheck,
lint e os dois portões de i18n. ⚠️ O **#07 (F9)** mexe na MESMA rota de
estado do radar que a F4 reescreveu — fazê-lo na branch da F4 (PR #89),
junto com #22/#23, senão nasce o terceiro conflito.

---

## 1. Estado das frentes

Legenda: ⬜ a fazer · 🟨 em andamento · 🔵 **aguardando decisão do operador** ·
✅ concluída · ⏭️ adiada (com motivo)

⚠️ Três achados terminam em decisão de produto, não em código: **#22** (como a
insatisfação deve expirar), **#23** (reabrir descarte sobre análise que falhou)
e **#12** (resolver o dono no cliente ou mover a criação para uma rota). Marque
as frentes deles 🔵 e leve as opções ao operador antes de implementar.

| # | Frente | Achados | Risco | Estado | PR |
| --- | --- | --- | --- | --- | --- |
| **F1** | Vazamento e perda de dado do cliente | #01 #02 #03 #04 | 🔴 crítico | ✅ | #86 |
| **F2** | Dono durável (CASCADE para `auth.users`) | #11 #12 #13 | 🔴 crítico | ✅ (+M1 e um 6º call site achado em implementação) | #90 |
| **F3** | Fila de gravação de campo personalizado | #09 #10 (+#03) | 🟠 alto | ✅ | #87 |
| **F4** | Radar: alarme apagado ou inalcançável | #05 #21 #22 #23 #28 | 🟠 alto | ✅ (#22b e #23b pelas decisões §0.6) | #89 |
| **F5** | Vazio virando afirmação (`useChannels`) | #06 #08 | 🟠 alto | ✅ (+M2, M10, M11, M12, M14) | #95 |
| **F6** | Portão de i18n no CI | #18 #19 #20 #24 | 🟠 alto | ✅ | #91 |
| **F7** | Guardas e testes estruturais com falso verde | #14 #15 | 🟠 alto | ✅ | #88 |
| **F8** | Filtros do inbox | #16 #25 #26 | 🟡 médio | ✅ (+M4 e M5-parcial; a outra metade do M5 foi ENCERRADA por medição — ver §6) | #92 |
| **F9** | Erro de banco lido como ausência | #04 #07 | 🟡 médio | ✅ (#04 no PR #86; #07 no PR #89, mesma branch da F4) | #86/#89 |
| **F10** | CI/CD e vazamento de credencial | #29 #30 | 🟡 médio | ✅ | #93 |
| **F11** | Menores de UX e estado | #17 #27 #31 #32 | 🟢 baixo | ✅ (+M7; o M6 ficou fora aqui, com motivo, e foi resolvido depois no #103) | #94 |

**Ordem recomendada:** F1 → F2 → F3 → F5 → F7 → F4 → F6 → F9 → F8 → F10 → F11.

Racional: F1 e F2 perdem ou vazam dado de cliente (escritório de advocacia —
sigilo e histórico são o produto). F3 vem em seguida porque #03 mora no mesmo
caminho de gravação e o conserto é mais barato feito junto. F5 e F7 são
baratos e removem duas classes inteiras de erro futuro.

Sobre a F6 vir só em sétimo, apesar de ser um portão de CI: os falsos vermelhos
de #18/#19/#20 exigem código NOVO de forma específica (um `twMerge` em arquivo
sem binding, um segundo `const t` com outro namespace, uma chave aninhada em
arquivo folha). Nenhuma das frentes anteriores escreve código assim, então na
prática elas passam. **Se alguma travar no portão, promova a F6 na hora** — é o
sinal de que o falso vermelho saiu do hipotético.

---

## 2. Os achados

---

## F1 — Vazamento e perda de dado do cliente

### #01 — Nota de voz aterrissa na conversa do cliente ERRADO

- **Arquivo:** `src/components/inbox/message-composer.tsx:1037` (função `finalizeRecording`)
- **PR de origem:** #74 · **Categoria:** correctness · **Veredito:** CONFIRMADO (2 ângulos)
- **Evidência:** `const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);`
  seguido direto de `removeStaged(draftRef.current?.path);` e `setDraft({ kind: "audio", ... })`.
  O `useCallback` fecha em `[removeStaged]` — **não** em `conversationId`.

**O problema.** O PR #74 consertou a corrida de troca de conversa em DOIS dos
TRÊS caminhos de upload do compositor: `stageUpload` (anexo pelo clipe) e
`escolherDoAcervo`. O terceiro, `finalizeRecording` (gravação de voz), ficou
sem a guarda. O compositor **não remonta** na troca de conversa — isso está
declarado no próprio arquivo — então tudo que estiver em voo quando o operador
clica em outro cliente aterrissa no cliente novo.

A guarda que existe nos outros dois, para copiar (linhas ~938 e ~946):

```ts
const origem = conversationId;
setBusy(true);
try {
  const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
  // ⚠️ Subir um arquivo leva segundos e o compositor NÃO remonta na
  // troca de conversa: sem esta conferência o anexo aterrissa no
  // rascunho do cliente que estiver aberto quando o upload termina.
  // O objeto recém-subido não serve a ninguém — apaga junto.
  if (conversaAnteriorRef.current !== origem) {
    removeStaged(path);
    return;
  }
  removeStaged(draftRef.current?.path);
  setDraft({ ... });
```

**Como reproduzir.**
1. Abrir a conversa do cliente A. Gravar uma nota de voz de ~40 s (arquivo de
   alguns MB, para o upload demorar).
2. Soltar o botão de gravar — o `uploadAccountMedia` começa.
3. **Antes de o upload terminar**, clicar na conversa do cliente B na lista.
4. Observar: (a) o anexo que B tinha em rascunho é APAGADO do bucket por
   `removeStaged(draftRef.current?.path)`; (b) o rascunho de áudio com a fala
   sobre o caso de A aparece montado na conversa de B, pronto para enviar.
5. Um clique em Enviar entrega áudio sigiloso de um cliente a outro.

Para forçar a janela sem rede lenta: throttling de rede no DevTools, ou um
`await new Promise(r => setTimeout(r, 5000))` temporário antes do `setDraft`.

**Como corrigir.**
1. Capturar `const origem = conversationId;` antes do `setBusy(true)`.
2. Depois do `await uploadAccountMedia`, inserir o mesmo bloco
   `if (conversaAnteriorRef.current !== origem) { removeStaged(path); return; }`.
3. Acrescentar `conversationId` às dependências do `useCallback` (hoje é só
   `[removeStaged]`).
4. **Considerar a altitude:** três cópias da mesma guarda no mesmo arquivo é o
   sinal de que ela deveria ser um helper — por exemplo
   `const subirParaEstaConversa = useCallback(async (file, kind) => {...})`
   que os três chamem. Se optar pelo helper, ele é a correção; se optar pela
   terceira cópia, deixe escrito no comentário que são três e que a próxima
   entra também.

⚠️ **A guarda proposta NÃO cobre "trocar de conversa DURANTE a gravação".**
O efeito de troca (`message-composer.tsx:684-695`) atualiza
`conversaAnteriorRef.current = conversationId` imediatamente e **não
interrompe uma gravação em curso**. Trocando de conversa enquanto ainda grava,
o `finalizeRecording` roda depois com o closure já atualizado —
`origem === conversationId === conversaAnteriorRef.current` — a guarda PASSA, e
a nota sobre o caso de A pousa em B assim mesmo. O roteiro de reprodução acima
contorna isso de propósito (manda soltar o botão ANTES de trocar). **Feche os
dois:** ou interrompendo/descartando a gravação no efeito de troca, ou
capturando `origem` no INÍCIO da gravação em vez de no `finalizeRecording`.

⚠️ **Não feche este PR sem olhar o M22 da §6**: o efeito de troca de conversa
não limpa o `draft` já pousado, então o anexo do cliente A segue montado no
compositor de B mesmo sem upload em voo. É o mesmo dano por outro caminho, e
mais fácil de disparar.

**Armadilhas.** Não aborte antes de `removeStaged(path)` — o objeto
recém-subido fica órfão no bucket. E não confunda `path` (o recém-subido, que
deve ser apagado no ramo de descarte) com `draftRef.current?.path` (o rascunho
antigo do destino, que só deve ser apagado no ramo de sucesso).

**Resolvido em** PR #86 — `finalizeRecording` ganhou a guarda de origem dos
irmãos (3ª cópia comentada, com o aviso de que a próxima entra também); o
efeito de troca passou a cancelar gravação em curso (`cancelledRef` +
`clearTimer` + `stop()`, a receita da limpeza de desmonte) — fecha também a
janela "parou de gravar e trocou antes de o encoder devolver" — e a descartar
o rascunho já pousado (M22). · **Medido (E2E no preview, após o login do
operador):** anexo injetado no compositor da conversa A (fixture), rascunho
pousado (preview + legenda na tela), troca de conversa por clique → o
compositor de B abriu LIMPO e o `DELETE` ao Storage foi capturado no fetch
instrumentado — e a listagem do bucket confirmou o objeto REMOVIDO de
verdade. A gravação de VOZ em si não é acionável no Browser pane (sem
microfone); a guarda dela é byte a byte a do `stageUpload` (código já em
produção) e o cancelamento na troca é a receita da limpeza de desmonte.
Fixtures criadas e apagadas ao fim; typecheck/lint/suíte (2255) verdes.

⚠️ **Correção do parágrafo "A guarda proposta NÃO cobre…" (Codex na revisão
do PR #85, 01/09):** a alegação de que `finalizeRecording` rodaria "com o
closure já atualizado" é FALSA. `startRecording` atribui
`recorder.ondataavailable` UMA vez, e esse handler segura o
`finalizeRecording` do render em que a gravação começou — um render
posterior cria callback novo, mas não troca o handler do gravador. Com a
guarda de origem e `conversationId` nas dependências, uma gravação iniciada
em A captura A, compara com `conversaAnteriorRef.current === B` e é
DESCARTADA. O cancelamento da gravação na troca (feito no PR #86) continua
valendo por outros dois motivos — ninguém deve seguir gravando dentro do
compositor de B uma fala já condenada, e o upload dela seria pago para ser
jogado fora —, e o comentário do compositor foi reescrito com o motivo
certo no PR desta correção.

---

### #02 — Falha ao ler blocos + um arrastar zera `grupo_id` da conta inteira

- **Arquivo:** `src/components/contacts/custom-fields-manager.tsx:169` (`fetchFields`)
- **PR de origem:** #78 · **Categoria:** correctness · **Veredito:** CONFIRMADO (3 ângulos)
- **Evidência:** `setGrupos((gruposRes.data as GrupoDeCampos[] | null) ?? []);`
  — sem checar `gruposRes.error`. Idem `setFields(... ?? [])` na linha 168.

**O problema.** O catálogo (Configurações → Campos e etiquetas) é a **única
tela que ESCREVE** blocos, e é a única que trata falha de consulta como lista
vazia. As duas telas de LEITURA fazem o oposto, de propósito:
`contact-detail-view.tsx:277` e `src/components/inbox/painel/painel-do-contato.tsx:475` usam
`if (gruposRes.data) setGrupos(...)`, preservando o estado anterior na falha.

Quando `grupos` fica `[]`, `agruparCampos` joga TODOS os campos no bloco
"Geral" (é o fallback de exibição, correto e documentado: "grupo desconhecido
cai no Geral"). A tela fica indistinguível de uma conta sem blocos. Aí
qualquer arrastar chama `reordenarCampos`, que monta o payload com
`posicoesDoBloco(bloco.campos, bloco.grupo?.id ?? null)` para TODOS os blocos —
ou seja, `grupo_id: null` para todo campo da conta — e a RPC grava.

**Como reproduzir.**
1. Conta com pelo menos 2 blocos e ~15 campos distribuídos.
2. Fazer a consulta a `cb_grupos_de_campos` falhar: DevTools → Network →
   bloquear a URL do PostgREST para essa tabela, ou desligar a rede no
   instante da carga do painel (a de `custom_fields` precisa passar).
3. A tela pinta todos os campos sob um único cabeçalho "Geral".
4. Arrastar QUALQUER campo uma posição.
5. Recarregar: `SELECT grupo_id, count(*) FROM custom_fields GROUP BY 1` —
   todos com `grupo_id IS NULL`. Os blocos continuam existindo, vazios.

**Como corrigir.** Duas camadas, e as duas são necessárias:

1. **Não afirmar sobre carga falha.** Em `fetchFields`, tratar o erro:
   ```ts
   if (camposRes.error || gruposRes.error) {
     toast.error(t('loadError'));      // chave nova nos DOIS dicionários
     setLoading(false);
     return;                            // preserva o estado anterior
   }
   ```
   Isso alinha o catálogo às duas telas de leitura. ⚠️ A **outra metade** do
   mesmo `?? []` é a frase de vazio: o catálogo também afirma "Nenhum campo
   personalizado ainda" sobre consulta falha. Ela **não tem achado próprio
   nesta lista** porque a leva pendente da §0.3 já troca a condição
   (`fields.length === 0 && grupos.length === 0`) — mas aquela troca não olha o
   `error`, então tratar o erro aqui é o que fecha as duas.
2. **Cerca no escritor.** Mesmo com (1), `reordenarCampos` não deveria poder
   mandar um payload que zera a conta inteira a partir de um gesto que moveu
   UM campo. Opções, em ordem de preferência:
   - exigir que o estado esteja "confiável" (um sinalizador `catalogoCarregado`
     que só vira `true` quando as DUAS consultas voltaram OK) e desabilitar o
     `DndContext` e os `<select>` de bloco enquanto for falso;
   - e/ou fazer a RPC recusar um payload que zere `grupo_id` de campos cujo
     `grupo_id` atual é não-nulo quando o payload não menciona nenhum grupo —
     mas isso é regra de negócio no banco, mais caro; prefira a primeira.

**Armadilhas.** O fallback do `agruparCampos` (grupo desconhecido → Geral)
está CERTO e não deve mudar: ele existe para o caso "outro admin apagou o
grupo entre as duas cargas", e o certo ali é o campo APARECER em algum lugar.
O defeito é a tela de escrita persistir esse fallback de exibição. Não
"conserte" o módulo puro.

**Resolvido em** PR #86 — `fetchFields` trata o erro (toast `loadError` +
estado preservado, chaves novas nos dois dicionários) e a cerca
`catalogoConfiavel` (true só com as DUAS consultas OK) faz a lista nem
renderizar sem catálogo confiável (caixa de erro + Tentar de novo — sem
lista não há arrastar nem seletor), com guarda extra nos dois escritores
(`reordenarCampos`/`reordenarGrupos`). O fallback do módulo puro NÃO foi
tocado. O ramo de erro entrou ACIMA da linha do vazio que o PR #84 reescreve
— sem conflito. · **Medido (E2E no preview):** com a consulta de
`cb_grupos_de_campos` respondendo 500 (fetch interceptado), o catálogo
mostrou o toast "Não foi possível carregar os campos e blocos. Nada foi
alterado." e a CAIXA DE ERRO com "Tentar de novo" no lugar da lista — sem
blocos renderizados, sem arrastar, sem seletor, e SEM a frase de vazio.
Falha desligada + "Tentar de novo" → a lista real carregou (bloco GERAL com
os campos e alças). typecheck/lint/suíte/i18n verdes.

---

### #03 — Campo numérico meio digitado APAGA o valor gravado

- **Arquivo:** `src/components/contacts/campo-personalizado-input.tsx:118`
  (ramo `type="number"`), consumido por `campo-com-salvamento.tsx:167` e
  `src/lib/contacts/custom-values.ts:34`
- **PR de origem:** #83 · **Categoria:** correctness · **Veredito:** CONFIRMADO (medido em Chrome real)
- **Evidência:** `onChange={(e) => onChange(e.target.value)}` — sem
  `valueAsNumber`, sem sanitização, sem checar `validity.badInput`.

**O problema.** `<input type="number">` devolve **string vazia** em `.value`
sempre que o conteúdo não é um número válido (estado *bad input* do HTML) —
**enquanto a caixa continua exibindo o texto digitado**. Isso foi medido
servindo uma página com `<input type="number" value="300">` e digitando `.`:
um único evento `input` com `target.value === ""` e `validity.badInput === true`,
com o campo ainda mostrando `300.` na tela.

Antes do PR #83 esse `""` só chegava ao banco se o operador clicasse
"Salvar campos". O #83 trocou o botão por salvamento automático, então agora o
`""` chega **a cada blur e a cada desmonte** — e `salvarValoresDoContato`
traduz string vazia em `DELETE` da linha (`custom-values.ts:34-51`).

**Como reproduzir.**
1. Criar um campo personalizado do tipo **Número** (o `<option value="number">`
   existe em `custom-fields-manager.tsx:628`).
2. Preencher com `300` num cliente e deixar salvar (✓ verde).
3. Clicar no campo e digitar `.` no fim (ou selecionar tudo e digitar `-`).
   A caixa mostra `300.`.
4. Clicar em outro campo (blur).
5. Resultado: a linha de `contact_custom_values` é APAGADA, o ✓ verde "Salvo"
   pisca ao lado do rótulo, e a caixa continua exibindo `300.` — o React não
   reescreve `node.value` porque ele já é `""`.
6. Recarregar a ficha: o campo está vazio.

**Segundo gatilho, sem blur nenhum:** com o campo em bad input, trocar a
pastilha de bloco, fechar o painel no ✕, ou trocar de contato dispara a
descarga de desmonte (`campo-com-salvamento.tsx:131-133`), que enfileira o
`""`. A peça escrita para *não perder digitação* é a que destrói dado gravado.

**Como corrigir.** A correção mínima e localizada é **não deixar bad input
virar "esvaziar"**:

```ts
// campo-personalizado-input.tsx, ramo number
onChange={(e) => {
  // ⚠️ <input type=number> devolve "" em .value no estado *bad input*
  // (`1.`, `-`, `1e`) — a caixa AINDA mostra o texto. Sem esta guarda, o
  // salvamento automático da B1 lê isso como "esvaziar" e o upsert vira
  // DELETE da linha, com o ✓ verde ao lado.
  if (e.target.value === "" && e.target.validity.badInput) return;
  onChange(e.target.value);
}}
```

Alternativas avaliadas e por que são piores:
- trocar para `type="text"` com `inputMode="decimal"`: resolve, mas muda o
  teclado do celular e a validação nativa — decisão de produto, não de bug;
- barrar no `salvarValoresDoContato`: não dá, porque `""` **é** o gesto
  legítimo de esvaziar um campo em todos os outros tipos.

**Armadilhas.**
- Não confunda com o esvaziamento legítimo: apagar o conteúdo de um campo
  numérico com Backspace deixa `value === ""` e `badInput === false` — esse
  caso **deve** continuar apagando a linha.
- Esta correção interage com a leva pendente da branch
  `fix/achados-do-codex-31-08`, que mexe em `custom-fields-manager.tsx` e em
  `grupos-de-campos.ts`. Rebase antes.
- Conferir o mesmo caminho para o tipo **data** (`TIPO_DATA`): `<input
  type="date">` também tem bad input.

**Resolvido em** PR #86 — guarda `value === '' && validity.badInput` nos
ramos number E datetime-local (o tipo data usa `datetime-local`, conferido).
· **Medido em navegador real** (sonda com a guarda idêntica, mesmo método da
medição original): digitar `.` após `300` → evento com `.value === ""` e
`badInput === true`, guarda ignorou, blur gravaria `"300"`; esvaziar de
verdade → propagou `""` e o blur gravaria o DELETE legítimo. O datetime-local
não recebe teclas sintéticas no Browser pane (limitação conhecida), então a
guarda de data fica coberta por construção: só age no estado que é
exatamente o nocivo, e é byte a byte a guarda medida.

---

### #04 — Erro de banco vira "não existe" e duplica a ficha do cliente

> Listado em **F1** (pelo dano: ficha duplicada) e em **F9** (pela causa: erro
> de banco lido como ausência). Corrija junto com o **#07**.

- **Arquivo:** `src/app/api/cb/conversas/abrir/route.ts:199`, com a causa em
  `src/lib/contacts/dedupe.ts:51`
- **PR de origem:** #79 · **Categoria:** correctness · **Veredito:** CONFIRMADO (3 ângulos)
- **Evidência:** `const existente = await findExistingContact(admin, accountId, digitos)`
  consumido cru; em `dedupe.ts:51`, `if (error || !data) return null;`

**O problema.** `findExistingContact` colapsa dois estados diferentes em
`null`: "procurei e não achei" e "não consegui procurar". A rota trata os dois
como "pode criar".

O que torna isso grave aqui é que **o índice único não salva**. Ele é sobre
`(account_id, phone_normalized)` — exato. A busca que `findExistingContact`
faz é por LIKE nos **últimos 8 dígitos**, com tolerância a tronco, justamente
para pegar a variante do nono dígito. Duas variantes têm `phone_normalized`
DIFERENTES, então o INSERT passa limpo e o backstop de `isUniqueViolation`
(23505) nunca dispara.

**Como reproduzir.**
1. Cliente já cadastrado como `551133334444` (sem nono dígito).
2. Abrir o diálogo "Nova conversa" e digitar `5511933334444` (com nono).
3. Fazer o SELECT de `contacts` falhar nesse instante (bloquear a URL no
   DevTools, ou derrubar a rede por 1 s).
4. A rota INSERE um contato novo, cria conversa própria, e o toast diz
   "Conversa aberta" — sucesso aparente.
5. `SELECT id, phone, phone_normalized FROM contacts WHERE phone LIKE '%33334444'`
   devolve duas fichas, cada uma com metade do histórico.

**Como corrigir.** Separar os dois estados. A forma que respeita a regra do
CLAUDE.md ("Erro de banco NÃO é 'não encontrado'. Trate o erro antes do
vazio"):

1. Em `src/lib/contacts/dedupe.ts`, mudar a assinatura para distinguir. Duas
   opções:
   - lançar no erro: `if (error) throw new Error(...)` e manter `null` só para
     "não achei" — **confira os outros chamadores antes**, porque hoje eles
     dependem do `null` mudo;
   - ou devolver `{ contato, falhou }`, deixando cada chamador decidir.
2. Na rota `abrir/route.ts`, no ramo de falha, responder **500
   `LOOKUP_FAILED`** — exatamente como ela já faz para `canalErr` (linha ~121)
   e `contaErr` (linha ~149), esta última com o comentário
   "⚠️ Erro de banco NÃO é 'não encontrado' — a lição da API v1".
3. O diálogo já sabe mostrar erro genérico; conferir se a mensagem orienta a
   tentar de novo em vez de sugerir que o número é inválido.

**Armadilhas.**
- `findExistingContact` tem outros chamadores (`api/v1/contacts.ts`,
  `resolve-conversation.ts`, a ingestão). Mudar a assinatura sem olhar os
  quatro reintroduz o problema em outro lugar — ou pior, faz a INGESTÃO
  estourar, que é caminho de produção com Evolution.
- O item **M15** da §6 é a mesma classe na mesma rota, no `buscar()` de
  `resolverConversa` (linha 236), que descarta o `error` de `conversations`.
  Corrija os dois juntos. (Não confunda com o achado **#27**, que é outro
  assunto — realtime das execuções.)
- Ver também §6: a rota é a 4ª–6ª cópia do find-or-create do projeto. A
  correção de altitude (reusar `resolveConversationByPhone`) resolveria #04 e
  quase todo o M15 de uma vez — inclusive o "reabrir conversa fechada" — mas é
  refactor maior e deve ser decisão consciente, não efeito colateral.

**Resolvido em** PR #86 — `findExistingContact` devolve `{ contato, falhou }`
(opção "cada chamador decide", que era a única compatível com a armadilha de
não estourar a ingestão) e o typecheck forçou os 12 call sites em 6 arquivos:
abrir → 500 `LOOKUP_FAILED` (e o `buscar()` de `resolverConversa` trata o
`error` — a metade do M15 que este achado mandava levar junto); API v1 e
`resolve-conversation` → erro 500; ingestão Meta/Evolution → segue com
`contato` nulo, por escrito; formulário → consultivo, sem mudança.
· **Medido:** teste novo do caminho `falhou` no `dedupe.test.ts` (stub com
`error` → `{contato: null, falhou: true}`); suíte 2255 verde inclusive o
`dono-duravel.test.ts` estrutural; o diálogo já mapeia `LOOKUP_FAILED` para
"Não foi possível abrir a conversa. Tente de novo." (conferido no dicionário
— orienta repetir, não desconfiar do número). **E2E no preview:** criação
com número fixture → toast "Conversa aberta.", conversa selecionada com o
canal fixado; MESMO número de novo → "Este contato já existia — abrindo a
conversa dele", sem segunda ficha — os dois ramos felizes da rota com a
assinatura nova, contra o banco real. Fixtures apagadas ao fim.
⚠️ Observado de carona no teste: o defeito que o **PR #84** corrige
(`conversaRecemAbertaRef` atropelando o clique em outra conversa) é
REPRODUZÍVEL no main — depois de abrir pelo diálogo, clicar noutra conversa
não trocava até recarregar. Mais um motivo para mesclar o #84 logo.

---

## F2 — Dono durável (CASCADE para `auth.users`)

> **A regra.** `contacts.user_id` e `conversations.user_id` são
> `NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`
> (`0001_initial_schema.sql:38` e `:142`), e `conversations.contact_id`
> cascateia de novo (`001:143`). Todo caminho que CRIA contato ou conversa tem de gravar o **dono da
> conta** (`accounts.owner_user_id`), nunca o membro que clicou — senão, no dia
> em que essa pessoa for apagada do `auth.users`, o contato/conversa é apagado
> junto e leva TODAS as mensagens daquele cliente, que são do escritório.
>
> ⚠️ **O gatilho real NÃO é "remover membro" pela UI.** `remove_account_member`
> (018) e `961_cb_remover_membro_limpa_perfil` **não** apagam a linha de
> `auth.users` — realocam o perfil para uma conta pessoal ("keep them whole,
> just relocated"). O que dispara o CASCADE é apagar o usuário **fora do app**:
> dashboard do Supabase ou admin API — isto é, o passo normal de offboarding.
> A nota do CLAUDE.md em torno da linha 1493 culpa "sair da equipe" e está
> ERRADA; corrija-a junto (ver §7).

### #11 — `/api/whatsapp/send` cria conversa com o `user_id` de quem clicou

- **Arquivo:** `src/app/api/whatsapp/send/route.ts:298` (dentro de `findOrCreateConversation`)
- **PR de origem:** #80 · **Categoria:** correctness · **Veredito:** CONFIRMADO (2 ângulos)
- **Evidência:** `user_id: userId,` no `.insert({ account_id: accountId, user_id: userId, contact_id: contactId })`,
  onde `userId` vem de `await requireRole('agent')` na linha 37.

**O problema.** O PR #80 corrigiu o dono durável na rota
`POST /api/cb/conversas/abrir` e escreveu no CLAUDE.md que "todo caminho que
CRIA contato ou conversa grava o dono da conta". A afirmação nasceu falsa: o
caminho `contact_id` de `/api/whatsapp/send` — o "primeiro contato pela ficha",
que o próprio CLAUDE.md lista entre os quatro envios de gente — cria a conversa
com o membro autenticado.

**Como reproduzir.** Não precisa apagar ninguém para ver o defeito:
1. Abrir a ficha de um contato que ainda **não tem conversa**.
2. Mandar a primeira mensagem por ali (o botão da ficha chama
   `/api/whatsapp/send` com `contact_id`).
3. `SELECT user_id FROM conversations WHERE contact_id = '<id>'` — devolve o
   `auth.users.id` do operador, não o `accounts.owner_user_id`.
4. Comparar com uma conversa nascida da ingestão (webhook/Evolution): aquelas
   têm o dono da conta.

Para ver o dano completo (em ambiente de teste, nunca em produção): apagar o
usuário pelo dashboard do Supabase e observar a conversa e as mensagens sumirem.

**Como corrigir.**
1. Na rota, ler o dono da conta antes do insert — o padrão já existe em
   `abrir/route.ts` e em `inbound-store.ts` (`configOwnerUserId`) e em
   `resolve-conversation.ts` (`resolveAuditUserId`):
   ```ts
   const { data: conta, error: contaErr } = await supabase
     .from('accounts').select('owner_user_id').eq('id', accountId).single();
   if (contaErr || !conta?.owner_user_id) return 500 LOOKUP_FAILED;
   const donoDaConta = conta.owner_user_id;
   ```
2. Usar `donoDaConta` no insert de `conversations` (linha 298).
3. **Falhar fechado**: se o dono não resolver, é 500 — não caia para
   `user.id`, que é exatamente a mutação que o achado #13 mostra passar verde
   no teste.

**Armadilhas.** A RLS **permite** gravar o dono da conta: a policy original de
`conversations` era `"Users can manage own conversations" … auth.uid() = user_id`
(`0001_initial_schema.sql:158`), substituída pelas
`conversations_select/insert/update/delete … is_account_member(account_id, …)`
em `0017_account_sharing.sql:413-417`. Ou seja, o conserto **não precisa de
migration**. Conferido.

E a pergunta do passo 2 já tem resposta: **esta rota não cria contato.** O
único `from('contacts')` de `send/route.ts` (linha ~129) é um `.select('id')`
de validação de posse — só o insert de `conversations` precisa mudar.

**Resolvido em** PR #90 — `findOrCreateConversation` perdeu o parâmetro
`userId` e resolve `accounts.owner_user_id` DENTRO do caminho de criação (o
hit não paga a consulta), falhando fechado (null → o 500 que o call site já
devolvia). O `userId` da rota continua para rate limit e `senderUserId`
(autoria da mensagem — coluna diferente e correta).
· **Medido:** o teste de rota existente quebrou no ato (mock sem
`owner_user_id` → 500, o fail-closed funcionando) e foi endurecido: o mock
devolve `owner-1` ≠ caller `user-1` e o `toMatchObject` do insert afirma
`user_id: 'owner-1'` — regressão de fonte agora reprova por COMPORTAMENTO.
Sem E2E de propósito: o caminho dispara template real por canal de produção.

---

### #12 — Cadastro manual e importação de CSV gravam o membro que clicou

- **Arquivos:** `src/components/contacts/contact-form.tsx:168` e
  `src/components/contacts/import-modal.tsx:275`
- **PR de origem:** #80 (achado por extensão) · **Categoria:** correctness · **Veredito:** CONFIRMADO (2 ângulos)
- **Evidência:** `user_id: user.id,` nos dois inserts de `contacts`.

**O problema.** Mesma regra do #11, e aqui é **pior**, porque o CASCADE parte
do próprio contato: apagar o login leva o contato → a conversa → todas as
mensagens. São os dois caminhos pelos quais o escritório cadastra cliente à
mão, e a importação faz isso em lotes de 50.

O levantamento da revisão encontrou **14 call sites em `src/` gravando
`user_id: user.id`**; estes dois são os que tocam `contacts`. Os demais tocam
tabelas cujo CASCADE não leva histórico de cliente (ex.: `custom_fields` — ver
§6, item M1, que é dívida real mas de severidade menor).

**Como reproduzir.**
1. Cadastrar um cliente pelo diálogo "Novo contato" da página de Contatos.
2. `SELECT user_id FROM contacts WHERE id = '<novo>'` → o id do operador.
3. Idem importando um CSV pelo `import-modal`.

**Como corrigir.** Os dois rodam **no cliente, sob RLS**, então não têm
`supabaseAdmin` nem leem `accounts` hoje. Duas saídas:

- **(preferida) Resolver o dono no cliente.** `accounts.owner_user_id` **é**
  acessível por RLS ao membro — conferido: `accounts_select ON accounts FOR
  SELECT USING (is_account_member(id))`. Basta buscar uma vez e usar nos dois
  formulários. Custo: uma consulta por montagem, cacheável no contexto de auth
  (o `useAuth` já carrega o `profile`).
- **(alternativa) Mover a criação para uma rota.** Alinha com a convenção do
  fork ("toda escrita passa pela API"), mas é mudança maior e muda o
  tratamento de erro das duas telas.

Decida com o operador **antes de implementar** — a alternativa altera o
comportamento de duas telas muito usadas.

**Armadilhas.** Não tente resolver isso por trigger no banco sem falar com o
operador: um `BEFORE INSERT` que sobrescreva `user_id` mudaria o significado da
coluna para os 14 call sites de uma vez, inclusive os que não são de contato.

**Resolvido em** PR #90, pela opção (a) da decisão §0.6 — o select de
`accounts` que o `AuthProvider` JÁ fazia ganhou `owner_user_id`, e o contexto
expõe `ownerUserId` (custo zero de consulta extra; nulo = escritor falha
fechado com "Account owner not resolved", nunca cai para `user.id`).
⚠️ **O levantamento do plano estava incompleto**: além dos dois arquivos, o
CSV do passo de destinatários do broadcast (`use-broadcast-sending.ts`,
`resolveAudience`) TAMBÉM cria contatos com `user_id: user.id` — corrigido
junto. E de carona ali: o lookup de de-dupe filtrava `.eq('user_id', user.id)`
em vez de `account_id` — numa conta com 2+ membros, contato criado pela
ingestão (dono ≠ operador) não era achado, o re-insert batia no índice único
da 022 e o 23505 cru derrubava o broadcast inteiro. Trocado para
`.eq('account_id', accountId)`.
· **Medido (E2E no preview, banco real, fixtures apagadas com rowcount):**
cadastro manual (+5511999990004) e importação de CSV de 1 linha
(+5511999990005) → `contacts.user_id = 582aad06…` = `accounts.owner_user_id`
nas duas; toasts de sucesso. Conta de UM membro (operador == dono), então o
VALOR não distingue as fontes — o que o E2E prova é que `ownerUserId`
resolve de verdade (nulo teria falhado fechado) e que os fluxos seguem
inteiros; a distinção dono≠operador é o teste de rota do #11 e a varredura
do #13. O broadcast não foi rodado E2E (envio em massa real).

---

### #13 — O teste do dono durável casa o NOME da variável, não a origem do valor

- **Arquivo:** `src/app/api/cb/conversas/abrir/dono-duravel.test.ts:40`
- **PR de origem:** #80 · **Categoria:** test-coverage · **Veredito:** CONFIRMADO (medido por mutação)
- **Evidência:** `for (const v of gravados) expect(v).toBe('donoDaConta');`
  — a asserção é sobre o identificador; nada amarra `donoDaConta` ao resultado
  do `select('owner_user_id')`. E `expect(fonte).toContain('owner_user_id')` é
  satisfeito pelo SELECT mesmo que ninguém use o valor.

**O problema.** O teste lê o fonte de `route.ts` e faz três asserções de
TEXTO — nenhuma amarra o valor gravado à consulta que o produz.

**Como reproduzir.** Aplique cada mutação abaixo em
`src/app/api/cb/conversas/abrir/route.ts` e rode
`npx vitest run src/app/api/cb/conversas/abrir/dono-duravel.test.ts`.
Foi assim que a revisão mediu (reverta depois — são regressões reais):

| Mutação | Resultado |
| --- | --- |
| `const donoDaConta = conta?.owner_user_id ?? user.id` | ✅ **passa** — é o "amaciamento" que alguém escreve ao ver o 500 de `LOOKUP_FAILED` e achar que não deve derrubar a ação do operador |
| `const donoDaConta = user.id` (mantendo o `select('owner_user_id')` acima) | ✅ **passa** — a asserção 1 só exige a string em algum lugar do arquivo |
| `const user_id = user.id` + shorthand `user_id,` no insert do CONTATO | ✅ **passa** — sem dois-pontos o regex não vê nada, e `gravados.length > 0` é satisfeito pelo insert da CONVERSA |
| spread (`...dono`) | ❌ reprova |
| renomear a variável | ❌ reprova |

Um teste que fica verde sobre a regressão é pior que teste ausente: ele
desliga a atenção de quem revisa. E a mutação nº 1 é a mais provável de todas.

**Como corrigir.** O teste é estrutural por bom motivo (não há como rodar a
rota sem Supabase), mas deve verificar a **origem do valor**, não o nome:

1. Exigir que exista uma atribuição que ligue a variável ao select:
   regex casando `owner_user_id` **na mesma expressão** que produz a variável
   usada no insert.
2. Proibir explicitamente o fallback: reprovar se aparecer `owner_user_id`
   seguido de `??` ou `||` na mesma linha/expressão.
3. Proibir shorthand: exigir que o insert de `contacts` e o de `conversations`
   tragam `user_id:` com dois-pontos, e reprovar `user_id,` solto.
4. Exigir **dois** `gravados` (contato E conversa), não `> 0`.
5. **Estender o alcance:** hoje o teste lê um único `route.ts`
   (`fs.readFileSync(path.join(__dirname, 'route.ts'))`). A regra que o
   CLAUDE.md enuncia é do repositório inteiro. Transformá-lo numa varredura de
   `src/**` que ache todo `.insert(` em `contacts`/`conversations` e cobre o
   dono durável fecha #11, #12 e as regressões futuras de uma vez — e é o que
   torna a nota do CLAUDE.md verdadeira.

**Armadilhas.** Ao ampliar a varredura, ela vai acusar #11 e #12 imediatamente
— o que é o comportamento certo, mas significa que **o teste tem de entrar no
mesmo PR que as correções**, senão o CI fica vermelho no `main`.

**Resolvido em** PR #90 — o teste antigo foi apagado e substituído por
`src/lib/contacts/dono-duravel.test.ts`, varredura de `src/**` no molde da
allowlist da F7: universo EXATO de call sites `.from(contacts|conversations|
custom_fields).insert/upsert` (deep-equal — 17 call sites em 11 arquivos;
arquivo novo obriga o dev a declarar a fonte NO teste que documenta a regra),
fonte durável por arquivo decidida pela heurística do "último `.from()`
anterior" (é o que deixa o `user_id: user.id` LEGÍTIMO do insert de
`broadcasts`, no mesmo arquivo do hook, fora do alcance sem exceção
declarada), origem amarrada (a declaração de `donoDaConta` tem de conter
`owner_user_id` e NÃO conter `??`/`||`; `ownerUserId` client-side tem de vir
do destructuring de `useAuth()` e redeclará-lo é proibido — fecha o
sombreamento), shorthand proibido dentro do argumento extraído por
balanceamento de parênteses, e a amarra do próprio provider
(`ownerUserId: account?.owner_user_id ?? null`, e `user.id` proibido ali).
· **Medido por mutação (7/7 reprovam):** as três da tabela acima (`?? user.id`
→ 1 failed; `= userId` mantendo o select → 1 failed; shorthand → 2 failed)
mais quatro novas (fonte errada no client → 1; `const ownerUserId = user.id`
sombreando no handler → 1; arquivo novo com insert fora do universo → 1;
provider caindo para `user.id` → 1). Suíte 2257 verde no estado bom.

---

## F3 — Fila de gravação de campo personalizado

> Módulo: `src/lib/contacts/salvamento-de-campo.ts` (puro, com teste em
> `salvamento-de-campo.test.ts`), consumido por `campo-com-salvamento.tsx`,
> que é montado pela ficha (`src/components/contacts/contact-detail-view.tsx`)
> e pelo painel da conversa
> (`src/components/inbox/painel/painel-do-contato.tsx`). Os dois achados abaixo são do MESMO
> laço — corrija juntos, num PR só, com testes novos para os dois.

### #09 — Falha COM pendente desalinha a régua e a tela passa a mentir

- **Arquivo:** `src/lib/contacts/salvamento-de-campo.ts:119`
- **PR de origem:** #83 · **Categoria:** correctness · **Veredito:** CONFIRMADO (4 ângulos + simulação em nó isolado)
- **Evidência:** `else desejado = salvo;` dentro do `for (;;)`, seguido de
  `const proximo = pendente; pendente = null; ... atual = proximo;` — o laço
  continua sem tocar em `desejado`.

**O problema.** O laço mantém três variáveis: `salvo` (o que o banco tem),
`desejado` (a régua do "mudou?") e `pendente` (o próximo valor a gravar). No
ramo de falha, `desejado = salvo` é executado **mesmo quando há pendente na
fila** — e nada re-sincroniza `desejado` depois que o pendente grava com
sucesso.

O comentário do código explica por que o `else` existe ("volta a régua para o
que o banco tem, senão o MESMO gesto repetido pelo operador seria descartado
como 'não mudou'") — e o raciocínio está certo. Ele só é **seguro quando
`pendente === null`**.

**Como reproduzir.**
1. Campo de texto com `"A"` gravado.
2. Digitar `"B"` e sair do campo (gravação em voo).
3. Antes de a resposta voltar, voltar ao campo, digitar `"C"` e sair
   (`pendente = "C"`, `desejado = "C"`).
4. Fazer a requisição de `"B"` FALHAR (bloquear a URL no DevTools por 1 s).
   → `desejado = salvo = "A"`.
5. O laço segue e grava `"C"` com sucesso → `salvo = "C"`, mas `desejado`
   continua `"A"`.
6. O operador se arrepende e devolve o campo para `"A"`, e sai:
   `valorMudou("A", "A")` é `false` → **nada é enviado**.
7. A tela mostra `"A"`, o banco guarda `"C"`. Sem spinner, sem toast, sem
   nada. Só aparece no próximo carregamento da ficha.

Reproduzido em nó isolado com a lógica do módulo: `chamadas: ['B','C']`,
`salvo(): 'C'`, `desejado: 'A'`.

**Como corrigir.**
```ts
const ok = await gravar(atual);
if (ok) salvo = atual;
// Falhou: volta a régua para o que o banco tem, senão o MESMO gesto repetido
// pelo operador seria descartado como "não mudou".
// ⚠️ SÓ quando não há pendente: com pendente, `desejado` já aponta para o
// valor mais novo e reverter aqui o deixa preso num valor que o banco não
// tem mais assim que o pendente gravar — e aí um gesto de desfazer some.
else if (pendente === null) desejado = salvo;
```

**Teste a acrescentar** (o arquivo hoje cobre falha SEM pendente, na linha
~148 — o caso que funciona):
```
it("falha COM pendente não deixa a régua presa no valor velho", ...)
```
Enfileirar "B", enfileirar "C" com "B" em voo, resolver "B" como `false` e
"C" como `true`, e afirmar que `enfileirar("A")` DEPOIS disso grava.

**Armadilhas.** Não "simplifique" removendo o `else` inteiro: sem ele, uma
falha isolada faz o operador repetir o mesmo valor e ser ignorado — que é o
defeito que o comentário documenta ter consertado.

**Resolvido em** PR #87 — `else if (pendente === null) desejado = salvo;`
com o comentário dos dois lados; o `else` NÃO foi removido. · **Medido:**
teste novo com o roteiro exato do plano; contraprova por mutação (módulo
antigo + testes novos = exatamente os 2 novos reprovam, 15 antigos passam).
E2E de sanidade no preview: valor gravado por blur num campo real sobreviveu
ao reload (fixture criada e apagada).

---

### #10 — Rejeição em `gravar()` trava a fila e o spinner para sempre

- **Arquivo:** `src/lib/contacts/salvamento-de-campo.ts:113` (`for (;;) { const ok = await gravar(atual); ... }`)
- **PR de origem:** #83 · **Categoria:** correctness · **Veredito:** CONFIRMADO (2 ângulos)
- **Evidência:** `for (;;) {` com `const ok = await gravar(atual);` dentro,
  sem `try`. `rodando = true` é fixado na linha 110 e só volta a `false` no
  `return` do caminho normal (linha ~123).

**O problema.** O contrato de `aoGravar` é `Promise<boolean>`, e todo o
desenho assume que ele **resolve**, nunca rejeita. Se a promessa rejeitar, o
laço abandona sem executar `rodando = false` nem `aoMudarEstado("parado")`. A
partir daí:

- `rodando` fica `true` para sempre naquela instância;
- todo `enfileirar` cai em `if (rodando) { pendente = valor; return; }` e o
  pendente nunca é consumido;
- **nada mais é gravado naquele campo**, nem no blur, nem na descarga de
  desmonte;
- o `<Loader2 className="animate-spin">` fica girando ao lado do rótulo
  indefinidamente — o "spinner eterno" que o próprio comentário do componente
  chama de pior saída;
- e vira uma rejeição não tratada no console.

Caminhos reais de rejeição hoje: `createClient()` estourando no painel, um
`toast.error(t(...))` quebrando na formatação da mensagem, e qualquer chamador
futuro que use `fetch` com `res.json()` cru. Com o botão antigo isso não
existia: cada clique era um gesto independente e um erro deixava o botão
pronto para nova tentativa.

**Como reproduzir.** No teste, passar um `gravar` que faz `throw` (ou
`Promise.reject`) e afirmar que um `enfileirar` posterior ainda grava. Na tela:
temporariamente lançar dentro de `gravarCampo` e observar o spinner permanente
e o campo que para de salvar.

**Como corrigir.**
```ts
for (;;) {
  let ok = false;
  try {
    ok = await gravar(atual);
  } catch {
    // Rejeição é falha, não fim do mundo: o laço tem de continuar drenando
    // o pendente e SEMPRE devolver `rodando` a false, senão o campo para de
    // gravar em silêncio com o spinner aceso.
    ok = false;
  }
  if (ok) salvo = atual;
  else if (pendente === null) desejado = salvo;   // ver #09
  ...
}
```

**Teste a acrescentar:** `it("rejeição em gravar não trava a fila")` — espia
que `emVoo()` volta a `false` e que o `enfileirar` seguinte chama `gravar`.

**Armadilhas.** Tratar a rejeição como `ok = false` é o certo (o operador vê
"parado" e pode tentar de novo). Não engula silenciosamente sem mudar o estado
— e considere logar, porque hoje o `catch` do chamador é quem toasta.

**Resolvido em** PR #87 — try/catch com `ok = false` + `console.error` (o
toast segue no chamador); estado "parado" e a fila continua drenando o
pendente. · **Medido:** teste novo (`emVoo()` volta a false; o `enfileirar`
seguinte grava de novo) com contraprova por mutação — no módulo antigo o
teste reprova. As DUAS notas do CLAUDE.md desta frente (§7: "Salvar campos"
e `salvoRef`) corrigidas no mesmo PR; a terceira (":538", famílias de
ordenação) já é corrigida pelo texto novo do próprio PR #84.

---

## F4 — Radar: alarme apagado ou inalcançável

### #05 — Consulta de agendadas sem `limit`/`order` trunca e APAGA o alarme

- **Arquivos:** `src/hooks/use-radar.ts:165` e `src/lib/cb-radar/worker.ts:424`
- **PR de origem:** #74 · **Categoria:** correctness · **Veredito:** CONFIRMADO (5 ângulos)
- **Evidência (hook, `use-radar.ts:165`):** `.from('cb_scheduled_messages')` →
  `.select('message_id')` → `.in('conversation_id', ids)` →
  `.not('message_id', 'is', null)` — sem `.order()`, sem `.limit()` e **sem
  tratar o erro**.
- **Evidência (worker, `worker.ts:424`):** a mesma consulta, mas com
  `.eq('conversation_id', args.conversationId)` (UMA conversa) e **com** o erro
  tratado (`if (agErr) throw new Error(...)`, linha 428).
- ⚠️ **Não são o mesmo caso.** No hook o teto é atingido pela SOMA das
  conversas com pendência aberta; no worker seria por ~1000 agendadas numa
  única conversa — bem menos provável. A frase "sem erro, nem o `console.warn`
  dispara", abaixo, descreve só o hook.

**O problema.** O PR #74 descobriu que a mensagem nascida de uma **agendada**
sai com `sender_id` preenchido (o `created_by` de quem a criou dias antes) e
por isso contava como "resposta de gente", fechando a pendência do cliente
esquecido. A correção foi excluí-la pela proveniência
(`cb_scheduled_messages.message_id`). A consulta que faz essa exclusão foi
escrita **sem nenhuma das três defesas** que a consulta irmã, seis linhas
acima, tem — e aquela vem com um parágrafo explicando por que truncar ali é
seguro:

```
a consulta é DESC — o teto só pode omitir resposta ANTIGA, e faltar resposta
mantém o cartão: a direção segura.
```

Aqui é o contrário. `deAgendada` incompleto faz uma agendada passar como
resposta humana, `respondidas` ganha a conversa, e o **cartão do cliente
esquecido SAI do painel** — a direção que o comentário ao lado declara
inaceitável ("errar para o outro é o cliente esquecido sumindo em silêncio").

E o teto chega sozinho: `desde` é a pendência mais antiga da tela, pendência
aberta **não expira por desenho**, e `cb_scheduled_messages` é histórico
permanente das enviadas (a tela `/agendadas` pagina justamente o acervo).
Passando das 1000 linhas do PostgREST, volta um subconjunto **arbitrário**
(sem `ORDER BY` não há sequer garantia de quais), sem erro — então nem o
`console.warn` do ramo de falha dispara.

**Como reproduzir.** Difícil hoje por volume; reproduza reduzindo o teto:
acrescente `.limit(3)` temporariamente numa conta com 5+ agendadas enviadas em
conversas com pendência aberta, e observe cartões sumindo do `/radar`.

**Como corrigir.** Recortar pela mesma régua da irmã, e declarar a truncagem:
1. `.gte('scheduled_for', desde)` (ou o campo equivalente) para limitar à
   janela que interessa;
2. `.order(...)` explícito + `.limit(TETO_...)` com constante nomeada;
3. `console.warn` quando `data.length >= teto`, como a irmã faz.

**Alternativa melhor, se couber:** fazer a segunda consulta DEPOIS da
primeira, com `.in('message_id', data.map(m => m.id))` — assim ela é limitada
a `TETO_RESPOSTAS` por construção e a pergunta fica exata. Custa serializar as
duas consultas; num hook que recarrega a cada 2 min, é barato.

**Armadilhas.** A prioridade é o **hook** — é lá que o teto é alcançável e que
o erro é engolido. No worker, aplique só o `.limit()` + aviso; ele já trata o
erro (e esse `throw` tem custo próprio: ver M23 na §6).

**Resolvido em** PR #89 — a "alternativa melhor" nos DOIS lados: a consulta
de agendadas roda DEPOIS da primeira e recortada por `.in('message_id', …)`
(hook: ids das respostas, teto = TETO_RESPOSTAS; worker: ids da equipe na
janela, teto = TETO_MENSAGENS_JANELA) — exata e limitada por construção,
sem depender de `order`/`limit` à mão. · **Medido:** typecheck/suíte 2258
verdes; ver M23 para a decisão sobre o `throw` do worker.

⚠️ **Correção deste texto (Codex na revisão do PR #85, 01/09):** o "Como
corrigir" acima está ERRADO como receita, e a "alternativa melhor" não era
opcional — era a única forma correta. Recortar por `scheduled_for >= desde`
não garante que toda mensagem enviada DEPOIS de `desde` seja reconhecida como
agendada: `dispararUma` aceita retentar uma agendada `failed`/pendente antiga
seja qual for o `scheduled_for` dela, então uma linha agendada ANTES da janela
produz mensagem DENTRO dela — a consulta por data a omitiria e o Radar
voltaria a ler a agendada como resposta humana, apagando o alarme. E o
`.limit(TETO)` reproduz o mesmo falso negativo assim que as linhas de
proveniência passam do teto. A implementação (PR #89) já foi pela forma por
`message_id`; esta nota existe para ninguém "simplificar" de volta para a
receita da lista numerada. A 970 indexou `message_id` (era varredura de
tabela inteira — Codex no PR #89).

---

### #21 — Envio agendado zera a pendência do cliente esquecido

- **Arquivo:** `src/lib/cb-radar/worker.ts:629`
- **PR de origem:** #74 · **Categoria:** correctness · **Veredito:** CONFIRMADO (verificado)
- **Evidência:**
  ```ts
  const houveHumanoNaJanela = comData.some(
    (m) => m.sender_type === 'agent' && m.sender_id !== null,
  )
  ```
  contra, no MESMO arquivo (linha ~442):
  ```ts
  porGente: (m.sender_id !== null || m.from_device === true) && !deAgendada.has(m.id),
  ```

**O problema.** O PR #74 corrigiu a régua de "resposta de gente" num lugar
(`porGente`) e deixou a outra (`houveHumanoNaJanela`) na versão antiga.

O CLAUDE.md diz que essa diferença é **deliberada**, e para o `from_device`
ela é: `from_device` ALARGA "humano" (o celular pareado), e omiti-lo aqui é
defensável — uma saída pelo celular sozinha não deveria refazer a análise.
Mas a **agendada ESTREITA**, e para ela a omissão é defeito: o comentário do
próprio bloco (linhas ~616-622) NOMEIA a agendada entre as saídas de que o
ramo tem de proteger — e então escolhe um discriminador (`sender_id`) que não
a distingue.

Agrava: o comentário novo em `worker.ts:437-441` afirma que a divergência é
"de propósito", o que sela o defeito contra revisão futura.

**Como reproduzir.**
1. Conversa com pendência aberta antiga (cliente escreveu há >7 dias, ninguém
   respondeu). O cartão está no `/radar` pela exceção "pendência aberta não
   expira".
2. Agendar um follow-up para essa conversa e deixar disparar (ou disparar por
   "Executar agora").
3. Rodar o ciclo do Radar (`/api/cb/radar/cron`).
4. Observar: a conversa volta à candidatura (`last_message_at` mudou), a
   janela de 7 dias não tem NENHUMA mensagem do cliente, a IA é pulada
   (`semClienteNaJanela`), mas `houveHumanoNaJanela` é `true` → o ramo
   preservador é pulado → o UPDATE completo grava `aguardando_desde: null`,
   `nota: null`, `urgencia: 'nenhuma'`, `insatisfacao: false`.
5. O cartão SOME do painel, sem ninguém ter respondido ao cliente.

Confirmado na cadeia: `scheduled/dispatch.ts:522` passa
`senderUserId: linha.created_by`; `send-message.ts:782/788` grava
`sender_type:'agent'` + `sender_id` não-nulo; `:827` atualiza
`last_message_at`. E `dispatch.ts:535` grava `message_id` = o UUID de
`messages`, então a exclusão por proveniência FUNCIONA onde foi aplicada.

**Como corrigir.** Aplicar a mesma exclusão por proveniência:
```ts
const houveHumanoNaJanela = comData.some(
  (m) => m.sender_type === 'agent' && m.sender_id !== null && !deAgendada.has(m.id),
)
```
E **reescrever o comentário de `worker.ts:437-441`**: hoje ele afirma que a
divergência inteira é proposital. O correto é dizer que a diferença é só o
`from_device` (e por quê), e que a exclusão da agendada vale para as duas.

**Armadilhas.** NÃO unifique as duas expressões numa só. Elas respondem
perguntas diferentes — `porGente` decide se a pendência fechou;
`houveHumanoNaJanela` decide se a análise congelada é preservada. O CLAUDE.md
avisa: "Não unificar as duas sem entender qual pergunta cada uma responde".
`worker.test.ts` não tem nenhum caso de agendada — acrescente.

**Resolvido em** PR #89 — `!deAgendada.has(m.id)` nas DUAS réguas (não
unificadas: a diferença deliberada é só o `from_device`, e os dois
comentários foram reescritos para dizer exatamente isso — o de
`worker.ts:437-441` afirmava que a divergência INTEIRA era proposital).
· **Medido:** pino estrutural novo em `worker.test.ts` com contraprova por
mutação — reverter o `houveHumanoNaJanela` à forma antiga derruba 2 testes;
restaurado, 9/9. (Harness de fluxo completo não existe no arquivo — mock
de todo o admin client seria maquinário desproporcional; o pino cobre a
regressão exata do achado: uma régua atualizada, a outra esquecida.)

---

### #22 — Reclamação da sexta expira no domingo e some para sempre

- **Arquivo:** `src/app/(dashboard)/radar/page.tsx:212` (`insatisfacao: insatisfacaoViva,`),
  com a régua em `src/lib/cb-radar/rubrica.ts:79` (`insatisfacaoAindaVale`)
- **PR de origem:** #76 · **Categoria:** correctness · **Veredito:** CONFIRMADO
- **Evidência:** `insatisfacao: insatisfacaoViva,` alimentando
  `(temGatilho(d.ord) || d.insight.status === 'failed')`, com
  `insatisfacaoViva = insatisfacaoAindaVale(i.insatisfacao, i.analisado_em, agora.getTime())`.

**O problema.** O PR #76 passou a aplicar a régua de 48h da insatisfação
também na LEITURA. Como o painel **não tem mais a aba "Todos"** (decisão do
operador), sair do `temGatilho` significa sair da única superfície que existe
— e `descartado`/ausente não reabre sozinho.

O resultado é um cartão que **expira antes de alguém o ter lido**.

**Como reproduzir.**
1. Cliente reclama sexta-feira 09h. A equipe responde 09h10 (então
   `aguardando_desde` é nulo), sem pedido aberto e urgência `nenhuma` — o
   cartão entra na lista **só** por `insatisfacao`.
2. O worker grava `analisado_em = sexta 09h15`.
3. Ninguém abre o `/radar` no fim de semana (expediente 08–19).
4. Segunda 08h: passaram 71h. `insatisfacaoAindaVale` devolve `false` →
   `ord.insatisfacao` false → `temGatilho` false → o cartão **não está na
   lista**, e ninguém o viu.

Vale para toda reclamação analisada a partir de sexta 08h. **Antes do #76 o
cartão ficava aceso** (a âncora era a última linha do transcrito, que numa
conversa morta não anda): o desaparecimento é comportamento NOVO.

**Efeito colateral relacionado, do mesmo PR:** a régua da ESCRITA e a da
LEITURA se somam, então um sinal pode viver até ~96h (evidência de segunda,
análise na quarta com 47h, cartão até sexta). As notas do módulo apresentam a
régua como "48h", sem admitir que o teto real é a soma.

**Como corrigir.** Isto é **decisão de produto, não conserto mecânico** —
leve ao operador com as três opções:

- **(a) Só expira depois de visto.** Guardar um `visto_em` por insight
  (migration nova) e só aplicar a régua de leitura a cartão que alguém já
  abriu. Resolve o caso motivador sem ressuscitar a aba "Todos".
- **(b) Contar em horas ÚTEIS.** `horario-comercial.ts` já existe e é o único
  arquivo com essa régua. 48h úteis atravessam o fim de semana.
- **(c) Reverter a régua na leitura** e deixá-la só na escrita (que é onde o
  operador pediu a expiração). Mais simples, mas devolve o "sinal aceso para
  sempre sobre caso encerrado" que o #76 foi consertar.

**Armadilhas.** Não resolva ressuscitando a aba "Todos" — ela foi removida a
pedido explícito do operador, porque listar toda conversa analisada era
justamente o ruído que o filtro passou a cortar. O CLAUDE.md registra isso.

**Resolvido em** PR #89 (decisão (b) da §0.6), com uma CALIBRAÇÃO dentro da
decisão, registrada para veto: **2 dias úteis (22h de expediente)**, não "48h
úteis" — a conversão hora-a-hora inflaria a régua para ~6 dias corridos
(11h/dia), quase a janela inteira de 7, desfazendo na prática a expiração que
o #76 criou; é o MESMO racional que o CLAUDE.md já usa para manter
`LIMIAR_ALARME_MS` em corridas. "48h" da decisão original do operador
(2026-08-30) sempre quis dizer "2 dias". **Simetria da escrita: adotada** (a
decisão mandava avaliar e registrar) — em corridas, mensagem nova no fim de
semana fazia a reanálise de segunda DESCARTAR a evidência de sexta (o mesmo
buraco, no nascimento do sinal), e réguas em unidades diferentes tornariam a
soma das duas inexplicável. A soma (~4 dias úteis de teto) está admitida na
docstring da constante e no CLAUDE.md.
· **Medido:** pinos com datas de calendário reais nos DOIS lados (leitura:
análise de sexta 09:15 viva segunda 08:00, morta terça 10:00; escrita:
evidência de sexta sobrevive à reanálise de segunda) + contraprova por
mutação (reverter a leitura para corridas → 1 failed; a escrita → 1 failed).
Suíte 2275 verde. E2E: `/radar` em produção rendendo 20 sinais / 9 cartões
de insatisfação sob a régua nova, sem erro novo de console (não há linha
com `analisado_em` de sexta em produção — o worker reanalisa a cada
mensagem — então a discriminação temporal é provada pelos pinos, não pela
tela).

---

### #23 — Descartar análise `failed` esconde o sinal real para sempre

- **Arquivo:** `src/app/api/cb/radar/[conversationId]/estado/route.ts:81`
- **PR de origem:** #76 · **Categoria:** correctness · **Veredito:** CONFIRMADO
- **Evidência:** `query = query.neq('status', 'running');` — o único status recusado.

**O problema.** O #76 fechou a janela em que o worker está COM a linha
(`running`). Mas a linha `failed` com `tentativas < 3` **será reanalisada pelo
próximo ciclo** — `precisaDeAnalise` devolve `temMsgNova || insight.tentativas
< TENTATIVAS_MAX` (`worker.ts:229`), sem exigir mensagem nova. E `descartado`
NUNCA reabre sozinho.

A janela aqui é MAIOR que a do `running` que o PR fechou: um ciclo inteiro
(até 15 min), não os segundos da geração.

**Como reproduzir.**
1. Forçar uma análise a falhar uma vez (`status='failed'`, `tentativas=1`) —
   por exemplo com a chave de IA inválida por um ciclo.
2. A linha aparece no painel **independente de gatilho**, com a etiqueta
   `analiseFalhou` e os botões Tratar/Descartar
   (`src/app/(dashboard)/radar/page.tsx:710` e `:802`).
3. O operador lê "análise falhou" e clica **Descartar**. A rota ACEITA (o
   status é `failed`, não `running`).
4. Restaurar a chave. Em até 15 min o ciclo reivindica a linha, a análise dá
   certo e grava insatisfação/urgência/pedidos REAIS — mantendo
   `estado='descartado'`.
5. O sinal real fica invisível para a equipe inteira, permanentemente.

**Como corrigir.** Opções, da mais simples à mais correta:
- **(a)** Recusar também `failed` com `tentativas < TENTATIVAS_MAX`, com um
  código próprio (`analysis_pending_retry`) e uma frase que explique ("a
  análise vai ser refeita; aguarde"). Simples, mas deixa o operador sem ação
  por até 15 min.
- **(b) (preferida)** Deixar aceitar, mas fazer o worker **respeitar um
  descarte posterior à falha**: ao gravar uma análise bem-sucedida sobre uma
  linha `descartado`, verificar se o `estado_em` é POSTERIOR ao
  `analisado_em` da tentativa falha e, nesse caso, **reabrir** — porque o
  operador descartou uma NÃO-análise, não um veredito. Isso exige uma coluna
  ou uma comparação de carimbos; documente a regra ao lado das outras três
  assimetrias do ciclo de vida no CLAUDE.md.

**Armadilhas.** A regra "`descartado` NUNCA reabre sozinho" é deliberada e
está no CLAUDE.md (descartar = "a IA errou"; reanálise repetiria o falso
positivo). A exceção proposta em (b) é estreita — descarte sobre linha que
NUNCA teve análise concluída — e precisa ficar escrita, senão o próximo leitor
a remove como inconsistência.

**Resolvido em** PR #89 (decisão (b) da §0.6), com um REFINAMENTO do
enunciado, descoberto na implementação: a falha NÃO carimba `analisado_em`,
então "estado_em posterior ao analisado_em da falha" não é implementável
como comparação — e a comparação crua `estado_em > analisado_em` reabriria
TODO descarte normal (todo descarte é posterior à análise descartada). O
discriminador real: `status='failed'` com `analisado_em IS NULL` no retrato
do CLAIM (`descarteFoiSobreFalha`, pura e exportada) — linha que nunca teve
análise concluída, onde o descarte só pode ter sido sobre o aviso de falha.
A linha done→failed+descarte fica na regra geral: havia conteúdo real no
cartão, e foi ele que o operador rejeitou. O flag viaja do CHAMADOR (após o
UPDATE principal o carimbo antigo já foi sobrescrito) nos dois call sites
(ciclo e reanálise manual); o update de reabertura confere
`estado='descartado'` na hora (clique no meio-tempo vira no-op) e mora ao
lado do reset condicional de `tratado`, como o CLAUDE.md manda.
· **Medido:** 4 pinos da regra pura + pino estrutural do fio (2 call sites +
`.eq('estado','descartado')` no update); mutações: regra invertida → 2
failed, flag removido do ciclo → 3 failed. A exceção está escrita ao lado
das três assimetrias no CLAUDE.md. Sem E2E: forçar falha real de análise +
descarte + sucesso em produção exigiria quebrar a chave de IA da conta.

---

### #28 — Claim órfão trava o cartão inteiro por 10 a 25 minutos

- **Arquivo:** `src/app/api/cb/radar/[conversationId]/estado/route.ts:104`
  (`atual.status === 'running' ? 'analysis_running' : 'analysis_changed'`)
- **PR de origem:** #76 · **Categoria:** correctness · **Veredito:** PLAUSÍVEL
- **Evidência:** nem a linha 81 (`neq('status','running')`) nem a 104 olham
  `running_desde`.

**O problema.** O #76 passou a recusar o PATCH com `status='running'` sem
checar **obsolescência**, e "Reanalisar" já recusava o mesmo estado
(`ja_em_analise`, `worker.ts:787`). Um claim abandonado congela o cartão: nem
Tratar, nem Descartar, nem Reanalisar.

Como o claim é abandonado: o ciclo é o laço LENTO do `docker-stack.yml`
(`sleep 900`, `curl -m 120`) e o worker tem `TETO_ABSOLUTO_MS = 110_000` —
margem de 10 s. Basta o curl estourar, ou o rollout do Swarm trocar o
container no meio de uma análise (acontece **a cada merge no `main`** — 11
hoje), para a linha ficar `running` com `running_desde` órfão. Quem desprende
é só `recolherTravadas`, chamado APENAS de dentro do ciclo, com corte de
`TRAVADA_MIN = 10` min sobre um laço de 15.

**Como reproduzir.** `UPDATE cb_conversation_insights SET status='running',
running_desde = now() - interval '30 minutes' WHERE conversation_id = '<id>'`
e tentar Tratar/Descartar/Reanalisar na tela.

**Como corrigir.** A rota já tem toda a informação: aplicar a mesma régua de
obsolescência que o worker usa.
```ts
// Claim VIVO recusa; claim ABANDONADO (mais velho que TRAVADA_MIN) não —
// senão um curl que estourou congela o cartão até o ciclo seguinte, e o
// operador fica sem Tratar, Descartar E Reanalisar ao mesmo tempo.
const limite = new Date(Date.now() - TRAVADA_MIN * 60_000).toISOString()
query = query.or(`status.neq.running,running_desde.lt.${limite}`)
```
Exportar `TRAVADA_MIN` de onde o worker o define, para não duplicar a
constante (regra da casa: número digitado duas vezes mente na primeira
mudança).

**Armadilhas.** Antes do PR os dois botões funcionavam nesse estado — ou
seja, é regressão, não dívida antiga. Confira também o `reanalisar`
(`worker.ts:787`), que tem a mesma recusa cega.

**Resolvido em** PR #89 — **medição primeiro** (era PLAUSÍVEL): sonda SQL
read-only em produção achou 60 insights, ZERO `running` órfão neste
instante e zero `failed`/`tentativas` — nenhuma instância viva, mas nada
refutado: o mecanismo está nos TRÊS lugares por leitura (rota, pré-cheque
do reanalisar e o próprio `reivindicar`, que recusava `running` cegamente),
sucessos zeram `tentativas` (rastros antigos se apagam) e a janela
rollout×ciclo é real (rollout a cada merge; ciclo de até 110s por 15 min).
Fix: `claimVivo()`/`corteDeClaimAbandonado()` exportados do worker (régua
IDÊNTICA ao recolhedor, `running_desde` nulo incluso, comparação por
INSTANTE — nunca lexicográfica); rota e reanalisar recusam só claim VIVO, o
409 idem, e `reivindicar` TOMA claim abandonado (seguro: a cerca de posse
corta o worker antigo ao regravar o carimbo). · **Medido:** testes de
`claimVivo` (offsets `+00:00`×`Z` inclusos); simulação em produção foi
DESCARTADA de propósito — exigiria mutar insight real e o recolhedor
fabricaria um cartão de falha falso no painel da equipe.

---

## F5 — Vazio virando afirmação (`useChannels`)

> **A regra que o CLAUDE.md fixou em 31/08** (depois do defeito do PR #81):
> lista vazia é cosmética quando serve a rótulo/filtro, e **grave quando é
> convertida numa afirmação POSITIVA que desabilita um controle**. Os dois
> achados abaixo são exatamente esse caso — e o #06 mostra que o conserto do
> próprio #81 está incompleto.

### #06 — `useChannels` põe `loading = false` também no ERRO

- **Arquivo:** `src/hooks/use-channels.ts:38`
- **PR de origem:** #81 · **Categoria:** correctness · **Veredito:** CONFIRMADO (verificado)
- **Evidência:**
  ```ts
  const res = await fetch('/api/cb/channels');
  if (!res.ok) return;            // linha 38 — sai do try
  ...
  } catch { /* mudo */ }
  } finally { if (!cancelado) setLoading(false); }   // roda igual
  ```
  (`return` dentro de `try` executa o `finally` — medido.)

**O problema.** O PR #81 consertou a badge "Expirada" e o compositor
desabilitado usando `janelaDe24h = !canaisCarregando && !evolutionActive`, e o
comentário declara: *"Conta SEM canal nenhum continua na regra da Meta — ali a
lista resolveu vazia, e vazio-com-resposta é conhecimento, não lacuna."*

**O hook não sustenta essa distinção.** Ele descarta o status HTTP e a
exceção, então `{channels: [], loading: false}` é byte por byte o mesmo estado
para "a conta não tem canal" e "não consegui perguntar".

Há um segundo furo: a própria rota devolve **200** com
`{channels: [], unavailable: true}` quando `listChannels` falha (o ramo que
casa `/cb_channels|does not exist|42P01/i`) — e `repo.ts:101` lança
`Falha ao listar canais: ${error.message}`, então um `permission denied` do
PostgREST casa a regex e vira 200-com-lista-vazia. `cb-channels-panel.tsx:191`
**consome** esse `unavailable`; `use-channels.ts` o joga fora.

**Como reproduzir.**
1. Conta 100% Evolution (a de produção).
2. Fazer UM `GET /api/cb/channels` responder não-200 (DevTools → bloquear a
   URL; ou 5xx transitório do Supabase; ou o rollout `start-first`).
3. Abrir uma conversa cuja última mensagem do cliente tenha ≥24h.
4. Observar: badge vermelha "Expirada" no cabeçalho e o compositor
   **desabilitado** com "Sessão expirada — use um modelo".
5. Trocar de conversa **não** resolve (o `MessageThread` é renderizado sem
   `key` em `inbox/page.tsx:873` e não remonta). Só recarregar a página.

**Como corrigir.** O hook precisa expor o **desfecho**, não só `loading`:
```ts
interface UseChannelsResult {
  channels: CbChannel[];
  loading: boolean;
  /** `true` quando a última tentativa NÃO trouxe uma lista confiável
   *  (rede, não-200, ou o `unavailable: true` que a rota devolve com 200). */
  falhou: boolean;
}
```
E `message-thread.tsx` passa a exigir resposta bem-sucedida:
```ts
const janelaDe24h = !canaisCarregando && !canaisFalharam && !evolutionActive;
```
**Falhando para o lado seguro** (compositor habilitado), que é o lado em que a
Evolution está.

**Armadilhas.**
- São ~24 call sites de `useChannels`. Acrescentar um campo ao retorno não
  quebra nenhum (é adição), mas **não mude o significado de `loading`**.
- Consuma o `unavailable` da rota, senão o caminho 200-com-erro continua
  aberto.
- Considere, na mesma passada, o achado menor M2 (§6): o painel do Radar
  (`radar/page.tsx:110`) tem a mesma conversão sobre `radar_enabled`.

---

### #08 — Diálogo de nova conversa afirma "sem conexão" e trava o botão

- **Arquivo:** `src/components/inbox/nova-conversa-dialog.tsx:204`
- **PR de origem:** #79 · **Categoria:** correctness · **Veredito:** CONFIRMADO (**6 ângulos** — o topo da revisão, empatado com #16)
- **Evidência:** `{canais.length === 0 ? (` → `<p className="text-[11px] text-destructive">{t("semCanal")}</p>`,
  alimentado por `const { channels } = useChannels();` em
  `conversation-list.tsx:174`, que **descarta o `loading`**.

**O problema.** O diálogo converte `canais.length === 0` na afirmação em
vermelho *"Nenhuma conexão de WhatsApp disponível. Conecte uma em
Configurações"* e deixa `podeAbrir` falso, matando o único botão da tela.

Dois caminhos: (a) abrir o diálogo antes de `/api/cb/channels` responder —
piscada; (b) o hook falhar (ver #06) — **permanente** naquela montagem, e a
instrução está errada, além de ser algo que um `agent` sequer pode fazer.

**Como reproduzir.** Bloquear `/api/cb/channels` no DevTools, abrir o inbox e
clicar no botão de nova conversa numa conta com dois números conectados.

**Como corrigir.**
1. Destruturar `loading` (e o `falhou` do #06) em `conversation-list.tsx:174`
   e passar ao diálogo.
2. Três estados na tela: carregando (spinner ou botão desabilitado sem
   afirmação), falhou (mensagem de "não foi possível carregar as conexões" +
   tentar de novo), vazio-de-verdade (a frase atual).
3. Só o terceiro desabilita o botão com a instrução de ir a Configurações.

**Armadilhas.** Corrija #06 **antes ou junto**: sem o sinalizador de falha, o
`loading` sozinho só resolve a piscada, não o caso permanente.

**Bônus barato, no mesmo arquivo:** o `ChannelSelect` é renderizado sempre que
`canais.length > 0`, contra a convenção do projeto ("seletor some com menos de
2 canais" — `message-thread.tsx:1724`, `automation-builder.tsx:1115`,
`flow-builder.tsx:340` e mais dois já gateiam em `>= 2`).
⏭️ **NÃO feito**, de propósito: aqui o seletor com UM canal é a linha que diz
**por qual número a conversa vai nascer** — e essa conversa ainda não existe.
Nas outras cinco telas o canal já está decidido e visível em outro lugar.

---

### Resolvido no PR #95 — o que foi MEDIDO

Tudo abaixo com a rota `/api/cb/channels` devolvendo **503 de verdade**
(interruptor por env no handler do dev, removido depois), na conversa
`0569d67c…` — antiga e **já lida**, para não escrever nada em produção.

| | Antes (código do `main`) | Depois (F5) |
| --- | --- | --- |
| Compositor | `disabled: true`, placeholder **"Sessão expirada - use um modelo"** | habilitado, "Digite uma mensagem…" |
| Cabeçalho | badge vermelha **"Expirada"** + faixa "A janela de 24 horas expirou" | nenhuma |
| Botão "Modelos" | **oferecido** (abriria o `TemplatePicker` com `channelId` nulo — M12) | oculto |

- **#08 medido no diálogo:** sob falha ele diz *"Não foi possível carregar as
  conexões"* com **"Tentar de novo"**; o clique (com a rota curada no mesmo
  gesto, sem reload) devolveu o seletor — "Escolha um canal". A frase
  "Conecte uma em Configurações" ficou só para o vazio COM resposta.
- **M14 medido:** `1` busca real para os 3 consumidores do inbox (eram 3–4
  GETs idênticos). Ida ao Radar e volta dentro da validade: **0** buscas
  novas; passada a validade, **1**. Falha **não** entra no cache, de
  propósito — cada montagem tenta de novo em vez de repetir "falhou" por 15s.
- **M2 medido no Radar:** com os canais falhando a tela mostra **2 de 23**
  sinais (só os sem `channel_id`) + o aviso com "tentar de novo"; curado,
  volta aos 23. ⚠️ **A falha pende para a PRIVACIDADE, não para o alarme** —
  é a exceção deliberada da 941 (Radar manda conversa de cliente para IA
  externa e há canal PESSOAL na conta). Esconder 21 cartões é agressivo e
  está atrás de um aviso vermelho; se o operador preferir o contrário, é
  trocar uma linha em `radar/page.tsx`.
- **M11 — limite de medição declarado:** o tique só arma quando a janela da
  Meta está em jogo (`if (!janelaDe24h) return`), e esta conta é 100%
  Evolution, então a badge nunca renderiza aqui. Medido: `0` timers armados,
  que é o comportamento CERTO. O envelhecimento do memo fica pinado por
  teste estrutural (`agoraDaBadge` nas dependências), não por tela.
- **Contraprovas por mutação:** 6/6 mortas, cada uma por exatamente um teste
  — tirar `!canaisFalharam`; voltar o literal inglês; tirar `agoraDaBadge`
  dos deps; furar um dos três portões de disparo; tirar o gate de transporte
  de um atalho; ignorar o `unavailable` no hook.

---

## F6 — Portão de i18n no CI

> O PR #82 transformou `i18n-parity.mjs` e `i18n-chaves-usadas.mjs` em portão
> do job `verificar`, que é o único `needs:` do `deploy`. Os quatro achados
> abaixo foram **medidos rodando o script** e cobrem os dois modos de falha:
> falso VERMELHO (trava a publicação sobre código correto) e falso VERDE (a
> proteção não protege). Corrija os quatro no mesmo PR, com casos de teste
> para o próprio script.

### #18 — Modo folha trata `twMerge`/`toast` como pedido de tradução

- **Arquivo:** `scripts/i18n-chaves-usadas.mjs:142` (porta de entrada) e `:145` (o laço)
- **PR de origem:** #82 · **Categoria:** correctness · **Veredito:** CONFIRMADO (medido, 2 ângulos)
- **Evidência:** `if (!/(?<![\w.$])t[A-Z]?[\w$]*(?:\.(?:rich|raw|markup))?\(\s*['"`]/.test(fonte)) continue`
  — o padrão `t[A-Z]?[\w$]*` casa qualquer identificador que comece com `t`.

**O problema.** Em arquivo **sem binding** de `useTranslations` (o "modo
folha", criado para componentes que recebem o tradutor por prop), o script
casa `twMerge(`, `toast(`, `track(`, `truncate(` e cobra o primeiro literal
deles contra o dicionário.

**Como reproduzir (medido).** Criar `src/__probe/a.tsx` contendo só
`twMerge('flex gap-2')` e rodar `node scripts/i18n-chaves-usadas.mjs`:
saída `FALHA: 1 chave(s) pedida(s) e AUSENTE(S) em pt-BR.json — "flex gap-2"`,
exit 1. Idem com `toast('Contrato salvo')`.

Já é quase real: em `src/components/flows/shared.tsx` — um dos **dois**
arquivos em modo folha (o outro é `src/components/inbox/message-media.tsx`; o
próprio script imprime `arquivos em modo folha: 2`) — o regex casa `truncate`
**16 vezes** (contra 13 do `t` de verdade) — só
não estoura porque nenhuma dessas 16 recebe literal no 1º argumento. Um
`truncate("…", 10)` reprova o build. Efeito colateral: essas 16 entram no
contador "dinâmicas ignoradas", então o número que o script imprime para
declarar o próprio alcance está inflado.

**Como corrigir.** Amarrar o modo folha a um identificador plausível de
tradutor em vez de "qualquer coisa que comece com t":
- exigir que o nome seja exatamente `t` ou case `^t[A-Z]` (`tSidebar`,
  `tAgendadas`) **e** que o arquivo importe algo de `next-intl` ou receba um
  prop tipado como tradutor; ou
- (mais simples e mais honesto) exigir que o arquivo **declare** o parâmetro
  do tradutor e casar só aquele nome.
Uma allowlist de "não é tradutor" (`twMerge|toast|track|truncate`) é remendo:
a próxima função com `t` volta a reprovar.

**Resolvido em** PR #91 (opção "casar só o nome declarado", na forma mínima:
o identificador `t` EXATO, que é a convenção da casa nos dois arquivos folha
reais — allowlist de "não é tradutor" foi descartada como remendo, como o
plano previa). · **Medido:** teste do repro (`toast('Contrato salvo')` +
`twMerge('flex gap-2')` em folha → OK) + mutação (regex antigo de volta → o
teste reprova). Contra o repo real: 2673 literais conferidas, o MESMO total
de antes — cobertura preservada.

---

### #19 — Dois `const t` no mesmo arquivo perdem um namespace

- **Arquivo:** `scripts/i18n-chaves-usadas.mjs:114`
- **PR de origem:** #82 · **Categoria:** correctness · **Veredito:** CONFIRMADO (medido, 2 ângulos)
- **Evidência:** `for (const m of fonte.matchAll(RE_BINDING)) bindings.set(m[1], m[3] ?? '')`
  — a chave do Map é `m[1]` (o NOME), não o par nome+namespace; e
  `const escopos = [...new Set(bindings.values())]` (linha 117) só enxerga o
  sobrevivente.

**O problema.** Dois componentes no mesmo arquivo, cada um com seu
`const t = useTranslations('...')`, deixam só o ÚLTIMO namespace em `escopos`.
As chaves válidas do primeiro são reportadas como ausentes.

Isso contradiz, por escrito, o que o próprio PR escreveu no CLAUDE.md
("Cobra contra TODOS os namespaces do arquivo, não contra o binding"): ele
cobra contra todos MENOS os que foram sobrescritos.

**Como reproduzir (medido).** Arquivo com `Primeiro()` usando
`useTranslations('Inbox.composer')` + `t('draftHint')` e `Segundo()` usando
`useTranslations('Channels')` + `t('label')`:
`FALHA — "draftHint" … procurada sob: Channels`, exit 1, embora
`Inbox.composer.draftHint` exista.

**Alcance hoje:** 18 arquivos já redeclaram o mesmo nome de binding
(`radar/page.tsx`, `custom-fields-manager.tsx`, `integracoes-panel.tsx` com 6
declarações de `t`…) e só continuam verdes porque todas usam o MESMO
namespace. Dois componentes por arquivo é padrão comum em React — é o caso
que mais provavelmente reprova um PR legítimo.

**Como corrigir.** Acumular em vez de sobrescrever:
```js
const bindings = new Map()   // nome -> Set<namespace>
for (const m of fonte.matchAll(RE_BINDING)) {
  if (!bindings.has(m[1])) bindings.set(m[1], new Set())
  bindings.get(m[1]).add(m[3] ?? '')
}
```
e `escopos` vira a união de todos os Sets — mantendo a leniência declarada
("cobra contra todos os namespaces do arquivo"), agora de verdade.

**Resolvido em** PR #91, exatamente na forma proposta (nome → `Set`, escopos
= união). · **Medido:** teste com dois componentes/dois namespaces (era o
repro: `draftHint` reprovando "sob: Channels") → OK, e chave ausente nos
DOIS continua reprovando; mutação (sobrescrever de volta) → reprova.

---

### #20 — Modo folha reprova chave aninhada que EXISTE

- **Arquivo:** `scripts/i18n-chaves-usadas.mjs:153`
- **PR de origem:** #82 · **Categoria:** correctness · **Veredito:** CONFIRMADO (medido, 2 ângulos)
- **Evidência:** `if (!folhas.has(chave)) {` sobre
  `const folhas = new Set([...dicionario].map((k) => k.slice(k.lastIndexOf('.') + 1)))`
  — `chave` pode conter pontos, `folhas` nunca contém.

**O problema.** No modo folha a chave INTEIRA é comparada contra o conjunto
de ÚLTIMOS segmentos, então qualquer caminho com ponto é declarado ausente.

**Como reproduzir (medido).** Componente sem binding chamando
`t('table.name')` → exit 1, `- "table.name" … (namespace desconhecido — modo
folha)`, enquanto `Broadcasts.page.table.name` está no `pt-BR.json`.

**Alcance hoje:** `flow-canvas.tsx` e `flow-builder.tsx` já usam
`nodes.${type}.label` e `categories.${id}` sob o MESMO namespace `Flows.builder`
cujo `t` é entregue por prop ao `flows/shared.tsx` — mover um desses rótulos
para lá trava a publicação. O repo tem **249** chamadas `t('a.b…')`.

**Como corrigir.** No modo folha, aceitar a chave se ela casar como SUFIXO de
alguma chave do dicionário (`[...dicionario].some(k => k === chave || k.endsWith('.' + chave))`),
em vez de comparar contra o último segmento. Mantém a garantia fraca que o
modo folha admite ter, sem o falso vermelho.

**Resolvido em** PR #91: `folhas` (últimos segmentos) virou `sufixos` (todos
os sufixos por ponto de toda chave — `a.b.c` → c, b.c, a.b.c), e o modo
folha cobra pertinência ali. · **Medido:** `t('table.name')` com
`Broadcasts.page.table.name` no dicionário → OK; `t('table.colunaInventada')`
→ FALHA; mutação (último segmento de volta) → o teste do repro reprova.

---

### #24 — O portão imprime "OK" tendo conferido ZERO chaves

- **Arquivo:** `scripts/i18n-chaves-usadas.mjs:202`
- **PR de origem:** #82 · **Categoria:** correctness · **Veredito:** CONFIRMADO (medido)
- **Evidência:** `if (unicas.length === 0) {` → imprime
  "OK: toda chave literal pedida pelo código existe no dicionário" e
  `process.exit(0)`. Não há piso de cobertura.

**O problema.** A única condição de sucesso é a lista de faltantes estar
vazia. Um arquivo — ou o repositório inteiro — que saia do alcance dos regexes
vira **verde silencioso**, e a mensagem afirma uma garantia que não foi
verificada. É a mesma classe de falha que motivou o PR: uma proteção que
depende de alguém reparar num número.

**Como reproduzir (medido).**
`import { useTranslations as useTraducao } from 'next-intl'` +
`const rotulos = useTraducao('Inbox.sidebar')` + `rotulos('chaveInventadaQueNaoExiste')`
→ exit **0** e "OK". ⚠️ **O script NÃO imprime `literais conferidas: 0`** — o
contador é GLOBAL e continua 2673 com o probe no lugar (medido). É exatamente
esse o defeito: o arquivo saiu da cobertura **sem produzir sinal nenhum**. Para
ver que saiu, instrumente o walker, ou compare o total antes e depois de
acrescentar ao probe uma chave que sabidamente não existe.

`RE_BINDING` casa o TEXTO `useTranslations|getTranslations`, e o gate do modo
folha exige nome começando com `t`; um alias no import ou um envelope local
(`export const useT = (ns) => useTranslations(ns)`) apaga a cobertura do
arquivo inteiro.

**Como corrigir.** Duas guardas, baratas:
1. **Piso de cobertura.** Gravar o total atual (2673 em 31/08) num arquivo ou
   constante e reprovar se cair abaixo de, digamos, 90% dele — com mensagem
   dizendo que a queda é o defeito, não a chave.
2. **Todo arquivo que importa `next-intl` tem de produzir binding.** Se
   importar e o script não achar nenhum, reprovar nomeando o arquivo. Fecha o
   caminho do alias.

**Armadilha (relacionada, do `i18n-parity.mjs`):** chave que existe SÓ no
`pt-BR.json` passa nos dois scripts (`sobrando` é impresso como "inofensivo" e
não entra em `bloqueantes`), mas `src/i18n/messages.test.ts`, que roda no
MESMO job, reprova. Quem seguir a mensagem do checador novo e acrescentar a
chave só ao `pt-BR` passa nos dois scripts e quebra dois passos adiante. Vale
alinhar as duas guardas — ou ao menos dizer isso na mensagem de erro.

**Resolvido em** PR #91, com as duas guardas propostas — e uma lição de
ORDEM medida na implementação: a guarda "importa e não produz binding" tem
de rodar DEPOIS do gate do modo folha, senão acusa o import-só-de-tipo do
`message-media.tsx` (`ReturnType<typeof useTranslations>`), que é folha
legítimo. Piso `PISO_CONFERIDAS = 2400` (~90% das 2673; a mensagem diz que
o defeito é o ALCANCE, não uma chave); invocação direta continua aceita. A
armadilha relacionada do parity também: a mensagem de `sobrando` agora
avisa que `messages.test.ts` reprova chave órfã. Os fixtures dos testes
entram por `I18N_CHECK_ROOT`/`I18N_CHECK_PISO` (inertes fora dos testes), e
`vitest.config.ts` passou a incluir `scripts/**` — teste de portão que não
roda é portão sem prova. · **Medido:** o repro do alias
(`useTranslations as useTraducao` + chave inventada) sai de exit 0
silencioso para FALHA nomeando o arquivo; piso reprovando com "cobertura
CAIU"; 5/5 mutações da frente reprovam exatamente o teste correspondente;
suíte 171/2264 verde.

---

## F7 — Guardas e testes estruturais com falso verde

### #14 — A trava do roteador de funil vigia o `meta-send.ts` errado

- **Arquivo:** `src/lib/cb-channels/pipeline-routing.chamadores.test.ts:71`
- **PR de origem:** #79 · **Categoria:** test-coverage · **Veredito:** CONFIRMADO (4 ângulos)
- **Evidência:** `const NAO_PODEM_ROTEAR = [` com
  `lib/whatsapp/broadcast-core.ts`, `lib/automations/meta-send.ts`,
  `lib/cb-channels/engine-send.ts` — e **sem** `lib/flows/meta-send.ts`.

**O problema.** O teste existe para impedir que alguém "unifique" um sender no
núcleo de envio e traga o roteador de funil junto, escondido — o cabeçalho diz
isso. Mas ele vigia o arquivo derivado, não o real:

- `src/lib/ai/auto-reply.ts:10` → `import { engineSendText } from '@/lib/flows/meta-send'`
- `src/lib/automations/engine.ts:35` → `import { engineSendMedia } from '@/lib/flows/meta-send'`
- `src/lib/automations/meta-send.ts:6` → delega para `@/lib/flows/meta-send`
- `lib/cb-channels/engine-send.ts` (108 linhas) **nem é sender** — exporta só
  `resolveEngineChannel*`/`evolutionTransportFor`.

Ou seja: o arquivo protegido é o wrapper, e o arquivo por onde REALMENTE saem
fluxo, resposta automática de IA e mídia de automação está descoberto. Quem
trocar `engineSendText` por `sendMessageToConversation` em `flows/meta-send.ts`
faz toda resposta de robô abrir card de funil — **com a suíte verde**.

Há dois `meta-send.ts` no repo, e a nota do CLAUDE.md (~linha 1470) cita
"`meta-send.ts`, `engine-send.ts`" **sem caminho** — o que provavelmente
originou a troca.

**Como reproduzir.** Acrescentar `routeContactToPipeline` a
`src/lib/flows/meta-send.ts` e rodar `npm test` — passa.

**Como corrigir.** Duas camadas:
1. **Imediato:** acrescentar `lib/flows/meta-send.ts` (e avaliar
   `lib/whatsapp/broadcast-resume.ts`) à lista.
2. **Estrutural (preferido):** inverter a lógica. Em vez de uma lista de
   negados mantida à mão, varrer `src/lib/**` e `src/app/api/**` procurando
   quem importa `sendMessageToConversation` ou `routeContactToPipeline` e
   afirmar que o conjunto é IGUAL a uma **allowlist** explícita. Assim um
   sender novo reprova por padrão, sem depender de alguém lembrar.
3. Corrigir a nota do CLAUDE.md para citar os caminhos completos.

**Resolvido em** PR #88 — as duas camadas: lista de negados ganhou
`lib/flows/meta-send.ts` e `lib/whatsapp/broadcast-resume.ts`, e a varredura
default-deny anda `src/` inteiro afirmando igualdade EXATA com a allowlist
dos dois símbolos (nos dois sentidos: chamador novo reprova, e desligar um
esperado também). CLAUDE.md ganhou os caminhos completos e a história dos
dois `meta-send.ts`; `docs/public-api.md` documenta o negócio aberto pelo
`POST /api/v1/messages` (resíduo do R3). · **Medido:** o repro exato do
achado (roteador enxertado em `flows/meta-send.ts`) derruba 2 testes agora —
antes derrubava zero (contraprova §8.2).

---

### #15 — Apagar disparo dá toast de sucesso sem apagar nada

- **Arquivo:** `src/app/(dashboard)/broadcasts/[id]/page.tsx:291`
- **PR de origem:** #74 · **Categoria:** correctness · **Veredito:** CONFIRMADO (2 ângulos)
- **Evidência:** `const { error: delErr } = await supabase` … `.delete().eq('id', broadcastId)`,
  seguido de `if (delErr) { … return } toast.success(t('toastDeleted'))`.
  Um `grep useCan|GatedButton` no arquivo não devolve nada.

**O problema.** A migration `964` (do próprio PR #74) passou
`broadcasts_delete` de `'agent'` para `'admin'`, mas a página de detalhe do
disparo não ganhou a régua correspondente na tela. DELETE barrado pela RLS
volta **204 com zero linhas e sem erro** — o "0 linhas = sucesso" que o
CLAUDE.md documenta.

Das seis tabelas da 964, `automations`, `automation_steps`, `flows` e
`flow_nodes` passam por rotas com `requireRole('admin')` — essas estão
cobertas. **Duas são escritas direto do navegador:** `broadcasts` (esta tela) e
`broadcast_recipients`.

⚠️ **`broadcast_recipients` é o segundo buraco — não o esqueça.**
`src/hooks/use-broadcast-sending.ts` faz `.insert(batch)` (linha ~440) e quatro
`.update(...)` (linhas ~547, 558, 569, 581) direto contra a tabela, no meio de
um disparo em progresso. Um `agent` que dispare um broadcast tem os updates de
progresso silenciosamente barrados pela RLS de admin, sem erro. Corrija os dois
no mesmo PR: pôr o `GatedButton` na lixeira e fechar o PR achando que o par
rota+policy está resolvido deixa o caminho mais caro aberto.

**Como reproduzir.** Com um membro `agent` (ou simulando a policy), abrir
`/broadcasts/<id>` e clicar na lixeira → confirmar. Toast de sucesso, navega
para `/broadcasts`, e o disparo continua listado.

**Como corrigir.** As duas metades:
1. **Régua na tela:** `const podeGerir = useCan('manage-automations')` e
   `<GatedButton canAct={podeGerir}>` na lixeira — é exatamente o que a página
   irmã (`broadcasts/page.tsx:64,191`) já faz.
2. **Conferência do retorno:** `.delete().select('id')` e tratar
   `!data?.length` como falha. O padrão a copiar está em
   `src/components/inbox/painel/painel-do-contato.tsx:511-517` — atenção, lá é
   um `.update(...).select('id')` seguido de `if (error || !data?.length)`, não
   um delete; a forma é a mesma, a operação não. A tela nunca deve afirmar
   sucesso sobre 0 linhas.

**Resolvido em** PR #88 — lixeira atrás de `GatedButton`
(`manage-automations`, a régua da página irmã), `.delete().select('id')` com
0 linhas = toast de erro (chave nova nos dois dicionários), e os 4 updates de
status + o final do `use-broadcast-sending` conferidos pelo retorno
(`marcarDestinatario`) com AVISO pós-envio — nunca throw: a mensagem já saiu
e um erro no wizard convidaria a REENVIAR a campanha.
⚠️ **Refinamento MEDIDO sobre o plano:** o `agent` NÃO alcança os updates do
envio — o INSERT de `broadcasts` (passo 2 do hook) estoura ALTO na RLS antes
de qualquer envio, e o wizard está atrás de GatedButton na lista. O buraco
silencioso alcançável era só o DELETE; a conferência dos updates entrou como
defesa em profundidade (cascade-delete no meio do envio, drift futuro de
policy). · **Medido (E2E no preview, fixture draft criada/apagada):** DELETE
devolvendo 0 linhas (interceptado) → toast "Nada foi excluído…" e a página
FICA; delete real → "Disparo excluído" + navegação. Docstring de `roles.ts`
corrigida (§7).

---

## F8 — Filtros do inbox

### #16 — A faixa do filtro padrão some justo quando ela é necessária

- **Arquivo:** `src/components/inbox/conversation-list.tsx:630`, com o gêmeo em
  `src/components/inbox/filtros-salvos-menu.tsx:98`
- **PR de origem:** #83 · **Categoria:** correctness · **Veredito:** CONFIRMADO (6 ângulos)
- **Evidência:** `return padrao && mesmoFiltro(padrao.filtros, filtros) ? padrao : null;`
  contra `setFiltros(limparOrfaos(f, catalogosDoFiltro))` (linha 452) e a
  semente `limparOrfaos(padrao.filtros, catalogosDoFiltro)` (linha ~593).

**O problema.** O recorte que vai para o estado passa por `limparOrfaos`, mas
as DUAS superfícies que perguntam "qual filtro salvo está aplicado?" comparam
contra o objeto **cru**. Basta uma referência morta para `mesmoFiltro`
reprovar.

**Como reproduzir.**
1. Salvar um filtro "Jurídico" = `{status:'open', etiquetaIds:['t-urgente']}` e
   marcá-lo como **padrão**.
2. Apagar a etiqueta "Urgente" em Configurações.
3. Recarregar o inbox.
4. Observar: a caixa abre recortada (por `status:'open'`), mas a faixa
   "Filtro padrão: Jurídico · mostrar tudo" **não é renderizada** — exatamente
   no caso que ela existe para socorrer ("um inbox recortado por algo que o
   operador NÃO fez nesta sessão"). O gatilho do menu volta a dizer "Salvos"
   sem ✓.
5. Clicando "Jurídico" à mão: a lista muda, mas nada acende — parece que o
   clique não pegou.

**Como corrigir.** Comparar contra o recorte **já limpo**:
```ts
const padraoLimpo = padrao ? limparOrfaos(padrao.filtros, catalogosDoFiltro) : null;
return padrao && padraoLimpo && mesmoFiltro(padraoLimpo, filtros) ? padrao : null;
```
e o mesmo em `filtros-salvos-menu.tsx:98` (`salvos.find(f => mesmoFiltro(limparOrfaos(f.filtros, catalogos), filtrosAtuais))`).
Memoize — ver a nota de eficiência em §6/M5.

**Armadilha.** `limparOrfaos` depende dos catálogos, que chegam em tempos
diferentes (o de canais vem do `useChannels`, separado do `Promise.all`). Com
catálogo ainda vazio ele **não limpa nada** (por desenho), então a comparação
pode oscilar entre dois carregamentos. Se isso incomodar, gateie a faixa em
"catálogos carregados" em vez de tentar acertar a comparação nos dois estados.

**Ver também #17** (`descreverFiltro` marcando órfão sem a guarda de catálogo
vazio) — mesmo módulo, mesma família, e o conserto se beneficia de ser feito
junto.

**Resolvido em** PR #92 — as duas superfícies comparam contra
`limparOrfaos(f.filtros, catalogos)`, memoizado; a M4 entrou junto (os cinco
`orfao:` de `descreverFiltro` com a guarda de catálogo vazio). ⚠️ Nota de
registro: o "Ver também #17" logo acima descreve o **M4** — o #17 real é a
aba Campos da ficha (F11); numeração trocada no plano, não no código.
· **Medido (E2E, fixtures apagadas):** filtro "f8 fixture" com etiqueta
MORTA de nascença marcado como padrão → a faixa "Filtro padrão: f8 fixture ·
mostrar tudo" RENDERIZOU no reload (sem o fix não renderizava) e o gatilho
do menu mostra o nome. Mutação da M4 (guarda removida) → 46/47.

---

### #25 — Paginação de `deals` sem `ORDER BY` pula e repete linhas

- **Arquivo:** `src/components/inbox/conversation-list.tsx:286` (`buscarDeals`)
- **PR de origem:** #73 · **Categoria:** correctness · **Veredito:** CONFIRMADO (2 ângulos)
- **Evidência:** `.select("contact_id, stage_id", { count: "exact" })` seguido
  direto de `.range(de, de + PAGINA - 1);` — nenhum `.order()` entre os dois.

**O problema.** `range()` sem `order()` no PostgREST vira LIMIT/OFFSET sobre
ordem **indefinida**. Uma linha atualizada entre duas páginas muda de posição
no seq scan (nova versão da tupla vai para o fim), então a página seguinte
pode repetir linhas já vistas e omitir outras — e o guarda
`acumulado.length >= total` declara o resultado completo.

**Como reproduzir.** Conta com >1000 negócios (o `PAGINA` é 1000). Entre a
página 0 e a 1, arrastar um card de etapa no Kanban (é UPDATE). Os contatos
omitidos ficam sem entrada no mapa `etapaPorContato`, somem do recorte
"Funil: X" e passam a casar com "Sem negócio" — resposta invertida, sem erro
em lugar nenhum.

Um segundo caminho, sem concorrência: `count` ausente com a 1ª página cheia
cai no ramo `total == null` e devolve o acumulado (1000 de N) como íntegro,
contradizendo o contrato escrito no próprio bloco ("`linhas: null` = não dá
para confiar").

**Como corrigir.**
1. `.order("id", { ascending: true })` antes do `.range(...)` — os outros dois
   `.range()` do repo já ordenam (`contacts/page.tsx:174`, `use-tarefas.ts:170`).
2. Fechar o ramo `total == null`: se não veio contagem e a página voltou
   cheia, devolver `linhas: null` (não confiável) em vez do acumulado.

**Armadilha.** Ordenar por `id` é suficiente para estabilidade e é barato (PK).
Não ordene por `stage_id`/`contact_id`, que têm duplicatas.

**Resolvido em** PR #92 — `.order("id", { ascending: true })` antes do
`.range()` e o ramo `total == null` fechado (página CHEIA sem count devolve
`linhas: null`; só página incompleta é aceita como fim). · **Medido:** a
query REAL do navegador agora sai
`deals?select=contact_id,stage_id&order=id.asc&offset=0&limit=1000`
(performance API). O cenário >1000 negócios com UPDATE concorrente não é
reproduzível na conta real — coberto por leitura e pela direção do fix.

---

### #26 — Filtro salvo com etapa e sem funil some do painel

- **Arquivo:** `src/components/inbox/inbox-filters.tsx:676`
- **PR de origem:** #73 (agravado pelo #83) · **Categoria:** correctness · **Veredito:** CONFIRMADO (2 ângulos)
- **Evidência:** `(!doisNiveis || filtros.funilId !== null) && (` — o gate do
  campo Etapa depende de `filtros.funilId`.

**O problema.** O painel de dois níveis depende da invariante "etapa escolhida
⇒ `funilId` carimbado", garantida **só** pelo caminho do deep link `?etapa=`.
O outro escritor de `FiltrosDoInbox` — o filtro salvo/padrão que o #83
introduziu — grava `etapaId` sem `funilId`, e `aplicarFiltroSalvo` só chama
`limparOrfaos`, que não carimba nada.

**Como reproduzir.**
1. Numa conta com UM funil (`recorteTemDoisNiveis` falso — o seed do `?etapa=`
   deliberadamente **não** carimba `funilId` nesse caso), salvar um filtro com
   etapa escolhida.
2. Criar um segundo funil com etapas → `doisNiveis` vira `true`.
3. Aplicar o filtro salvo.
4. Observar: `etapasDoFunil` fica vazio, o gate reprova, o **campo Etapa não é
   renderizado**, e o campo Funil renderiza aceso dizendo "Qualquer funil". A
   lista está recortada por uma etapa que o painel não mostra e cujo campo não
   dá para reabrir para trocar.

**Como corrigir (sem carimbar nada).** Derivar o funil visível da etapa
escolhida, que o painel já tem em mão (`etapaAtual`, linha ~130):
```ts
const funilVisivel = filtros.funilId ?? etapaAtual?.pipeline_id ?? null;
```
e usar `funilVisivel` para alimentar `etapasDoFunil` **e** o rótulo do campo
Funil. Assim o estado deixa de ter duas fontes de verdade, e nenhum dos dois
escritores precisa mudar.

**Armadilha.** NÃO resolva carimbando `funilId` no `aplicarFiltroSalvo`. O
CLAUDE.md é explícito: `funilId` é escrito SÓ pelo seletor de funil, porque
carimbá-lo faria "Qualquer etapa" passar a significar "quem tem negócio neste
funil", sumindo em silêncio com quem ainda não virou negócio.

**Resolvido em** PR #92, exatamente pela derivação proposta
(`funilVisivel = filtros.funilId ?? etapaAtual?.pipeline_id ?? null`) usada
no gate do campo Etapa, no rótulo do Funil e no ✓ das opções — sem carimbar
nada, como a armadilha manda. · **Medido (E2E):** fixture com `etapaId` de
"Contato Avulso" e `funilId: null` aplicada numa conta de 4 funis → o painel
exibiu FUNIL: "Bancário - Comercial" (derivado) e o campo ETAPA presente com
"Contato Avulso"; a lista recortou 184→158.

---

## F9 — Erro de banco lido como ausência

### #07 — Erro de banco vira 404 "Análise não encontrada"

- **Arquivo:** `src/app/api/cb/radar/[conversationId]/estado/route.ts:94`
- **PR de origem:** #75 · **Categoria:** correctness · **Veredito:** CONFIRMADO (2 ângulos)
- **Evidência:** `const { data: atual } = await supabaseAdmin()` … `.maybeSingle();`
  — o `error` sequer é desestruturado, ao contrário do UPDATE dez linhas acima,
  que trata `if (error)`.

**O problema.** A consulta que distingue "a análise mudou" (409) de "a análise
não existe" (404) descarta o erro do PostgREST, então um blip de banco vira a
afirmação errada.

**Como reproduzir.**
1. Clicar em "Tratar" num cartão do Radar.
2. Fazer o UPDATE não casar (o worker reanalisou, ou mude o `analisado_em` à
   mão) **e** a segunda consulta falhar (bloquear a URL por 1 s).
3. `atual` volta `null`, o `if (atual)` não entra, a rota responde 404
   "Análise não encontrada" e a tela toasta isso.
4. O operador lê que o Radar perdeu a análise do cliente que está na frente
   dele — quando houve um erro de rede. E não recebe nem o 409 que mandaria
   reler, nem o 500 que diria "tente de novo": as duas reações que o PR
   construiu ficam inalcançáveis exatamente quando o banco tosse.

**Como corrigir.**
```ts
const { data: atual, error: erroAtual } = await supabaseAdmin()...maybeSingle();
// ⚠️ Erro de banco NÃO é "não encontrado": responder 404 aqui faz a tela
// afirmar que a análise sumiu quando só a consulta falhou.
if (erroAtual) return NextResponse.json({ error: 'LOOKUP_FAILED' }, { status: 500 });
```
E conferir se a tela tem ramo para 500 (hoje ela cai no genérico
`acaoFalhou`) — se não tiver, o mínimo é uma frase que peça para tentar de
novo em vez de anunciar perda de dado.

**Ver também #04**, a mesma classe na rota de abrir conversa.

**Resolvido em** PR #89 (na branch da F4, como a §0.6 previu — o bloco é o
MESMO que o #28 reescreveu; branch própria criaria o terceiro conflito do
trem). A releitura destrutura `error` → 500 `LOOKUP_FAILED` com log; a tela
ganhou o ramo (`consultaFalhou` nos dois dicionários: "Não foi possível
conferir a análise agora — tente de novo em alguns segundos").
· **Medido (E2E em produção, ZERO mutação de dado):** PATCH com
`analisado_em` desatualizado numa conversa real → **409 `analysis_changed`**
e o banco conferido intocado depois (estado/carimbo idênticos); PATCH em
conversa inexistente → **404 verdadeiro**. O ramo do 500 em si é
inalcançável sem derrubar o banco — coberto pelos dois caminhos vizinhos
medidos + leitura. i18n ×2 verdes.

---

## F10 — CI/CD e vazamento de credencial

### #29 — As duas tentativas de rollout são coladas, sem backoff

- **Arquivo:** `.github/workflows/pipeline.yml:282`
- **PR de origem:** #77 · **Categoria:** correctness · **Veredito:** CONFIRMADO
- **Evidência:** `- name: Roll out on the VPS (segunda tentativa)` vem
  imediatamente depois do passo `id: rollout` / `continue-on-error: true`,
  sem passo intermediário. `grep -c sleep` no workflow = **0**.

**O problema.** O `appleboy/ssh-action` não expõe retry interno e o timeout de
conexão padrão é 30 s. Numa falha `dial tcp :22 i/o timeout` a 1ª morre em
~30 s e a 2ª começa em seguida — **~30-40 s de separação**, dentro de qualquer
blip de rede único, que é a única causa que o PR se propôs a cobrir.

Não é hipótese: a memória do operador registra que em **31/08/2026 (PR #80) AS
DUAS tentativas falharam** com esse erro, com a VPS no ar, e que
`gh run rerun --failed` resolveu na primeira tentativa **minutos depois**. Os
"minutos" são a medida do que faltava: backoff, não uma segunda tentativa
imediata.

**Agravante no mesmo passo:** `continue-on-error: true` faz a 1ª tentativa
falha aparecer como **success** no resumo do Actions. O único indício restante
é o passo 2 ter *rodado* em vez de `skipped`, que nenhuma listagem de runs
mostra. A auditoria de execuções que originou o PR, refeita hoje, contaria
100% verde enquanto o rollout falha na primeira tentativa a cada push.

**Como reproduzir.** Não force um blip de rede — leia o histórico, que já
tem o caso: `gh run list --workflow=pipeline.yml --limit 100` e procure os
runs do dia 31/08 em torno do merge do PR #80; o job traz as duas tentativas
com `dial tcp ***:22: i/o timeout` e o rerun bem-sucedido minutos depois.
Para provar a ausência de espera sem rede: `grep -n 'sleep\|timeout' .github/workflows/pipeline.yml`
entre os dois passos de rollout — não há nada.

**Como corrigir.**
1. Um passo de espera entre as duas: `- if: steps.rollout.outcome == 'failure'`
   com `run: sleep 60`. Separa as janelas.
2. Devolver o sinal: um passo condicional com
   `echo "::warning::rollout precisou de 2ª tentativa"` (ou
   `$GITHUB_STEP_SUMMARY`), para a flakiness voltar a ser auditável sem
   reprovar o job.
3. Considerar fixar `appleboy/ssh-action` por SHA — é a action que recebe
   `secrets.VPS_SSH_KEY` (acesso root à VPS que hospeda CRM e Evolution) e o
   PR dobrou os pontos de uso dela, mantendo a tag móvel `@v1`.

**Armadilhas.** Não confunda com dois achados **pré-existentes** que a revisão
encontrou no mesmo arquivo e que **não são do #77** (confirmado pelo diff):
o ramo `else` do rollout sai com código 0 (verde sem publicar), e
`workflow_dispatch` em qualquer branch publica aquela branch e envenena a tag
`:latest`. Estão na §6 (M8, M9) — valem um PR próprio, não este.

**Resolvido em** PR #93 — os três itens: `sleep 60` condicional entre as
tentativas, `::warning::` + `$GITHUB_STEP_SUMMARY` quando a 2ª foi
necessária, e `appleboy/ssh-action` fixado por SHA (v1.2.5) nos dois usos.
M8/M9 ficaram fora, como o próprio achado manda (pré-existentes, PR
próprio). · **Medido:** leitura + sintaxe validada pelo CI do PR (o backoff
só executa em falha real no main; o warning aparecerá no primeiro blip).

---

### #30 — O save de configuração ainda ecoa a chave de IA na tela

- **Arquivo:** `src/app/api/ai/config/route.ts:213`
- **PR de origem:** #74 · **Categoria:** correctness · **Veredito:** CONFIRMADO
- **Evidência:** `return NextResponse.json(` com `{ error: err.message, code: err.code }`
  no ramo `err instanceof AiError` — e o mesmo arquivo já tem a exceção correta
  35 linhas abaixo (linha ~247, `const ehChave = ...`).

**O problema.** O PR #74 tirou o eco de `err.message` no `invalid_key` só do
`/api/ai/test`. A validação da chave de CHAT no `POST /api/ai/config` — mesma
tela, botão ao lado — continua devolvendo a mensagem crua do provedor, e a
mensagem da OpenAI **embute a chave enviada**:
`Incorrect API key provided: sk-proj-…abcd`.

`integracoes-panel.tsx:596` renderiza `dados.error` na tela — no painel cujo
próprio cabeçalho promete que "a rota nunca manda a mensagem do provedor: ela
embute o eco da chave enviada, e sairia num print de suporte".

Pior: com `rawKey === ''` e só o MODELO trocado, `apiKeyPlain` é a chave
**guardada** (`decrypt(existing.api_key)`), então o eco expõe a chave em uso.

**Como reproduzir.** Configurações → Integrações → cartão OpenAI: colar uma
chave com um caractere errado e clicar Salvar. A mensagem do provedor aparece
na tela com o prefixo da chave.

**Como corrigir.** Replicar a exceção que já existe no mesmo arquivo: quando
`err.code === 'invalid_key'`, devolver texto genérico ("a chave foi recusada
pelo provedor"); para os demais códigos, manter a mensagem — é ela que diz
"modelo não encontrado", e essa preservação é deliberada (está no CLAUDE.md).

**Armadilhas.** `/api/ai/draft:142` e `/api/ai/playground:91` ecoam igual —
confira os três no mesmo PR.

**Resolvido em** PR #93, pelo PADRÃO (§8.1): helper
`mensagemSeguraDeAiError` em `lib/ai/types.ts` usado nas TRÊS rotas do
achado (config, draft, playground) + unificado no ramo do modelo do Radar
que já tinha a exceção inline. Grep de `error: err.message` sob
`src/app/api/ai`: sobra só `test/route.ts` (forma já segura — chave
inválida devolve só `{code}`), e um pino estrutural afirma essa allowlist
exata: a 4ª cópia reprova a suíte. · **Medido (E2E, zero gravação — a
validação falha ANTES do upsert, config conferida intacta):** POST com
provider openai + chave lixo → `{code: 'invalid_key', error: 'o provedor
recusou a chave'}`, nenhum `sk-proj` no corpo — o caminho EXATO do achado
(o 401 da OpenAI ecoa a chave; o do Gemini, medido também, nunca ecoou).
Mutações: helper desprotegido → 1 failed; eco cru de volta → o pino pega.

---

## F11 — Menores de UX e estado

### #17 — Aba "Campos" da ficha gira para sempre se a consulta falha

- **Arquivo:** `src/components/contacts/contact-detail-view.tsx:278`, com o
  render em `:877`
- **PR de origem:** #83 (agravado pelo #78) · **Categoria:** correctness · **Veredito:** CONFIRMADO (5 ângulos)
- **Evidência:** `if (valuesRes.data) {` … `setCustomValues({ de: alvo, mapa: map });`
  — o carimbo de dono está DENTRO da guarda de sucesso, enquanto o render em
  `:877` é `{loadingCustom || !valoresDesteContato ? (<Loader2 …/>)`.
  `setLoadingCustom(false)` roda incondicionalmente.

**O problema.** Numa falha da consulta a `contact_custom_values`,
`customValues.de` fica `null` (ou apontando para o contato ANTERIOR),
`valoresDesteContato` é `null` e a guarda de render nunca deixa de ser
verdadeira: **spinner indefinido, sem toast, sem retry**. Só fechar e reabrir o
Sheet. Antes do PR a aba continuava utilizável.

O painel da conversa, que faz o MESMO trio de consultas, avisa
(`toast.error(tSidebar('loadError'))`, `src/components/inbox/painel/painel-do-contato.tsx:446`) — as duas
telas editam o mesmo dado e divergem aqui.

**Como reproduzir.** Bloquear a URL de `contact_custom_values` no DevTools e
abrir a ficha de um contato pela página de Contatos.

**Como corrigir.** Tratar o erro como o painel irmão faz:
```ts
if (dealsRes.error || tagsRes.error || fieldsRes.error || valuesRes.error) {
  toast.error(t('loadError'));   // chave nova nos DOIS dicionários
  setLoadingCustom(false);
  return;
}
```
e dar à aba um estado de erro com botão "tentar de novo" — ou, no mínimo, sair
do spinner. Note que **sucesso com zero linhas devolve `[]`, que é truthy**,
então o caso "cliente sem valor nenhum" não é afetado.

**Resolvido em** PR #94 — o erro das TRÊS consultas vira toast + estado de
erro com "tentar de novo" (chaves `customLoadError`/`customRetry` nos dois
dicionários), como o painel irmão da conversa já fazia.
· **Medido (E2E):** `fetch` interceptado derrubando só
`contact_custom_values` → a aba mostrou a frase de erro SEM spinner e com o
botão; despatchado, o retry recarregou a aba com os blocos reais.

---

### #27 — O canal de realtime das execuções é destruído e recriado a cada evento

- **Arquivo:** `src/hooks/use-execucoes-do-contato.ts:181`
- **PR de origem:** #75 · **Categoria:** correctness · **Veredito:** PLAUSÍVEL
- **Evidência:** `}, [contactId, nonce]);` com
  `() => setNonce((n) => n + 1)` como callback do `postgres_changes` (linha
  ~126) e `supabase.removeChannel(canal)` no cleanup (linha ~179).

**O problema.** O PR #75 moveu o `.subscribe()` para antes do fetch com a
justificativa de fechar uma janela de perda de eventos. Mas `nonce` continua
nas **dependências do efeito**, então todo evento de `flow_runs` derruba a
assinatura e cria outra — e é durante esse re-join que os eventos se perdem.

A revisão observou ainda que o reordenamento em si não fecha janela nenhuma
(a IIFE assíncrona devolve o controle ao efeito antes de qualquer resposta
HTTP chegar), e que o comentário novo documenta uma corrida que o código não
tinha. O irmão citado como modelo, `useQuemVeAConversa`, tem deps
`[accountId]` e assina **uma vez só**.

**Como reproduzir.** Abrir a aba "Automações" de uma conversa com robô ativo e
observar no Network/console o canal sendo removido e recriado a cada UPDATE de
`flow_runs`; um segundo UPDATE durante o JOIN não chega.

**Como corrigir.** Tirar `nonce` das dependências: o efeito assina uma vez por
`contactId`; o `nonce` só dispara o **refetch**, num efeito separado. E
reescrever o comentário para descrever o que a mudança realmente faz.

**Veredito confirmado** (era PLAUSÍVEL) e **resolvido em** PR #94: a
assinatura foi para um efeito próprio com deps `[contactId]`, declarado
ANTES do efeito do snapshot para preservar a ordem "assina, depois busca"
que o #75 quis criar; o `nonce` segue disparando só o refetch. A leitura
confirmou o mecanismo — o callback bumpa o nonce, o nonce estava nas deps,
logo todo evento derrubava e recriava o canal.
· **Medido:** pino estrutural de 3 casos + mutação (`nonce` de volta nas
deps → 1 failed). Sem E2E: exigiria UPDATE real em `flow_runs` de cliente.

---

### #31 — Bloco novo não nasce no fim (0-based × 1-based)

- **Arquivo:** `src/components/contacts/custom-fields-manager.tsx:374`
- **PR de origem:** #78 · **Categoria:** correctness · **Veredito:** CONFIRMADO (5 ângulos)
- **Evidência:** `const posicao = grupos.reduce((max, g) => Math.max(max, g.posicao), 0) + 1;`
  contra `setGrupos(nova.map((g, i) => ({ ...g, posicao: i })));` (linha ~587)
  e `FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord)` (966:233).

**O problema.** O estado otimista do arrastar grava `posicao: i` (0..N-1)
enquanto a RPC grava a `ORDINALITY` (1..N), e não há refetch depois do
arrastar. `handleCreateGrupo` então calcula `max+1` sobre um estado defasado
em 1.

**Como reproduzir.**
1. Conta com blocos A, B, C (banco: 1, 2, 3).
2. Arrastar para reordenar → banco 1,2,3; estado local 0,1,2.
3. **Na mesma sessão**, criar o bloco "Bancário": `max(0,1,2)+1 = 3`, que
   empata com C.
4. `ordenarGrupos` desempata pelo nome → "Bancário" aparece ANTES de C.
5. Um F5 mostra a mesma ordem errada, porque ela já foi gravada.

Isso falsifica duas afirmações escritas: o comentário na linha ~373 ("Nasce no
FIM da lista de blocos") e o da migration 966:54 ("Empate cai no nome…, o que
só acontece em grupo criado por outro caminho — a tela grava max+1").

**Como corrigir.** Escolher UMA base e valer nos dois lados. O mais simples:
fazer o estado otimista usar `posicao: i + 1`, espelhando a `ORDINALITY`.
Alternativa: refetch depois do arrastar (mais caro, e o refetch com spinner é
o achado M6 da §6).

**Armadilha relacionada, mesma tela (não reportada, ver §6/M7):** apagar um
bloco devolve os campos ao Geral **com a `posicao` antiga**, que é a posição
DENTRO do bloco apagado — as posições colidem e a ordem do Geral embaralha.
`handleDeleteGrupo` não renormaliza. Vale corrigir junto.

**Resolvido em** PR #94 — estado otimista do arrastar de blocos passou a
`posicao: i + 1`, espelhando a ORDINALITY da RPC (a opção "mais simples" do
próprio achado). A carona **M7** entrou junto: apagar bloco renormaliza
(Geral atual + os que voltam) pela MESMA RPC do arrastar, antes do refetch.
· **Medido (E2E, fixtures apagadas):** blocos "f11 a"/"f11 b" criados pela
tela nasceram em 2 e 3 (a base 1-based que o fix alinha); apagando "f11 a"
pela tela, o campo dentro dele voltou ao Geral em `posicao: 5`, continuando
a sequência densa 0–4 — sem colisão nem reembaralhamento por nome.

---

### #32 — Falha de rede ainda auto-atribui a tarefa ao criador

- **Arquivo:** `src/components/tasks/task-form.tsx:140`
- **PR de origem:** #74 · **Categoria:** correctness · **Veredito:** CONFIRMADO (2 ângulos)
- **Evidência:** `if (membros.length <= 1) {` → `setResponsavel((atual) => atual || (user?.id ?? ''))`
  — deps `[open, tarefa, carregandoMembros, membros.length, user?.id]`, **sem**
  `membrosFalharam`.

**O problema.** O PR #74 criou o sinalizador (`fetchAccountMembersOrNull` →
`falhou`) exatamente para desfazer a ambiguidade entre "conta de um membro" e
"a busca falhou" — e o consumiu só no RÓTULO do campo. O efeito que escolhe o
destinatário continua decidindo por `membros.length <= 1`.

O comentário de `src/lib/account/members.ts:22` afirma que o flag existe
justamente porque "o formulário de tarefa … AUTO-ATRIBUÍA a tarefa ao criador".
Só o texto mudou.

**Como reproduzir.** Conta com 5 membros, `/api/account/members` respondendo
500. Abrir "Nova tarefa": o campo Responsável fica `disabled` com `__eu__`
selecionado, e o Criar grava a tarefa para o próprio criador — a colega para
quem ele queria delegar nunca fica sabendo. Não há botão de repetir (o efeito
de `useMembros` roda com deps `[]`).

**Como corrigir.**
```ts
if (!membrosFalharam && membros.length <= 1) {
  setResponsavel((atual) => atual || (user?.id ?? ''));
}
```
Em falha, o campo fica vazio e `podeSalvar` já barra — o desenho "escopo vazio
não afirma nada" usado no resto do fork. E acrescentar "tentar de novo", como
o `invite-member-dialog.tsx` do MESMO PR faz para o MESMO modo de falha.

**Resolvido em** PR #94, na forma proposta (`!membrosFalharam &&
membros.length <= 1`) mais o "tentar de novo": `useMembros` ganhou
`recarregar` e o formulário troca o seletor desabilitado por mensagem +
botão quando a busca falha. ⚠️ O texto de `assigneeLoadFailed` prometia o
comportamento ANTIGO ("a tarefa ficará com você… recarregue a página") —
reescrito nos dois dicionários; `assigneeYou`, que só existia para aquele
ramo, foi removida (ficaria órfã e o `messages.test.ts` reprova).
· **Medido (E2E):** `/api/account/members` em 500 → "Nova tarefa" abriu com
a mensagem de falha, SEM "Você", "Criar tarefa" desabilitado e o botão de
retry; despatchado, o retry trouxe "Você (único membro desta conta)" sem
recarregar a página.

---

## 5. ⚠️ REFUTADOS — não reporte de novo

Estes quatro candidatos foram levantados pelos finders e **derrubados** na
verificação adversarial. Estão aqui para que uma sessão futura não gaste ciclo
re-achando o mesmo e não abra PR desnecessário.

### R1 — Migrations 967/968 sem `GRANT` para `service_role`
**Alegação:** as duas tabelas novas fazem `REVOKE ALL … FROM anon` +
`GRANT … TO authenticated` e param aí, contra a regra do banco vazio.
**Por que é falso:** o repo tem DOIS padrões, separados por CONSUMIDOR, não
por recência. Tabela com escritor server-side concede ao `service_role` (941,
944, 945, 953, 963, 966); tabela escrita **só pelo navegador sob RLS** não —
e sempre foi assim: `0924_cb_favoritar.sql:91-93` e
`0918_cb_notas_na_conversa.sql:123-124` têm a forma idêntica e replayam verdes
no mesmo CI. Os únicos consumidores de `cb_inbox_saved_filters` e
`cb_inbox_filtro_padrao` são `use-filtros-salvos.ts` (cliente do NAVEGADOR) e
o parser puro; zero ocorrências em `src/app/api/`. Além disso, o mecanismo de
dano documentado no CLAUDE.md é sobre `REVOKE … FROM PUBLIC` numa **FUNÇÃO**
(EXECUTE nasce concedido a PUBLIC); aqui o REVOKE é sobre TABELA e só
`FROM anon` — privilégio de tabela nunca nasce em PUBLIC, então o
`service_role` não pode perder nada.
**Resíduo legítimo:** se um dia nascer rota server-side sobre essas tabelas,
ela precisará do GRANT escrito — a mesma dívida latente que 918 e 924 já têm.

### R5 — `custom-fields-manager` exibe catálogo de OUTRA conta quando `accountId` muda
**Alegação (Codex, PR #86):** com `accountId` mudando depois de uma carga boa,
uma falha nas consultas da conta nova preservaria `fields`/`grupos` da conta
anterior com `catalogoConfiavel = true`, expondo o catálogo do outro tenant.
**Por que é falso:** `accountId` sai de `profile.account_id` no `useAuth`, e
só muda por (a) troca de USUÁRIO — `onAuthStateChange` com `user.id`
diferente, e o `signOut` faz `window.location.href = '/login'`, recarga
completa, sem painel montado —, (b) `refreshProfile()`, chamado só por
`profile-form.tsx` (mesma pessoa, mesma conta) e por
`account-access-alert.tsx` (retry de perfil SEM conta: `null → X`, e com
`accountId` nulo o `fetchFields` nem roda, então não há catálogo velho), e (c)
aceitar convite em `/join/[token]`, que é OUTRA página — o catálogo não está
montado. Não existe troca de conta em runtime no app. **Regra do CLAUDE.md:**
nada de fallback para cenário impossível.
**Resíduo legítimo:** se um dia nascer troca de conta sem recarga, o padrão
`{ de, mapa }` das duas fichas (carimbar o DONO junto do estado) é o
conserto — e vale para todo estado por conta, não só este.

### R2 — `podeEditar` ausente no `gravarCampo` do painel da conversa
**Alegação:** a ficha checa `podeEditar` e o painel não, e a descarga de
desmonte não consulta `disabled`.
**Por que é falso:** para um `viewer`, `useCan` falha fechado
(`use-can.ts:46`), então `disabled={!podeEditar || !dadosProntos}` é sempre
true; input desabilitado nunca chama `mudou`, logo `rascunhoRef.current`
continua igual ao valor de montagem e a descarga morre em
`salvamento-de-campo.ts:133` (`if (!valorMudou(desejado, valor)) return`) —
comportamento fixado por teste. E a RLS de `contact_custom_values`
(`0017_account_sharing.sql:502-506`) exige `agent`+ no `USING` **e** no
`WITH CHECK`, o mesmo limiar de `canSendMessages`, lido da mesma coluna.
**Resíduo legítimo:** sobra a assimetria de altitude (a ficha checa papel, o
painel checa dados carregados). Sem caminho de exploração.

### R3 — Envio pela API v1 / MCP abre negócio indevidamente
**Alegação:** o gancho no núcleo trata `/api/v1/messages` como "envio de
gente", mas ali quem autentica é uma CHAVE DE API.
**Por que é falso:** é decisão **declarada** e fixada por teste executável.
`pipeline-routing.chamadores.test.ts:37` traz, em `DEVEM_ROTEAR`:
`{ arquivo: 'lib/whatsapp/send-message.ts', quem: 'núcleo de envio (compositor, ficha, agendada, API v1)' }`.
Tirar a v1 do gancho REPROVA esse teste. O comentário do bloco, o cabeçalho de
`pipeline-routing.ts:12`, o commit e o corpo do PR #79 dizem o mesmo. A
"contradição" com `send-message.ts:345` é de vocabulário: lá "não por gente"
qualifica `nomeParaAssinar`. Quantificação honesta: `createDeal` tem guarda de
"um card por contato" em qualquer funil, então 300 contatos → no máximo 300
cards, um por contato DISTINTO ainda sem card — e zero para quem já tem card
pela ingestão.
**Resíduo legítimo:** `docs/public-api.md` descreve o efeito colateral de
criar contato e conversa e **não menciona** que o envio pode abrir negócio.
Lacuna de documentação, não defeito. Ver §7.

### R4 — Replay da migration 966 aborta por campo `tracking` sem grupo
**Alegação:** `handleSeed` grava `categoria:'tracking'` com `grupo_id: null`, e
a conferência final da 966 trata isso como violação com `RAISE EXCEPTION`.
**Por que é falso:** a Seção 3 da própria 966 roda **antes**, na mesma
transação, e conserta exatamente essas linhas — o `INSERT … SELECT DISTINCT`
garante um bloco "Traqueamento" para toda conta com campo `tracking`, e o
`UPDATE … WHERE categoria='tracking' AND grupo_id IS NULL` move o conjunto que
a conferência inspeciona. Quando a linha 275 executa, `v_sem_grupo` é 0 por
construção. Alcance real: nenhum, em CI (banco vazio), `db reset` ou produção.
**Resíduo legítimo:** o estado `tracking` + `grupo_id` nulo **é** criável pela
tela; ele só não quebra migration nenhuma.

---

## 6. Achados menores levantados e NÃO reportados

A revisão produziu ~120 candidatos; 32 entraram no relatório e os ~23 abaixo
valem registro. Eles não sustentam uma frente sozinhos, mas **valem ser
resolvidos de carona** quando alguém abrir aquele arquivo por outro motivo.

⚠️ **Os ~65 restantes não têm caminho de recuperação.** Eram sobretudo achados
de reuso/simplificação/eficiência que não couberam, mais duplicatas entre
ângulos — não foram refutados, só não foram promovidos. O ledger bruto vivia em
`LEDGER.md` num scratchpad de sessão (efêmero, provavelmente já apagado).
**Consequência prática:** se uma revisão futura reencontrar um candidato que não
esteja nesta seção nem na §5, trate-o como NOVO — não presuma que já foi
avaliado e rejeitado.

| id | Onde | O que | Carona natural |
| --- | --- | --- | --- |
| **M1** | `custom-fields-manager.tsx:265` e `:466` | `handleCreate` e `handleSeed` gravam `user_id: user.id` em `custom_fields`, que é CASCADE para `auth.users` e leva `contact_custom_values` junto. **Pré-existente**, não é do #78 (o diff mostra a linha como contexto). Mesma família do #11/#12, severidade menor (o dado é definição de campo + valores, não histórico de conversa) | F2 — ✅ PR #90 (`ownerUserId` nos dois; `custom_fields` entrou na varredura; E2E: campo fixture criado com `user_id` do dono e apagado) |
| **M24** | `supabase/migrations/0001_initial_schema.sql` (+006, 010, 035) | ⚠️ **Irmão da F2 e da 971, e é DECISÃO DE PRODUTO.** `tags`, `message_templates`, `pipelines`, `whatsapp_config`, `broadcasts`, `automations`, `automation_logs`, `automation_pending_executions`, `flows`, `flow_runs` e `quick_replies` têm o MESMO `user_id … ON DELETE CASCADE` para `auth.users` que a F2 fechou em contatos/conversas/campos — e `pipelines` cascateia `deals`. São carimbados com quem CRIOU (upstream), e telas do upstream filtram por essa coluna (`tag-manager`, `template-manager`, `settings-overview` usam `.eq('user_id', user.id)`): apagar o login de um admin que criou o funil apaga o funil e os negócios. Reparentar para o dono muda o que cada pessoa vê nessas telas; converter as FKs para `SET NULL` exige `user_id` anulável e revisar quem lê. Medido em 01/09: 0 linhas fora do dono em TODAS elas (conta de um membro) — dormente até o segundo membro criar algo | 🔵 **decisão do operador** — não é carona: a 971 deixou de fora de propósito |
| **M22** | `message-composer.tsx:684` | ⚠️ **Irmão do #01, e mais provável que ele.** O efeito de troca de conversa limpa `pendente`, agendamento, seletor e anotação — mas **não** `draft`. O anexo JÁ POUSADO do cliente A continua montado no compositor de B, e `sendDraft` chama o `onSendMedia` de B. Não exige rede lenta: basta anexar e trocar de conversa. O #74 fechou o upload EM VOO e deixou o rascunho pousado | **F1, com o #01** — ✅ resolvido no PR #86 (o efeito de troca descarta o rascunho e limpa o estado) |
| **M2** | `radar/page.tsx:110` | `const { channels } = useChannels()` sem `loading` → "canal com Radar desligado" derivado de lista vazia; análise de canal PESSOAL desligado aparece na tela. Exceção deliberada à convenção "vazio = todos" (privacidade, 941) | F5 — ✅ PR #95: `canaisFalharam` esconde TODO insight com canal (medido: 2 de 23 sob falha) e a carga dos canais entra no spinner |
| **M3** | `use-radar.ts:259` | análise `failed` tem `analisado_em` NULO; com `.order(..., nullsFirst:false).limit(200)` ela é a PRIMEIRA a cair do teto, e não há consulta de resgate (só pendência tem). A garantia "failed aparece independente de gatilho" expira em silêncio | F4 — ✅ PR #96 (caiu no vão da F4 e foi registrado como pendente na revisão de 01/09; agora tem consulta de resgate própria, ordenada por `created_at` porque `analisado_em` é justamente a coluna nula) |
| **M4** | `filtros-salvos.ts:300/350` | `descreverFiltro` marca `orfao` sem a guarda de "catálogo vazio não prova nada" que `limparOrfaos` aplica 140 linhas abaixo → o menu escreve "(apagado)" sobre etiqueta/etapa VIVAS enquanto os catálogos carregam | F8 — ✅ PR #92 (guarda nos 5 campos + teste CRÍTICO com contraprova) |
| **M5** | `filtros-salvos-menu.tsx:299/498` + `conversation-list.tsx:614` | o menu recalcula `descreverFiltro` para o filtro atual e para cada salvo a CADA render (inclusive com os dois diálogos fechados), e a busca do inbox mora no mesmo pai → roda por tecla digitada. E `esperandoPadrao` serializa perfil→filtros antes da primeira pintura do inbox, para todo mundo | F8 — ✅ **ENCERRADO POR MEDIÇÃO (01/09)**: o PR #92 fez a metade barata; a outra não existe. As consultas saem em PARALELO (todas às ~613ms): filtros salvos terminam em 754–839ms, `pipeline_stages` em 894ms e **`conversations` em 1059ms** — o `esperandoPadrao` está inteiramente coberto pelo `loading` e custa ZERO. Reabrir só se a consulta de conversas ficar mais rápida (paginação) ou os catálogos mais lentos |
| **M6** | `custom-fields-manager.tsx:155` | `fetchFields` liga `loading` e refaz as DUAS consultas depois de TODAS as 8 escritas — inclusive renomear um campo. Zera a rolagem (a nota original dizia "desmonta a lista"; a MEDIÇÃO mostrou outro mecanismo — o contêiner fica, o conteúdo dele é que some) | ✅ PR #103 — **medido**: renomear um campo levava a rolagem de 139 a 0, porque o spinner substitui o conteúdo e o `scrollHeight` desaba de 1215 para 84, fazendo o navegador grampear o `scrollTop`. Valia para as OITO escritas. O spinner virou opcional e só a montagem o pede; depois: 139 → 139, gravação confirmada no banco |
| **M7** | `custom-fields-manager.tsx:419` | `handleDeleteGrupo` não renormaliza `posicao`: os campos voltam ao Geral com a posição DENTRO do bloco apagado, colidem, e `ordenarCampos` desempata pelo nome → a ordem que o operador montou embaralha, na ficha de TODO cliente | F11 — ✅ PR #94 (renormaliza pela RPC do arrastar antes do refetch; medido: campo volta em posicao 5 sobre um Geral 0–4) |
| **M8** | `pipeline.yml:240` (era `:212` antes do conserto) | o ramo `else` do rollout sai com código 0 → pipeline VERDE sem ter publicado. Cobre 4 estados, não só "serviço não existe": daemon fora do ar, nó fora de manager, SSH sem acesso ao socket. **PRÉ-EXISTENTE** (vem do `deploy.yml` original), não é do #77 | ✅ branch `chore/node-22-em-todo-lugar` — o script separa os quatro estados e **sai 1** nos quatro casos que não publicam. Medido com `docker` real (sem Swarm: antigo exit 0 / novo exit 1) e com stub para os outros três; caminho feliz confirmado chamando o mesmo `service update --image ... --with-registry-auth crm_crm` |
| **M9** | `pipeline.yml:205` (era `:187` antes do conserto) | `if: github.event_name != 'pull_request'` inclui `workflow_dispatch` → disparar o pipeline manualmente numa branch de feature faz rollout dela na VPS e reescreve a tag `:latest`. O comentário da linha 179 diz "⚠️ Só no main", o `if` diz "não é PR". **PRÉ-EXISTENTE** | ✅ branch `chore/node-22-em-todo-lugar` — o portão virou LISTA DE PERMISSÃO sobre a ref: `github.ref == 'refs/heads/main' && (event == 'push' || event == 'workflow_dispatch')`. Lista de permissão e não negação porque `pull_request_target`, se algum dia entrar no `on:`, roda com a ref da BASE (`refs/heads/main`) — checar só a ref não bastaria, e negar só `pull_request` não o pegaria. `actionlint` limpo |
| **M10** | `message-thread.tsx:526` | `return { expired: true, remaining: "No customer messages" }` — literal em INGLÊS na badge, com a chave `Inbox.sessionTimer.noCustomerMessages` traduzida nos três dicionários e sem uso. Nenhum dos dois portões pega (um compara dicionários, o outro só cobra chave PEDIDA) | F5 — ✅ PR #95 |
| **M11** ⚠️ | `message-thread.tsx:518` | `sessionInfo` chama `new Date()` mas depende de `[messages, tTimer]` — não envelhece. A badge congela em "1h restantes" e a janela pode fechar com o compositor liberado. **Limita o `janelaExpiradaRef` da leva pendente**, que lê esse mesmo memo | F5 — ✅ PR #95: relógio próprio (`agoraDaBadge`, tique de 60s) nas deps do memo; só arma com a janela Meta em jogo |
| **M12** | `message-thread.tsx:2163` | `channelKind={activeChannel?.kind ?? null}` continua cru: durante a carga o compositor desabilita como Evolution E oferece Templates/interativo da Meta, com o `TemplatePicker` recebendo `channelId=null` → **recorte por WABA desligado** (o CLAUDE.md marca isso como load-bearing) | F5 — ✅ PR #95: prop `transporteConhecido`; medido — o botão Modelos some sob falha |
| **M13** ⚠️ | `message-thread.tsx:1181` | `handleSendInteractive` é o 3º disparo e ficou fora do portão da leva pendente. **Só existe se a leva da §0.3 tiver sido mesclada**; sem ela o item vira "conferir se o portão, quando entrar, cobre os TRÊS disparos" | F5 — ✅ CONFERIDO no PR #95: o #84 já cobria os TRÊS disparos; virou pino estrutural (`janela-24h.chamadores.test.ts`) |
| **M14** | `use-channels.ts:29` | sem cache: 2 a 4 GETs idênticos por carga do inbox (`conversation-list`, `message-thread`, `scheduled-bar`, `group-sidebar`) | F5 — ✅ PR #95: cache de módulo (15s) + vôo compartilhado; medido 3–4 GETs → 1 |
| **M15** | `abrir/route.ts:236, :46, :172, :247, :35, :200` | seis achados menores da mesma rota: `buscar()` descarta `error`; erro ao ler `profiles` vira 403 "seu perfil não está ligado a uma conta"; `pinConversationChannel` roda incondicionalmente (FIXA canal de conversa ativa alheia) e o retorno é descartado; conversa `closed` não chama `reopenClosedConversation`; **única rota de escrita de `/api/cb` sem `checkRateLimit`**; nome digitado é ignorado quando o contato já existe | F9 / PR próprio — a METADE do `buscar()` (erro descartado) ✅ saiu no PR #86, junto com o #04; o resto segue pendente |
| **M16** | `execucoes/executar/route.ts:116` | o comentário diz "Falha ABERTA (contato sem negócio deixa passar)"; `stageInScope` devolve `false` (`engine.ts:1167`) → 422 fail-CLOSED. Nota mentindo | §7 — ✅ PR #89 corrigiu o comentário da rota E a nota do CLAUDE.md (as duas direções, com motivo) |
| **M17** | `964:129` | a conferência da migration pega policy RENOMEADA (`count < 12`) mas não policy ADICIONADA — um merge do upstream que reintroduza `"Users can manage own broadcasts"` reabre o furo com a migration imprimindo "OK" | ✅ PR #98 — a conferência passou a perguntar pelo CONJUNTO, em duas metades: `verify-schema.sql` (banco replayado; medido no Postgres 16 local — limpo passa, policy intrusa sai com exit 3 nomeando a policy) e um teste estrutural que roda em `verificar`, o job que gateia o deploy |
| **M18** | `perfis-panel.tsx:538` | a grade de canais do perfil não tem a saída "Todos" nem o rótulo de id órfão que o `ChannelMultiSelect` já tem → recorte órfão fica irremovível e a lista de perfis afirma o contrário na mesma tela | ✅ PR #99 — passou a usar o `ChannelMultiSelect` (tem o item "Todos", que zera o array inteiro) e a linha resume por `summarizeScope`. Medido com perfil fixture de id órfão: a lista dizia "1 conexão" e passou a dizer "conexões que não existem mais"; o recorte foi limpo PELA TELA (`channel_ids` de `['0000…ff']` para `[]` no banco) — antes era impossível. Fixture apagado |
| **M19** | `agenda/[id]/route.ts:245` | `channel_id` torto no PATCH vira `null` (desvincula o canal) e devolve 200, enquanto o mesmo PR aplicou "presente e torto = 400" a `owner_user_id` e `contact_id` | F9 — ✅ PR #96 (presente e torto = 400, como `owner_user_id`/`contact_id` na mesma rota; `null` explícito continua desvinculando) |
| **M20** | `0965_cb_transferencia_limpa_perfil.sql` | conserta a CAUSA e não faz backfill: um `profiles` que já esteja `owner` + `perfil_id` preenchido (o estado que o cabeçalho chama de irremovível) permanece assim para sempre | ⏭️ **ENCERRADO POR MEDIÇÃO (01/09)**: `profiles` tem UMA linha, `owner` com `perfil_id` NULO — zero linhas no estado divergente. As duas portas que o criavam estão fechadas (962 no `set_member_role`, 965 na transferência), então o backfill só alcançaria linhas anteriores a elas, e não há nenhuma. A migration seria um UPDATE sem efeito, replayado para sempre pelo CI |
| **M21** | vários (detalhe abaixo) | pacote de reuso/simplificação — **cada item com sua âncora**, senão a "carona" não acontece | ✅ PR #102 (menu de blocos + código morto) e **#103** (o item grande: as pastilhas do painel passaram a sair do `descreverFiltro`, acabando com a segunda cópia que o cabeçalho do módulo negava existir). ⚠️ Três itens da lista NÃO eram o que a nota dizia — ver as correções abaixo da tabela |
| **M23** | `src/lib/cb-radar/worker.ts:428` | `if (agErr) throw` na consulta de agendadas derruba a análise INTEIRA e queima 1 das 3 tentativas, por um refinamento opcional da régua. A metade gêmea (`use-radar.ts:203`) degrada com `console.warn`, de propósito. Três vezes na mesma conversa e a linha congela em `failed` | F4 — ✅ PR #89 (o `throw` do erro da consulta de agendadas ficou, com a DIREÇÃO do erro documentada no worker: degradar apagaria o alarme) |

**Detalhe do M21** (âncoras conferidas em `origin/main` @ `b9ceca8`):

| Onde | O quê |
| --- | --- |
| `src/lib/inbox/filtros-salvos.ts:174` × `src/components/inbox/inbox-filters.tsx:175` | o cabeçalho declara "UMA descrição, DUAS superfícies"; as pastilhas do painel seguem montadas à mão, ~110 linhas com os mesmos 10 ramos |
| `src/lib/contacts/salvamento-de-campo.ts:52` | `export { TIPO_DATA }` — reexport sem importador; os 5 consumidores reais importam de `@/lib/contacts/campo-data`. ⚠️ O TIPO em si é vivo (`campo-personalizado-input.tsx:52`); morto é só o reexport |
| `src/lib/contacts/salvamento-de-campo.ts:26` | `gravaAoSair` sem call site (só `gravaAoEscolher`, que é o `!` dela) |
| `src/lib/contacts/salvamento-de-campo.ts:141-142` | `salvo()` e `emVoo()` exercitados só pelo teste |
| `src/lib/inbox/filtros-salvos.ts:225` | `PedacoDoFiltro.limpar` e `.cor` calculados para todo pedaço e lidos por ninguém |
| `src/lib/contacts/campos-de-traqueamento.ts:53` e `:58` | `camposDeTraqueamento`/`camposGerais` sem consumidor; o JSDoc descreve a aba extinta |
| `src/components/contacts/contact-detail-view.tsx:891-911` × `src/components/inbox/painel/painel-do-contato.tsx:1241-1262` | menu horizontal de blocos duplicado nas duas fichas — **já divergiu**: `text-xs` de um lado, `text-[11px]` + `cn()` do outro |
| `src/components/contacts/custom-fields-manager.tsx:553-560` × `:569-571` | o estado otimista do arrastar reimplementa `posicoesDoBloco` inline, 15 linhas acima da chamada real |
| `src/components/contacts/custom-fields-manager.tsx:914-921` × `:1010-1017` | o "input que salva no blur" copiado no mesmo arquivo (bloco e campo) |
| `src/components/inbox/filtros-salvos-menu.tsx:465` × `:483` | o corpo do renomear escrito duas vezes (Enter e clique) |

⚠️ **Três itens desta lista foram MEDIDOS em 01/09 e não eram o que a nota
dizia** — registrado aqui porque "código morto" que não está morto é a pior
carona possível:

- **`.cor` do `PedacoDoFiltro` É LIDO** (`inbox-filters.tsx:421`, a bolinha
  colorida da etiqueta). A nota dizia "calculados para todo pedaço e lidos por
  ninguém"; vale só para `.limpar`.
- **`.limpar` não deve ser apagado.** O painel monta as próprias pastilhas com
  `aoRemover: () => mexer({ tipo: "todas" })` — o MESMO conhecimento que o
  `descreverFiltro` já guarda em `limpar: { tipo: "todas" }`. Apagar o campo
  consagraria a duplicata; o conserto é o primeiro item da tabela (unificar as
  duas superfícies), que é trabalho próprio e não carona.
- **`gravaAoSair` fica exportada.** Ela não tem call site de produção, mas TEM
  teste próprio, e é ela que ENUNCIA a regra (`gravaAoEscolher` é a negação).
  Removê-la trocaria clareza por uma linha a menos.
- **`salvo()`/`emVoo()` da fila ficam.** Existem para o teste inspecionar a
  fila — e é esse teste que guarda a corrida que apagava edição do operador.
  Simplificação que custa cobertura de caminho de gravação não é ganho.

---

## 7. Notas do CLAUDE.md que ficaram FALSAS

> Regra do topo do próprio arquivo: *"Ao achar divergência, atualize o
> CLAUDE.md no mesmo PR. **Nota mentindo é pior que ausência de nota.**"*
> Estas nasceram ou sobreviveram aos PRs de 31/08. Corrija cada uma **no PR da
> frente que toca aquele código** — não num PR de documentação separado, que é
> como elas envelhecem de novo.

| Onde | O que a nota diz | O que o código faz | Corrigir em |
| --- | --- | --- | --- |
| `CLAUDE.md:587` (seção 966) | "Um `Salvar campos` só, e ele salva TODOS os campos — inclusive os dos blocos que não estão à vista" | O botão não existe: o #83 trocou por salvamento automático por campo. A linha 453 do MESMO arquivo diz "não existe mais 'Salvar campos'". **5 ângulos acharam** | F3 — ✅ PR #87 (conferido em 01/09: o texto falso não existe mais) |
| `CLAUDE.md:481` | credita a idempotência da descarga de desmonte a `salvoRef` | `grep -rn 'salvoRef' src/` → **zero**. O mecanismo é `desejado`/`salvo` DENTRO de `criarFilaDeGravacao`, e a comparação é contra `desejado`, não `salvo` | F3 — ✅ PR #87 (a nota agora diz que o `salvoRef` creditado nunca existiu) |
| `CLAUDE.md:538` | "`.order('posicao', …)` em TODA consulta — são 8 call sites (painel da conversa ×2)" | São **7**, e o painel tem **1**. E a leva pendente REVERTE 4 deles (listas planas) com o argumento oposto, sem tocar na nota | F3 — ✅ PR #87 |
| `CLAUDE.md:1493` | "no dia em que essa pessoa sair da equipe, o contato é apagado junto" | `remove_account_member` (018) e a 961 **não** apagam de `auth.users` — realocam o perfil. O gatilho real é apagar o usuário fora do app | F2 — ✅ PR #90 (nota reescrita: gatilho = login apagado FORA do app; `custom_fields` e o `ownerUserId` do useAuth incluídos; aponta a varredura nova) |
| `CLAUDE.md:220` | o `ExecutarAutomacaoDialog` recebe "canal RESOLVIDO — `activeChannel`" | O #74 trocou para `conversation.channel_id ?? null`. Quem resolver conflito de merge seguindo a tabela reintroduz o bug | F4 — ✅ PR #89 |
| `CLAUDE.md:380` | "a rota `executar` checa o escopo de canal" e "falha ABERTA" | O #74 acrescentou o recorte de ETAPA, e `stageInScope` falha FECHADA (ver M16) | F4 — ✅ PR #89 |
| `CLAUDE.md:1325` | a automação de etapa "espera o ciclo de 15 min do cron" | O laço RÁPIDO do `docker-stack.yml` é `sleep 60`. O próprio #74 mediu isso e atualizou `lembretes.ts` e `DEPLOY-VPS.md`, mas não o CLAUDE.md | F4 — ✅ PR #89 (laço rápido, 60s) |
| `CLAUDE.md:441` | a rota do acervo "confere `data === false` ANTES do `error`" | O #74 reescreveu para `try/catch` lendo só `r.data`. A nota descreve a forma antiga e ensina a repeti-la | F4 — ✅ PR #89 |
| `CLAUDE.md:1937` | "Até ali a única proteção era lembrar de rodá-los à mão" | `src/i18n/messages.test.ts` já gateava a paridade no MESMO job `verificar`, e mais rigorosamente (reprova chave órfã, que o `i18n-parity` chama de "inofensivo") | F6 — ✅ PR #91 |
| `CLAUDE.md:1949` | o checador "cobra contra TODOS os namespaces do arquivo" | Cobra contra todos MENOS os sobrescritos — ver #19 | F6 — ✅ PR #91 (a nota ganhou o caso dos REDECLARADOS, do #19) |
| `src/lib/auth/roles.ts:85` (docstring) | `agent` pode "run broadcasts, edit automations" | A 964 fechou as duas no banco; a rota e a tela já exigiam admin. As três camadas dizem não | F7 — ✅ corrigida no PR #88 |
| `docker-stack.yml:17,56,63,85` | cita `.github/workflows/deploy.yml` (extinto) e descreve UM laço de 15 min | Só existe `pipeline.yml`; o agendador roda DOIS laços (60 s e 900 s) | F10 — ✅ PR #96 (a F10 passou por cima; corrigido de carona: `pipeline.yml`, os DOIS laços e o campo certo do CRM_IMAGE) |
| `messages/*.json` (Radar) | `semRespostaDesdeTitulo` e `vazioSemSinalDetalhe` cravam "24 horas" | `LIMIAR_ALARME_MS` viaja como valor para `cardPendencias` e para a legenda. Trocar o limiar faz a mesma tela contar duas histórias | F4 — ✅ PR #89 ({horas} interpolado da constante nos dois textos) |
| `messages/*.json` (Radar) | `Radar.legenda.estados` diz que o cartão "sai da lista na hora" e que o Desfazer é a correção | O #74/#76 passaram a manter o cartão listado com "Reabrir" (`mexidasAqui`) | F4 — ✅ PR #89 (texto novo nos dois dicionários, medido na tela) |
| `docs/public-api.md:131` | descreve os efeitos colaterais de `POST /api/v1/messages` | Não menciona que o envio pode ABRIR NEGÓCIO (`source: 'channel'`) — comportamento intencional do #79, não documentado | F7 — ✅ documentado no PR #88 |

---

## 8. Os três padrões atravessados

Isto não é um achado; é o que explica por que 32 achados saíram de um só dia
de merges. Vale mais que qualquer item individual.

### 8.1 Conserto aplicado num call site quando havia três

O #74 pôs a guarda de conversa em 2 dos 3 uploads (#01). O #80 corrigiu o dono
durável em 1 de 4 caminhos (#11, #12). O #74 corrigiu "0 linhas ≠ sucesso" no
painel e não na ficha, nem no botão de apagar disparo (#15). O #74 corrigiu a
régua de "resposta de gente" em 1 de 2 lugares (#21). O #74 consumiu o
sinalizador `falhou` no rótulo e não no efeito (#32).

O CLAUDE.md já avisa dessa classe para `routeContactToPipeline` (QUATRO call
sites) e `resolveTemplateRow` (CINCO). **A lição não pegou nos lotes de
correção**, que são justamente onde ela mais importa — um PR que conserta 15
coisas tem 15 chances de parar no primeiro call site.

**Contramedida sugerida:** ao consertar qualquer coisa, `grep` pelo PADRÃO
antes de fechar o PR, e escrever no corpo do PR quantos call sites existiam e
quantos foram tocados.

### 8.2 Testes estruturais que dão falso verde

`dono-duravel.test.ts` casa o nome da variável (#13 — três mutações naturais
passam) e `pipeline-routing.chamadores.test.ts` vigia o wrapper em vez do
sender real (#14). Os dois foram escritos como rede de segurança e hoje são
anestesia: eles fazem a revisão humana relaxar sobre exatamente o ponto que
não protegem.

**Contramedida:** todo teste estrutural novo tem de vir com a lista de
mutações que ele reprova — e alguém deve tentar 3 mutações plausíveis antes
de mesclar. Foi assim que os dois foram derrubados aqui.

### 8.3 Lista vazia virando afirmação positiva

O CLAUDE.md fixou a regra em 31/08 depois do defeito do #81, e no MESMO dia
ela foi violada em quatro lugares novos: o diálogo de nova conversa (#08), o
painel do Radar (M2), o catálogo de campos (#02 na escrita; a frase de vazio
saiu da lista porque a leva pendente da §0.3 a toca, ainda que sem olhar o
`error`) — e o próprio conserto do #81 ficou incompleto porque o hook não
distingue "resolveu vazio" de "falhou" (#06).

**Contramedida:** a distinção tem de morar no HOOK, não em cada consumidor.
Enquanto `useChannels` devolver só `{channels, loading}`, cada tela nova vai
repetir o erro — e são ~24 telas.

---

## 9. Encerramento de cada frente

Ao concluir uma frente, edite este arquivo **no mesmo PR**:

1. Marcar a linha da tabela da §1 como ✅ com o número do PR.
2. Em cada achado resolvido, acrescentar ao fim:
   `**Resolvido em** PR #NN — <o que foi feito> · **Medido:** <o que você
   verificou na tela/no banco, não o que você espera>`.
3. Se algum achado foi **descartado** (o operador decidiu não corrigir),
   escrever ⏭️ com o motivo — não apague o item. Se ficou **parado esperando o
   operador**, marcar 🔵 com a pergunta exata que está pendente e a data —
   senão a frente parece esquecida em vez de bloqueada.
4. Corrigir as notas do CLAUDE.md da §7 que pertencem àquela frente.
5. Se a correção mudou comportamento documentado, atualizar o CLAUDE.md e
   `docs/` na mesma passada.

**Checklist técnico por PR:** `npm run typecheck` · `npm run lint` ·
`npm run test` · `node scripts/i18n-parity.mjs` ·
`node scripts/i18n-chaves-usadas.mjs` · preview em 1440×900+ · revisar 2×.

> **Adição do operador (31/08, durante a execução):** ao fim de CADA frente,
> revisar o que foi feito e **testar end-to-end no preview** o que for
> testável na tela — não só os checks de linha de comando. Quando o preview
> estiver sem sessão (o pane pode cair na tela de login, e autenticação não
> se fabrica), registrar no achado exatamente qual medição ficou pendente e
> rodá-la assim que houver login — pendência de medição não é medição.

---

## 10. Revisão do Codex sobre os PRs desta correção (01/09/2026)

O Codex revisou os PRs de 31/08–01/09 (#84 a #103) e devolveu 24 apontamentos
(o operador reenviou dois em duplicata). Cada um foi conferido contra o código
de 01/09 — vários já tinham sido corrigidos por PR posterior ao que o Codex
leu — e o resultado está abaixo. **Resolvidos no PR desta seção** (branch
`fix/achados-do-codex-01-09`), salvo onde indicado. Migrations **970** e
**971** aplicadas em produção em 01/09 e conferidas por SQL (índice parcial
presente; a função reparenta as três tabelas e mantém o `perfil_id = NULL`
da 965; `anon` sem EXECUTE, `authenticated` e `service_role` com).

Legenda: ✅ corrigido aqui · ✔️ já estava corrigido quando o Codex leu ·
📝 correção de TEXTO (plano/comentário) · ⏭️ refutado (ver §5)

| id | PR lido | Onde | O que o Codex apontou | Veredito | O que foi feito |
| --- | --- | --- | --- | --- | --- |
| **C1** | #84 | `message-thread.tsx` | `janelaExpiradaRef` copiava `sessionInfo.expired`, memo que não envelhece — o portão do disparo não via a janela fechar durante o desfazer/rascunho | ✔️ | O próprio #84 (versão final) substituiu o ref por `janelaFechadaAgora()`, que LÊ O RELÓGIO no disparo (`lib/inbox/janela-24h.ts`) |
| **C2** | #84 | `message-thread.tsx` | o envio INTERATIVO não passava pelo portão | ✔️ | `handleSendInteractive` passa por `janelaFechadaAgora()` desde o #84 — são os três caminhos |
| **C3** | #85 | plano, #05 | a receita "recortar por `scheduled_for` + `limit`" é INCORRETA (retentativa de agendada antiga cai dentro da janela) | 📝 | nota de correção no #05; a implementação já era por `message_id` |
| **C4** | #85 | plano, #01 | "o closure já atualizado" é falso: `ondataavailable` segura o `finalizeRecording` do render em que a gravação começou | 📝 | nota no #01 + comentário do compositor reescrito com o motivo certo do cancelamento |
| **C5** | #86 | `custom-fields-manager.tsx` | catálogo da conta anterior ficaria confiável se `accountId` mudasse e a carga nova falhasse | ⏭️ | **R5**: `accountId` não muda com o painel montado (troca de usuário recarrega a página; `/join` é outra página) |
| **C6** | #89 | `worker.ts` | o recolhedor de travadas fazia UPDATE só por `id + status`, sem repetir a régua de abandono — marcava `failed` um claim recém-tomado pela reanálise manual | ✅ | o SELECT traz `running_desde` e o UPDATE o exige de volta (`is null` quando nulo); claim tomado no meio não conta. Pino em `worker.test.ts` |
| **C7** | #89 | `worker.ts`, `use-radar.ts` | `.in('message_id', …)` com até 1000 UUIDs estoura a linha de requisição | ✔️ | os dois lados já fatiam em 500 (o #89 final) |
| **C8** | #89 | `cb_scheduled_messages` | `message_id` sem índice — varredura da tabela inteira a cada análise e a cada recarga do painel | ✅ | **970**: índice parcial `WHERE message_id IS NOT NULL` |
| **C9** | #90 | `use-auth.tsx` / 018 | carimbar o dono não sobrevive à TRANSFERÊNCIA de posse: `transfer_account_ownership` não reparenta, o ex-dono vira removível e o CASCADE leva contatos, conversas e campos do mandato dele | ✅ | **971**: a função reparenta `contacts`/`conversations`/`custom_fields` + backfill idempotente (0 linhas em produção). Escopo limitado às três — o resto virou **M24** |
| **C10** | #91 | `i18n-chaves-usadas.mjs` | arquivo folha que TAMBÉM importa o hook com alias pulava a guarda de cobertura | ✅ | guarda roda antes e independente do modo folha; teste com fixture |
| **C11** | #91 | `i18n-chaves-usadas.mjs` | `import type { useTranslations }` reprovaria como binding perdido | ✅ | `(?!type\b)`/`(?<!\btype\s)` no regex, fonte sem comentários; `message-media.tsx` passou a `import type`; teste com as duas formas |
| **C12** | #92 | `filtros-salvos-menu.tsx` | `aplicado` procurava entre TODOS os salvos — filtro escondido (canal fora do escopo) limpava para vazio e aparecia como aplicado | ✅ | procura só entre `visiveis` e só quem ainda recorta algo depois de `limparOrfaos` |
| **C13** | #92 | `conversation-list.tsx` | padrão com todos os ids mortos limpava para `FILTROS_VAZIOS`, casava com o vazio e a faixa não saía nunca | ✅ | `contarFiltrosAtivos(limpo) === 0` → não está na tela |
| **C14** | #93 | rotas `api/ai` | `err.message` de AiError ainda chegava à tela por `warning` (knowledge, [id], reindex) e pelo template do embeddings key no config; o pino só casava `error: err.message` | ✅ | `mensagemSeguraDeAiError` nos quatro; o pino passou a reprovar QUALQUER `err|error|e.message` fora de `console.*` |
| **C15** | #96 | `use-radar.ts` | resgate das falhas com `limit(100)` incluía tratadas/descartadas (a tela só mostra abertas) — falha ABERTA antiga ficava invisível | ✅ | `.eq('estado','aberto')`, como a irmã da pendência; pino. Paginação NÃO: 100 falhas abertas é conta quebrada, não acervo |
| **C16** | #96 | `use-channels.ts` | cache de 15s não é invalidado por mutação no painel de Conexões | ✅ | `invalidarCacheDeCanais()` exportado e chamado no `load()` do painel (caminho comum a toda escrita); pino estrutural |
| **C17** | #96 | `message-thread.tsx` | o tique da badge parava em conversa Evolution; ao voltar a uma Meta o relógio velho abria a janela por até um minuto | ✅ | o tique roda sempre (um setState/min) |
| **C18** | #98 | `policies-de-escrita.test.ts` | nome + comando não pegam policy recriada com predicado FROUXO depois da 964 | ✅ | o parser guarda o CORPO da última definição e exige `'admin'`/proíbe `'agent'` no fim do replay; `verify-schema.sql` faz o mesmo sobre `pg_policies` |
| **C19** | #98 | `verify-schema.sql` | nome sozinho exime `broadcasts_insert` criada em `automations` | ✅ | par `(tablename, policyname)` |
| **C20** | #99 | `perfis-panel.tsx` | `channels = []` durante carga/falha virava "conexões que não existem mais" em todo perfil restrito, e o editor não oferecia saída | ✅ | `loading`/`falhou` do hook: sem catálogo confiável a linha diz "N conexões"; falha tem frase + tentar de novo; a dica de órfão só com catálogo confiável (2 chaves novas nos dois dicionários) |
| **C21** | #101 | `message-thread.tsx` | voltar (celular) zera `messages` mas não a marca `conversaCarregadaRef`; reabrir a mesma conversa era lido como resync, sem spinner, com "Nenhuma mensagem ainda" | ✅ | a marca zera quando `conversationId` fica nulo |
| **C22** | #101 | `message-bubble.tsx` | `nomeDeArquivo` devolvia `undefined` sem `media_url`, jogando fora `media_filename`/`content_text` de documento pendente | ✅ | `nomeDeclarado()` em `lib/media/filename.ts` (passos 0+1, sem síntese) — a bolha usa quando não há objeto; testes |
| **C23** | #101 | `group-sidebar.tsx` | "Nenhuma anotação ainda" pintado durante a carga e para sempre na falha | ✅ | o hook expõe `pronta`/`falhou` (carimbados pela CONVERSA); o vazio só afirma com `pronta`, falha tem frase + tentar de novo (2 chaves novas) |
| **C24** | #103 | `custom-fields-manager.tsx` | com refetch silencioso a lista fica editável durante o voo: respostas fora de ordem, e o arrastar otimista atropelado por resposta velha | ✅ | número de série das buscas (só a mais nova escreve); os escritores otimistas invalidam o voo e recarregam depois do sucesso |

**Segunda rodada do Codex (sobre o commit `835d998` deste PR):** dois
apontamentos, os dois válidos e corrigidos no commit seguinte.

| id | Onde | O que o Codex apontou | O que foi feito |
| --- | --- | --- | --- |
| **C25** | `use-channels.ts` | `invalidarCacheDeCanais` zerava só o `cache`: um voo iniciado ANTES da mutação e resolvido DEPOIS repovoava o cache com a lista velha, e a montagem seguinte ainda recebia a promessa antiga por `emVoo` | geração: invalidar sobe o contador, zera cache E `emVoo`; a resposta só escreve o cache se a geração ainda for a dela, e só solta o `emVoo` se ainda for o seu. `obterCanais` exportada para o teste, que prende o `fetch` com uma promessa, invalida no meio e prova que a montagem seguinte busca de novo (2 fetches, lista nova) |
| **C26** | `i18n-chaves-usadas.mjs` | a guarda de alias ainda estava sob `bindings.size === 0`: um `const t = useTranslations(...)` legítimo ao lado de um alias ou envelope escondia o segundo tradutor | a guarda passou a valer para TODO arquivo e a contar CHAMADAS por fábrica importada (alias incluso): toda chamada tem de ser binding ou invocação direta; o resto reprova com nome e contagem ("2 chamada(s), 1 reconhecida(s)"). Ensaio no repo: zero falsos vermelhos. Três fixtures novas (binding + alias, binding + envelope, namespace dinâmico não é buraco) |

**Medido:** typecheck · lint (0 erros; os 5 avisos nos arquivos tocados
pré-existem no `main`) · suíte 185 arquivos / **2392 testes** em Node 22 ·
`i18n-parity` e `i18n-chaves-usadas` verdes (2697 literais) · `npm run
build` verde · 970/971 conferidas por SQL em produção (acima).

**Medido E2E no preview (01/09, dev server sobre o banco de produção, logado
como o operador; toda escrita foi desfeita e conferida por SQL):**

- **C16** — com um `MutationObserver` e o `fetch` instrumentado por pilha:
  a busca do `useChannels` rodou no inbox (t=116,7 s), o painel de Conexões
  foi aberto por navegação de CLIENTE (o `load()` dele invalidou o cache) e
  a volta ao inbox em t=123,9 s — 7,2 s depois, dentro dos 15 s — disparou
  `buscar` de novo (frame `useChannels.useEffect → obter → buscar`). Sem a
  invalidação, seria cache.
- **C21** — viewport 375×812: abrir "Ana Exemplo" (326 msgs), voltar,
  reabrir. Na reabertura o nó com "Nenhuma mensagem ainda" foi REMOVIDO e o
  spinner inserido aos 166 ms; as mensagens entraram aos ~600 ms; nenhum
  `add` do texto vazio em momento algum.
- **C23** — grupo "CB - Rafael Exemplo" (0 notas) com a aba Notas ativa;
  troca para "CB TRABALHISTA - ANA PAULA": "Nenhuma nota ainda" saiu aos
  150 ms, a busca de `cb_conversation_notes` correu de 153 a 436 ms e o vazio
  só voltou aos 443 ms — depois da resposta.
- **C20** — perfil "Teste Codex C20" criado com a conexão "Comercial -
  Bancário" (linha: "1 conexão"); saída para o inbox, 16,5 s de espera
  (cache expirado), volta aos perfis por navegação de cliente: os canais
  foram buscados de novo (166→723 ms de carga) e a sentinela não registrou
  "conexões que não existem mais" nem "Não foi possível carregar" — a linha
  disse "1 conexão" o tempo todo. Perfil apagado ao fim (0 linhas em
  `cb_perfis_de_acesso`).
- **C24** — catálogo de campos: rename de "Link Reunião" (commit por
  `focusout`) e, no MESMO tique, mover "Tempo de Atraso" de bloco pelo
  `<select>` (a busca do rename ainda em voo). Banco e tela terminaram
  iguais: nome novo gravado e campo no bloco novo; repetido no sentido
  inverso para desfazer. A posição original do campo movido foi devolvida
  por SQL (mover põe no FIM do bloco) e a tela recarregada mostrou a ordem
  e os nomes originais.
- Regressões: painel de perfis com os três padrões em "todas as conexões";
  inbox sem filtro padrão e gatilho "Salvos" (C12/C13 não têm fixture
  reproduzível sem um segundo membro restrito ou etiqueta apagada).

**O que NÃO foi medido na tela:** C17 (exige conta com Meta E Evolution —
produção é 100% Evolution), C22 (produção não tem documento sem `media_url`
com nome declarado — coberto por `filename.test.ts`), C12/C13 (exigem
visão de um membro com canal fora do escopo, ou id apagado num filtro
salvo). Observação de carona: o diálogo "Apagar o perfil" ficou aberto com
nome vazio depois de apagar (fechou só no Escape) — pré-existente, fora do
escopo desta correção.
