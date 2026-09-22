// ============================================================
// Entrada da Evolution: o que vira mensagem e o que é descartado.
//
// Estes casos nasceram de um bug real em produção: o primeiro canal
// Evolution recebia texto normalmente e NADA de mídia. Cada `it` aqui trava
// um pedaço daquele diagnóstico — se algum voltar a falhar, o cliente está
// mandando anexo que não aparece no inbox.
// ============================================================

import { describe, expect, it } from 'vitest';

import {
  parseDeleteEvent,
  detectContentType,
  ehLidSemTelefone,
  extractText,
  isNonChatJid,
  isReaction,
  lidJidFromKey,
  normalizeUpsert,
  phoneFromJid,
  unwrapMessage,
  type EvolutionUpsert,
  edicaoCifrada,
  isSecretEncrypted,
  quotedProviderId,
} from './evolution-inbound';

function item(message: Record<string, unknown>, over: Partial<EvolutionUpsert> = {}) {
  return {
    key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'MSG1' },
    pushName: 'Fulano',
    message,
    messageTimestamp: 1785080000,
    ...over,
  } satisfies EvolutionUpsert;
}

// Payloads espelhados no formato Baileys/Evolution v2.
const IMAGEM = {
  imageMessage: { mimetype: 'image/jpeg', caption: 'olha o contrato', mediaKey: 'k' },
};
const AUDIO_PTT = {
  audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 7, mediaKey: 'k' },
};
const FIGURINHA = { stickerMessage: { mimetype: 'image/webp', mediaKey: 'k' } };
const VIDEO = { videoMessage: { mimetype: 'video/mp4', mediaKey: 'k' } };
const DOCUMENTO = {
  documentMessage: { mimetype: 'application/pdf', fileName: 'peticao.pdf', mediaKey: 'k' },
};
const REACAO = {
  reactionMessage: {
    key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: true, id: 'ALVO' },
    text: '\u{1F44D}',
  },
};

describe('detectContentType', () => {
  it('reconhece cada tipo de mídia', () => {
    expect(detectContentType({ conversation: 'Oi' })).toBe('text');
    expect(detectContentType(IMAGEM)).toBe('image');
    expect(detectContentType(AUDIO_PTT)).toBe('audio');
    expect(detectContentType(VIDEO)).toBe('video');
    expect(detectContentType(DOCUMENTO)).toBe('document');
    expect(detectContentType({ locationMessage: { degreesLatitude: -23 } })).toBe('location');
  });

  it('figurinha entra como imagem (não há tipo próprio no schema)', () => {
    expect(detectContentType(FIGURINHA)).toBe('image');
  });

  it('mídia "ver uma vez" é reconhecida, não confundida com texto', () => {
    // Antes disto, `viewOnceMessageV2` era lido como texto vazio: o cliente
    // mandava a foto do documento e no inbox não aparecia nada.
    expect(detectContentType({ viewOnceMessageV2: { message: IMAGEM } })).toBe('image');
    expect(detectContentType({ viewOnceMessage: { message: AUDIO_PTT } })).toBe('audio');
  });

  it('mídia de conversa efêmera é reconhecida', () => {
    expect(detectContentType({ ephemeralMessage: { message: IMAGEM } })).toBe('image');
  });

  it('documento com legenda é reconhecido', () => {
    expect(detectContentType({ documentWithCaptionMessage: { message: DOCUMENTO } })).toBe(
      'document',
    );
  });

  it('invólucro aninhado (efêmera + ver uma vez) também desce', () => {
    expect(
      detectContentType({ ephemeralMessage: { message: { viewOnceMessageV2: { message: VIDEO } } } }),
    ).toBe('video');
  });
});

describe('unwrapMessage', () => {
  it('não entra em laço infinito com invólucro que aponta para si mesmo', () => {
    // O payload vem de fora; sem limite de profundidade isto prenderia o
    // webhook para sempre.
    const ciclico: Record<string, unknown> = {};
    ciclico.ephemeralMessage = { message: ciclico };
    expect(() => unwrapMessage(ciclico)).not.toThrow();
  });

  it('devolve a própria mensagem quando não há invólucro', () => {
    expect(unwrapMessage(IMAGEM)).toBe(IMAGEM);
  });

  it('invólucro sem `message` dentro não perde o que já se tinha', () => {
    const truncado = { ephemeralMessage: {} };
    expect(unwrapMessage(truncado)).toBe(truncado);
  });
});

