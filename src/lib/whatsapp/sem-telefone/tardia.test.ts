import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { criarBanco, type Linha } from './banco.test-helper';
import { refletirComoUltima } from './tardia';

const conversa = (over: Linha = {}): Linha => ({
  id: 'conv-1',
  status: 'closed',
  assigned_agent_id: 'quem-atendeu-por-ultimo',
  last_message_text: 'até logo',
  last_message_at: '2026-09-10T12:00:00.000Z',
  ...over,
});

const mensagem = (over: Linha = {}): Linha => ({
  id: 'm-tardia',
  conversation_id: 'conv-1',
  content_text: 'Preciso falar com vocês',
  content_type: 'text',
  deleted_at: null,
  created_at: '2026-09-18T16:03:54.000Z',
  ...over,
});

describe('refletirComoUltima — a recuperada TARDIA ainda é a última da conversa', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('conversa ENCERRADA: reabre SEM responsável, troca a prévia e sobe na lista', async () => {
    const b = criarBanco({ conversations: [conversa()], messages: [mensagem()] });
    await refletirComoUltima(b.db, 'conv-1');
    const c = b.tabelas.conversations[0];
    expect(c.status).toBe('open');
    // O dono antigo NÃO volta: cliente e celular pareado reabrem sem responsável.
    expect(c.assigned_agent_id).toBeNull();
    expect(c.last_message_text).toBe('Preciso falar com vocês');
    expect(Date.parse(c.last_message_at as string)).toBeGreaterThan(Date.parse('2026-09-10T12:00:00.000Z'));
  });

  it('conversa ABERTA: não mexe em situação nem em responsável — só prévia e posição', async () => {
    const b = criarBanco({
      conversations: [conversa({ status: 'open', assigned_agent_id: 'ana' })],
      messages: [mensagem()],
    });
    await refletirComoUltima(b.db, 'conv-1');
    expect(b.tabelas.conversations[0]).toMatchObject({
      status: 'open',
      assigned_agent_id: 'ana',
      last_message_text: 'Preciso falar com vocês',
    });
  });

  it('PENDENTE continua pendente (aberta ↔ pendente não é assunto de reabertura)', async () => {
    const b = criarBanco({ conversations: [conversa({ status: 'pending' })], messages: [mensagem()] });
    await refletirComoUltima(b.db, 'conv-1');
    expect(b.tabelas.conversations[0].status).toBe('pending');
  });

  // A prévia é CANÔNICA (a mensagem mais recente pelo carimbo), não "o texto
  // desta": se outra mensagem chegou entre a decisão do modo e aqui, é ela que
  // fica — escrever o texto da tardia por cima deixaria a lista mentindo até a
  // mensagem seguinte.
  it('outra mensagem mais nova chegou no meio: a prévia é a DELA, não a da tardia', async () => {
    const b = criarBanco({
      conversations: [conversa({ status: 'open' })],
      messages: [
        mensagem(),
        mensagem({ id: 'm-nova', content_text: 'e mais uma coisa', created_at: '2026-09-18T19:30:00.000Z' }),
      ],
    });
    await refletirComoUltima(b.db, 'conv-1');
    expect(b.tabelas.conversations[0].last_message_text).toBe('e mais uma coisa');
  });

  it('mídia sem legenda vira o rótulo do tipo, como no caminho normal', async () => {
    const b = criarBanco({
      conversations: [conversa({ status: 'open' })],
      messages: [mensagem({ content_text: null, content_type: 'audio' })],
    });
    await refletirComoUltima(b.db, 'conv-1');
    expect(b.tabelas.conversations[0].last_message_text).toBe('[audio]');
  });

  it('conversa que não existe (apagada no meio): não escreve nada', async () => {
    const b = criarBanco({ conversations: [], messages: [mensagem()] });
    await refletirComoUltima(b.db, 'conv-1');
    expect(b.escritas).toEqual([]);
  });

  it('NUNCA lança — nem com erro de banco, nem com o cliente do banco estourando', async () => {
    const b = criarBanco({ conversations: [conversa()], messages: [mensagem()] });
    b.falhas.conversations = { message: 'timeout' };
    await expect(refletirComoUltima(b.db, 'conv-1')).resolves.toBeUndefined();

    const quebrado = {
      from: () => {
        throw new Error('rede fora');
      },
    } as never;
    await expect(refletirComoUltima(quebrado, 'conv-1')).resolves.toBeUndefined();
  });
});
