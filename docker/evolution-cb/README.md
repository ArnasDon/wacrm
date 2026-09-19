# Imagem `evolution-api-cb` — Evolution 2.4 (develop) com a citação do cliente

Construída pelo workflow `.github/workflows/evolution-cb.yml` a partir do
**mesmo commit** da imagem `evoapicloud/evolution-api:homolog` que está em
produção (`e273b904`, build de 14/07/2026), com duas diferenças:

1. `2708-citacao.patch` — o PR upstream evolution-foundation/evolution-api#2708
   ("preserve reply metadata when flattening extendedTextMessage"): o
   `prepareMessage` da 2.4 achata `extendedTextMessage` em `conversation` e
   descartava o `contextInfo` (stanzaId/quotedMessage) — toda resposta de
   cliente citando uma mensagem nossa chegava sem a citação (issue #2713).
   O patch copia o `contextInfo` para o nível de cima antes de apagar o
   invólucro. 27 linhas, um arquivo.
2. O Dockerfile passa a copiar `prisma.config.ts` para a imagem — sem ele o
   Prisma 7 não roda `migrate deploy` (medido em 09/09/2026: a `homolog` não o
   traz e a produção sobe com um bind mount de `/root/evolution/`).
3. `foto-de-perfil-por-telefone-com-teto.patch` (17/09/2026) — o handler de
   `messages.upsert` roda dentro do `concatMap` do `BaileysMessageProcessor`
   (um lote por vez) e esperava `profilePicture(received.key.remoteJid)`: a
   consulta de foto ao WhatsApp feita com o **LID**, que o servidor não
   responde, e a Baileys 7 espera os 60 s de `defaultQueryTimeoutMs` — **1
   mensagem por minuto por conexão**, medido. Trinta linhas antes a própria
   Evolution já tinha trocado o LID pelo telefone em `messageRaw.key.remoteJid`.
   O patch consulta por esse telefone e passa um teto de 5 s **só nesse
   chamador** (`profilePicture` ganhou um `timeoutMs?` opcional; o endpoint
   HTTP que a 973 do CRM usa continua sem teto). 22 linhas, um arquivo. O
   `develop` do upstream em 17/09/2026 ainda tem o defeito (linha 1699).
   Diagnóstico, medições e o protocolo de verificação: `docs/PLANO-baileys-7.md`,
   5.10.

Mesmo commit = mesmas migrations: trocar entre esta imagem e a `homolog` não
mexe no banco. O rollback é só trocar a imagem de volta.

A ordem de aplicação é a do workflow (`2708-citacao` e depois `foto-de-perfil`);
o segundo foi gerado sobre o primeiro, em regiões distintas do mesmo arquivo.

Quando o upstream mesclar o #2708 E corrigir a foto de perfil (ou publicar uma
`homolog` com os dois), esta imagem deixa de ser necessária. Plano vivo: `docs/PLANO-baileys-7.md`, P10.