describe('legenda invisível do iPhone', () => {
  // MEDIDO no payload real (09/09/2026): documento mandado do iPhone traz
  // `caption: '\uFFFC'`. Gravado, ele vira uma caixinha sob o nome do
  // arquivo na bolha e na prévia da lista.
  it('caption só com o marcador de objeto não vira texto', () => {
    expect(
      extractText({ documentMessage: { caption: '\uFFFC', fileName: 'a.pdf' } }),
    ).toBeNull();
    expect(
      extractText({ documentMessage: { caption: ' \uFFFC \uFFFC ', fileName: 'a.pdf' } }),
    ).toBeNull();
  });

  it('legenda de verdade continua passando, marcador junto ou não', () => {
    expect(extractText({ documentMessage: { caption: 'segue o contrato' } })).toBe(
      'segue o contrato',
    );
    expect(extractText({ documentMessage: { caption: '\uFFFCsegue' } })).toBe('\uFFFCsegue');
  });
});

describe('extractText', () => {
  it('pega conversation e extendedTextMessage', () => {
    expect(extractText({ conversation: 'Oi' })).toBe('Oi');
    expect(extractText({ extendedTextMessage: { text: 'Olá' } })).toBe('Olá');
  });

  it('usa a legenda da mídia como texto', () => {
    expect(extractText(IMAGEM)).toBe('olha o contrato');
  });

  it('acha a legenda dentro do invólucro "ver uma vez"', () => {
    expect(extractText({ viewOnceMessageV2: { message: IMAGEM } })).toBe('olha o contrato');
  });

  it('mídia sem legenda devolve null', () => {
    expect(extractText(AUDIO_PTT)).toBeNull();
  });
});

describe('isNonChatJid', () => {
  it('barra grupo, canal e status', () => {
    expect(isNonChatJid('12345@g.us')).toBe(true);
    expect(isNonChatJid('12345@newsletter')).toBe(true);
    expect(isNonChatJid('status@broadcast')).toBe(true);
  });

  it('deixa passar conversa normal', () => {
    expect(isNonChatJid('5511999998888@s.whatsapp.net')).toBe(false);
  });

  it('deixa passar @lid — barrar perderia mensagem de cliente real', () => {
    expect(isNonChatJid('123456789@lid')).toBe(false);
  });
});

describe('isReaction', () => {
  it('reconhece reação, inclusive embrulhada', () => {
    expect(isReaction(REACAO)).toBe(true);
    expect(isReaction({ ephemeralMessage: { message: REACAO } })).toBe(true);
  });

  it('mensagem comum não é reação', () => {
    expect(isReaction({ conversation: 'Oi' })).toBe(false);
    expect(isReaction(IMAGEM)).toBe(false);
  });
});

describe('normalizeUpsert', () => {
  it('mídia vira mensagem com o tipo certo e mediaUrl a preencher depois', () => {
    const out = normalizeUpsert(item(IMAGEM), 'conta', 'dono', 'canal');
    expect(out).not.toBeNull();
    expect(out!.contentType).toBe('image');
    expect(out!.text).toBe('olha o contrato');
    // O webhook resolve o anexo DEPOIS de gravar — aqui é sempre null.
    expect(out!.mediaUrl).toBeNull();
    expect(out!.channelId).toBe('canal');
    expect(out!.phone).toBe('5511999998888');
  });

  it('descarta reação: ela não é mensagem e não pode disparar IA/automação', () => {
    expect(normalizeUpsert(item(REACAO), 'conta', 'dono', 'canal')).toBeNull();
  });

  it('descarta grupo, canal e status', () => {
    for (const jid of ['12345@g.us', '12345@newsletter', 'status@broadcast']) {
      const it0 = item(IMAGEM, { key: { remoteJid: jid, fromMe: false, id: 'X' } });
      expect(normalizeUpsert(it0, 'conta', 'dono', 'canal')).toBeNull();
    }
  });

  it('NÃO descarta fromMe — marca a origem e deixa o chamador decidir', () => {
    // `fromMe` engloba duas coisas: o eco do que o CRM enviou (descartar) e
    // o que o operador digitou no celular pareado (tem de aparecer). Só o
    // `message_id` distingue, e isso exige ir ao banco — então descartar
    // aqui apagava metade do histórico da conversa.
    const doAparelho = item(IMAGEM, {
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: true, id: 'X' },
    });
    const out = normalizeUpsert(doAparelho, 'conta', 'dono', 'canal');
    expect(out).not.toBeNull();
    expect(out!.fromMe).toBe(true);
    expect(out!.contentType).toBe('image');
  });

  it('mensagem do cliente vem com fromMe falso', () => {
    const out = normalizeUpsert(item({ conversation: 'Oi' }), 'conta', 'dono', 'canal');
    expect(out!.fromMe).toBe(false);
  });

  it('o telefone continua sendo o do cliente mesmo em fromMe', () => {
    // O JID é sempre o do OUTRO lado da conversa, inclusive quando fomos
    // nós que escrevemos. Se isto virasse o número do escritório, a
    // mensagem do celular abriria uma conversa do escritório com ele mesmo.
    const doAparelho = item({ conversation: 'respondi pelo celular' }, {
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: true, id: 'Y' },
    });
    expect(normalizeUpsert(doAparelho, 'conta', 'dono', 'canal')!.phone).toBe('5511999998888');
  });

  it('descarta item sem key/id', () => {
    expect(normalizeUpsert({ message: IMAGEM }, 'conta', 'dono', 'canal')).toBeNull();
  });

  it('figurinha e ver-uma-vez chegam como mídia, não como texto vazio', () => {
    expect(normalizeUpsert(item(FIGURINHA), 'c', 'd', null)!.contentType).toBe('image');
    expect(
      normalizeUpsert(item({ viewOnceMessageV2: { message: AUDIO_PTT } }), 'c', 'd', null)!
        .contentType,
    ).toBe('audio');
  });
});

