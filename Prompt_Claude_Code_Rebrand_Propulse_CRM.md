# Prompt para Claude Code — renomear "wacrm" para "Propulse CRM" (só o nome visível no app)

> Cole no Claude Code. Execução 100% autônoma, sem confirmar nada. Commits locais, `vercel deploy --prod` no final.

## Escopo — só o que a pessoa que usa o sistema vê

Não mexer na URL/domínio (continua `wacrm-alpha-ecru.vercel.app` por enquanto — mudar isso quebraria o webhook configurado no uazapi), não mexer no `name` do `package.json` nem em identificadores internos/técnicos (nomes de pacote, variáveis, nomes de arquivo, repositório git). É só o texto que aparece pra quem usa o produto.

## Onde já identifiquei o texto (troque "wacrm" / "Modelo de CRM para WhatsApp" / "CRM Template for WhatsApp" por "Propulse CRM")

- `src/app/layout.tsx`: `metadata.title.default` ("wacrm" → "Propulse CRM") e `metadata.title.template` ("%s — wacrm" → "%s — Propulse CRM") — isso é o título da aba do navegador.
- `messages/pt-BR.json`: `Sidebar.title` ("Modelo de CRM para WhatsApp" → "Propulse CRM"), e todas as menções literais a "wacrm" dentro de valores de string (convite de vendedor, descrições de exclusão de modelo, mensagem de webhook registrado, descrição da IA) — são pelo menos 5 ocorrências, troque todas mantendo o resto da frase natural em português.
- `messages/en.json`: mesma coisa, `Sidebar.title` ("CRM Template for WhatsApp" → "Propulse CRM") e as mesmas ~5 menções a "wacrm" em inglês.
- `src/components/settings/invite-member-dialog.tsx`: os dois fallbacks `'nossa conta wacrm'` (linhas ~138 e ~167) → `'nossa conta Propulse CRM'`.

## Depois disso

Rode uma busca case-insensitive por `wacrm` em `src/` e `messages/` pra conferir se sobrou algum texto visível ao usuário que eu não listei aqui (ex.: outro componente com string hardcoded fora do sistema de tradução). Se achar mais algum, troque também. Ignore ocorrências em comentários de código, nomes de variável/função, `package.json`, pasta `mcp-server/`, migrations do banco e documentação técnica interna (README, CONTRIBUTING, CHANGELOG) — essas não são o que a pessoa vê usando o produto, não precisa mexer.

## Critérios de aceite

- [ ] Título da aba do navegador mostra "Propulse CRM".
- [ ] Nome na sidebar mostra "Propulse CRM" (pt-BR e en).
- [ ] Nenhuma menção a "wacrm" visível em nenhuma tela do app (login, configurações, convites, mensagens de sistema).
- [ ] URL/domínio, `package.json` e identificadores internos não foram tocados.
- [ ] `npm run typecheck/lint/test/build` passando.
- [ ] Commit local, deploy publicado.
