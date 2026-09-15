# Plano — o CRM como app no celular

> Documento INTERNO (não vai para quem instala o sistema). Plano vivo:
> atualizar o **Estado** a cada entrega.

## Contexto

Em 14/09/2026 o operador instalou o CRM na Tela de Início do iPhone (Safari →
Compartilhar → Adicionar à Tela de Início), em vez de publicar um app na App
Store. A instalação funcionou, e o uso real mostrou dois defeitos e um pedido:

1. **Moldura de navegador ao abrir uma conversa** — X e endereço em cima;
   voltar, compartilhar, recarregar e "abrir no Safari" embaixo. É a
   interface que o iPhone mostra quando acha que a navegação SAIU do app.
2. **Teclado** — ao tocar na caixa de mensagem, o cabeçalho com o nome do
   cliente sobe para fora da tela e só volta rolando; não há como recolher o
   teclado; ao recolher, a tela fica "desconfigurada".
3. **Voltar da conversa com o gesto** — arrastar da borda esquerda para voltar
   à caixa de entrada, como no WhatsApp do iPhone.

O trabalho foi dividido em duas fases:

- **Fase 1** — o app instalado se comportar como app e dar para atender pelo
  celular (este plano).
- **Fase 2** — notificações push (iOS 16.4+ com o app instalado). Ainda não
  planejada em detalhe.

## Estado

| Entrega | O que | PR | Estado |
|---|---|---|---|
| E1 | App instalável: manifesto, ícone e nome curto | #213 | em produção (14/09) |
| E2 | Teclado no celular | #214 | em produção (14/09) |
| E3 | Telas que se atualizam ao voltar para o app | #216 e #217 | em produção (15/09) |
| E4 | Voltar da conversa com o gesto do iPhone | #215 | em produção (14/09) |

O #216 foi mesclado com as cercas das três primeiras rodadas de revisão; as
da quarta (lista de funis e automações do Funil) chegaram à branch depois do
merge e seguiram no #217.

**Falta:** o operador reinstalar o ícone e passar o roteiro de teste no
iPhone. O teclado, o gesto de voltar e a volta real ao app só se confirmam no
aparelho — o navegador do computador não tem teclado virtual nem gesto de
borda.

## Decisões do operador (14/09/2026)

- **D1.** Notificações ficam para a Fase 2.
- **D2.** Nome embaixo do ícone: **"CB CRM"** (build-arg
  `NEXT_PUBLIC_APP_SHORT_NAME` no `pipeline.yml`).
- **D3.** O logo do escritório fica **para depois**: o ícone sai com o símbolo
  genérico do sistema. Quando o logo vier, cada pessoa reinstala o ícone de
  novo (o iPhone guarda o ícone no momento da instalação).
- **D4.** No celular, a tecla de retorno **pula linha**; enviar é só pelo
  botão, como no WhatsApp. No computador nada muda.
- **D5.** O app abre na **caixa de entrada** (`start_url: /inbox`). O Meu dia
  continua aparecendo antes, quando for a hora dele.
- **D6.** Voltar da conversa **arrastando da borda esquerda**, como no
  WhatsApp. Feito pelo histórico do navegador — o gesto é do próprio iPhone —,
  e não por um arrasto em JavaScript, que disputaria a borda com o sistema.
- **D7.** Arrastar a conversa rumo às mensagens antigas **recolhe o teclado**,
  como no WhatsApp.
- **D8.** Revisão do Codex no E3: depois de quatro rodadas, **mesclar** quando
  a revisão vier limpa ou só com melhorias do mesmo tipo, que ficam
  **anotadas** neste plano; parar e perguntar só se vier algo que quebra
  comportamento.
- **Sem decisão:** o Meu dia reaparecer depois de 4 h sem uso também no
  celular. Mantido como está.
- **Fora da Fase 1, por decisão:** otimizar as telas de montagem (automações,
  fluxos, disparos, Configurações) para o celular.

## E1 — App instalável (#213)

