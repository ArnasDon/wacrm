# Documentação

## Para instalar e operar

| Documento | O que responde |
|---|---|
| [`INSTALACAO.md`](./INSTALACAO.md) | Instalar do zero: Supabase, segredos, WhatsApp, deploy, primeiro acesso, diagnóstico |
| [`ATUALIZAR.md`](./ATUALIZAR.md) | Trazer uma versão nova sem perder customizações, e quando um passo manual é necessário |
| [`docker.md`](./docker.md) | Rodar com Docker localmente |
| [`multi-waba.md`](./multi-waba.md) | Vários números oficiais na mesma instalação, e WABAs em apps diferentes da Meta (`META_APP_SECRET` com vários segredos) |

## Para integrar

| Documento | O que responde |
|---|---|
| [`public-api.md`](./public-api.md) | A API REST `/api/v1`, os escopos e as chaves revogáveis |
| [`webhooks.md`](./webhooks.md) | Os webhooks das duas direções: receber acionamentos de fora e avisar sistemas externos |
| [`mcp.md`](./mcp.md) | O servidor MCP, para operar o CRM a partir de assistentes de IA |

## Onde mais procurar

O [`CHANGELOG.md`](../CHANGELOG.md) na raiz lista o que muda a cada
versão, incluindo quais migrations aplicar e quando um `docker stack
deploy` manual é necessário.

O [`CONTRIBUTING.md`](../CONTRIBUTING.md) explica como mexer no código
desta cópia e como reduzir o atrito das atualizações futuras.

O `.env.local.example` na raiz é a referência das variáveis de ambiente:
cada uma traz, ao lado, o que é, onde obter e o que quebra sem ela. Um
teste no CI cobra que toda variável lida pelo código esteja lá.
