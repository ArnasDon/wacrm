# Mexendo no código

Esta é a sua cópia do CRM. Renomeie, mude cores, acrescente telas, remova
módulos — nada precisa voltar para lugar nenhum.

O que este documento cobre é como fazer isso sem tornar as atualizações
futuras dolorosas, e quais convenções o código já assume.

---

## Ambiente

```bash
nvm use            # Node 22, do .nvmrc — antes de tudo
npm install
cp .env.local.example .env.local
npm run dev        # localhost:3000
```

A versão do Node não é detalhe. Ela sai do `.nvmrc` e o `Dockerfile` traz
o mesmo número; rodar teste numa versão diferente da que o CI usa produz
falha que só aparece lá. Já aconteceu: uma formatação de moeda resolvia
diferente entre duas versões do V8, e o teste passava na máquina e
reprovava no CI.

Comandos:

```bash
npm run dev        # desenvolvimento
npm run build      # build de produção
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run format     # prettier
```

---

## Antes de abrir um PR

O CI roda, nesta ordem, e qualquer um segura a publicação:

```bash
npm run lint
npm run typecheck
node scripts/i18n-parity.mjs         # dicionários em paridade
node scripts/i18n-chaves-usadas.mjs  # o código não pede chave inexistente
npm test
npm run build
```

E, num job próprio, o replay de todas as migrations contra um Postgres
vazio. Ele também segura a publicação: se o banco não puder ser
construído do zero, nada vai para produção.

---

## Convenções que o código assume

Estas não são preferências de estilo. São regras que, ignoradas, quebram
algo — e a maioria delas está registrada com o motivo e a data no
`CLAUDE.md`, que é a memória de engenharia do projeto. Vale ler a seção
correspondente antes de mexer numa área.

**Texto de tela vive no dicionário, nos dois idiomas.** Chave nova em
`messages/en.json` entra em `messages/pt-BR.json` na mesma passada. O
fallback do next-intl é por arquivo, não por chave: uma chave que falta
não cai para o inglês, aparece na tela como o caminho dela. Dois scripts
no CI cobram isso.

**O nome do produto não é tradução.** Ele vem de `src/lib/marca.ts`, que
lê `NEXT_PUBLIC_APP_NAME`. Frase de interface não cita o nome do produto;
onde ele é necessário, entra como parâmetro `{appName}`.

**Migrations são arquivos, e nunca se renumera uma já aplicada.** Nomes
em `NNNN_descricao.sql`, com **quatro** dígitos, sequenciais — o CI
aplica os arquivos em ordem de nome, e `1000_` com três dígitos ao lado
ordenaria antes da `0900_` (um teste reprova nome fora do formato).
Número novo vem sempre depois do maior que já existe: quem atualiza por
`supabase db push` tem a migration fora de ordem recusada. Toda
migration precisa aplicar num
banco **vazio**: todo `REVOKE` acompanhado do `GRANT` de volta para quem
precisa, e nenhuma conferência que exija dado que só existe numa
instalação específica.

**A chave `service_role` do Supabase nunca aparece no navegador.** Ela
ignora as regras de acesso do banco. Só em rota de servidor.

**Prefira arquivo novo a reescrever um existente.** Um módulo seu em
`src/lib/<seu-dominio>/` nunca conflita numa atualização. Uma edição no
meio de uma tela existente conflita toda vez que aquela tela mudar.

**Lógica pura sai do componente.** O padrão do projeto é um módulo sem
I/O, com teste, e o componente só desenhando. É o que permite testar
regra de negócio sem montar tela.

---

## Duas armadilhas que já custaram caro

Valem para qualquer código novo, e nenhuma delas aparece em teste ou em
revisão — só na tela.

**Lista vazia durante o carregamento não é uma resposta.** Um efeito que
limpa o estado roda *depois* do primeiro render, então existe um instante
com os dados antigos sob o cabeçalho novo. E uma lista ainda não
carregada é indistinguível de uma lista genuinamente vazia. Transformar
esse vazio numa afirmação positiva ("não há nada", "não é este
transporte") produz telas que mentem por alguns segundos — e uma delas
chegou a desabilitar a caixa de resposta no exato momento em que o
atendente abria a conversa para responder. Compare sempre contra a
propriedade do render atual, ou espere um sinalizador de "já carregou".

**Classe do Tailwind montada em tempo de execução não existe.** O
Tailwind varre o código-fonte procurando strings e não executa nada, então
`bg-${cor}-500` simplesmente não é gerada: o elemento nasce transparente,
sem erro nenhum. Cores de paleta são literais, sempre.

---

## Onde procurar

- `CLAUDE.md` — a memória de engenharia: por que cada decisão não óbvia é
  como é, com data e, quando houve, a medição que a motivou. É longo de
  propósito; use busca.
- `docs/` — instalação, atualização, API pública, MCP.
- `.env.local.example` — toda variável de ambiente, explicada.