// Este bloco existe por causa de um bug que CHEGOU A PRODUÇÃO: o eco das
// mensagens enviadas pelo celular vinha com `@lid` (identificador interno do
// WhatsApp, não telefone), o contato era procurado por telefone, não achava,
// e a conversa do cliente se partia em duas — uma com o que ele escreveu,
// outra com nome de número sem sentido contendo as respostas do advogado.
describe('@lid — endereçamento novo do WhatsApp', () => {
  const LID = '10000000000107@lid';
  const TEL = '558393124441@s.whatsapp.net';

  it('LID sozinho é DESCARTADO: melhor não gravar que inventar contato', () => {
    const it0 = item({ conversation: 'oi' }, { key: { remoteJid: LID, fromMe: true, id: 'X' } });
    expect(normalizeUpsert(it0, 'conta', 'dono', 'canal')).toBeNull();
  });

  it('LID com o telefone ao lado usa o TELEFONE', () => {
    for (const campo of ['remoteJidAlt', 'senderPn', 'participantPn', 'participantAlt']) {
      const it0 = item(
        { conversation: 'respondi pelo celular' },
        { key: { remoteJid: LID, fromMe: true, id: 'X', [campo]: TEL } },
      );
      const out = normalizeUpsert(it0, 'conta', 'dono', 'canal');
      expect(out, `campo ${campo}`).not.toBeNull();
      // O telefone REAL, para cair na conversa que já existe.
      expect(out!.phone, `campo ${campo}`).toBe('558393124441');
      expect(out!.remoteJid, `campo ${campo}`).toBe(TEL);
    }
  });

  it('a contrapartida não pode ser outro LID', () => {
    const it0 = item(
      { conversation: 'oi' },
      { key: { remoteJid: LID, fromMe: true, id: 'X', remoteJidAlt: '999@lid' } },
    );
    expect(normalizeUpsert(it0, 'conta', 'dono', 'canal')).toBeNull();
  });

  it('conversa normal segue intocada', () => {
    const it0 = item({ conversation: 'oi' }, { key: { remoteJid: TEL, fromMe: false, id: 'X' } });
    expect(normalizeUpsert(it0, 'conta', 'dono', 'canal')!.phone).toBe('558393124441');
  });

  // ⚠️ O LID muda de CAMPO conforme a versão da Evolution (ver `lidJidFromKey`
  // e docs/PLANO-baileys-7.md, 4.2). Ler só um deles faz `remote_jid_lid`
  // nascer NULL depois de um upgrade — e aí apagar/editar mensagem de
  // conversa migrada volta a não fazer nada (bug de 28/07/2026, migration 917).
  it('guarda o LID venha ele em previousRemoteJid (2.3.2), remoteJidAlt (2.4) ou no próprio remoteJid', () => {
    const formas: Array<[string, Record<string, unknown>]> = [
      ['2.3.2 (+lidfix)', { remoteJid: TEL, previousRemoteJid: LID }],
      ['2.4 (troca)', { remoteJid: TEL, remoteJidAlt: LID, addressingMode: 'pn' }],
      ['sem troca', { remoteJid: LID, remoteJidAlt: TEL }],
    ];
    for (const [versao, key] of formas) {
      const out = normalizeUpsert(
        item({ conversation: 'oi' }, { key: { fromMe: true, id: 'X', ...key } }),
        'conta',
        'dono',
        'canal',
      );
      expect(out, versao).not.toBeNull();
      expect(out!.remoteJidLid, versao).toBe(LID);
      expect(out!.remoteJid, versao).toBe(TEL);
    }
  });

  it('2.3.7 põe telefone nos dois campos e perde o LID: fica null, sem inventar', () => {
    const out = normalizeUpsert(
      item({ conversation: 'oi' }, { key: { remoteJid: TEL, remoteJidAlt: TEL, fromMe: true, id: 'X' } }),
      'conta',
      'dono',
      'canal',
    );
    expect(out!.remoteJidLid).toBeNull();
  });

  it('conversa não migrada não ganha LID', () => {
    const out = normalizeUpsert(
      item({ conversation: 'oi' }, { key: { remoteJid: TEL, fromMe: false, id: 'X' } }),
      'conta',
      'dono',
      'canal',
    );
    expect(out!.remoteJidLid).toBeNull();
  });
});

