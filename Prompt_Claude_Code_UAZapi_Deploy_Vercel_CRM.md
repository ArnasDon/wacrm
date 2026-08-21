# Prompt para Claude Code — organizar, testar e publicar o suporte à API não oficial (uazapi) do CRM (wacrm)

> Copie e cole no Claude Code, aberto no projeto "CRM - WhatsApp". **Execução autônoma total**: não pare pra confirmar nada — nenhuma decisão de implementação, nenhum ponto de checagem no meio. Decida a opção mais sensata e documente nos commits. Nada de GitHub nesta rodada — trabalhamos só local + deploy direto na Vercel via CLI.

---

## 0. Antes de tudo: destravar o git

Rode `git status`. Se aparecer erro de `.git/index.lock` ("Unable to create .git/index.lock: File exists"), apague esse arquivo (`rm .git/index.lock`) antes de continuar — é só um lock travado, não indica outro processo git rodando de verdade.

Depois disso, confirme em qual branch está e se os ~85 arquivos modificados/novos (implementação do provedor uazapi — abstração `WhatsAppProvider`, cliente `uazapi-api.ts`, migrations 037-039, UI de configuração/QR pairing) ainda estão intactos no working directory.

## 1. Configurar permissões pra não pedir confirmação

Criar/ajustar `.claude/settings.json` neste projeto (segue o mesmo padrão já usado no projeto iBox Prime, adaptado pra esse stack): permitir sem perguntar comandos de leitura (`git status`, `git diff`, `git log`, `cat`, `ls`, `grep`, `find`), os scripts do próprio projeto (`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run dev`), `git add`/`git commit`/`git checkout` (commits são só locais, sem remoto nesta rodada), e os comandos da Vercel CLI necessários (`vercel link`, `vercel env ls`, `vercel deploy`, `vercel deploy --prod`, `vercel logs`). Negar explicitamente: `git push` (não vamos usar GitHub agora), qualquer coisa destrutiva (`rm -rf`, `git reset --hard`, `git clean -f`), e `vercel env add`/`vercel env rm` com valor embutido no comando (variáveis de ambiente sensíveis devem ser configuradas por mim, nunca digitadas por você).

## 2. Revisar e organizar o trabalho existente (uazapi provider)

Esse trabalho já é extenso e bem estruturado (constraints de exclusividade mútua na migration 037, abstração de provedor limpa, cliente de API completo) — não é pra reescrever do zero. O objetivo aqui é:

- Rodar `npm run typecheck`, `npm run lint`, `npm test` e `npm run build` de verdade neste ambiente (o meu ambiente de análise não conseguiu rodar essas ferramentas por uma limitação de infraestrutura própria — os resultados de vocês são a referência real).
- Corrigir qualquer erro real que aparecer.
- Ler os pontos de integração-chave e confirmar que estão coerentes ponta a ponta: `send-core.ts` (resolução de provedor + retry), a rota de webhook `/api/uazapi/webhook/[accountId]/[secret]`, `uazapi-platform-config.ts` (credenciais da plataforma, com fallback DB → env var), e o fluxo de UI em Settings (escolher provedor → parear por QR → status da conexão).
- Fazer uma revisão de sênior (segurança, dados sensíveis, edge cases) igual ao processo já usado antes neste mesmo projeto (ver commits anteriores do histórico, como `e570e1a security: switch WhatsApp token encryption...`) — o token uazapi por instância precisa estar criptografado do mesmo jeito que o `access_token` do Meta já é.
- Commitar em um ou mais commits locais organizados (sem push, sem PR) — mensagens claras, sem misturar formatação com lógica no mesmo commit se der pra evitar.

## 3. Conectar e publicar na Vercel (sem GitHub)

- `vercel link` pra conectar esta pasta local a um projeto Vercel (novo ou existente — perguntar ao usuário só se não houver como inferir, mas por padrão criar um novo projeto se nenhum existir).
- Listar exatamente quais variáveis de ambiente o projeto precisa pra rodar em produção (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `META_APP_SECRET`, `NEXT_PUBLIC_SITE_URL` — conferir `.env.local.example` pra lista completa e atualizada). Você não vai ter os valores reais — só documente os nomes exatos no relatório final; eu configuro os valores direto no painel da Vercel (Settings → Environment Variables).
- `UAZAPI_ADMIN_TOKEN`/`UAZAPI_BASE_URL` **não precisam** ir na Vercel necessariamente — o código já suporta configurar isso direto pela tela de Settings do próprio app (tabela `platform_settings`, migration 039), o que é mais simples pro usuário. Mencionar essa opção no relatório como alternativa a variável de ambiente.
- Depois de eu configurar as variáveis, rodar `vercel deploy --prod` e confirmar que o build passa na Vercel (não só localmente).

## 4. Teste ponta a ponta que só o usuário consegue confirmar

No relatório final, listar um passo a passo claro pra eu testar depois do deploy: entrar em Settings → WhatsApp, escolher provedor "uazapi", criar instância, escanear o QR code com um número de teste, confirmar status "connected", mandar uma mensagem de teste e confirmar que chega tanto o envio quanto o recebimento (webhook).

## Critérios de aceite

- [ ] Git destravado, ~85 arquivos revisados e commitados localmente (sem GitHub).
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` passando de verdade neste ambiente.
- [ ] `.claude/settings.json` configurado — nada de confirmação manual pra comandos seguros de rotina.
- [ ] Projeto conectado e publicado na Vercel via CLI, variáveis de ambiente necessárias documentadas (nomes, não valores).
- [ ] Passo a passo de teste do fluxo uazapi (QR → conectar → enviar → receber) entregue no relatório final.
