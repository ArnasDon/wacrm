import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarBanco, type Linha } from './banco.test-helper';
import { resolverTelefoneDoLid } from './resolver-lid';

const LID = '254833865040050@lid';
const TEL = '5583900001111@s.whatsapp.net';

/** Uma mensagem como a ingestão grava: os dois endereços + a conversa embutida. */
function mensagem(over: Linha = {}): Linha {
  return {
    id: 'm1',
    conversation_id: 'conv-1',
    remote_jid: TEL,
    remote_jid_lid: LID,
    created_at: '2026-09-18T16:04:11.000Z',
    conversations: { account_id: 'conta-1', group_id: null },
    ...over,
  };
}

describe('resolverTelefoneDoLid', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('acha o telefone e a conversa de um LID já visto', async () => {
    const b = criarBanco({ messages: [mensagem()] });
    expect(await resolverTelefoneDoLid(b.db, 'conta-1', LID)).toEqual({
      telefoneJid: TEL,
      conversationId: 'conv-1',
    });
  });

  it('LID nunca visto: null (a mensagem vai para a retenção)', async () => {
    const b = criarBanco({ messages: [mensagem()] });
    expect(await resolverTelefoneDoLid(b.db, 'conta-1', '111@lid')).toBeNull();
  });

  it('o LID é casado INTEIRO — sufixo igual não basta', async () => {
    const b = criarBanco({ messages: [mensagem({ remote_jid_lid: `9${LID}` })] });
    expect(await resolverTelefoneDoLid(b.db, 'conta-1', LID)).toBeNull();
  });

  it('a mais RECENTE vence (quem troca de número leva o LID junto)', async () => {
    const novo = '5511988887777@s.whatsapp.net';
    const b = criarBanco({
      messages: [
        mensagem({ id: 'velha', created_at: '2026-08-01T10:00:00.000Z' }),
        mensagem({ id: 'nova', remote_jid: novo, created_at: '2026-09-18T10:00:00.000Z' }),
        mensagem({ id: 'do-meio', created_at: '2026-09-01T10:00:00.000Z' }),
      ],
    });
    expect((await resolverTelefoneDoLid(b.db, 'conta-1', LID))?.telefoneJid).toBe(novo);
  });

  it('escopo de CONTA: o par visto em outra conta não serve', async () => {
    const b = criarBanco({
      messages: [mensagem({ conversations: { account_id: 'outra-conta', group_id: null } })],
    });
    expect(await resolverTelefoneDoLid(b.db, 'conta-1', LID)).toBeNull();
  });

  it('conversa de GRUPO não conta', async () => {
    const b = criarBanco({
      messages: [mensagem({ conversations: { account_id: 'conta-1', group_id: 'grupo-1' } })],
    });
    expect(await resolverTelefoneDoLid(b.db, 'conta-1', LID)).toBeNull();
  });

  it('só JID de TELEFONE: grupo ou LID no `remote_jid` são ignorados', async () => {
    const b = criarBanco({
      messages: [
        mensagem({ id: 'g', remote_jid: '120363000000000000@g.us' }),
        mensagem({ id: 'l', remote_jid: LID }),
        mensagem({ id: 'n', remote_jid: null }),
      ],
    });
    expect(await resolverTelefoneDoLid(b.db, 'conta-1', LID)).toBeNull();
  });

  it('consulta que FALHA devolve null — reter é o lado seguro, nunca adivinhar', async () => {
    const b = criarBanco({ messages: [mensagem()] });
    b.falhas.messages = { message: 'timeout do PostgREST' };
    expect(await resolverTelefoneDoLid(b.db, 'conta-1', LID)).toBeNull();
  });

  it('nunca lança, nem quando o cliente do banco lança', async () => {
    const quebrado = {
      from: () => {
        throw new Error('rede fora');
      },
    } as never;
    await expect(resolverTelefoneDoLid(quebrado, 'conta-1', LID)).resolves.toBeNull();
  });
});