// A cópia que a Baileys 7 emite quando o celular pareado reenvia uma mensagem
// que ela não conseguiu decifrar: chave só com o LID — sem `remoteJidAlt`, sem
// `addressingMode`, sem `pushName`. Medida em produção em 19/09/2026 (5 em
// 3.875; ver docs/PLANO-lid-sem-telefone.md). O telefone vem de FORA da chave,
// resolvido pelo chamador no acervo do próprio CRM.
describe('@lid sem telefone — telefone resolvido pelo chamador', () => {
  const LID = '100000000000101@lid';
  const TEL = '5583900001111@s.whatsapp.net';
  const copiaDoCelular = (over: Record<string, unknown> = {}) =>
    ({
      key: { remoteJid: LID, fromMe: false, id: 'ACA5A459', ...over },
      message: { conversation: 'Olá, gostaria de informações' },
      messageTimestamp: 1789747434,
    }) satisfies EvolutionUpsert;

  it('reconhece a forma: LID na chave e telefone em campo nenhum', () => {
    expect(ehLidSemTelefone({ remoteJid: LID, fromMe: false, id: 'X' })).toBe(true);
    expect(ehLidSemTelefone({ remoteJid: LID, remoteJidAlt: TEL })).toBe(false);
    expect(ehLidSemTelefone({ remoteJid: TEL, remoteJidAlt: LID })).toBe(false);
    expect(ehLidSemTelefone({ remoteJid: '120363000000000000@g.us' })).toBe(false);
    expect(ehLidSemTelefone(undefined)).toBe(false);
  });

  it('sem a opção, continua NÃO normalizando (o comportamento de sempre)', () => {
    expect(normalizeUpsert(copiaDoCelular(), 'conta', 'dono', 'canal')).toBeNull();
    expect(normalizeUpsert(copiaDoCelular(), 'conta', 'dono', 'canal', {})).toBeNull();
    expect(
      normalizeUpsert(copiaDoCelular(), 'conta', 'dono', 'canal', { telefoneResolvido: null }),
    ).toBeNull();
  });

  it('com o telefone resolvido: usa o telefone, guarda o LID e o carimbo original', () => {
    const out = normalizeUpsert(copiaDoCelular(), 'conta', 'dono', 'canal', {
      telefoneResolvido: TEL,
    });
    expect(out).not.toBeNull();
    expect(out!.phone).toBe('5583900001111');
    expect(out!.remoteJid).toBe(TEL);
    expect(out!.remoteJidLid).toBe(LID);
    expect(out!.fromMe).toBe(false);
    expect(out!.timestamp).toBe(1789747434);
    expect(out!.text).toBe('Olá, gostaria de informações');
    // Sem pushName a cópia cai no telefone — e `findOrCreateContact` não
    // renomeia contato existente para um número.
    expect(out!.name).toBe('5583900001111');
  });

  it('o LID NUNCA vira telefone: o que vem de fora precisa ser JID de telefone', () => {
    for (const torto of [
      '999999999999999@lid',
      '120363000000000000@g.us',
      '5583900001111',
      'status@broadcast',
      '@s.whatsapp.net',
      '',
    ]) {
      expect(
        normalizeUpsert(copiaDoCelular(), 'conta', 'dono', 'canal', { telefoneResolvido: torto }),
        torto,
      ).toBeNull();
    }
  });

  it('telefone na chave MANDA: o resolvido por fora é ignorado', () => {
    const outro = '5511988887777@s.whatsapp.net';
    const out = normalizeUpsert(copiaDoCelular({ remoteJidAlt: TEL }), 'conta', 'dono', 'canal', {
      telefoneResolvido: outro,
    });
    expect(out!.remoteJid).toBe(TEL);
  });

  it('o resolvido não ressuscita o que é descartado por OUTRO motivo', () => {
    const opcoes = { telefoneResolvido: TEL };
    const grupo = { ...copiaDoCelular(), key: { remoteJid: '120363000000000000@g.us', id: 'G' } };
    expect(normalizeUpsert(grupo, 'conta', 'dono', 'canal', opcoes)).toBeNull();
    const reacao = { ...copiaDoCelular(), message: REACAO };
    expect(normalizeUpsert(reacao, 'conta', 'dono', 'canal', opcoes)).toBeNull();
    const semId = { ...copiaDoCelular(), key: { remoteJid: LID } };
    expect(normalizeUpsert(semId, 'conta', 'dono', 'canal', opcoes)).toBeNull();
  });

  it('eco do escritório (fromMe) resolvido continua sendo eco', () => {
    const out = normalizeUpsert(copiaDoCelular({ fromMe: true }), 'conta', 'dono', 'canal', {
      telefoneResolvido: TEL,
    });
    expect(out!.fromMe).toBe(true);
    expect(out!.remoteJid).toBe(TEL);
  });
});

