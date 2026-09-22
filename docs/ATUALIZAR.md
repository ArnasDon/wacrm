# Atualizar a sua instalação

Como trazer uma versão nova para a sua cópia sem perder o que você
customizou, e sem quebrar o que já está no ar.

---

## O modelo

Você tem uma cópia do código. Ela é sua: pode renomear, mudar cores,
acrescentar telas, remover módulos. Uma atualização não substitui a sua
cópia — ela é **mesclada** nela, e onde os dois lados mexeram na mesma
linha, você decide.

Isso funciona porque a atualização chega por um remote git comum:

```bash
git remote -v
# origin     https://github.com/<você>/<a-sua-cópia>.git   (fetch/push)
# upstream   <de onde vêm as atualizações>                 (fetch)
```

Se o `upstream` ainda não existe:

```bash
git remote add upstream <o endereço que você recebeu>
```

---

## O roteiro

Sempre numa branch, nunca direto no `main`.

```bash
git fetch upstream --tags
git checkout main && git pull origin main
git checkout -b chore/atualizacao-AAAA-MM-DD

git merge vX.Y.Z          # a versão que você quer trazer
```

> Enquanto ainda não houver versões marcadas (`git tag -l` vazio depois do
> `fetch`), traga o ramo principal: `git merge upstream/main`. Leia antes
> a seção `[Não publicado]` do `CHANGELOG.md` — é ela que diz o que muda
> e o que exige passo manual.

Resolva os conflitos (a próxima seção diz onde eles caem). Depois, antes
de qualquer outra coisa:

```bash
nvm use
npm ci
node scripts/i18n-parity.mjs        # os dicionários continuam em paridade?
node scripts/i18n-chaves-usadas.mjs # o código pede chave que não existe?
npm run typecheck
npm run lint
npm test
npm run build
```

Só com tudo verde:

```bash
git checkout main
git merge chore/atualizacao-AAAA-MM-DD
git push origin main
```

O push constrói a imagem e publica. Antes de dar esse push, leia a seção
seguinte: algumas versões pedem um passo manual **antes** dele.

---

## Onde os conflitos caem

Quase sempre nos mesmos lugares, e por um motivo estrutural: são os
arquivos que os dois lados editam.

**Os dicionários (`messages/*.json`).** É o campo de batalha. Toda versão
nova acrescenta chaves, e você provavelmente traduziu ou reescreveu
algumas. Ao resolver, mantenha a sua redação e traga as chaves novas —
para os **dois** arquivos, sempre. O fallback do next-intl é por arquivo,
não por chave: uma chave que falta não cai para o inglês, aparece na tela
como o caminho dela.

**O que você customizou.** Se você mexeu numa tela para o seu uso, essa
tela vai conflitar quando ela mudar do outro lado. É o custo de
customizar, e a forma de reduzi-lo é preferir arquivo NOVO a reescrever
um existente: um módulo seu em `src/lib/<seu-dominio>/` nunca conflita.

**Configuração de infraestrutura.** `docker-stack.yml`,
`.github/workflows/pipeline.yml` e o `.env.local.example` carregam o seu
domínio, a sua rede e a sua imagem. Mantenha os seus valores.

---

## Migrations

Uma versão nova quase sempre traz arquivos novos em
`supabase/migrations/`. Eles são numerados em sequência e aplicam em
ordem.

```bash
supabase db push
```

Isso aplica **só o que ainda não foi aplicado** no seu projeto. Rodar de
novo não faz nada.

> ⚠️ **Atualizando uma instalação feita antes de 14/09/2026?** Nessa data
> os arquivos de migration passaram de três para quatro dígitos
> (`001_initial_schema.sql` virou `0001_initial_schema.sql`). O `db push`
> guarda no histórico o número do arquivo, então o seu histórico ainda diz
> `001`, `998` — e o `push` recusa aplicar qualquer coisa enquanto não
> encontrar esses números nos arquivos. **Uma vez, antes do `db push`**,
> rode no *SQL Editor* do painel o conteúdo de
> [`scripts/reparar-historico-de-migrations.sql`](../scripts/reparar-historico-de-migrations.sql).
> Ele troca só o número registrado; nenhuma migration roda de novo, e ele
> é seguro de repetir. Instalação feita depois dessa data não precisa.

