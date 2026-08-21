# Prompt para Claude Code — corrigir navegação de Configurações, redesign visual, e deixar o caminho pronto pra Asaas

> Cole no Claude Code. Execução 100% autônoma, sem confirmar nada. Commits locais, `vercel deploy --prod` no final. Depois de terminar cada migration nova, rode você mesmo `supabase db push` (ou o comando equivalente do projeto) contra o banco de produção — nas últimas rodadas o código foi pro Vercel mas a migration ficou pra trás e só rodou porque eu apliquei na mão pelo SQL Editor. Isso não pode se repetir: nenhuma rodada está de fato completa até a migration estar aplicada em produção E eu (ou você) confirmar isso com uma query direta, tipo `select to_regclass('public.nome_da_tabela')`.

## 1. Bug: navegação em Configurações trava depois de um tempo/deploy

Reproduzi as seções que o usuário reportou quebradas (Organização, Membros, Respostas rápidas, Campos e etiquetas) navegando do zero e todas funcionaram — o que aponta pra um caso clássico de **stale chunk do Next.js**: fizemos vários deploys nesta sessão, e se a pessoa deixa a aba aberta de antes do deploy e clica em algo que precisa carregar um chunk JS que não existe mais na build atual, a navegação client-side falha silenciosamente (o app não recarrega sozinho, só "para de funcionar" pra quem estava com a aba aberta).

### O que fazer
- Adicione o tratamento padrão pra isso: capturar erro de carregamento de chunk (`ChunkLoadError` / `Failed to fetch dynamically imported module` / erro do `next/dynamic`) globalmente (error boundary no layout raiz + listener de `error`/`unhandledrejection` na window) e, quando acontecer, fazer `window.location.reload()` automaticamente (ou, se preferir mais transparência, mostrar um toast rápido "Nova versão disponível, atualizando..." antes de recarregar).
- Confirme que isso cobre tanto navegação client-side (Link/router.push) quanto erros de import dinâmico.
- Não precisa de teste automatizado pra isso especificamente (é um comportamento de browser real), mas deixe um comentário no código explicando o porquê, pra não ser removido achando que é código morto.

## 2. Redesign visual — painéis (dashboard) e telas de login

O usuário mandou duas referências do 21st.dev como inspiração de estilo (não pra copiar código, é componente pago/de terceiro — usar só como referência visual/estrutural, remontando do zero com o que já temos: Tailwind + shadcn/ui):

**Painéis (Painel principal do CRM, `/painel-plataforma`, e a página de detalhe de loja)** — inspirado em "Efferd Dashboard 2": sidebar com navegação agrupada por seção (títulos pequenos em uppercase acima de cada grupo de links, como já fazemos em Configurações — replicar esse padrão na navegação principal também), cards de KPI numérico grandes com indicador de variação percentual (verde subindo / vermelho descendo) ao lado do valor, gráficos limpos sem grade pesada, tabelas de dados com filtro de busca, checkbox de seleção em massa, badges de status coloridos, e um seletor de colunas visíveis. Bordas finas e sutis, bastante espaço em branco, paleta escura consistente com o que já usamos.

**Login (`/login`, `/signup`, `/painel-plataforma/login`)** — inspirado em "Sign In Flow": layout centralizado sem card com borda pesada, fundo escuro com um brilho/glow sutil atrás do título, título grande e acolhedor, inputs e botões em formato pill/cápsula (bordas bem arredondadas), texto legal pequeno no rodapé com links sublinhados. Mantenha os campos que cada tela já tem (não é pra remover nenhum campo do cadastro de lojista nem simplificar o login do admin) — é só o involucro visual que muda.

Aplique esse novo estilo de forma consistente nas três telas de login/cadastro e nos painéis, sem quebrar nenhuma funcionalidade already existente. Tire prints antes/depois de cada tela principal no relatório final.

## 3. Deixar o caminho pronto pra cobrança (Asaas) — SEM integrar de verdade ainda

O usuário decidiu não ligar o Asaas agora, mas quer a fundação pronta pra quando decidir ativar. Isso significa: schema e estrutura de UI preparados, **zero chamada real de API pro Asaas, zero cobrança, zero webhook de pagamento recebendo nada ainda**.

### O que criar
- Migration nova, aditiva, adicionando à tabela `organizations`: `billing_status TEXT NOT NULL DEFAULT 'trial'` (valores: `trial`, `active`, `past_due`, `canceled` — só o schema, sem nenhuma lógica de bloqueio de acesso baseada nisso ainda, `organizations.status` continua sendo o único campo que hoje bloqueia acesso), `asaas_customer_id TEXT` nullable, `plan TEXT` nullable. Documente no comentário da migration que isso é só a fundação e nenhum desses campos é lido por nenhuma regra de acesso ainda.
- Uma seção nova em Configurações do lojista, "Faturamento" (mesmo padrão visual das outras seções), mostrando um estado "Em breve — cobrança automática chegando em breve, sua conta continua gratuita até lá" — sem formulário de cartão, sem nada clicável além de um link de contato/suporte se quiser.
- No painel admin (`/painel-plataforma`), no card de cada loja, mostre o `billing_status` (hoje sempre "trial" pra todo mundo) só como informação — sem ação de cobrar/editar isso ainda.
- Documente em um comentário no código (arquivo `src/lib/billing/README.md` ou similar) onde exatamente a integração real vai entrar depois: criar cliente no Asaas ao criar a loja, endpoint de webhook pra receber confirmação de pagamento, e qual campo passa a gatilhar suspensão automática — só documentação, não implemente nada disso agora.

## Critérios de aceite

- [ ] Erro de chunk desatualizado detectado e recarrega a página automaticamente.
- [ ] Login, cadastro de lojista e login do admin com o novo visual (pill-shaped, centralizado, fundo com glow), sem perder nenhum campo/funcionalidade.
- [ ] Painéis com sidebar agrupada, KPIs com variação percentual, tabelas com filtro/checkbox/badges — sem quebrar nenhuma tela existente.
- [ ] Migration nova de billing aplicada e **verificada em produção por você mesmo** (não só deployada).
- [ ] Seção "Faturamento" em Configurações do lojista, em estado "em breve".
- [ ] `billing_status` visível (read-only) no painel admin.
- [ ] `npm run typecheck/lint/test/build` passando.
- [ ] Commit local, deploy publicado.
- [ ] Prints antes/depois no relatório final.
