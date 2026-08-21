# Prompt para Claude Code — login dedicado do painel admin + criar conta self-service pro lojista

> Cole no Claude Code. Execução 100% autônoma, sem confirmar nada. Commits locais, `vercel deploy --prod` no final. Esta é a continuação da Fase 1 (fundação do admin da plataforma, já aplicada e testada em produção — `platform_admins`, `is_platform_admin()`, `/painel-plataforma` funcionando). Agora o objetivo é abrir dois caminhos de entrada que hoje não existem, pra testar do zero antes de emendar a Fase 2 (cobrança).

## Contexto

Hoje só existem dois jeitos de entrar em uma conta: (a) login normal em `/login` pra quem já tem conta, e (b) o platform admin cadastra uma loja nova manualmente pelo botão "Criar loja nova" dentro de `/painel-plataforma`. Faltam:

1. Um login **dedicado** pro painel da plataforma — hoje pra acessar `/painel-plataforma` é preciso já estar logado na conta normal do app e a pessoa precisa saber navegar até lá; não existe uma porta de entrada própria pro admin.
2. Um jeito do **lojista se cadastrar sozinho** (self-service) — hoje toda loja nova só existe se o platform admin criar manualmente. Isso é o caminho que precisa existir antes de ligar a cobrança na Fase 2 (alguém paga → cria a própria conta → conecta o WhatsApp, sem depender de mim criando na mão).

## O que construir

### 1. Login dedicado do painel admin

- Rota nova `/painel-plataforma/login` (mesma convenção de nome não óbvio já usada pro painel em si — não usar `/admin/login`). Formulário simples de e-mail + senha, usando o mesmo Supabase Auth já existente — não é um sistema de auth separado, é a mesma base de usuários, só uma **porta de entrada própria** com identidade visual clara de que é o painel da plataforma (ex.: título "Painel da Plataforma", não o mesmo header do login normal do CRM).
- Depois do login bem-sucedido, checar `is_platform_admin()`. Se `true` → redireciona pra `/painel-plataforma`. Se `false` → desloga a sessão imediatamente e mostra um erro claro tipo "Esta conta não tem acesso ao painel da plataforma" (não precisa disfarçar se o e-mail existe ou não — não é o ponto sensível aqui, o ponto sensível é nunca deixar uma sessão autenticada-mas-não-admin persistir nessa página).
- `/painel-plataforma` (e qualquer rota abaixo dela) continua protegida como já está, mas agora quem não estiver autenticado deve ser redirecionado pra `/painel-plataforma/login`, não pro `/login` normal do CRM.
- Sem "criar conta" nessa página — plataforma admin continua só entrando na tabela via SQL manual (mesmo modelo de segurança já documentado na migration 042, não mude isso).

### 2. Criar conta self-service pro lojista

- Olhe primeiro como a página `/login` atual está estruturada antes de mexer — não quebre o fluxo de convite que já existe hoje pra vendedores/setores entrarem numa organização já criada (isso continua idêntico).
- Adicione uma aba/toggle "Entrar" / "Criar conta" na tela de login do CRM normal (ou uma rota separada `/signup` linkada a partir do login — decida o que for mais simples de manter dado o que já existe). Essa aba de criar conta é especificamente pro **dono de loja novo**, não pra vendedores (vendedores continuam só entrando via convite).
- Campos do cadastro: nome do responsável, nome da loja/negócio, e-mail, senha (com confirmação).
- Ao submeter: cria o usuário no Supabase Auth, cria a `account` dona (owner) + `profile` com `account_role = 'owner'`, cria a `organization` (`owner_account_id` = essa conta nova). `organizations.status` fica `active` por padrão — ainda não existe cobrança pra bloquear nada nessa fase, isso é a Fase 2.
- E-mail duplicado precisa dar um erro claro e não quebrar a UI.
- Depois do cadastro, redireciona direto pro fluxo de conectar o WhatsApp (primeira ação que importa), não pra uma tela vazia.
- Não precisa CAPTCHA customizado agora — só usar o que o Supabase Auth já oferece nativamente (rate limit padrão). Não inventar proteção extra nessa rodada.
- Na tela, deixe um aviso visível de que uma mensalidade vai ser cobrada assim que a cobrança existir (texto simples, sem checkout nenhum — isso é só preparar terreno visual pra Fase 2, não implementar pagamento).

## Segurança

- Confirme que a nova rota de signup não dá nenhum jeito de alguém se auto-promover a `platform_admin` ou criar uma conta já dentro de uma organização que não é a própria (a organização sempre nasce nova, vinculada só à conta que acabou de se cadastrar).
- Confirme que `/painel-plataforma/login` realmente desloga e barra quem não é platform admin — não deixar a sessão logada "meio autenticada" numa aba que deveria ser só do admin.

## Testes

- Cadastro de lojista novo cria account + profile (owner) + organization corretamente.
- E-mail duplicado no cadastro é rejeitado com erro claro.
- `/painel-plataforma/login` com conta que NÃO é platform admin: login "funciona" no Supabase Auth mas a pessoa é deslogada e vê o erro — nunca entra no painel.
- `/painel-plataforma` sem sessão nenhuma redireciona pra `/painel-plataforma/login` (não pro `/login` normal).
- Fluxo de convite de vendedor já existente continua passando nos testes como antes (não regrediu).

## Critérios de aceite

- [ ] `/painel-plataforma/login` funcionando, só deixa entrar quem é platform admin.
- [ ] `/painel-plataforma` redireciona pra esse login novo quando deslogado.
- [ ] Aba/rota de "Criar conta" pro lojista, criando account+profile+organization de ponta a ponta.
- [ ] Fluxo de convite de vendedor não quebrou.
- [ ] Testes automatizados cobrindo os pontos acima.
- [ ] `npm run typecheck/lint/test/build` passando.
- [ ] Commit local, deploy publicado.
- [ ] No relatório final, me diga a URL exata de cada rota nova (login admin e criar conta lojista) pra eu testar ao vivo.