describe('lidJidFromKey', () => {
  const LID = '10000000000107@lid';
  const TEL = '558393124441@s.whatsapp.net';

  it('devolve o primeiro campo que for @lid, na ordem previousRemoteJid → remoteJidAlt → remoteJid', () => {
    expect(lidJidFromKey({ remoteJid: TEL, previousRemoteJid: LID })).toBe(LID);
    expect(lidJidFromKey({ remoteJid: TEL, remoteJidAlt: LID })).toBe(LID);
    expect(lidJidFromKey({ remoteJid: LID, remoteJidAlt: TEL })).toBe(LID);
  });

  it('telefone em todo campo, ou chave ausente, é null', () => {
    expect(lidJidFromKey({ remoteJid: TEL, remoteJidAlt: TEL })).toBeNull();
    expect(lidJidFromKey({ remoteJid: TEL })).toBeNull();
    expect(lidJidFromKey(undefined)).toBeNull();
  });
});

describe('phoneFromJid', () => {
  it('reduz o JID a dígitos', () => {
    expect(phoneFromJid('5511999998888@s.whatsapp.net')).toBe('5511999998888');
  });

  it('descarta a parte do aparelho', () => {
    expect(phoneFromJid('5511999998888:12@s.whatsapp.net')).toBe('5511999998888');
  });
});