**Ordem importa.** Quando uma versão traz coluna nova que o código passa
a ler, aplique a migration **antes** de publicar a imagem nova. Ao
contrário, a aplicação nova pede uma coluna que o banco ainda não tem, e
o comportamento vai de "o recurso não funciona em silêncio" a erro na
tela, dependendo do caso. O `CHANGELOG.md` marca as versões em que essa
ordem é obrigatória.

A exceção é a migration que **restringe** — que passa a recusar algo que
a versão anterior da aplicação ainda faz. Essa vai **depois** da imagem
nova, e o `CHANGELOG.md` diz quais são. Como o `db push` aplica tudo o
que falta de uma vez: mova esse arquivo para fora da pasta, rode o
`db push`, publique a imagem, devolva o arquivo e rode
`supabase db push --include-all`. O `--include-all` é necessário porque
a migration devolvida é mais antiga que as já aplicadas, e sem ele o
`push` a recusa.

Se algo der errado, o teste que vale é o mesmo que o CI faz: as
migrations reaplicam num banco vazio, do zero, em ordem. Você pode rodar
isso localmente com `supabase db start` (precisa de Docker).

---

## Mudanças que exigem passo manual

O CI publica trocando a imagem do serviço, com `docker service update`.
Ele **não relê** o `docker-stack.yml`. Então, quando uma versão muda
aquele arquivo — um serviço novo, uma variável nova, uma rota nova no
agendador — é preciso um `docker stack deploy` à mão no servidor:

```bash
set -a && . ./crm.env && set +a
export CRM_IMAGE="$(docker service inspect crm_crm \
  --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' | cut -d@ -f1)"
docker stack deploy -c docker-stack.yml --with-registry-auth crm
```

> ⚠️ **As três linhas andam juntas.** Sem carregar o `crm.env`, o Docker
> substitui cada `${VARIAVEL}` por string vazia, sem erro nenhum, e o
> servidor sobe sem credencial alguma — com o site respondendo 200,
> porque a tela de login já está dentro da imagem. E a imagem precisa vir
> de `.Spec.TaskTemplate.ContainerSpec.Image`, nunca do rótulo
> `com.docker.stack.image`: o rótulo guarda a imagem do último deploy
> manual e rolaria a sua produção para trás em silêncio.

Confira depois, de dentro do container:

```bash
cid=$(docker ps --filter name=crm_crm --format '{{.ID}}' | head -1)
docker exec $cid printenv SUPABASE_SERVICE_ROLE_KEY | wc -c   # 0 = quebrado
```

---

## Coisas que valem a pena não mudar

Algumas escolhas parecem arbitrárias e não são. Mexer nelas durante uma
atualização é a forma mais comum de quebrar algo que estava funcionando.

**`ENCRYPTION_KEY`.** Ela cifra todo token de WhatsApp e toda chave de IA
no banco. Trocá-la não dá erro — os valores só deixam de ser legíveis, e
cada conexão precisa ser refeita à mão.

**A versão do Node.** Sai do `.nvmrc`, e o `Dockerfile` traz o mesmo
número. Os dois têm de andar juntos: com versões diferentes, um teste que
toque data, fuso ou formatação de número passa numa e reprova na outra.

**O laço de 15 minutos do agendador.** O número tem de bater com
`CICLO_MINUTOS`, em `src/lib/scheduled/display.ts`. É esse valor que a
tela de mensagens agendadas usa para oferecer horários e prometer prazo.

**As chaves de armazenamento local** (`wacrm:*`) e o prefixo das chaves
de API (`wacrm_live_`). Renomear as primeiras apaga as preferências de
todos os usuários; renomear o segundo invalida todas as chaves de API já
emitidas e quebra as integrações dos seus clientes.

---

## Se você não quer atualizar

Não atualizar é uma opção legítima. A sua cópia continua funcionando
indefinidamente: ela não chama nenhum serviço de quem a distribuiu, não
verifica licença e não expira.

O que você perde ficando para trás são correções de segurança e a
compatibilidade com mudanças da Meta e da Evolution API — que mudam por
conta própria e não avisam.
