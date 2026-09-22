# Mensagens enviadas pelo celular não aparecem no CRM (`@lid`)

> ⚠️ **OBSOLETO desde 09/09/2026.** A produção deixou a Evolution 2.3.2 + `lidfix`
> e roda a **2.4.0 / Baileys 7.0.0-rc13** (imagem própria `evolution-api-cb`),
> em que o LID é nativo — o patch descrito aqui não existe mais nela. O que
> substitui esta doc: `docs/PLANO-baileys-7.md` (diagnóstico, decisões,
> roteiro, rollback) e `docs/INFRA-VPS.md` §4/§6 (o que está no ar e como
> recriar). O workflow `evolution-lid-fix.yml` continua no repositório só para
> quem ainda estiver na 2.3.x. As medições abaixo ficam como histórico.

Procedimento para aplicar o conserto na Evolution da VPS.

## O que está acontecendo

O WhatsApp trocou o endereço de parte das conversas: em vez do telefone
(`5511999999999@s.whatsapp.net`), passa um identificador interno
(`100000000000102@lid`). Medido na instância do escritório em **27/07/2026**:
**263 dos 551 chats** já migraram.

Quando alguém responde pelo **celular** (ou pelo WhatsApp Web), esse eco chega
ao CRM endereçado só pelo identificador, sem telefone nenhum. O CRM não tem
como saber de qual conversa é, e descarta.

| | |
| --- | --- |
| Ecos do aparelho perdidos | **119 de 143 em ~29h — 83%** |
| Mensagens de cliente perdidas | **0** |
| Como se percebe | comparando o celular com a tela; **não há erro nem aviso** |

O tipo da mensagem não importa: some texto, áudio e imagem igualmente. A
percepção de "só a mídia some" foi coincidência de amostra.

## A causa, e por que o conserto é uma linha

O telefone da outra ponta vem, nesse tipo de mensagem, num campo chamado
`peer_recipient_pn`. A biblioteca que a Evolution usa (Baileys) só passou a
ler esse campo em **2025-09-07**. A versão que roda aqui é de **2025-08-31** —
sete dias antes — e a correção nunca foi trazida de volta para essa linha.

Uma linha basta porque as duas pontas já sabem lidar com o dado: a Evolution
2.3.2 já troca o identificador pelo telefone sozinha assim que o recebe, e o
CB CRM já lê esse campo. **Nenhuma mudança no CRM é necessária.**

---

## Antes de começar

**1. Descubra a imagem que está rodando.** Na VPS:

```bash
docker service inspect evolution_evolution --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}'
```

Guarde a saída **inteira, com o `@sha256:...`**. É ela que vai como
`base_image`, e é para ela que se volta se algo der errado.

Medido em **28/07/2026**:

```
evoapicloud/evolution-api:latest@sha256:3e30bb3dd00d0347430f3609722db6e50e5cd66df4acfbc3777ff8330f2bc2d7
```

Essa imagem foi criada em **2025-09-02** — o dia da tag 2.3.2 —, é Alpine com
node 20.19.4, roda como root e tem `WorkingDir` `/evolution`.

> ⚠️ **A tag `:latest` já andou.** No mesmo dia, `:latest` no Docker Hub
> apontava para `sha256:966625…`, **diferente** do que a VPS roda. Ou seja: um
> `docker stack deploy` que resolva `:latest` troca a versão da Evolution
> sozinho, sem ninguém revisar — e a versão nova é da linha que tem a falha de
> entrega descrita em "Se não funcionar". **Vale fixar o serviço por digest
> independentemente deste patch.**

**1b. Confirme o que está lá dentro** (leitura pura, não muda nada):

```bash
docker exec $(docker ps -q -f name=evolution_evolution | head -1) sh -c 'grep -m1 "\"version\"" /evolution/node_modules/baileys/package.json; grep -n "sender_pn" /evolution/node_modules/baileys/lib/Utils/decode-wa-message.js'
```

Esperado: versão `6.7.19` e a linha `senderPn: stanza?.attrs?.sender_pn,`.
Se vier outra coisa, **pare** — o build falharia de qualquer forma, mas é
melhor saber antes do que depois.

