import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedInbound } from '@/lib/whatsapp/inbound-store';

import { criarBanco, type Linha } from './banco.test-helper';
import { gravarHistorica } from './historica';

const LID = '254833865040050@lid';
const TEL = '5583900001111@s.whatsapp.net';
// 18/09/2026 13:03:54 BRT — o caso medido.
const CARIMBO = 1789747434;
const CARIMBO_ISO = '2026-09-18T16:03:54.000Z';

const recuperada = (over: Partial<NormalizedInbound> = {}): NormalizedInbound => ({
  accountId: 'conta-1',
  configOwnerUserId: 'dono-1',
  channelId: 'canal-1',
  fromMe: false,
  phone: '5583900001111',
  name: '5583900001111',
  providerMessageId: 'ACA5A459',
  remoteJid: TEL,
  remoteJidLid: LID,
  quotedProviderId: null,
  timestamp: CARIMBO,
  contentType: 'text',
  text: 'Olá, gostaria de informações',
  mediaUrl: null,
  ...over,
});

/** A resposta do escritório pelo celular pareado, 17 s DEPOIS da fala do cliente. */
const ecoDoEscritorio = (over: Linha = {}): Linha => ({
  id: 'eco-1',
  conversation_id: 'conv-1',
  sender_type: 'agent',
  sender_id: null,
  from_device: true,
  deleted_at: null,
  message_id: '3EB028',
  created_at: '2026-09-18T16:04:11.000Z',
  ...over,
});

describe('gravarHistorica', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('fala de CLIENTE: a mesma forma de linha do caminho normal, com o carimbo ORIGINAL', async () => {
    const b = criarBanco({ messages: [ecoDoEscritorio()] });
    const r = await gravarHistorica(b.db, recuperada(), 'conv-1');
    expect(r.status).toBe('gravada');
    const linha = b.tabelas.messages.find((m) => m.message_id === 'ACA5A459')!;
    expect(linha).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'customer',
      content_type: 'text',
      content_text: 'Olá, gostaria de informações',
      message_id: 'ACA5A459',
      remote_jid: TEL,
      remote_jid_lid: LID,
      channel_id: 'canal-1',
      from_me: false,
      status: 'delivered',
      created_at: CARIMBO_ISO,
    });
    // Cliente não é `from_device`: a coluna fica no DEFAULT do banco.
    expect(linha).not.toHaveProperty('from_device');
  });

  it('o caso de 18/09: gente respondeu depois → NÃO conta não lida', async () => {
    const b = criarBanco({ messages: [ecoDoEscritorio()] });
    await gravarHistorica(b.db, recuperada(), 'conv-1');
    expect(b.rpcs).toEqual([
      {
        nome: 'cb_assentar_mensagem_historica',
        args: { p_conversation_id: 'conv-1', p_conta_nao_lida: false },
      },
    ]);
  });

  it('ninguém da equipe respondeu depois → conta não lida', async () => {
    const b = criarBanco({ messages: [] });
    await gravarHistorica(b.db, recuperada(), 'conv-1');
    expect(b.rpcs[0].args.p_conta_nao_lida).toBe(true);
  });

  it('ROBÔ não é gente: resposta sem `sender_id` e sem `from_device` não tira a não lida', async () => {
    const b = criarBanco({ messages: [ecoDoEscritorio({ from_device: false })] });
    await gravarHistorica(b.db, recuperada(), 'conv-1');
    expect(b.rpcs[0].args.p_conta_nao_lida).toBe(true);
  });

  it('resposta pelo CRM (`sender_id`) é gente; resposta ANTERIOR à fala não conta; apagada não conta', async () => {
    const peloCrm = criarBanco({
      messages: [ecoDoEscritorio({ from_device: false, sender_id: 'membro-1' })],
    });
    await gravarHistorica(peloCrm.db, recuperada(), 'conv-1');
    expect(peloCrm.rpcs[0].args.p_conta_nao_lida).toBe(false);

    const anterior = criarBanco({
      messages: [ecoDoEscritorio({ created_at: '2026-09-18T16:00:00.000Z' })],
    });
    await gravarHistorica(anterior.db, recuperada(), 'conv-1');
    expect(anterior.rpcs[0].args.p_conta_nao_lida).toBe(true);

    const apagada = criarBanco({
      messages: [ecoDoEscritorio({ deleted_at: '2026-09-18T16:10:00.000Z' })],
    });
    await gravarHistorica(apagada.db, recuperada(), 'conv-1');
    expect(apagada.rpcs[0].args.p_conta_nao_lida).toBe(true);
  });

  it('eco do ESCRITÓRIO (fromMe): entra como equipe pelo celular, e nunca conta não lida', async () => {
    const b = criarBanco({ messages: [] });
    await gravarHistorica(b.db, recuperada({ fromMe: true, providerMessageId: '3EB047' }), 'conv-1');
    expect(b.tabelas.messages[0]).toMatchObject({
      sender_type: 'agent',
      from_me: true,
      from_device: true,
      status: 'sent',
      created_at: CARIMBO_ISO,
    });
    expect(b.rpcs[0].args.p_conta_nao_lida).toBe(false);
  });

  it('a OUTRA cópia já entrou (UNIQUE da conversa): duplicada, e a conversa não é tocada', async () => {
    const b = criarBanco({
      messages: [{ id: 'm0', conversation_id: 'conv-1', message_id: 'ACA5A459' }],
    });
    expect(await gravarHistorica(b.db, recuperada(), 'conv-1')).toEqual({ status: 'duplicada' });
    expect(b.tabelas.messages).toHaveLength(1);
    expect(b.rpcs).toEqual([]);
  });

  it('insert que falha: `falhou`, sem tocar a conversa', async () => {
    const b = criarBanco();
    b.falhas.messages = { code: '57014', message: 'statement timeout' };
    expect(await gravarHistorica(b.db, recuperada(), 'conv-1')).toEqual({ status: 'falhou' });
    expect(b.rpcs).toEqual([]);
  });

  it('a função da 1007 falhando NÃO desfaz a mensagem: ela já está no fio', async () => {
    const b = criarBanco();
    b.falhasDeRpc.cb_assentar_mensagem_historica = { code: '42883', message: 'function does not exist' };
    const r = await gravarHistorica(b.db, recuperada(), 'conv-1');
    expect(r.status).toBe('gravada');
    expect(b.tabelas.messages).toHaveLength(1);
  });

  it('citação: liga à citada quando ela está NESTA conversa; fora dela fica nula', async () => {
    const b = criarBanco({
      messages: [
        { id: 'citada-uuid', conversation_id: 'conv-1', message_id: 'WAMID-CITADA' },
        { id: 'outra-uuid', conversation_id: 'conv-2', message_id: 'WAMID-DE-FORA' },
      ],
    });
    await gravarHistorica(b.db, recuperada({ quotedProviderId: 'WAMID-CITADA' }), 'conv-1');
    await gravarHistorica(
      b.db,
      recuperada({ providerMessageId: 'OUTRA', quotedProviderId: 'WAMID-DE-FORA' }),
      'conv-1'
    );
    const [a, c] = b.tabelas.messages.filter((m) => m.sender_type === 'customer');
    expect(a.reply_to_message_id).toBe('citada-uuid');
    expect(c.reply_to_message_id).toBeNull();
  });

  it('tipo fora do vocabulário da coluna vira `text` (o CHECK de messages recusaria)', async () => {
    const b = criarBanco();
    await gravarHistorica(b.db, recuperada({ contentType: 'sticker' as never }), 'conv-1');
    expect(b.tabelas.messages[0].content_type).toBe('text');
  });
});
