# Vários números oficiais (WABAs) na mesma instalação

Cada número oficial é uma **conexão** em *Configurações → Conexões*, com o
seu Phone Number ID, WABA ID, token e Verify Token. Várias conexões —
de uma conta ou de várias contas da mesma instalação — convivem sem
configuração extra. O que decide se os webhooks delas chegam é **de qual
app da Meta** cada WABA faz parte.

## O que é de cada conexão e o que é da instalação

| O quê | Onde fica | Vale para |
|---|---|---|
| Phone Number ID, WABA ID, token permanente, Verify Token | a conexão (o token é guardado cifrado) | aquela conexão |
| App Secret (`META_APP_SECRET`) | variável de ambiente | a instalação inteira |
| App ID (`META_APP_ID`) | variável de ambiente | a instalação inteira |

A Meta **assina** cada webhook com o App Secret do app em que a WABA está
inscrita, e o CRM confere essa assinatura contra `META_APP_SECRET` antes de
ler qualquer coisa — assinatura que não confere é recusada com 401.

## Caso A — todas as WABAs no MESMO app da Meta (o caso comum)

Nada a fazer além do [passo 3.2 da instalação](./INSTALACAO.md): um App
Secret em `META_APP_SECRET`, e cada número criado como conexão em
*Configurações → Conexões*. No painel do app, a Callback URL é a mesma para
todos (`https://crm.seudominio.com/api/whatsapp/webhook`), e o CRM encaminha
cada entrega pela conexão dona do `phone_number_id` que ela traz.

## Caso B — WABAs em apps DIFERENTES

Cada app assina com o seu segredo. Liste todos em `META_APP_SECRET`,
separados por vírgula (espaços em volta são ignorados):

```
META_APP_SECRET=segredo-do-app-um,segredo-do-app-dois
```

A entrega é aceita quando a assinatura confere com QUALQUER um deles; cada
comparação é feita em tempo constante. Variável vazia, ou só com vírgulas,
continua recusando tudo. Em cada app, registre a mesma Callback URL e o
Verify Token da conexão correspondente.

⚠️ Mudar variável de ambiente exige reiniciar o serviço com ela carregada
(na VPS: `docker stack deploy` com o arquivo de ambiente — ver
[`INSTALACAO.md`](./INSTALACAO.md)).

## O que NÃO funciona com apps diferentes

`META_APP_ID` é **um só**: ele é usado no envio da imagem de cabeçalho de
modelo (o upload da Meta é por app). Com WABAs em apps diferentes, criar
modelo com cabeçalho de imagem funciona só nas WABAs do app cujo ID está na
variável. Texto, botões e modelos sem cabeçalho de mídia não dependem dele.

## Como conferir

- Mensagem que chega a uma conexão e não aparece no CRM, com o resto
  funcionando: confira no log do servidor a recusa da assinatura — é o
  segredo daquele app faltando em `META_APP_SECRET`.
- A verificação do webhook no painel da Meta (o GET) usa o Verify Token da
  conexão; ela falha se a conexão ainda não foi salva no CRM.