**2. Confirme que a VPS consegue puxar do GHCR.** Ela já puxa a imagem do CRM
de lá, então normalmente sim. Para ter certeza:

```bash
docker pull ghcr.io/leonardocabralb/cb-crm:latest
```

Se pedir autenticação, faça `docker login ghcr.io` com um token de leitura de
pacotes antes de seguir.

**3. Anote a hora.** Serve para comparar o antes e o depois nos logs.

---

## Aplicar

**Passo 1 — construir a imagem.** No GitHub, aba *Actions* → workflow
**`evolution-lid-fix`** → *Run workflow*. Preencha `base_image` com a saída do
passo anterior. O resumo do workflow devolve a linha pronta com o digest.

O build **falha de propósito** se a imagem base não for o que se espera — se
já vier patcheada, ou se for de outra linha da biblioteca. Falhar aqui é o
comportamento certo: significa que a base mudou e o procedimento precisa ser
revisto, não empurrado.

**Passo 2 — aplicar na VPS.** Com a linha que o workflow imprimiu:

```bash
docker service update --image ghcr.io/leonardocabralb/evolution-api-lidfix:2.3.2-lidfix@sha256:... evolution_evolution
```

O Swarm troca o contêiner. **A sessão do WhatsApp não é afetada** — o patch
não toca em credenciais nem no estado de criptografia. Não é preciso ler QR.

**Passo 3 — conferir que subiu.**

```bash
docker service ps evolution_evolution --no-trunc | head -3
curl -s https://api.cbadvogados.com/ | head -c 200
```

---

## Verificar se funcionou

Esta é a parte que decide, e ela tem uma resposta objetiva.

**Teste direto:** mande uma mensagem **pelo celular** para um contato cuja
conversa já esteja em `@lid`, e veja se ela aparece no CRM em segundos.

**Teste pelo log — é o medidor de verdade.** O CRM registra cada descarte
desde o PR #16. No log do serviço do CRM:

```bash
docker service logs crm_crm --since 30m 2>&1 | grep -c 'DESCARTADA: endereçada por @lid'
```

- **Contagem cai a zero** com mensagens saindo do celular → funcionou.
- **Contagem continua subindo** → o patch aplicou, mas o campo
  `peer_recipient_pn` não está vindo nesta conta. Ver "Se não funcionar".

Vale rodar esse mesmo comando **antes** da troca, para ter a linha de base.

---

## Voltar atrás

```bash
docker service update --image <a imagem original, do passo 1> evolution_evolution
```

Só isso. Nada a desfazer no banco, no CRM ou no pareamento.

---

## Se não funcionar

Significa que a premissa não se confirmou: o WhatsApp não manda
`peer_recipient_pn` nos ecos desta conta. **Isso é informação, não fracasso** —
é a única medição que ninguém conseguiu fazer sem aplicar o patch.

Nesse caso, o próximo fio a puxar já foi localizado: a Baileys 6.7.19 emite um
evento `chats.phoneNumberShare` (`lib/Socket/messages-recv.js:643`) carregando
exatamente o par identificador ↔ telefone, quando o WhatsApp o compartilha. A
Evolution 2.3.2 não parece repassá-lo ao webhook — mas o dado chega ao
processo, e isso muda o problema de "não existe" para "não está exposto".

O que **não** fazer nesse cenário, e o porquê:

- **Subir para Evolution 2.3.7** — troca a perda do eco por um risco pior:
  há falha aberta e ativa em que a mensagem **não chega ao cliente** e a API
  responde "pendente" para sempre. Hoje perdemos o registro de mensagem que o
  cliente **recebeu**; lá o cliente não recebe.
- **Forçar a biblioteca 7 sobre a Evolution 2.3.2** — não sobe. A 2.3.2
  importa uma função que a linha 7 removeu; o contêiner entra em crash-loop.

---

## Estado do deploy da Evolution (medido em 28/07/2026)

Registrado aqui porque **não está no git**: o stack da Evolution vive na VPS,
fora deste repositório, e nada além desta seção guarda essa informação.

