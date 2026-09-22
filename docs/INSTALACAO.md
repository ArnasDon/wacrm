# Instalação do zero

Guia único, do nada até uma mensagem de WhatsApp entrando e saindo. Não
depende de nenhum outro documento.

Ele substitui o antigo `SETUP-PRODUCAO.md`, que descrevia uma hospedagem
que não é mais usada e afirmava coisas que deixaram de ser verdade.

**Tempo:** de duas a quatro horas na primeira vez, quase tudo esperando
DNS, certificado e aprovação da Meta (quando você escolhe a Meta).

---

## 0. O que você precisa antes de começar

| Item | Para quê | Custo |
|---|---|---|
| Conta no [Supabase](https://supabase.com) | Banco, autenticação, arquivos | Plano gratuito serve para começar |
| Um servidor com Docker **em modo Swarm** | Rodar o CRM e o gateway de WhatsApp | Qualquer VPS de 2 vCPU / 4 GB dá conta |
| Um domínio, com DNS que você controla | Endereço do CRM e certificado | — |
| Conta no GitHub | Guardar a sua cópia e construir a imagem | Gratuito |
| Um número de WhatsApp | O número de atendimento | — |

Opcional: uma chave de OpenAI, Anthropic ou Google Gemini, se quiser o
assistente de IA, a transcrição de áudio e o Radar de atendimento.

### Decisão que vale a pena tomar agora: como conectar o WhatsApp

São dois caminhos, e cada conexão do CRM escolhe o seu. Dá para usar os
dois na mesma instalação.

**Meta Cloud API (oficial).** Você cria um app no Meta for Developers,
verifica o número numa conta comercial e envia modelos de mensagem para
aprovação. Em troca: suporte oficial, sem risco de bloqueio, e o número
some do celular (passa a viver na nuvem da Meta). Fora de uma janela de
24 horas desde a última mensagem do cliente, só é possível responder com
um modelo aprovado.

**Evolution API (não oficial).** Você hospeda um gateway de código aberto
e pareia por QR code, como o WhatsApp Web. Em troca: nada de aprovação,
nada de modelos, nada de janela de 24 horas, e o número continua no
celular. O custo é o risco: é um cliente não oficial, e o WhatsApp pode
bloquear o número.

Se você não tem certeza, comece pela Evolution: ela sobe em quinze
minutos e não depende de aprovação de ninguém. Trocar depois é
acrescentar uma conexão, não refazer a instalação.

### 0.1 Preparar o servidor

Faça isto **antes de tudo que vem depois**, uma vez só. Tanto o gateway
de WhatsApp (passo 3.1) quanto o CRM (passo 5.3) sobem como serviços do
Docker Swarm e conversam por uma rede overlay, e nenhuma das duas coisas
existe num servidor recém-instalado.

```bash
# Docker instalado NÃO é o mesmo que Docker em modo Swarm.
docker info --format '{{.Swarm.LocalNodeState}}'   # "inactive" = falta iniciar
docker swarm init                                  # só se estiver inactive

# A rede por onde o CRM alcança o gateway. Ela não é publicada em
# porta nenhuma do servidor: só quem está nela se enxerga.
docker network create --driver overlay --attachable crmnet
```

Confira antes de seguir:

```bash
docker info --format '{{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}}'
# esperado: "active true"
docker network ls | grep crmnet
```

> ⚠️ `active true` é o que o rollout do CI exige literalmente: ele recusa
> um nó cujo estado não seja ativo ou que não seja manager. Se aqui sair
> outra coisa, pare e resolva agora — cada passo seguinte assume estes
> dois comandos feitos, e a falha aparece lá na frente, longe da causa.

---

## 1. Supabase

### 1.1 Criar o projeto

No painel do Supabase, **New project**. Escolha a região mais próxima dos
seus usuários e guarde a senha do banco. O projeto leva uns dois minutos
para subir.

### 1.2 Aplicar as migrations

Todo o esquema do banco vive em `supabase/migrations/`, e as migrations
reconstroem tudo do zero, em ordem. Isso é verificado a cada mudança
neste repositório: o CI sobe um Postgres vazio e reaplica todas elas
antes de deixar publicar.

Na sua máquina, com a [CLI do Supabase](https://supabase.com/docs/guides/local-development/cli/getting-started)
instalada:

```bash
git clone <a-sua-cópia-deste-repositório> crm
cd crm
supabase link --project-ref <o-ref-do-seu-projeto>
supabase db push
```

O `<ref>` está na URL do painel e em *Project Settings → General*.

> **Por que `db push` funciona para você e não para nós.** Num projeto
> **novo**, o histórico de migrations nasce vazio e alinhado com os
> arquivos, então o `push` aplica tudo em ordem e registra corretamente.
> Na instalação original deste código o histórico foi criado por outro
> caminho e ficou com identificadores que não correspondem aos nomes dos
> arquivos — por isso o `CLAUDE.md` proíbe `db push` lá. Não é o seu caso.

Confira em *Table Editor* que existem tabelas como `messages`,
`conversations`, `contacts` e `cb_channels`.

### 1.3 Ligar o Realtime

*Database → Replication*. As migrations já inscrevem as tabelas que
precisam, mas confirme que a publicação `supabase_realtime` está ativa.
Sem isso a caixa de entrada não atualiza sozinha.

### 1.4 Configurar a autenticação

*Authentication → URL Configuration*:

- **Site URL:** `https://crm.seudominio.com`
- **Redirect URLs**, acrescente:
  - `https://crm.seudominio.com/auth/callback`

É a recuperação de senha: sem ela o link do e-mail é recusado pelo
Supabase. (Os convites de equipe não passam por e-mail do Supabase e não
precisam de entrada aqui.)

*Authentication → Emails → SMTP Settings*: configure um SMTP próprio.
O remetente embutido do Supabase é limitado a testes e não entrega
volume — quem depende dele descobre no dia em que convida a equipe.

> ⚠️ **Deixe os cadastros LIGADOS por enquanto.** Em *Authentication →
> Sign In / Providers* existe a opção *Allow new users to sign up*, e ela
> vem ligada. É por ela que você cria a sua própria conta no passo 6.
> Desligue-a logo depois (passo 10): os convites do CRM continuam
> funcionando com ela desligada.

### 1.5 Copiar as três chaves

*Project Settings → API*:

| Onde no painel | Vai para |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret` | `SUPABASE_SERVICE_ROLE_KEY` |

A chave `service_role` ignora todas as regras de acesso do banco. Ela só
pode existir no servidor. Nunca a coloque numa variável com prefixo
`NEXT_PUBLIC_`.

---

## 2. Gerar os segredos da instalação

Na sua máquina:

```bash
# Criptografa os tokens de WhatsApp e as chaves de IA gravados no banco.
openssl rand -hex 32

# Protege as rotas de tarefas agendadas.
openssl rand -hex 32

# Autentica o webhook da Evolution (pule se for só Meta).
openssl rand -hex 32
```

> ⚠️ **A primeira, `ENCRYPTION_KEY`, não pode ser trocada depois.** Todo
> token de WhatsApp e toda chave de IA são gravados no banco cifrados com
> ela. Trocá-la não dá erro: os valores simplesmente deixam de ser
> legíveis, e cada conexão precisa ser reconfigurada à mão. Guarde-a onde
> você guarda senha de verdade.

---

## 3. WhatsApp

Faça **um** dos dois caminhos. Você pode voltar e fazer o outro depois.

### 3.1 Caminho A — Evolution API

O gateway roda no mesmo servidor do CRM, **como serviço do Swarm e na
mesma rede overlay que ele**. O repositório traz um
`docker-compose.evolution.yml` pronto para desenvolvimento local; para o
servidor, o essencial é:

```yaml
# evolution-stack.yml
services:
  evolution:
    image: evoapicloud/evolution-api:2.3.2
    environment:
      SERVER_URL: https://api.seudominio.com
      AUTHENTICATION_API_KEY: <a-sua-chave-global>   # invente uma longa
      DATABASE_ENABLED: 'true'
      DATABASE_PROVIDER: postgresql
      DATABASE_CONNECTION_URI: postgresql://evolution:<senha>@postgres:5432/evolution?schema=public
      DEL_INSTANCE: 'false'
    networks:
      - crmnet
    deploy:
      replicas: 1
      restart_policy:
        condition: any

networks:
  crmnet:
    external: true
```

```bash
# A rede `crmnet` já existe desde o passo 0.1.
docker stack deploy -c evolution-stack.yml evolution
docker service logs -f evolution_evolution
```

> ⚠️⚠️ **NÃO publique a Evolution em `127.0.0.1:8080` e NÃO aponte o CRM
> para esse endereço.** Parece a coisa segura a fazer, e é o erro que
> deixa a instalação inteira sem WhatsApp: o CRM roda **dentro de um
> contêiner**, e ali `127.0.0.1` é o próprio contêiner do CRM, não o
> servidor nem a Evolution. Provisionar canal e parear número falham, com
> "connection refused" e sem nada explicando por quê.
>
> Quem resolve o endereço é o **DNS do Swarm**: dentro da rede overlay, o
> serviço `evolution` do stack `evolution` atende como
> `evolution_evolution`. Por isso o valor certo é
> `EVOLUTION_BASE_URL=http://evolution_evolution:8080` — tráfego que nunca
> sai do host, sem passar pela internet e sem expor a chave global.
>
> O que o `127.0.0.1` tentava proteger continua protegido, e melhor: sem
> `ports:`, a Evolution **não** fica publicada em porta nenhuma do
> servidor. Só quem está na mesma rede overlay a alcança. Se você quiser o
> painel dela (`/manager`) pelo navegador, exponha-o pelo mesmo proxy que
> serve o CRM, com TLS, e nunca a porta 8080 crua.

**O conserto do eco do celular.** Quando alguém da equipe responde pelo
**celular pareado**, o WhatsApp entrega esse eco ao gateway endereçado por
um identificador interno (`@lid`) e sem o telefone da outra ponta. A
versão da biblioteca Baileys embarcada na Evolution 2.3.2 ignora o campo
que traz esse telefone, e o CRM não consegue saber de qual conversa é a
mensagem: ela é descartada. Na instalação onde isso foi medido, 119 de
143 ecos se perderam em cerca de 29 horas.

Há dois caminhos. **Na 2.3.x**, o repositório traz o conserto, de uma linha,
como imagem derivada (`docker/evolution-lid-fix/`) e um workflow que a
constrói (`.github/workflows/evolution-lid-fix.yml`): rode-o informando a
imagem base e a tag de saída, depois aponte o serviço para a imagem
resultante. **Na 2.4 (Baileys 7)** o LID é nativo e o eco do celular chega
certo sem patch — é o que a instalação de referência roda desde 09/09/2026 —,
mas ela pede um cadastro gratuito de licença no `/manager` antes de a API
responder, e a imagem oficial `homolog` não traz o `prisma.config.ts` que o
Prisma 7 exige para migrar (monte o arquivo do repositório da Evolution em
`/evolution/prisma.config.ts`, ou construa a imagem com ele dentro pelo
`docker/evolution-cb/README.md`). O CRM lê os dois formatos de payload.

> Antes de fazer isso, vale medir: mande uma mensagem pelo celular
> pareado e veja se ela aparece na conversa certa no CRM. Se aparecer, a
> versão que você subiu já traz o campo e você não precisa da imagem
> derivada. O conserto foi aceito na Baileys em setembro de 2025 e pode
> já ter chegado à Evolution que você instalou.

### 3.2 Caminho B — Meta Cloud API

1. Em [developers.facebook.com](https://developers.facebook.com), crie um
   app do tipo **Business** e adicione o produto **WhatsApp**.
2. Em *App Settings → Basic*, copie o **App Secret**. Ele vai em
   `META_APP_SECRET`. Sem ele o CRM recusa todo webhook recebido, porque
   não consegue verificar a assinatura.
3. Em [business.facebook.com](https://business.facebook.com) →
   *Business Settings → Users → System Users*, crie um usuário de sistema
   com papel Admin, vincule o app e a conta de WhatsApp, e gere um token
   com as permissões `whatsapp_business_messaging` e
   `whatsapp_business_management`, expiração **Never**.

   Não use o token temporário de 24 horas que aparece na tela de *API
   Setup*: ele funciona hoje e para de funcionar amanhã, sem aviso.
4. Anote o **Phone Number ID** e o **WABA ID** em *WhatsApp → API Setup*.
5. Para um número de produção, cadastre o **PIN de verificação em duas
   etapas** em *WhatsApp Accounts → Phone Numbers*. Números de teste da
   Meta não têm PIN.

O webhook da Meta é registrado depois, no passo 7 — depois que o CRM
estiver no ar.

---

## 4. Montar o arquivo de ambiente

Copie `.env.local.example` e preencha. Cada variável tem, ao lado, o que
ela é e o que quebra sem ela — leia o arquivo, ele é a referência.

No servidor, crie um `crm.env` fora do controle de versão:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<a chave anon>
SUPABASE_SERVICE_ROLE_KEY=<a chave service_role>
ENCRYPTION_KEY=<os 64 hex do passo 2>
AUTOMATION_CRON_SECRET=<o segundo segredo do passo 2>

# Só se usar a Evolution. O nome é o DNS do Swarm (<stack>_<serviço>),
# NUNCA 127.0.0.1 — ver o aviso no passo 3.1.
EVOLUTION_BASE_URL=http://evolution_evolution:8080
EVOLUTION_GLOBAL_API_KEY=<a chave global do gateway>
EVOLUTION_WEBHOOK_SECRET=<o terceiro segredo do passo 2>

# Só se usar a Meta:
META_APP_SECRET=<o App Secret>
```

```bash
chmod 600 crm.env
```

---

## 5. Construir e publicar

> **Cada instalação constrói a própria imagem.** A URL e a chave anônima
> do Supabase são lidas pelo navegador, e o Next.js as grava dentro do
> pacote JavaScript **no momento do build**. Não existe uma imagem única
> servindo instalações diferentes — a sua tem as suas credenciais dentro.
> Vale o mesmo para o idioma, o nome do produto e o logo.

### 5.1 Ajustar o que identifica a sua instalação

No `.github/workflows/pipeline.yml`, no passo *Build and push*:

```yaml
build-args: |
  NEXT_PUBLIC_SUPABASE_URL=${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
  NEXT_PUBLIC_SUPABASE_ANON_KEY=${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
  NEXT_PUBLIC_SITE_URL=https://crm.seudominio.com
  NEXT_PUBLIC_APP_LOCALE=pt-BR
  NEXT_PUBLIC_APP_NAME=CRM do Seu Escritório
  NEXT_PUBLIC_APP_SHORT_NAME=Seu CRM
```

Idiomas prontos: `pt-BR` e `en`, os dois completos. Para um logo próprio,
ponha o arquivo em `public/marca/logo.svg` e acrescente
`NEXT_PUBLIC_APP_LOGO_URL=/marca/logo.svg`.

O `NEXT_PUBLIC_APP_SHORT_NAME` é o nome que aparece embaixo do ícone quando
alguém instala o sistema no celular (no iPhone: Safari → Compartilhar →
Adicionar à Tela de Início). O iPhone corta nome comprido ali; sem essa
linha, vale o `NEXT_PUBLIC_APP_NAME`.

No mesmo arquivo, ajuste `IMAGE` para o seu usuário do GitHub, e no
`docker-stack.yml` ajuste o domínio, a rede e o resolvedor de certificado
para os do seu servidor.

### 5.2 Segredos do GitHub

*Settings → Secrets and variables → Actions*:

| Segredo | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | a URL do projeto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | a chave anon |
| `VPS_SSH_HOST` | endereço do servidor |
| `VPS_SSH_USER` | usuário com acesso ao Docker |
| `VPS_SSH_KEY` | chave SSH privada desse usuário |

Os segredos de runtime (`service_role`, `ENCRYPTION_KEY`, credenciais da
Evolution) **não** passam por aqui. Eles vivem no `crm.env` do servidor.
O que o CI faz é trocar a imagem; o ambiente é do servidor.

### 5.3 O primeiro deploy é manual

Um push no `main` constrói a imagem e roda `docker service update`, que
só atualiza um serviço que já existe. Da primeira vez, no servidor:

```bash
# 1. O Swarm já foi iniciado no passo 0.1. Confirme, porque publicar
#    num nó que não é manager falha aqui:
docker info --format '{{.Swarm.LocalNodeState}} {{.Swarm.ControlAvailable}}'
# esperado: "active true" — se não for, volte ao passo 0.1

# 2. Autenticar no registro onde a SUA imagem foi publicada.
docker login ghcr.io -u <seu-usuário>

# 3. Carregar os segredos E APONTAR PARA A SUA IMAGEM.
set -a && . ./crm.env && set +a
export CRM_IMAGE=ghcr.io/<seu-usuário>/cb-crm:latest

# 4. Subir. O `--with-registry-auth` repassa ao Swarm o login do passo 2:
#    sem ele, imagem PRIVADA (o padrão de pacote criado a partir de
#    repositório privado) não é baixada, e o serviço fica sem subir.
docker stack deploy -c docker-stack.yml --with-registry-auth crm
docker service logs -f crm_crm
```

> ⚠️⚠️ **O `export CRM_IMAGE` não é opcional numa instalação sua.** O
> `docker-stack.yml` traz um valor de queda que aponta para a imagem do
> repositório de ONDE ESTE CÓDIGO VEIO, e trocar o `IMAGE` no
> `pipeline.yml` não muda esse valor de queda. Sem exportar, o Swarm puxa
> a imagem de outra pessoa. Na melhor hipótese o pull falha por falta de
> permissão; na pior ele funciona — e aí a sua instalação sobe com a URL e
> a chave pública do Supabase **de outro projeto** gravadas no pacote
> JavaScript, porque todo `NEXT_PUBLIC_*` é inlinado no build. O navegador
> dos seus usuários passaria a falar com o banco de outra empresa.
>
> Vale editar a linha `image:` do `docker-stack.yml` para a sua imagem de
> uma vez, e deixar o `export` como cinto e suspensório.

> ⚠️ **As duas primeiras linhas andam juntas, sempre.** O
> `docker-stack.yml` usa `${VARIAVEL}`, que o Docker substitui pelo
> ambiente do shell. Variável ausente vira **string vazia, sem erro e sem
> aviso** — e o resultado é o pior tipo de falha: o site responde
> normalmente (a tela de login já está dentro da imagem) enquanto o
> servidor inteiro está sem credencial nenhuma. Nada é gravado, nada é
> enviado, e as rotas de tarefas agendadas passam a responder 503.

Confira, de dentro do container:

```bash
cid=$(docker ps --filter name=crm_crm --format '{{.ID}}' | head -1)
docker exec $cid printenv SUPABASE_SERVICE_ROLE_KEY | wc -c   # 0 = quebrado
curl -s -o /dev/null -w '%{http_code}\n' https://crm.seudominio.com/api/cb/scheduled/cron
# 401 = segredo no lugar · 503 = ambiente vazio
```

### 5.4 O agendador não é opcional

O `docker-stack.yml` traz um serviço chamado `agendador`. Ele bate nas
rotas de tarefas do CRM em dois laços: um de 15 segundos, só para
`automations/cron` (é o piso das pausas curtas do "Aguardar" e das
retentativas de envio), e outro de 15 minutos para as outras seis rotas.

**Sem ele, mensagem agendada não sai.** O Next.js não tem agendador
embutido, e nada no código chama essas rotas sozinho. Também dependem
dele: o passo "Aguardar" das automações, os lembretes por data, o Radar
de atendimento e as sincronizações do Meta Ads, do tl;dv e do Asaas. A
linha fica gravada no banco e nunca vira mensagem.

Se você não usa Docker Swarm, substitua por uma entrada de `cron`:

```
* * * * * curl -fsS -m 50 -H "x-cron-secret: SEGREDO" https://crm.seudominio.com/api/automations/cron
*/15 * * * * for r in cb/scheduled flows cb/radar cb/meta-ads cb/tldv cb/asaas; do curl -fsS -m 120 -H "x-cron-secret: SEGREDO" "https://crm.seudominio.com/api/$r/cron"; done
```

O `cron` do sistema roda no mínimo a cada minuto: com ele, uma pausa de
segundos no "Aguardar" passa a durar até um minuto. Para manter os 15
segundos, use um laço em shell (`while true; do curl …; sleep 15; done`)
num serviço próprio, como o `agendador` faz.

O laço de 15 minutos não pode encolher sem mexer também em
`CICLO_MINUTOS`, em `src/lib/scheduled/display.ts`: é esse número que a
tela usa para oferecer horários e prometer "sai em até 15 min".

---

## 6. Primeiro acesso

1. Abra `https://crm.seudominio.com/signup` e crie a sua conta. O primeiro
   cadastro vira dono da conta automaticamente — um gatilho no banco cria
   a conta e o perfil na mesma transação.
2. **Configurações → Perfis**: crie os perfis de acesso padrão pelo botão
   que os semeia (Administrador, Advogado e Observador).
3. **Funis**: crie o primeiro funil e as etapas. Se pretende usar os
   painéis de desempenho, marque em cada etapa o degrau correspondente
   (Lead, MQL, Reunião, Proposta, Contrato, Perda — ou "Não conta").
4. **Configurações → Conexões**: crie a conexão do WhatsApp.
   - *Evolution*: escolha o transporte, dê um rótulo, salve e leia o QR
     code com o celular. O nome da instância é derivado do rótulo e
     fixado na criação; renomear a conexão depois não a renomeia.
   - *Meta*: cole o Phone Number ID, o WABA ID, o token permanente,
     invente um Verify Token e informe o PIN.

---

## 7. Registrar o webhook

**Evolution:** o CRM registra o webhook sozinho ao criar a conexão. Se
você mudar o domínio ou o `EVOLUTION_WEBHOOK_SECRET`, use
"Ressincronizar" na tela de conexões — instâncias já pareadas guardam o
valor antigo e passariam a ser recusadas.

**Meta:** só depois de salvar no CRM, vá ao painel do app →
*WhatsApp → Configuration → Webhooks*:

- Callback URL: `https://crm.seudominio.com/api/whatsapp/webhook`
- Verify Token: o mesmo que você inventou
- Assine o campo `messages` (obrigatório) e, se quiser status de modelos
  em tempo real, `message_template_status_update`.

A ordem importa: registrar na Meta antes de salvar no CRM faz a
verificação falhar, porque o CRM ainda não conhece o Verify Token.

---

## 8. Testar

Mande uma mensagem de outro celular para o número conectado. Ela deve
aparecer na caixa de entrada em segundos. Responda pelo CRM e confirme
que chega. Depois responda pelo **celular pareado** e confirme que esse
eco também aparece na conversa certa.

Agende uma mensagem para dali a poucos minutos e confirme que ela sai
sozinha: é o teste do agendador.

---

## 9. Quando algo não funciona

| Sintoma | Causa provável |
|---|---|
| Envia mas não recebe (Meta) | `META_APP_SECRET` errado ou ausente, ou campo `messages` não assinado |
| Envia mas não recebe (Evolution) | `EVOLUTION_WEBHOOK_SECRET` diferente do que está gravado na instância. Use "Ressincronizar" |
| "Conectado" mas nenhum evento chega | Falta o registro do número (PIN de duas etapas, na Meta) |
| `token_corrupted` na tela | `ENCRYPTION_KEY` diferente da que cifrou. Reconfigure a conexão |
| Site responde 200 mas nada é gravado | `crm.env` não foi carregado no deploy. Veja o passo 5.3 |
| Rotas de cron devolvem 503 | `AUTOMATION_CRON_SECRET` vazia no servidor |
| Rotas de cron devolvem 401 | O segredo do agendador não bate com o do CRM |
| Mensagem agendada nunca sai | O agendador não está rodando. Veja o passo 5.4 |
| Link do e-mail de senha dá erro | Falta `/auth/callback` na lista de redirects do Supabase (passo 1.4) |
| Convite devolve erro 500 citando `NEXT_PUBLIC_SITE_URL` | A instalação não sabe o próprio endereço. Defina a variável e reconstrua |
| Eco do celular pareado não aparece | O conserto do `@lid` na Evolution. Veja o passo 3.1 |
| Tela em inglês depois de mudar o idioma | Idioma é fixado no build. Reconstrua a imagem |
| Convite aceito mas o cadastro é recusado | Os cadastros estão desligados no Supabase. Veja o passo 10 |
| Evolution "connection refused" a partir do CRM | `EVOLUTION_BASE_URL` apontando para `127.0.0.1`. Use o nome do serviço no Swarm. Veja o passo 3.1 |
| `docker stack deploy` ou `network create` diz que não é um manager | O Swarm não foi iniciado. Veja o passo 0.1 |
| A tela abre com dados de outra empresa | O stack subiu com a imagem de queda, de outro repositório. Exporte `CRM_IMAGE`. Veja o passo 5.3 |

---

## 10. Fechar o cadastro (logo depois de criar a sua conta)

Enquanto a opção de cadastro estiver ligada, **qualquer pessoa que
alcance o seu endereço cria uma conta no seu servidor** — e cada conta é
um CRM inteiro, capaz de conectar WhatsApp no seu gateway. Feche assim
que a sua conta de dono existir (passo 6).

Em *Authentication → Sign In / Providers*, desligue **só** a opção *Allow
new users to sign up*. ⚠️ Não desligue o provedor *Email*: ele é o login
por senha de todo mundo, e desligá-lo tranca a equipe inteira do lado de
fora.

**Os convites do CRM continuam funcionando.** Quem abre um link de
convite sem ter conta cria a conta pela tela do convite, e ela nasce no
servidor, já dentro da equipe que convidou — o convite é conferido antes
e aceito junto. Não use o *Invite user* do painel do Supabase: ele cria a
pessoa com um CRM próprio, fora da sua equipe. E não religue o cadastro
para convidar ninguém.

A conta criada por convite nasce com o e-mail já confirmado: o convite é
a credencial, e confirmar por e-mail dependeria do SMTP. Quem digitar o
e-mail errado não recebe a recuperação de senha.

**Depois de fechar, confira quem mais tem login.** O cadastro fechado
impede contas NOVAS; quem já tem login continua entrando. Cada login fora
da sua equipe (alguém que se cadastrou antes de você fechar, um teste
esquecido) tem um CRM próprio e pode gerar convites para ele. Em
*Authentication → Users*, confira a lista e **bloqueie** (*Ban user*)
quem não deve entrar — bloquear é reversível; apagar pode ser recusado
enquanto a pessoa for dona de uma conta. O mesmo vale para quem sai da
equipe: removê-lo da equipe não apaga o login dele.

Um teste que vale fazer: com o cadastro fechado, abra `/signup` numa aba
anônima. A tela tem de dizer que o cadastro está fechado.

---

## 11. Integrações opcionais

Ficam em *Configurações → Integrações*, só para administradores. Cada uma
guarda a própria chave cifrada com a `ENCRYPTION_KEY` — rotacionar essa
variável invalida todas de uma vez.

**Asaas** (cobrança de honorários): no Asaas, em *Integrações → Chaves de
API*, gere uma chave com **leitura** em *Clientes*, *Cobranças* e
*Parcelamentos* **e Webhooks em leitura e escrita** — é essa permissão que
deixa o CRM criar sozinho o aviso na hora (o webhook); sem ela, o cartão
mostra o webhook sem permissão e o aviso na conversa só muda no ciclo de 15
minutos. Sem data de validade (o Asaas não avisa antes de uma validade
definida à mão expirar). O CRM recusa chave de sandbox. Cole a chave no
cartão com o NOME que ela tem no Asaas. O webhook precisa do endereço
público do CRM gravado no build (`NEXT_PUBLIC_SITE_URL`, passo 5.1): sem
ele, o CRM não tem para onde apontar o aviso e não o cria. A partir daí o
agendador (passo 5.4) lê a cada 15 minutos as cobranças vencidas e liga cada cliente do Asaas a um contato
do CRM pelo telefone, pelo documento ou pelo e-mail — e cria a ficha de
quem tem telefone e ainda não tem contato, com a etiqueta `asaas`. Quem
não casou aparece no cartão, em *Para confirmar* e *Sem ficha*, para uma
pessoa decidir. ⚠️ Se você já tinha o agendador no ar antes desta versão,
refaça o `docker stack deploy` (passo 5.3): o laço só passa a chamar
`cb/asaas/cron` depois disso.

A **régua de cobrança** do Asaas (automações de cobrança vencida e de
"vence hoje") sai só por conexão **QR Code** (Evolution), nunca pelo
número oficial; roda até as 18:00, pula fim de semana e feriado nacional de
data fixa (feriado estadual ou municipal não conta), e trata número sem `+`
como brasileiro. Envio automático por conexão não oficial aumenta o risco
de o WhatsApp bloquear o número.

**Calendly** (agendamento vira lead e automação): webhooks exigem plano
pago do Calendly (**Standard ou superior**). Gere um *Personal access token*
em *Integrations → API & Webhooks* com a conta que **administra a
organização** (para enxergar os eventos de todos). O CRM assina o webhook
sozinho no endereço público do CRM, que precisa ser alcançável de fora; ao
trocar de domínio, use **Reassinar** no cartão.

**tl;dv** (transcrições de reunião na ficha): a API só existe nos planos
**Pro e Business**, e só sai pela API a reunião de quem a ORGANIZOU com um
desses planos. Gere a chave em *Settings → Personal Settings → API Keys*.
O webhook é opcional (o cartão mostra a URL; eventos `MeetingReady` e
`TranscriptReady`); sem ele, a reunião entra no ciclo seguinte do
agendador.

**Meta Ads** (investimento e custo por lead no painel do funil): no
Gerenciador de Negócios, *Configurações do negócio → Usuários do sistema →
Gerar token*, com a permissão `ads_read` e sem validade. Depois, ligue cada
campanha a um funil no cartão.

**Assistente de IA, Radar e transcrição de áudio**: a chave de OpenAI,
Anthropic ou Google Gemini vai em *Configurações → Integrações*. A
**transcrição de áudio só funciona com Gemini**, e a busca na base de
conhecimento (RAG) só com **OpenAI**. O Radar fica desligado por padrão e
é ligado **por conexão**. Use chave de plano **pago** do provedor: os
planos gratuitos podem usar o conteúdo enviado.

**Instagram Direct** (em *Configurações → Conexões*, não em Integrações):
crie um app próprio no painel da Meta e cadastre no CRM o *Instagram App
ID* e o *Instagram App Secret* da aba do produto Instagram (um app serve a
todas as contas). No painel da Meta:
1. registre a **OAuth Redirect URI** que o CRM mostra (uma vez por app);
2. em *Configuração da API com login do Instagram → Configurar webhooks*,
   cole a Callback URL e o Verify Token que o CRM mostra e assine o campo
   `messages`;
3. adicione cada conta profissional ao app e aceite o convite no app do
   Instagram;
4. publique o app (modo **Ativo**) — em desenvolvimento, só quem tem papel
   no app recebe mensagens. O modo Ativo pede uma URL de política de
   privacidade: o CRM serve uma em `/privacidade`, que você deve revisar
   antes de usar.
O token vale **60 dias**; o CRM avisa quando estiver para vencer, e a
renovação é entrar de novo pelo login do Instagram.

**Webhooks de entrada e de saída** (Typebot, n8n, outros sistemas): ver
[`webhooks.md`](./webhooks.md).

---

## O que fazer em seguida

- [`ATUALIZAR.md`](./ATUALIZAR.md) — como trazer uma versão nova sem
  perder o que você customizou.
- [`public-api.md`](./public-api.md) — a API REST e as chaves com escopo.
- [`mcp.md`](./mcp.md) — usar o CRM a partir de assistentes de IA.
