# CB-CRM

CRM de WhatsApp para equipes de atendimento. Caixa de entrada
compartilhada, funil comercial, automações e assistente de IA, rodando no
seu servidor, com o seu banco e as suas chaves.

[![CI](https://github.com/leonardocabralb/CB-CRM/actions/workflows/pipeline.yml/badge.svg)](https://github.com/leonardocabralb/CB-CRM/actions/workflows/pipeline.yml)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)

**Instalação do zero:** [`docs/INSTALACAO.md`](./docs/INSTALACAO.md)

---

## O que ele faz

**Atendimento.** Caixa de entrada compartilhada com vários números no
mesmo lugar, atribuição por conversa, situação (aberta, pendente,
encerrada), anotações internas, favoritas, filtros salvos por pessoa e
busca que alcança o corpo do histórico, não só o nome do contato. Grupos
de WhatsApp aparecem como conversa, com o remetente identificado. Áudio é
transcrito sob demanda. Mensagens podem ser agendadas, com anexo, e um
acervo guarda os arquivos que o escritório envia sempre. Quem está com a
mesma conversa aberta aparece no cabeçalho. Instala na tela de início do
celular como aplicativo.

**Dois transportes de WhatsApp, lado a lado.** A API oficial da Meta e a
Evolution API (pareamento por QR code, como o WhatsApp Web). Cada conexão
escolhe o seu, e a mesma instalação usa os dois. Mensagem enviada do
celular pareado entra no CRM junto com o resto. O Instagram Direct entra
na mesma caixa de entrada, para atendimento feito por gente (o robô não
responde no Direct).

**Contatos.** Etiquetas, campos personalizados organizados em blocos que
o operador ordena, importação por CSV com deduplicação, histórico de tudo
que aconteceu com aquele cliente.

**Funil comercial.** Kanban com negócios ligados às conversas, etapas com
resultado (ganho, perdido), automações por etapa desenhadas numa grade, e
painéis de desempenho e saúde: entradas por período, conversão entre
etapas, ticket médio, custo por lead e CAC quando o Meta Ads está
conectado.

**Automações e fluxos.** Gatilhos por mensagem recebida, contato novo,
palavra-chave, mudança de etapa do funil, agendamento do Calendly,
cobrança vencida no Asaas ou webhook recebido (Typebot, n8n, formulário).
Condições, esperas que param quando o cliente responde ou o card sai da
etapa, ramificações, webhooks. Construtor visual, sem código.

**Disparos.** Envio em massa com modelos aprovados pela Meta, controle de
entrega e leitura por destinatário, substituição de variáveis, e
agendamento.

**Radar de atendimento.** A IA lê as conversas dos últimos sete dias e
abre um cartão só quando há algo a tratar: cliente insatisfeito, pedido
sem resposta, urgência, ou espera longa demais. Não é boletim de todas as
conversas, e cada sinal precisa citar a linha do histórico que o
sustenta.

**Agenda e tarefas.** Reuniões com disponibilidade por advogado e
sobreposição barrada pelo banco. Tarefas por cliente, com prazo,
responsável e respostas encadeadas. A tela "Meu dia" abre o expediente
de cada pessoa com o que venceu e o que chegou; quem administra vê
também o que precisa de correção na operação.

**Assistente de IA com a sua chave.** OpenAI, Anthropic ou Google Gemini.
A chave é da sua conta, guardada cifrada, e o CRM chama o provedor
direto. Sem cobrança por usuário. Respostas sugeridas na caixa de
entrada, robô de resposta automática com limite e passagem limpa para
humano, e base de conhecimento própria com busca semântica opcional.

**Equipe e permissões.** Convite por link, perfis de acesso configuráveis
por tela e por seção, escopo por conexão e por funil, transferência de
titularidade, e um modo "ver como" para conferir o que cada perfil
enxerga.

**Integrações.** Calendly (agendamento vira lead, com automação),
Meta Ads (investimento e atribuição no painel do funil), Asaas (clientes
ligados às fichas, aviso de inadimplência na conversa e régua de
cobrança por WhatsApp), tl;dv (transcrições de reunião na ficha),
webhooks de entrada e de saída, API REST pública com chaves revogáveis
por escopo, e um servidor MCP para operar o CRM a partir de assistentes
de IA.

---

## Como ele é montado

| Camada | Escolha |
|---|---|
| Aplicação | Next.js 16 (App Router), React 19, TypeScript, Tailwind v4 |
| Banco, autenticação, arquivos | Supabase (Postgres com RLS, Auth, Storage, Realtime) |
| WhatsApp | Meta Cloud API e/ou Evolution API |
| Empacotamento | Docker, imagem standalone, atrás de um proxy com TLS |

Cada instalação constrói a própria imagem: a URL e a chave pública do
Supabase são lidas pelo navegador e ficam gravadas no pacote JavaScript
no momento do build. Não existe uma imagem única servindo instalações
diferentes.

O banco reconstrói do zero. As migrations de `supabase/migrations/` são
reaplicadas contra um Postgres vazio a cada mudança, e isso segura a
publicação: nada vai para produção se o esquema não puder ser construído
por quem está começando agora.

---

## Começando

```bash
git clone https://github.com/leonardocabralb/CB-CRM.git
cd CB-CRM
nvm use                            # Node 22, do .nvmrc
npm install
cp .env.local.example .env.local   # preencha; cada variável está explicada lá
npm run dev
```

Para uma instalação de verdade, com Supabase, WhatsApp e servidor, siga
[`docs/INSTALACAO.md`](./docs/INSTALACAO.md) do começo ao fim.

## Documentação

| Documento | Para quê |
|---|---|
| [`docs/INSTALACAO.md`](./docs/INSTALACAO.md) | Instalar do zero, do Supabase à primeira mensagem |
| [`docs/ATUALIZAR.md`](./docs/ATUALIZAR.md) | Trazer uma versão nova sem perder o que você customizou |
| [`docs/public-api.md`](./docs/public-api.md) | A API REST e as chaves com escopo |
| [`docs/mcp.md`](./docs/mcp.md) | Operar o CRM por assistentes de IA |
| [`docs/webhooks.md`](./docs/webhooks.md) | Webhooks recebidos (Typebot, n8n, formulário) e enviados |
| [`docs/docker.md`](./docs/docker.md) | Rodar a imagem localmente, com Docker Compose |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Como mexer no código da sua cópia |

## Idiomas

Português do Brasil e inglês, os dois dicionários completos e mantidos em
paridade por um portão no CI. O idioma é escolhido no build, em
`NEXT_PUBLIC_APP_LOCALE`.

## Marca

Nome, logo e cores são configuração, não código. `NEXT_PUBLIC_APP_NAME` e
`NEXT_PUBLIC_APP_LOGO_URL` definem os dois primeiros; as cores vivem no
tema, em `src/lib/themes.ts`.

## Origem e licença

Este projeto começou como um fork do
[wacrm](https://github.com/ArnasDon/wacrm), de Arnas Donauskas,
distribuído sob licença MIT, e cresceu bastante desde então. O aviso de
copyright original está preservado em [`LICENSE`](./LICENSE).

As conexões de WhatsApp por QR Code usam a
[Evolution API](https://github.com/evolution-foundation/evolution-api),
licenciada sob a Apache 2.0 com condições adicionais. Uma delas é avisar a
quem administra o sistema que ela é usada: o aviso está ao pé de
Configurações → Visão geral. A Evolution roda num serviço próprio, fora
deste código, e tem licença própria a ativar (ver
[`docs/INSTALACAO.md`](./docs/INSTALACAO.md)).