| | |
| --- | --- |
| Definição do stack | `/root/evolution.yaml` na VPS |
| Quem administra | `docker stack deploy` na mão — **não** o Portainer |
| Serviço | `evolution_evolution`, atrás do Traefik em `api.cbadvogados.com` |
| Volume | `evolution_instances` (as sessões pareadas vivem aqui) |
| Rede | `CBAdvNet` |

O Portainer roda na VPS e administra outros stacks, mas **não este**: as
etiquetas do serviço têm só `com.docker.stack.namespace`, nenhuma
`io.portainer`. Ou seja, o arquivo é fonte única — não há segunda cópia
escondida na base do Portainer.

### A armadilha que estava armada, e foi desarmada

Até 28/07/2026 o arquivo dizia:

```yaml
image: atendai/evolution-api:latest
```

Enquanto o serviço rodava `evoapicloud/evolution-api:latest@sha256:3e30bb…`.
**Repositório diferente**, não só tag flutuante — `atendai` é o repositório
antigo do projeto. Um `docker stack deploy` teria trocado a Evolution por uma
imagem de outra origem e versão desconhecida, levando junto o patch do `@lid`.

Hoje a linha está fixada na imagem patcheada, **com digest**, e com o aviso
colado nela. O arquivo passou a ser rede de proteção em vez de gatilho.

### ⚠️ O arquivo AINDA está incompleto — não rode `stack deploy`

A suspeita se confirmou. Comparando o serviço em execução com o arquivo em
28/07/2026, **sete variáveis existem no serviço e não no arquivo**:

```
S3_ACCESS_KEY   S3_BUCKET   S3_ENABLED   S3_ENDPOINT
S3_PORT         S3_SECRET_KEY   S3_USE_SSL
```

São a configuração de armazenamento de mídia da Evolution, ajustada direto no
serviço e nunca devolvida ao arquivo. **Um `stack deploy` as apagaria**, e a
Evolution perderia o S3 sem nenhum erro visível.

Ou seja: hoje o arquivo protege a IMAGEM (o patch do `@lid`) mas quebraria o
S3. Enquanto essas sete linhas não voltarem para ele, o arquivo **não é
seguro de aplicar**.

Para completá-lo, leia os valores do serviço e acrescente-os ao bloco
`environment:`, com a mesma indentação das demais:

```bash
docker service inspect evolution_evolution \
  --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' | grep '^S3_'
```

⚠️ `S3_SECRET_KEY` e `S3_ACCESS_KEY` são credenciais. Edite direto na VPS; não
passe por chat, e-mail ou histórico de shell.

Depois, repita a comparação abaixo até dar "sem divergência".

### Como comparar arquivo × serviço

```bash
docker service inspect evolution_evolution \
  --format '{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{println .}}{{end}}' \
  | cut -d= -f1 | sort > /tmp/rodando.txt
grep -oE "^[[:space:]]+- [A-Z_]+=" /root/evolution.yaml | tr -d ' -' | cut -d= -f1 | sort > /tmp/arquivo.txt
diff /tmp/rodando.txt /tmp/arquivo.txt && echo "sem divergência"
```

E, como a imagem no GHCR é **privada** (`401` sem autenticação), o deploy
exige `--with-registry-auth` — ou tornar o pacote público, o que elimina a
pegadinha:

```bash
docker stack deploy -c /root/evolution.yaml --with-registry-auth evolution
```

## Dois avisos que valem independentemente disto

**A imagem não está fixada.** A Evolution 2.3.2 declara a biblioteca como
`github:WhiskeySockets/Baileys`, sem versão. Estarmos na 6.7.19 é acidente da
data em que a imagem foi construída — um rebuild qualquer traz a linha 7 e o
serviço não sobe. Vale fixar o serviço por **digest**, com ou sem este patch.

**A regra dos 14 dias.** O celular pareado precisa se conectar à internet ao
menos uma vez a cada 14 dias, ou o WhatsApp derruba o dispositivo vinculado e
a Evolution precisa de QR novo. É regra do WhatsApp, não da Evolution, e vale
para qualquer integração por QR.