// ============================================================
// `messages.delete` — as DUAS formas de payload.
//
// Bug real de produção (27/07/2026): o handler lia só o id de primeiro
// nível. Na exclusão vinda da API da Evolution esse campo é o id INTERNO do
// banco dela, então o UPDATE acertava zero linhas em silêncio — e era
// justamente a forma que fecharia o ciclo do nosso próprio botão de apagar.
// ============================================================
describe('parseDeleteEvent', () => {
  // Forma 1: exclusão feita no celular / em outro cliente do WhatsApp.
  it('lê a chave achatada', () => {
    expect(parseDeleteEvent({ id: '3EB0AAA', remoteJid: '55@s.whatsapp.net', fromMe: false })).toEqual([
      { providerMessageId: '3EB0AAA', fromMe: false },
    ]);
    expect(parseDeleteEvent({ keyId: '3EB0BBB', fromMe: true })).toEqual([
      { providerMessageId: '3EB0BBB', fromMe: true },
    ]);
  });

  // Forma 2 — a que estava sendo perdida. O `id` de fora é lixo para nós.
  it('prefere key.id ao id de primeiro nível, que é o UUID interno da Evolution', () => {
    expect(
      parseDeleteEvent({
        id: '0c2a1f5e-8b3d-4a11-9f6c-2b7e5d9a1c34',
        key: { id: '3EB0CCC', fromMe: true, remoteJid: '55@s.whatsapp.net' },
      }),
    ).toEqual([{ providerMessageId: '3EB0CCC', fromMe: true }]);
  });

  it('aceita lote em array', () => {
    expect(
      parseDeleteEvent([{ keyId: 'A', fromMe: true }, { key: { id: 'B' } }]),
    ).toEqual([
      { providerMessageId: 'A', fromMe: true },
      { providerMessageId: 'B', fromMe: false },
    ]);
  });

  // `fromMe` decide QUEM apagou, e o rótulo na bolha sai daí. Ausente tem de
  // significar "o contato", nunca "nós" — atribuir a nós uma exclusão do
  // cliente reescreve o histórico do atendimento.
  it('fromMe ausente ou não-booleano vira false', () => {
    expect(parseDeleteEvent({ keyId: 'A' })[0].fromMe).toBe(false);
    expect(parseDeleteEvent({ keyId: 'A', fromMe: 'true' })[0].fromMe).toBe(false);
    expect(parseDeleteEvent({ key: { id: 'A', fromMe: null } })[0].fromMe).toBe(false);
  });

  // Nada aqui pode lançar: é um webhook, e uma exceção vira 500 que faz a
  // Evolution reentregar o lote inteiro para sempre.
  it('payload sem id utilizável devolve lista vazia, nunca exceção', () => {
    for (const lixo of [null, undefined, {}, [], 42, 'texto', { id: 7 }, { key: {} }, [null, {}]]) {
      expect(parseDeleteEvent(lixo), JSON.stringify(lixo)).toEqual([]);
    }
  });
});

// ============================================================
// `previousRemoteJid` — o endereço para AGIR sobre a mensagem.
//
// Bug real de produção (28/07/2026): depois que a Evolution passou a
// reescrever `@lid` → telefone (patch da baileys), apagar pelo CRM uma
// mensagem enviada pelo CELULAR deixou de fazer efeito. A revogação ia para a
// conversa "telefone" e a mensagem vive na "@lid". O endereço original chega
// em `key.previousRemoteJid` e estava sendo descartado. Ver migration 917.
// ============================================================
describe('normalizeUpsert — endereço @lid da conversa', () => {
  const TEXTO = { conversation: 'oi' };

  it('guarda o @lid quando a Evolution reescreveu o endereço', () => {
    const out = normalizeUpsert(
      item(TEXTO, {
        key: {
          remoteJid: '5511960000001@s.whatsapp.net',
          previousRemoteJid: '100000000000102@lid',
          fromMe: true,
          id: '3A65CF57',
        },
      }),
      'conta',
      'dono',
      'canal',
    );
    // O telefone continua sendo quem IDENTIFICA a conversa...
    expect(out!.remoteJid).toBe('5511960000001@s.whatsapp.net');
    expect(out!.phone).toBe('5511960000001');
    // ...e o @lid é quem permite AGIR sobre a mensagem.
    expect(out!.remoteJidLid).toBe('100000000000102@lid');
  });

  it('conversa não migrada não tem @lid — e null aqui é o caso normal', () => {
    const out = normalizeUpsert(item(TEXTO), 'conta', 'dono', 'canal');
    expect(out!.remoteJidLid).toBeNull();
  });

  // A guarda importa: se o campo vier com um telefone (ou lixo), gravá-lo
  // faria a revogação sair para um endereço inventado. Só LID entra.
  it('ignora previousRemoteJid que NÃO seja um @lid', () => {
    for (const bruto of [
      '5511960000001@s.whatsapp.net',
      '120363000000000000@g.us',
      '',
      'lixo',
    ]) {
      const out = normalizeUpsert(
        item(TEXTO, {
          key: {
            remoteJid: '5511960000001@s.whatsapp.net',
            previousRemoteJid: bruto,
            fromMe: true,
            id: 'X',
          },
        }),
        'conta',
        'dono',
        'canal',
      );
      expect(out!.remoteJidLid, bruto).toBeNull();
    }
  });
});

