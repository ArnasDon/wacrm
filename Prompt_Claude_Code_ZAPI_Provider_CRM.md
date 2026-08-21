# Prompt para Claude Code — adicionar Z-API como terceiro provedor WhatsApp (CRM wacrm)

> Copie e cole no Claude Code. **Execução 100% autônoma, do início ao fim, sem nenhuma parada pra confirmação.** Isso inclui: nenhuma pergunta de "posso continuar?", nenhum diálogo de permissão de comando no meio da tarefa, nenhuma decisão de implementação jogada de volta pra mim. Decida sozinho a opção mais sensata em qualquer ambiguidade e documente a escolha no commit. Sem GitHub — commits locais, deploy via `vercel deploy --prod` no final, mesmo modelo já usado pro uazapi.

## 0. Garantir zero confirmação antes de começar

Antes de tocar em qualquer código, revise `.claude/settings.json` deste projeto (já configurado na rodada anterior do uazapi) e confirme que cobre tudo que esta tarefa vai precisar: `npm run typecheck/lint/test/build/dev`, `git add/commit/checkout` (sem push), `vercel link/env ls/deploy/deploy --prod/logs`, leitura livre (`cat/ls/grep/find/git status/git diff/git log`). Se antecipar qualquer comando novo que essa tarefa específica vai exigir e que não esteja coberto, **adicione o padrão ao `allow` do settings.json você mesmo, antes de rodar o comando** — não pare a execução pra pedir liberação no meio do trabalho. Continua negado: `git push`, `rm -rf`, `git reset --hard`, `git clean -f`, `vercel env add/rm` com valor embutido.

## Contexto

O provedor uazapi (QR pairing, modelo revenda) já está revisado, testado (657 testes passando) e publicado. **Não mexer nisso** — o pedido agora é adicionar o Z-API como uma **terceira opção**, ao lado de `meta` e `uazapi`, reaproveitando a mesma abstração `WhatsAppProvider` (`src/lib/whatsapp/provider-types.ts`) e o mesmo padrão de arquivos que o uazapi já estabeleceu (`uazapi-api.ts`, `providers/uazapi-provider.ts`, migration 037, rota de webhook, UI de settings).

**Diferença importante de modelo**: uazapi é reseller (uma assinatura admin cria instância pra cada conta via API). Z-API é auto-serviço — cada cliente cria a própria instância direto no painel deles (`app.z-api.io`) e só cola **Instance ID + Token** (+ opcionalmente um Client-Token de segurança da conta) na tela de configurações do nosso CRM. Não existe token de admin nem criação de instância via API neste caso — é só entrada manual de credenciais + exibição do QR code pra parear.

## O que construir

1. **Migration nova** (seguir o padrão da 037): adicionar `'zapi'` ao CHECK de `provider`, colunas nullable `zapi_instance_id`, `zapi_token`, `zapi_client_token`, `zapi_status`, `zapi_connected_at`, `zapi_paired_phone`, `zapi_webhook_secret` (mesmo raciocínio do `uazapi_webhook_secret` — stand-in de assinatura, já que Z-API webhook não tem HMAC nativo tão robusto quanto Meta). Atualizar a constraint de exclusividade mútua pra cobrir os três provedores agora (só um conjunto de colunas populado por vez).

2. **`src/lib/whatsapp/zapi-api.ts`** — cliente HTTP, mesmo estilo do `uazapi-api.ts` (uma função por endpoint, args nomeados, sem estado). Endpoints reais da API (confirmar na doc oficial, `developer.z-api.io`, antes de implementar — não adivinhar campos):
   - Base: `https://api.z-api.io/instances/{instanceId}/token/{token}/...`
   - `send-text`, `send-image`, `send-document`, `send-link` (mídia)
   - QR code / status / disconnect / restart da instância
   - Header opcional `Client-Token` quando o token de segurança de conta estiver configurado
   - Normalizar toda resposta pro mesmo formato `{ messageId }` que os outros providers já usam.

3. **`src/lib/whatsapp/providers/zapi-provider.ts`** — implementa `WhatsAppProvider` (`kind: 'zapi'`), mesma forma que `UazapiProvider`. Sem capacidade de template (igual uazapi — `isMetaProvider()` continua só reconhecendo `'meta'`).

4. **Rota de webhook** `/api/z-api/webhook/[accountId]/[secret]/route.ts` — mesmo padrão de validação de secret da rota uazapi. Parsear o payload real do Z-API (campos confirmados: `instanceId`, `phone`, `connectedPhone`, `fromMe`, `momment`, `status`, `type`, `notification` — conferir a doc de webhooks pra cobrir os tipos de mensagem que o resto do sistema já trata: texto, imagem, documento, reação).

5. **`send-core.ts`** — estender `resolveProviderConfig`/`buildProvider` pro terceiro caso, mesmo formato do bloco uazapi.

6. **UI de Settings** — estender `whatsapp-provider-panel.tsx` pra incluir Z-API como opção junto de Meta/uazapi. Tela de conexão do Z-API: formulário simples (Instance ID, Token, Client-Token opcional) em vez do fluxo de "criar instância" do uazapi — depois de salvar, mostrar o QR code (endpoint de QR do Z-API) pra parear.

7. **Sem variável de ambiente de plataforma** pro Z-API (diferente do uazapi) — cada conta traz suas próprias credenciais, não há admin token compartilhado.

## Antes de codar

Ler a documentação oficial atual em `developer.z-api.io` (seções de mensagens, webhooks, autenticação e instância) pra confirmar nomes exatos de campos e endpoints — o que descrevi acima é a forma geral confirmada por pesquisa, mas os detalhes finos (nomes exatos de parâmetros, formato exato do payload de webhook) precisam ser conferidos na doc real antes de implementar, do mesmo jeito rigoroso que o cliente do uazapi foi construído.

## Critérios de aceite

- [ ] uazapi continua funcionando exatamente como está — nenhuma regressão.
- [ ] Z-API selecionável como provedor na tela de Settings, com formulário de credenciais + QR code de pareamento.
- [ ] Enviar e receber mensagem de teste funcionando ponta a ponta com uma instância Z-API real.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` passando.
- [ ] Commits locais organizados, sem push.
- [ ] Deploy publicado (`vercel deploy --prod`) ao final.
- [ ] Relatório final com o passo a passo de como conectar uma conta Z-API de teste (onde pegar Instance ID/Token no painel deles, onde colar no CRM).
