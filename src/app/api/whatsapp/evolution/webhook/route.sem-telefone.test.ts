import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Mensagem em `@lid` SEM telefone, de ponta a ponta DENTRO da rota: o webhook
// entra pelo `POST` de verdade, sobre um banco de mentira em memória. Só a
// gravação do caminho NORMAL é simulada (`persistInboundMessage` /
// `persistDeviceMessage`): aquele caminho não mudou, e é justamente isso que
// o primeiro teste pina.
//
// Ids, números e textos são fictícios. Ver docs/PLANO-lid-sem-telefone.md.
// ============================================================

import type { Banco, Linha } from '@/lib/whatsapp/sem-telefone/banco.test-helper';

const h = vi.hoisted(() => ({
  banco: null as unknown as Banco,
  after: [] as (() => Promise<void> | void)[],
  /** A ordem em que as coisas aconteceram — é ela que alguns testes cobram. */
  ordem: [] as string[],
}));

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.after.push(cb);
  },
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, init }) },
}));

// A rota guarda o client num singleton: o de mentira delega ao banco DO TESTE
// a cada chamada.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => h.banco.db.from(t),
    rpc: (n: string, a: Record<string, unknown>) =>
      (h.banco.db as unknown as { rpc: (n: string, a: unknown) => unknown }).rpc(n, a),
  }),
}));

vi.mock('@/lib/whatsapp/inbound-store', () => {
  /** Grava como o caminho real grava: os dois endereços + a conversa embutida. */
  const gravar =
    (tipo: 'cliente' | 'aparelho') =>
    async (
      _db: unknown,
      m: {
        providerMessageId: string;
        channelId?: string | null;
        remoteJid?: string;
        remoteJidLid?: string | null;
        timestamp: number;
      },
    ) => {
      h.ordem.push(`normal:${m.providerMessageId}`);
      const id = `msg-${m.providerMessageId}`;
      (h.banco.tabelas.messages ??= []).push({
        id,
        conversation_id: 'conv-1',
        channel_id: m.channelId ?? null,
        message_id: m.providerMessageId,
        sender_type: tipo === 'cliente' ? 'customer' : 'agent',
        from_device: tipo === 'aparelho',
        sender_id: null,
        deleted_at: null,
        remote_jid: m.remoteJid ?? null,
        remote_jid_lid: m.remoteJidLid ?? null,
        created_at: new Date(m.timestamp * 1000).toISOString(),
        conversations: { account_id: 'conta-1', group_id: null },
      });
      return { messageId: id, conversationId: 'conv-1', contato: null };
    };
  return {
    persistInboundMessage: vi.fn(gravar('cliente')),
    persistDeviceMessage: vi.fn(gravar('aparelho')),
  };
});

vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: vi.fn(async () => {}) }));

import { persistDeviceMessage, persistInboundMessage } from '@/lib/whatsapp/inbound-store';
import { criarBanco } from '@/lib/whatsapp/sem-telefone/banco.test-helper';

import { POST } from './route';

const SEGREDO = 'segredo-de-teste';
const INSTANCIA = 'cbcrm-instancia-de-teste';
const RETIDAS = 'cb_mensagens_sem_telefone';
const LID = '100000000000000@lid';
const TEL = '5583900000000@s.whatsapp.net';
const AGORA = 1789747434; // 2026-09-18T16:03:54Z

const canal: Linha = {
  id: 'canal-1',
  account_id: 'conta-1',
  created_by: 'dono-1',
  groups_enabled: false,
  own_lid: null,
  instance_name: INSTANCIA,
  kind: 'evolution',
};

const upsert = (data: Linha) => ({ event: 'messages.upsert', instance: INSTANCIA, data });

/** A mensagem COMUM da Evolution 2.4: telefone em `remoteJid`, LID em `remoteJidAlt`. */
const comum = (id: string, seg: number, over: Linha = {}) =>
  upsert({
    key: { remoteJid: TEL, remoteJidAlt: LID, fromMe: false, id, addressingMode: 'pn' },
    pushName: 'Cliente de Teste',
    message: { conversation: `mensagem ${id}` },
    messageType: 'conversation',
    messageTimestamp: AGORA + seg,
    ...over,
  });