describe('edição cifrada (secretEncryptedMessage, Baileys 7)', () => {
  // Payload REAL de 09/09/2026 19:44 (Evolution 2.4.0 / rc13): o cliente
  // editou "Sim" → "Não" e a edição chegou assim, sem texto legível.
  const EDICAO = {
    key: {
      remoteJid: '558380000016@s.whatsapp.net',
      remoteJidAlt: '100000000000103@lid',
      fromMe: false,
      id: '3ADD98536C64480C3D21',
      addressingMode: 'pn',
    },
    pushName: 'Rodrigo Tavares Monteiro',
    message: {
      messageContextInfo: { deviceListMetadataVersion: 2 },
      secretEncryptedMessage: {
        encIv: 'YJMJvA0NlXqnuSO4',
        encPayload: 'e4fyGlVouS2/70+0eRwoUkPxXX+O8nBEh7vUTQySSOBM',
        secretEncType: 2,
        targetMessageKey: { id: '3A9AE00D793FDBEAB5CB', fromMe: true, remoteJid: '100000000000103@lid' },
      },
    },
    messageType: 'secretEncryptedMessage',
    messageTimestamp: 1788993842,
  };

  it('⚠️ não vira bolha: normalizeUpsert descarta', () => {
    expect(normalizeUpsert(EDICAO, 'acc', 'owner', null)).toBeNull();
    expect(isSecretEncrypted(EDICAO.message)).toBe(true);
  });

  it('aponta a mensagem editada (targetMessageKey.id)', () => {
    expect(edicaoCifrada(EDICAO.message)).toEqual({ targetId: '3A9AE00D793FDBEAB5CB' });
  });

  it('só MESSAGE_EDIT (2) conta; edição de evento (1) e mensagem comum não', () => {
    const evento = {
      ...EDICAO.message,
      secretEncryptedMessage: { ...EDICAO.message.secretEncryptedMessage, secretEncType: 1 },
    };
    expect(edicaoCifrada(evento)).toBeNull();
    expect(isSecretEncrypted(evento)).toBe(true);
    expect(edicaoCifrada({ conversation: 'oi' })).toBeNull();
    expect(isSecretEncrypted({ conversation: 'oi' })).toBe(false);
  });

  it('sem alvo não há o que carimbar', () => {
    expect(
      edicaoCifrada({ secretEncryptedMessage: { secretEncType: 2, targetMessageKey: {} } }),
    ).toBeNull();
  });
});

describe('quotedProviderId — a citação muda de lugar com a versão da Evolution', () => {
  const key = { remoteJid: '558380000016@s.whatsapp.net', fromMe: false, id: '3A414DC87A4CEB87F32F' };

  it('2.4 com o patch da citação: stanzaId no contextInfo de cima (texto achatado em conversation)', () => {
    const item = {
      key,
      message: { conversation: 'Sim' },
      contextInfo: { stanzaId: '3EB0DBB1705F2F0E41CF56', participant: '5511960000001@s.whatsapp.net' },
    };
    expect(quotedProviderId(item)).toBe('3EB0DBB1705F2F0E41CF56');
    expect(normalizeUpsert(item, 'acc', 'owner', null)?.quotedProviderId).toBe('3EB0DBB1705F2F0E41CF56');
  });

  it('2.3.2, e mídia na 2.4: stanzaId dentro do corpo (extendedTextMessage / imageMessage)', () => {
    expect(
      quotedProviderId({
        key,
        message: { extendedTextMessage: { text: 'Sim', contextInfo: { stanzaId: 'ABC' } } },
      }),
    ).toBe('ABC');
    expect(
      quotedProviderId({ key, message: { imageMessage: { mimetype: 'image/jpeg', contextInfo: { stanzaId: 'IMG' } } } }),
    ).toBe('IMG');
  });

  it('localização como resposta carrega a citação em locationMessage.contextInfo (Codex, PR #184)', () => {
    expect(
      quotedProviderId({
        key,
        message: { locationMessage: { degreesLatitude: -7.1, degreesLongitude: -34.8, contextInfo: { stanzaId: 'LOC' } } },
      }),
    ).toBe('LOC');
  });

  it('⚠️ 2.4 SEM o patch: o contextInfo do texto é descartado e não há citação (issue #2713)', () => {
    const item = {
      key,
      message: { messageContextInfo: { deviceListMetadataVersion: 2 }, conversation: 'Sim' },
      contextInfo: { threadId: [], deviceListMetadataVersion: 2 },
    };
    expect(quotedProviderId(item)).toBeNull();
    expect(normalizeUpsert(item, 'acc', 'owner', null)?.quotedProviderId).toBeNull();
  });
});