**O que:** `src/app/manifest.ts` (escopo na raiz, abertura em `/inbox`, tela
cheia), `src/app/apple-icon.tsx` (180/192/512), `appleWebApp.title` no
layout e `NOME_CURTO_DO_APP` em `src/lib/marca.ts`.

**Por quê:** sem manifesto o iPhone decide sozinho quais endereços são do app,
a partir da página em que a pessoa estava ao instalar — e abrir uma conversa
já bastava para ele concluir que a navegação saiu. No Android, sem manifesto,
o ícone abre como aba comum do navegador.

**Sem isso:** a moldura come uns 15% da altura da tela em toda conversa, e o
botão da bússola leva a conversa para o Safari, onde o login é outro.

**Achado na verificação:** o `icons` que o layout herdou do upstream fazia o
Next ignorar os ícones de arquivo, e o `<head>` saía sem `apple-touch-icon`,
com o manifesto e as imagens perfeitos. Foi removido, com pino.

**Conferido em produção:** `/manifest.webmanifest` responde 200 com
`short_name` "CB CRM", `scope` "/" e `start_url` "/inbox"; `/apple-icon/180`
responde 200.

**Depois do deploy:** apagar o ícone, adicionar de novo e fazer login.

## E2 — Teclado no celular (#214)

- A casca do app e a caixa de entrada medem a área VISÍVEL, acima do teclado
  (`--altura-visivel`), e o empurrão do iPhone é desfeito — **só com o foco
  dentro da conversa**. Fora dela (formulário de outra tela, diálogo, painel
  do contato), o empurrão é o que revela o campo acima do teclado.
- Letra de 16 px em todo campo de aparelho de toque: abaixo disso o iPhone
  amplia a tela sozinho ao tocar no campo e não desfaz ao recolher.
- Arrastar a conversa rumo às mensagens antigas recolhe o teclado (D7).
- Retorno pula linha no toque (D4), e a dica "Shift+Enter para nova linha"
  some onde não existe Shift+Enter.
