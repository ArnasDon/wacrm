# Plano — o CRM como app no celular

> Documento INTERNO (não vai para quem instala o sistema). Plano vivo:
> atualizar o **Estado** a cada entrega.

## Contexto

Em 14/09/2026 o operador instalou o CRM na Tela de Início do iPhone (Safari →
Compartilhar → Adicionar à Tela de Início), em vez de publicar um app na App
Store. A instalação funcionou, e o uso real mostrou dois defeitos:

1. **Moldura de navegador ao abrir uma conversa** — X e endereço em cima;
   voltar, compartilhar, recarregar e "abrir no Safari" embaixo. É a
   interface que o iPhone mostra quando acha que a navegação SAIU do app.
2. **Teclado** — ao tocar na caixa de mensagem, o cabeçalho com o nome do
   cliente sobe para fora da tela e só volta rolando; não há como recolher o
   teclado; ao recolher, a tela fica "desconfigurada".

O trabalho foi dividido em duas fases:

- **Fase 1** — o app instalado se comportar como app e dar para atender pelo
  celular (este plano).
- **Fase 2** — notificações push (iOS 16.4+ com o app instalado). Ainda não
  planejada em detalhe.

## Estado

| Entrega | O que | Estado |
|---|---|---|
| E1 | App instalável: manifesto, ícone e nome curto | em revisão (PR) |
| E2 | Teclado no celular | a fazer |
| E3 | Telas que se atualizam ao voltar para o app | a fazer |

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
- **Sem decisão:** o Meu dia reaparecer depois de 4 h sem uso também no
  celular. Mantido como está.
- **Fora da Fase 1, por decisão:** otimizar as telas de montagem (automações,
  fluxos, disparos, Configurações) para o celular.

## E1 — App instalável

**O que:** `src/app/manifest.ts` (escopo na raiz, abertura em `/inbox`, tela
cheia), `src/app/apple-icon.tsx` (180/192/512), `appleWebApp.title` no
layout e `NOME_CURTO_DO_APP` em `src/lib/marca.ts`.

**Por quê:** sem manifesto o iPhone decide sozinho quais endereços são do app,
a partir da página em que a pessoa estava ao instalar — e abrir uma conversa
já bastava para ele concluir que a navegação saiu. No Android, sem manifesto,
o ícone abre como aba comum do navegador.

**Sem isso:** a moldura come uns 15% da altura da tela em toda conversa, e o
botão da bússola leva a conversa para o Safari, onde o login é outro.

**Depois do deploy:** apagar o ícone, adicionar de novo e fazer login.

## E2 — Teclado no celular

- A tela passa a medir a área VISÍVEL (acima do teclado), com o cabeçalho
  fixo. Hoje ela mede a altura total do aparelho, e o iPhone empurra a página
  inteira para cima.
- Letra de 16 px nos campos de texto em aparelho de toque: abaixo disso o
  iPhone amplia a tela sozinho ao tocar no campo e não desfaz ao recolher.
- Rolar a conversa recolhe o teclado.
- Retorno pula linha no toque (D4), e a dica "Shift+Enter para nova linha"
  some onde não existe Shift+Enter.

## E3 — Telas que se atualizam ao voltar

O app instalado não tem botão de recarregar nem "puxar para atualizar". A
caixa de entrada já se atualiza ao voltar; Tarefas, Meu dia, Funil e Contatos
não — quem volta do WhatsApp vê a lista de uma hora atrás, sem aviso.

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

## Roteiro de teste no iPhone (a cada entrega)

- [ ] Abrir o app pelo ícone: tela cheia, sem barra do Safari.
- [ ] Abrir uma conversa: continua sem moldura de navegador.
- [ ] Tocar na caixa de mensagem: cabeçalho da conversa continua visível, sem
      zoom.
- [ ] Rolar a conversa com o teclado aberto: o teclado recolhe, e a tela volta
      inteira.
- [ ] Retorno pula linha; o botão envia.
- [ ] Foto da câmera e da galeria; gravar áudio; abrir um PDF recebido e
      voltar ao app.
- [ ] Trocar o número da conversa; anotação; agendamento.
- [ ] Sair para o WhatsApp e voltar em Tarefas e no Meu dia: a lista se
      atualiza sozinha.
