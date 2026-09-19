import { describe, expect, it } from 'vitest';

import { IDADE_MAXIMA_DA_NOVA_MS, modoDaRecuperada } from './modo';
import { LIMIAR_ATRASO_SEG } from '@/lib/cb-channels/atraso-de-entrega';

const AGORA = Date.UTC(2026, 8, 18, 16, 5, 3);
const seg = (n: number) => n * 1000;

describe('modoDaRecuperada', () => {
  it('a última da conversa e recente: NOVA (caminho normal, motores inclusive)', () => {
    expect(
      modoDaRecuperada({
        carimboMs: AGORA - seg(8),
        agoraMs: AGORA,
        ultimaDaConversaMs: AGORA - seg(600),
      }),
    ).toBe('nova');
  });

  it('o caso medido em 18/09: o escritório já tinha respondido → HISTÓRICA', () => {
    // Cliente 13:03:54, ecos 13:04:11, cópia do celular chega 13:05:03.
    const carimbo = AGORA - seg(69);
    expect(
      modoDaRecuperada({
        carimboMs: carimbo,
        agoraMs: AGORA,
        ultimaDaConversaMs: carimbo + seg(17),
      }),
    ).toBe('historica');
  });

  it('conversa sem mensagem nenhuma: ela É a última', () => {
    expect(
      modoDaRecuperada({ carimboMs: AGORA - seg(5), agoraMs: AGORA, ultimaDaConversaMs: null }),
    ).toBe('nova');
  });

  it('empate no mesmo segundo (rajada do cliente) conta como a última', () => {
    const carimbo = AGORA - seg(3);
    expect(
      modoDaRecuperada({ carimboMs: carimbo, agoraMs: AGORA, ultimaDaConversaMs: carimbo }),
    ).toBe('nova');
  });

  it('meio segundo DEPOIS dela já a torna história (envio do CRM tem milissegundos)', () => {
    const carimbo = AGORA - seg(3);
    expect(
      modoDaRecuperada({ carimboMs: carimbo, agoraMs: AGORA, ultimaDaConversaMs: carimbo + 500 }),
    ).toBe('historica');
  });

  it('a fronteira dos 5 min: no teto ainda é nova, um milissegundo depois não', () => {
    const naBorda = AGORA - IDADE_MAXIMA_DA_NOVA_MS;
    expect(
      modoDaRecuperada({ carimboMs: naBorda, agoraMs: AGORA, ultimaDaConversaMs: null }),
    ).toBe('nova');
    expect(
      modoDaRecuperada({ carimboMs: naBorda - 1, agoraMs: AGORA, ultimaDaConversaMs: null }),
    ).toBe('historica');
  });

  it('retida religada horas depois nunca é nova, mesmo sendo a última', () => {
    expect(
      modoDaRecuperada({
        carimboMs: AGORA - seg(3 * 3600),
        agoraMs: AGORA,
        ultimaDaConversaMs: null,
      }),
    ).toBe('historica');
  });

  // ⚠️ O elo com a 1002: a `nova` chama `registrarEntrega`. Se este teto
  // passar do limiar do alarme, uma recuperada sozinha acende "conexão
  // entregando com atraso" — alarme falso sobre conexão sadia.
  it('o teto da nova não passa do limiar do alarme de atraso de entrega', () => {
    expect(IDADE_MAXIMA_DA_NOVA_MS).toBeLessThanOrEqual(LIMIAR_ATRASO_SEG * 1000);
  });
});
