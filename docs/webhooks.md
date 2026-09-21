# Webhooks

O CRM tem webhooks nas **duas direções**, e elas resolvem problemas
diferentes. As duas ficam em **Configurações → Webhooks**, que só
administradores enxergam.

| | O que faz | Quando usar |
|---|---|---|
| **Recebidos** | Um sistema de fora chama o CRM e dispara suas automações | Formulário, Typebot, n8n, chatbot — qualquer coisa que gere lead |
| **Enviados** | O CRM avisa um sistema de fora quando algo acontece aqui | Alimentar um painel, um ERP, uma planilha |

---

## Webhooks recebidos

### O caminho inteiro, em uma frase

O sistema de fora faz um `POST` na URL do webhook → o CRM registra o
acionamento → acha o cliente pelo **telefone** que veio no corpo (criando a
ficha se for número novo) → dispara as automações que têm o gatilho
**"Webhook recebido"**.

### 1. Crie o webhook

**Configurações → Webhooks → Recebidos → Novo webhook.** Você informa:

- **Nome** — aparece no log e no seletor do construtor de automações. É
  único por conta.
- **Campo do telefone** — o nome do campo, **dentro do JSON**, que carrega o
  telefone do cliente. Sem ele o acionamento é registrado mas nenhuma
  automação roda, porque não há sobre quem agir.
- **Campo do nome** — opcional; usado só quando a ficha é criada.
- **Campo do id** — opcional. Quando o sistema de fora manda um
  identificador estável do envio, o CRM ignora a reentrega do mesmo
  acionamento em vez de disparar tudo outra vez.

Ao salvar, o CRM mostra **uma única vez** o segredo do webhook. Guarde-o
agora: ele não é exibido de novo, nem mascarado. Se perder, apague o
webhook e crie outro.

### 2. Configure o sistema de fora

Dois valores, os dois na tela do webhook:

```
POST  https://SEU-CRM/api/cb/entrada/<token>
Authorization: Bearer <segredo>
Content-Type: application/json
```

A **URL identifica qual webhook é**; o **segredo prova que é você**. Os dois
são necessários — a URL sozinha não basta.

> **Sem segredo.** Há uma opção para sistemas que não conseguem mandar
> cabeçalho. Ligá-la faz da URL a única barreira: quem a tiver consegue
> disparar suas automações. Trate a URL como senha, e prefira o segredo
> sempre que o sistema de fora permitir.

### 3. Como o corpo vira variável

O corpo pode ser qualquer JSON. O CRM o **achata** e entrega o resultado às
automações como `{{vars.<nome>}}`. As regras:

| No corpo | Vira |
|---|---|
| `{"nome": "Ana"}` | `{{vars.nome}}` |
| `{"contato": {"telefone": "..."}}` | `{{vars.contato_telefone}}` |
| `{"tags": ["a", "b"]}` | `{{vars.tags_0}}`, `{{vars.tags_1}}` |
| `{"observação": "x"}` | `{{vars.observacao}}` (acento sai) |
| `{"nome-completo": "x"}` | `{{vars.nome_completo}}` (hífen vira `_`) |
| `{"email": null}` | `{{vars.email}}`, vazio |

Isso não é escolha de estilo: o interpolador das automações só reconhece
nomes com letras, números e `_`, e lê **um nível só** — `{{vars.pedido.total}}`
nunca funcionaria. Por isso o aninhamento vira `pedido_total`.

**Você não precisa decorar nada disso.** Acione o webhook uma vez e abra o
log: cada acionamento mostra a lista completa de variáveis com os valores
que chegaram. O painel do gatilho, no construtor de automações, mostra a
mesma lista.

Limites: 100 variáveis por acionamento, 500 caracteres por valor, 5 níveis
de aninhamento, 60 acionamentos por minuto por webhook.

### 4. Monte a automação

**Automações → Nova → Gatilho: "Webhook recebido"**, e escolha o webhook
(ou deixe em "Qualquer webhook de entrada"). Os passos usam
`{{vars.*}}` do payload e `{{contact.*}}` do cliente.

> ⚠️ Lead novo **não tem negócio aberto**. Um passo "Mover card de etapa"
> falha nesse caso e encerra a execução. Se a automação precisa mexer no
> funil, ponha um **"Criar negócio"** antes — ele não faz nada quando o
> contato já tem card, então serve para os dois casos.

Três comportamentos que valem para todo webhook recebido:

- **A conversa do lead novo nasce encerrada.** Ele ainda não escreveu, e
  uma conversa vazia em "Abertas" só atrapalha a equipe. Ela aparece na aba
  **Encerradas** e reabre sozinha na primeira mensagem — dele ou da equipe.
  Se o contato já tinha conversa, ela fica como está.
- **Variável vazia não apaga campo.** "Atualizar campo" com
  `{{vars.algo}}` que chegou vazio (ou nem chegou) não mexe no valor que a
  ficha já tem. Por isso dá para mandar o mesmo corpo em vários pontos de um
  formulário: o que ainda não foi respondido não apaga o que já se sabia.