/** A cópia que o celular pareado reenvia: só o LID, sem pushName, sem addressingMode. */
const semTelefone = (id: string, seg: number, over: Linha = {}) =>
  upsert({
    key: { remoteJid: LID, fromMe: false, id },
    message: { messageContextInfo: {}, conversation: `fala ${id}` },
    messageType: 'conversation',
    messageTimestamp: AGORA + seg,
    ...over,
  });

async function entregar(corpo: unknown) {
  const antes = h.after.length;
  const resposta = (await POST(
    new Request('http://localhost/api/whatsapp/evolution/webhook', {
      method: 'POST',
      headers: { authorization: `Bearer ${SEGREDO}`, 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    }),
  )) as unknown as { body: unknown; init?: { status?: number } };
  expect(resposta.init?.status ?? 200).toBe(200);
  const novos = h.after.slice(antes);
  expect(novos).toHaveLength(1);
  await novos[0]();
}

let aviso: MockInstance<(...args: unknown[]) => void>;
beforeEach(() => {
  vi.useFakeTimers({ now: (AGORA + 600) * 1000, toFake: ['Date'] });
  process.env.EVOLUTION_WEBHOOK_SECRET = SEGREDO;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://banco.de.teste';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-de-teste';
  h.banco = criarBanco({ cb_channels: [canal], messages: [] });
  h.after = [];
  h.ordem = [];
  vi.mocked(persistInboundMessage).mockClear();
  vi.mocked(persistDeviceMessage).mockClear();
  aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const avisos = () => aviso.mock.calls.map((c) => String(c[0]));

describe('REGRESSÃO — a mensagem com telefone é tratada exatamente como antes', () => {
  it('chama o persistidor de sempre, UMA vez, com o normalizado de sempre — e não escreve mais nada', async () => {
    await entregar(comum('NORMAL-1', 590));

    expect(persistInboundMessage).toHaveBeenCalledTimes(1);
    expect(persistDeviceMessage).not.toHaveBeenCalled();
    expect(vi.mocked(persistInboundMessage).mock.calls[0][1]).toEqual({
      accountId: 'conta-1',
      configOwnerUserId: 'dono-1',
      channelId: 'canal-1',
      fromMe: false,
      phone: '5583900000000',
      name: 'Cliente de Teste',
      providerMessageId: 'NORMAL-1',
      remoteJid: TEL,
      remoteJidLid: LID,
      quotedProviderId: null,
      timestamp: AGORA + 590,
      contentType: 'text',
      text: 'mensagem NORMAL-1',
      mediaUrl: null,
    });
    // A única novidade no caminho dela: UMA consulta às retidas, DEPOIS de
    // gravada, e nenhuma escrita.
    expect(h.banco.escritas).toEqual([]);
    expect(h.banco.rpcs).toEqual([]);
    expect(avisos()).toEqual([]);
  });

  it('conversa que ainda NÃO é endereçada por LID nem consulta as retidas', async () => {
    const from = vi.spyOn(h.banco.db, 'from');
    await entregar(
      upsert({
        key: { remoteJid: TEL, fromMe: false, id: 'SEM-LID' },
        pushName: 'Cliente',
        message: { conversation: 'oi' },
        messageTimestamp: AGORA + 590,
      }),
    );
    expect(persistInboundMessage).toHaveBeenCalledTimes(1);
    expect(from.mock.calls.map((c) => c[0])).not.toContain(RETIDAS);
  });

  it('o banco SEM a 1010 (deploy antes da migration) não custa a mensagem normal', async () => {
    h.banco.falhas[RETIDAS] = { code: '42P01', message: 'relation does not exist' };
    await entregar(comum('NORMAL-2', 590));
    expect(persistInboundMessage).toHaveBeenCalledTimes(1);
    expect(h.banco.tabelas.messages).toHaveLength(1);
  });

  it('mensagem do celular pareado segue pelo caminho dela', async () => {
    await entregar(
      comum('3EB0-APARELHO', 590, {
        key: { remoteJid: TEL, remoteJidAlt: LID, fromMe: true, id: '3EB0-APARELHO' },
      }),
    );
    // `fromMe` espera os 2 s da corrida do envio do próprio CRM — relógio falso
    // só no `Date`, então a espera real acontece.
    expect(persistDeviceMessage).toHaveBeenCalledTimes(1);
    expect(persistInboundMessage).not.toHaveBeenCalled();
  });
});

describe('`@lid` sem telefone', () => {
  it('LID já conhecido: a fala ENTRA na conversa certa, com o carimbo dela', async () => {
    await entregar(
      comum('3EB0-ECO', 17, {
        key: { remoteJid: TEL, remoteJidAlt: LID, fromMe: true, id: '3EB0-ECO' },
      }),
    );
    await entregar(semTelefone('FALA-1', 0));

    const fala = h.banco.tabelas.messages.find((m) => m.message_id === 'FALA-1')!;
    expect(fala).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'customer',
      remote_jid: TEL,
      remote_jid_lid: LID,
      channel_id: 'canal-1',
      content_text: 'fala FALA-1',
      created_at: new Date(AGORA * 1000).toISOString(),
    });
    // O escritório já tinha respondido: história, sem motor e sem não lida.
    expect(persistInboundMessage).not.toHaveBeenCalled();
    expect(h.banco.rpcs).toHaveLength(1);
    expect(h.banco.rpcs[0]).toMatchObject({
      nome: 'cb_assentar_mensagem_historica',
      args: {
        p_conversation_id: 'conv-1',
        p_carimbo: new Date(AGORA * 1000).toISOString(),
        p_da_equipe: false,
        p_conta_nao_lida: false,
      },
    });
    expect(h.banco.tabelas[RETIDAS][0]).toMatchObject({
      situacao: 'entregue',
      resolvida_por: 'acervo',
      payload: null,
    });
    expect(avisos()).toEqual([]);
  });

  it('a DUPLICATA (a cópia normal chegou antes) sai calada — hoje ela gera um "DESCARTADA" falso', async () => {
    await entregar(comum('MESMA', 590));
    await entregar(semTelefone('MESMA', 588));
    expect(h.banco.tabelas.messages).toHaveLength(1);
    expect(h.banco.tabelas[RETIDAS] ?? []).toEqual([]);
    expect(avisos()).toEqual([]);
  });

  it('LID desconhecido: RETIDA — e a mensagem seguinte daquele cliente a traz de volta, DEPOIS de tratada', async () => {
    await entregar(semTelefone('PRIMEIRA', 0));
    expect(h.banco.tabelas.messages).toEqual([]);
    expect(h.banco.tabelas[RETIDAS][0]).toMatchObject({ situacao: 'retida', lid_jid: LID });
    expect(avisos().some((a) => a.includes('RETIDA'))).toBe(true);
    expect(avisos().some((a) => a.includes('DESCARTADA'))).toBe(false);

    // O banco de mentira registra a ordem das escritas na tabela de mensagens.
    const push = h.banco.tabelas.messages.push.bind(h.banco.tabelas.messages);
    h.banco.tabelas.messages.push = (...linhas: Linha[]) => {
      for (const l of linhas) if (l.message_id === 'PRIMEIRA') h.ordem.push('historica:PRIMEIRA');
      return push(...linhas);
    };
    await entregar(comum('SEGUNDA', 120));

    // ⚠️ A ORDEM é a regra: os motores veem a SEGUNDA como veriam hoje (é ela
    // a "primeira mensagem" para o gatilho); a retida entra depois, como história.
    expect(h.ordem).toEqual(['normal:SEGUNDA', 'historica:PRIMEIRA']);
    expect(persistInboundMessage).toHaveBeenCalledTimes(1);
    const primeira = h.banco.tabelas.messages.find((m) => m.message_id === 'PRIMEIRA')!;
    expect(primeira).toMatchObject({
      sender_type: 'customer',
      remote_jid: TEL,
      created_at: new Date(AGORA * 1000).toISOString(),
    });
    expect(h.banco.tabelas[RETIDAS][0]).toMatchObject({
      situacao: 'entregue',
      resolvida_por: 'religacao',
      payload: null,
    });
    // Ninguém da equipe respondeu depois dela: conta não lida.
    expect(h.banco.rpcs.at(-1)?.args).toMatchObject({
      p_conversation_id: 'conv-1',
      p_da_equipe: false,
      p_conta_nao_lida: true,
    });
  });

  it('o eco do ESCRITÓRIO também destrava — o caso de 18/09, se a cópia tivesse chegado antes', async () => {
    await entregar(semTelefone('PRIMEIRA', 0));
    await entregar(
      comum('3EB0-RESPOSTA', 17, {
        key: { remoteJid: TEL, remoteJidAlt: LID, fromMe: true, id: '3EB0-RESPOSTA' },
      }),
    );
    expect(h.banco.tabelas.messages.map((m) => m.message_id).sort()).toEqual([
      '3EB0-RESPOSTA',
      'PRIMEIRA',
    ]);
    // Gente respondeu DEPOIS dela: entra sem acender não lida.
    expect(h.banco.rpcs.at(-1)?.args.p_conta_nao_lida).toBe(false);
  });

  it('sem a 1010 no banco: o comportamento e o aviso de SEMPRE', async () => {
    h.banco.falhas[RETIDAS] = { code: '42P01', message: 'relation does not exist' };
    await entregar(semTelefone('PRIMEIRA', 0));
    expect(h.banco.tabelas.messages).toEqual([]);
    expect(avisos()).toEqual([
      '[evolution/webhook] mensagem DESCARTADA: endereçada por @lid sem telefone.',
    ]);
  });

  it('reentrega do MESMO webhook não duplica a retida', async () => {
    await entregar(semTelefone('PRIMEIRA', 0));
    await entregar(semTelefone('PRIMEIRA', 0));
    expect(h.banco.tabelas[RETIDAS]).toHaveLength(1);
  });
});

// O achado P1 do Codex no PR #226: religar são várias idas ao banco por retida.
// Dentro do laço dos itens, o lote que destravasse muitas delas atrasaria — e,
// num corte do `after()`, PERDERIA — os itens seguintes do mesmo lote, que é a
// perda que as duas fases da rota existem para impedir.
describe('a religação roda DEPOIS de todos os itens do lote gravados', () => {
  /** Um lote: vários itens no MESMO webhook. */
  const lote = (...itens: { data: Linha }[]) => ({
    event: 'messages.upsert',
    instance: INSTANCIA,
    data: itens.map((i) => i.data),
  });

  it('[a que destrava, outra mensagem atual]: as DUAS atuais entram antes de qualquer retida', async () => {
    await entregar(semTelefone('RETIDA-1', 0));
    await entregar(semTelefone('RETIDA-2', 10));
    expect(h.banco.tabelas[RETIDAS]).toHaveLength(2);

    const push = h.banco.tabelas.messages.push.bind(h.banco.tabelas.messages);
    h.banco.tabelas.messages.push = (...linhas: Linha[]) => {
      for (const l of linhas) {
        if (String(l.message_id).startsWith('RETIDA')) h.ordem.push(`historica:${l.message_id}`);
      }
      return push(...linhas);
    };
    await entregar(lote(comum('ATUAL-A', 120), comum('ATUAL-B', 125)));

    expect(h.ordem).toEqual([
      'normal:ATUAL-A',
      'normal:ATUAL-B',
      'historica:RETIDA-1',
      'historica:RETIDA-2',
    ]);
    expect(h.banco.tabelas[RETIDAS].map((r) => r.situacao)).toEqual(['entregue', 'entregue']);
  });

  it('três mensagens do MESMO cliente no lote são UMA consulta às retidas, não três', async () => {
    let consultas = 0;
    const from = h.banco.db.from.bind(h.banco.db);
    (h.banco.db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      if (t === RETIDAS) consultas++;
      return from(t);
    };
    await entregar(lote(comum('A', 120), comum('B', 121), comum('C', 122)));
    expect(persistInboundMessage).toHaveBeenCalledTimes(3);
    expect(consultas).toBe(1);
  });

  it('a corrida retenção × eco DENTRO de um lote: a retida é religada pela rota, depois do laço', async () => {
    // [a cópia sem telefone, o eco que traz o par] — na ordem em que a Evolution
    // pode entregá-los. A cópia fica retida (o par ainda não existe) e o eco,
    // gravado logo depois no MESMO lote, a destrava.
    await entregar(
      lote(
        semTelefone('PRIMEIRA', 0),
        comum('3EB0-ECO', 17, {
          key: { remoteJid: TEL, remoteJidAlt: LID, fromMe: true, id: '3EB0-ECO' },
        }),
      ),
    );
    expect(h.banco.tabelas.messages.map((m) => m.message_id).sort()).toEqual(['3EB0-ECO', 'PRIMEIRA']);
    expect(h.banco.tabelas[RETIDAS][0]).toMatchObject({
      situacao: 'entregue',
      resolvida_por: 'religacao',
      payload: null,
    });
  });

  it('lendo o fonte: `religarRetidas` é chamada FORA do laço dos itens, e antes da fase de anexos', () => {
    const fonte = fs
      .readFileSync(path.join(__dirname, 'route.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const lacoDosItens = fonte.indexOf('for (const item of items) {');
    const lacoDeReligar = fonte.indexOf('for (const [lidJid, alvo] of paraReligar) {');
    const chamada = fonte.indexOf('await religarRetidas(');
    const faseDeAnexos = fonte.indexOf('for (const pendente of semAnexo) {');
    expect(lacoDosItens).toBeGreaterThan(-1);
    expect(lacoDeReligar).toBeGreaterThan(lacoDosItens);
    expect(chamada).toBeGreaterThan(lacoDeReligar);
    expect(faseDeAnexos).toBeGreaterThan(chamada);
    // Uma chamada só no arquivo — e ela está depois do laço dos itens.
    expect(fonte.split('religarRetidas(').length - 1).toBe(1);
  });
});

// A fase de mídia é comum a TODA mensagem — por isso o que muda nela é pinado
// lendo o fonte: o teste de comportamento não distingue "não baixou" de "tentou
// no canal errado e falhou", e o segundo gasta uma chamada à Evolution contra
// uma instância que nunca viu a mensagem.
describe('fase de mídia: a retida cuja conexão foi APAGADA não é buscada no canal padrão', () => {
  const fonte = fs
    .readFileSync(path.join(__dirname, 'route.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('o pulo vem ANTES do download, e só vale para quem CARREGA a chave nula', () => {
    const pulo = fonte.indexOf("if ('channelId' in pendente && pendente.channelId == null) continue;");
    const download = fonte.indexOf('await resolveEvolutionMedia(');
    expect(pulo).toBeGreaterThan(-1);
    expect(download).toBeGreaterThan(pulo);
  });

  it('item normal continua sem a chave — é o que o mantém no canal do webhook, como sempre', () => {
    // Os dois `semAnexo.push({ … })` do caminho normal (1:1 e grupo) não podem
    // ganhar `channelId`: com a chave presente, o `in` passaria a valer.
    const pushes = fonte.match(/semAnexo\.push\(\{[\s\S]*?\}\);/g) ?? [];
    expect(pushes.length).toBeGreaterThanOrEqual(2);
    for (const p of pushes) expect(p).not.toContain('channelId');
  });
});
