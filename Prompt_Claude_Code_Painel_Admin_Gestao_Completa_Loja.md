# Prompt para Claude Code — gestão completa de lojas dentro do painel admin

> Cole no Claude Code. Execução 100% autônoma, sem confirmar nada. Commits locais, `vercel deploy --prod` no final. Continuação direta do que já está em produção: `/painel-plataforma` (lista de lojas, criar loja, suspender) e `/painel-plataforma/login` (login dedicado). Já testei os dois ao vivo e funcionam.

## Contexto

Hoje `/painel-plataforma` só lista as lojas (nome, dono, contagem de vendedores, status, data) com um botão de suspender. Isso não é suficiente pra operar a plataforma no dia a dia — preciso conseguir entrar em cada loja e editar/excluir o que for necessário: dados da loja, dados do dono, e a lista de vendedores/funcionários vinculados (incluindo login/e-mail, senha, nome, contato).

## O que construir

### 1. Página de detalhe da loja

Nova rota `/painel-plataforma/lojas/[id]`, acessível clicando em qualquer loja da lista de `/painel-plataforma`. Protegida do mesmo jeito que o painel em si (só `is_platform_admin()`, redireciona pro login dedicado se não for).

Mostra, pra aquela organização especificamente:

- **Dados da loja**: nome (editável), status ativa/suspensa (o toggle que já existe, só mover pra cá), data de criação.
- **Dados do dono (conta que criou a loja)**: nome, e-mail (login), contato/telefone se o cadastro coletar isso — todos editáveis.
- **Lista de vendedores/funcionários vinculados**: nome, e-mail, status (convite pendente / ativo), papel (role). Cada um com ação de editar (nome/e-mail/contato) e de remover.

### 2. Ações disponíveis (todas via rota de API dedicada com service-role — nunca política de RLS de escrita ampla pro platform admin, mesmo padrão já usado nas migrations 041/042)

- **Editar nome da loja** — `PATCH /api/platform/organizations/[id]`.
- **Editar dados de uma conta (dono ou vendedor)** — nome, e-mail, contato. Trocar e-mail é trocar o login de fato (usar a Admin API do Supabase Auth, `admin.updateUserById`), então valide formato e unicidade antes de aplicar.
- **Redefinir senha de uma conta** — ação principal deve ser **"Enviar link de redefinição de senha"** pro e-mail da pessoa (usa o fluxo padrão do Supabase Auth, é o mais seguro e o que qualquer painel de suporte sério faz). Se quiser, adicione também uma opção secundária de "Definir uma senha nova diretamente" pra casos em que enviar e-mail não for prático — mas se implementar essa opção, o valor da senha nunca pode ser logado, armazenado, nem reaparecer na tela depois de enviado; é escrita única via Admin API, ponto.
- **Remover um vendedor da loja** — decida entre desvincular (tira o `organization_id`, mantém a conta e os dados dele intactos, só some da loja) ou excluir de vez (apaga a conta e tudo que só pertence a ela — conversas, contatos, mensagens, conexão de WhatsApp). Ofereça as duas opções com nomes claros ("Remover da loja" vs "Excluir conta permanentemente"), cada uma com sua própria confirmação.
- **Excluir a loja inteira** — apaga a organização, a conta-dono, todos os vendedores vinculados, e tudo que pertence a essas contas (conversas/contatos/mensagens/conexões). Isso é a ação mais destrutiva do sistema inteiro — exige confirmação escrita (a pessoa precisa digitar o nome exato da loja antes do botão de excluir ficar habilitado), e a rota de API precisa rodar isso dentro de uma transação (tudo ou nada, nunca deixar meio-apagado).

### 3. Log de auditoria

Toda ação de escrita feita a partir do painel admin (editar loja, editar conta, trocar e-mail, redefinir senha, remover vendedor, excluir loja) precisa gravar uma linha numa tabela nova `platform_admin_audit_log` (quem fez — `admin_user_id`, o quê — `action`, em qual loja/conta — `target_type`/`target_id`, detalhes relevantes em `metadata jsonb`, `created_at`). Sem isso, uma ação destrutiva feita sem querer não tem como ser investigada depois. RLS dessa tabela: só platform admin lê, ninguém escreve direto (só as próprias rotas de API, via service-role).

## Segurança — não pule isso

Esse painel já é o nível de acesso mais alto do sistema (migration 042), e agora ele ganha **poder de escrita** sobre qualquer loja da plataforma, o que não existia antes (até aqui só existia leitura + suspender/criar). Escreva testes automatizados provando:

- Usuário comum (não platform admin) recebe 403 em toda rota nova (`PATCH`/`DELETE` de organização, edição de conta, redefinição de senha, remoção de vendedor).
- Editar/excluir a Loja A nunca afeta nenhum dado da Loja B — teste isso explicitamente com duas organizações de teste.
- Excluir uma loja realmente remove tudo (organização, contas, conversas, contatos, mensagens) e não deixa linha órfã em nenhuma tabela.
- Toda ação de escrita gera uma linha correspondente em `platform_admin_audit_log`.
- Confirmação por nome digitado é realmente obrigatória antes de excluir uma loja (o botão não pode funcionar sem o texto bater exatamente).

## Fora de escopo

Cobrança (Asaas) continua na Fase 2, não mexa nisso agora. Não precisa mudar o fluxo de "Criar loja nova" que já existe — ele já funciona, vou testar ele mesmo depois que isso aqui for pro ar.

## Critérios de aceite

- [ ] `/painel-plataforma/lojas/[id]` mostrando dados completos da loja, do dono e da lista de vendedores.
- [ ] Editar nome da loja, e editar nome/e-mail/contato de qualquer conta vinculada.
- [ ] Redefinir senha (link por e-mail como ação principal).
- [ ] Remover vendedor (desvincular ou excluir, com confirmação).
- [ ] Excluir a loja inteira (transação completa, confirmação por nome digitado).
- [ ] Tabela `platform_admin_audit_log` registrando toda ação de escrita.
- [ ] Testes automatizados cobrindo os 5 pontos de segurança listados acima.
- [ ] `npm run typecheck/lint/test/build` passando.
- [ ] Commit local, deploy publicado.
- [ ] No relatório final, me diga a URL exata da página de detalhe de loja pra eu testar ao vivo (vou criar uma loja nova ali pelo botão "Criar loja nova" e testar editar/excluir tudo nela).