- As últimas mensagens continuam à vista quando o teclado encolhe a conversa.
- **Revisto em 15/09 (#219):** o print do operador mostrou o ajuste desligado
  no iPhone dele — a regra dependia de comparar a área visível com a altura da
  janela, que no app instalado provavelmente encolhe junto com o teclado.
  Agora, com o foco na conversa, a tela mede sempre só a área acima do teclado
  e desce junto se o iPhone a empurrar.
- **Formatação na linha dos botões (15/09, #219, pedido do operador):** no
  celular, negrito, itálico, riscado e monoespaçado sobem para a linha dos
  ícones quando cabem; ficam na linha própria com hora de agendamento
  escolhida, no número oficial da Meta ou em tela abaixo de 390 px.

## E3 — Telas que se atualizam ao voltar (#216 e #217)

O app instalado não tem botão de recarregar nem "puxar para atualizar". A
caixa de entrada já se atualizava ao voltar; Tarefas, Meu dia, Funil e
Contatos não — quem volta do WhatsApp via a lista de uma hora atrás, sem
aviso.

- Voltar ao app depois de **30 s fora** recarrega as quatro telas.
- A recarga é silenciosa, sem trocar a tela pelo spinner. O Meu dia é a
  exceção deliberada: pisca "carregando", como o botão "Atualizar", porque a
  tela afirma números.
- Cercas das quatro rodadas de revisão do Codex: Contatos mantém marcados
  só os contatos que continuam na página e recarrega também o catálogo de
  etiquetas, sem perder a seleção nem piscar; o Funil recarrega também a
  lista de funis (funil apagado lá fora sai da seleção) e as automações,
  descarta a resposta de um funil que já não está aberto (inclusive A → B →
  A) e a que partiu antes de um arrasto ou salvamento, e mantém tudo como
  estava quando a consulta falha. As visões Lista, Desempenho e Saúde do
  funil também recarregam — piscando, de propósito: são relatórios, e na
  Lista a tabela sem linhas durante a carga impede mudar etapa com a recarga
  no ar.

**Anotado pela D8, e depois resolvido em parte (#218):** as revisões do Codex
sobre o merge do #216 e sobre o #217 apontaram mais três pontos em que a
volta não recarregava tudo. Dois foram resolvidos no #218:

- **Desempenho:** a volta recarrega as trajetórias E o gasto do Meta Ads. Só
  as trajetórias misturava leads novos com o gasto de antes da sincronização,
  e custo por lead e CAC saíam errados até trocar de tela ou de período.
- **Lista:** a volta recarrega também os catálogos de campos personalizados,
  blocos, perfis e conexões — em silêncio, e a recarga que falha mantém os
  nomes que estão na tela.

**Anotado, e fica como está por decisão do operador (15/09/2026)** — o caso
é raro (um administrador muda o perfil de alguém com o app aberto em segundo
plano), e a correção mexe no login do app inteiro:

- **Perfil de acesso:** a volta recarrega a lista de funis, mas o recorte por
  perfil usa o perfil carregado quando o app abriu — o login não recarrega o
  perfil da mesma pessoa, e isso já vale para o app inteiro. Funil tirado do
  perfil por outro administrador continua visível e selecionado até o app ser
  recarregado. Recarregar o perfil na volta mexe no provedor de login: cada
  recarga devolve um perfil "novo" mesmo sem mudança, e as telas que reagem a
  ele (o quadro do Funil, o painel da conversa, a ficha do contato) voltariam
  a recarregar inteiras a cada retorno ao app. O conserto seguro é o provedor
  só trocar o perfil quando o conteúdo mudou, e a casca do app recarregá-lo
  na volta — valendo para o menu e todas as telas, não só o Funil.

## E4 — Voltar com o gesto do iPhone (#215)

- No celular, abrir a conversa cria um passo no histórico; o gesto de voltar
  do iPhone (e o botão voltar do Android) fecha a conversa, e avançar a
  reabre.
- O botão voltar da tela desfaz o mesmo passo.
- No computador nada muda: abrir conversa continua sem criar passo.

## Limitações conhecidas (sem conserto do nosso lado)

- **Link recebido no WhatsApp abre no Safari**, não no app instalado (o iPhone
  não deixa link abrir app da Tela de Início), e lá o login é outro. A
  notificação da Fase 2 é o caminho que abre o app direto.
- **O app instalado guarda o login separado do Safari.** Reinstalar pede
  login de novo.
- **Sem internet, abrir o app mostra a tela de erro do iPhone** até existir a
  peça técnica da Fase 2 (service worker).
- Quem abre o app deslogado passa pelo login e cai no Painel (o login não
  guarda a página de origem); da abertura seguinte em diante, cai na caixa de
  entrada.

## Roteiro de teste no iPhone

- [ ] Apagar o ícone antigo, adicionar de novo pelo Safari e fazer login.
- [ ] Abrir o app pelo ícone: tela cheia, sem barra do Safari, nome "CB CRM".
- [ ] Abrir uma conversa: continua sem moldura de navegador.
- [ ] Arrastar da borda esquerda numa conversa: volta para a caixa de entrada.
- [ ] Tocar na caixa de mensagem: cabeçalho da conversa continua visível, sem
      zoom.
- [ ] Arrastar a conversa rumo às mensagens antigas com o teclado aberto: o
      teclado recolhe, e a tela volta inteira.
- [ ] Retorno pula linha; o botão envia.
- [ ] Negrito, itálico, riscado e </> aparecem na linha dos ícones (e voltam
      para a linha de baixo ao escolher uma hora de agendamento).
- [ ] Foto da câmera e da galeria; gravar áudio; abrir um PDF recebido e
      voltar ao app.
- [ ] Trocar o número da conversa; anotação; agendamento.
- [ ] Sair para o WhatsApp por mais de 30 s e voltar em Tarefas, Meu dia,
      Funil e Contatos: a tela se atualiza sozinha.