- **O formulário é público.** Qualquer pessoa pode digitar o telefone de um
  cliente seu. Se a automação grava dados ou mexe no funil, ponha o que ela
  faz dentro de uma condição **"O negócio está na etapa X"** (a etapa em que o
  formulário cria o card): assim ela só age sobre o card que o próprio
  formulário criou, e nunca sobre a ficha de quem já é cliente.

### Typebot

- Use o bloco **HTTP request** (Integrações), não o bloco lógico "Webhook" —
  aquele trava a conversa esperando uma resposta de fora.
- Método **POST**. Em *Advanced configuration*: **Headers** →
  `Authorization` = `Bearer <segredo>`; ligue **Custom body** e cole o JSON;
  deixe **Execute on client** DESLIGADO (ligado, o segredo iria para o
  navegador de cada visitante).
- Nomeie as chaves do JSON com os **mesmos nomes das variáveis do Typebot**
  (`{"phone": "{{phone}}", "name": "{{name}}", …}`) e configure o **campo do
  telefone** do webhook com esse nome. Se alguém desligar o *Custom body*, o
  Typebot manda um retrato com as variáveis pelos mesmos nomes, e nada quebra.
- O Typebot **não repete** uma chamada que falhou (401, 404, 429 ou tempo
  esgotado): o ponto é perdido, e o erro só aparece em Typebot → *Results* →
  *logs*. Esses três erros também não chegam ao log do CRM.
- Um bloco só roda se o fluxo PASSAR por ele. Quando a seta de um grupo entra
  no meio dele (num bloco específico), o que estiver acima desse bloco nunca
  roda — ponha o HTTP request depois do ponto de entrada.
- O "Preview" do editor e o botão "Test the request" fazem chamadas DE
  VERDADE: teste com um telefone fictício.

### 5. Leia o log

Cada webhook tem um log com os acionamentos, do mais recente para o mais
antigo. É por ele que "configurei e não aconteceu nada" tem resposta:

| Resultado | O que significa | O que fazer |
|---|---|---|
| **Disparado** | Automação executou até o fim | — |
| **Em espera** | A automação parou num passo "Aguardar" | O restante sai pelo agendador; veja o histórico da automação |
| **Sem automação** | Chegou, mas nenhuma automação ativa escuta este webhook | Crie a automação, ou confira o escopo dela |
| **Sem telefone** | O campo do telefone não veio, ou não parecia um telefone | Confira o **campo do telefone** contra a lista de variáveis do log |
| **Sem contato** | Não foi possível criar/achar a ficha | Confira o formato do número |
| **Ignorado** | O webhook está desligado | Ligue-o |
| **Falhou** | Algum passo da automação deu erro | Veja o histórico da automação |
| **Recebido** | Chegou e ainda não foi processado | Se ficar assim, veja "Falhou" acima |

Clicando na linha, você vê o detalhe: todas as variáveis com seus valores, o
motivo por extenso e um link para a ficha do cliente.

**Processar de novo** roda aquele acionamento outra vez, depois de você
arrumar o que faltava. Só aparece em `Recebido`, `Sem contato` e
`Sem automação` — nos demais, repetir mandaria a mesma mensagem ao cliente
mais uma vez.

### Se nada chega

1. O log está vazio? Então a chamada não chegou. Confira a URL e o método
   (`POST`).
2. O sistema de fora recebe **401**? O segredo está errado ou não está indo
   no cabeçalho `Authorization`.
3. Recebe **404**? A URL está errada, ou o webhook foi apagado.
4. Recebe **400**? O corpo não é JSON válido.
5. Chega mas dá "Sem telefone"? Abra o detalhe e compare os nomes das
   variáveis com o que está no **campo do telefone**.

---

## Webhooks enviados

O CRM faz `POST` num endereço seu quando algo acontece aqui. Três eventos:

| Evento | Dispara quando |
|---|---|
| `message.received` | Chega mensagem de um contato |
| `message.status_updated` | Muda o status de entrega de uma mensagem enviada |
| `conversation.created` | Uma conversa nova é aberta |

**Configurações → Webhooks → Enviados → Novo endereço.** A URL precisa ser
`https://` e alcançável da internet. O segredo é mostrado uma única vez —
guarde-o no sistema que vai **receber**, para conferir a assinatura.

### Conferindo a assinatura

Cada entrega leva `X-Wacrm-Signature: t=<unix>,v1=<hex>`, onde `v1` é
`HMAC-SHA256(segredo, "<t>.<corpo cru>")`. Confira sobre o **corpo cru**,
compare em tempo constante, e recuse se `t` tiver mais que alguns minutos.

### Duas limitações que você precisa conhecer

- **Uma tentativa por evento**, com 5 segundos de limite e **sem nova
  tentativa**. Trate entrega perdida como possível e reconcilie pelos
  endpoints de leitura da [API pública](./public-api.md) quando importar.
- **Quinze falhas seguidas desligam o endereço sozinho.** Religar pela tela
  zera o contador.

Os mesmos endereços também podem ser geridos pela API pública, com uma chave
de escopo `webhooks:manage` — veja [`public-api.md`](./public-api.md).
