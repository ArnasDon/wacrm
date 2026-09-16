import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { toneFor, type EntradaDeCor, type HealthTone } from '@/lib/cb-channels/health';
import { LIMIAR_ATRASO_SEG } from '@/lib/cb-channels/atraso-de-entrega';

// ============================================================
// O MESMO BURACO do `rotulo-da-secao.test.ts` e do
// `rotulo-do-gatilho.test.ts`, agora no indicador de saúde.
//
// `channel-health-indicator.tsx` pede tom e motivo por chave MONTADA
// (``t(`tone_${c.tone}`)`` e ``t(`detail_${c.detail}`)``), e chave montada
// está fora do alcance do portão de i18n do CI — ela entra em "dinâmicas
// ignoradas". Dava para `toneFor` passar a devolver um motivo novo, o CI
// ficar inteiro verde, e o popover mostrar `ChannelHealth.detail_lagging`
// cru no lugar da frase.
//
// A lista de motivos não é digitada aqui: ela é COLHIDA do próprio
// `toneFor`, varrendo as entradas que o produzem. Uma lista escrita à mão
// divergiria na primeira mudança da régua — que é exatamente o defeito que
// este arquivo existe para impedir.
// ============================================================

/** Medição colhida há instantes — sem isto o alarme não acende (3ª rodada). */
const FRESCO = '2026-09-16T14:59:30.000Z';

const BASE: EntradaDeCor = {
  status: 'connected',
  estadoVivo: null,
  checkedAt: null,
  lastError: null,
  incompleto: false,
  webhookOk: null,
  atrasoSeg: null,
  atrasoMedidoEm: null,
  agoraMs: Date.parse('2026-09-16T15:00:00.000Z'),
};

/** Uma entrada por RAMO de `toneFor` — se um ramo sumir, o motivo some junto. */
const CENARIOS: EntradaDeCor[] = [
  { ...BASE, incompleto: true },
  { ...BASE, estadoVivo: 'close' },
  { ...BASE, estadoVivo: 'connecting' },
  { ...BASE, estadoVivo: 'open' },
  { ...BASE, estadoVivo: 'open', webhookOk: false },
  { ...BASE, estadoVivo: 'open', lastError: 'algo' },
  { ...BASE, estadoVivo: 'open', atrasoSeg: LIMIAR_ATRASO_SEG + 60, atrasoMedidoEm: FRESCO },
  { ...BASE, status: 'disconnected' },
  { ...BASE, status: 'connecting' },
  { ...BASE, status: 'connected', checkedAt: null },
  { ...BASE, status: 'connected', checkedAt: '2026-09-16T14:59:50.000Z' },
  {
    ...BASE,
    status: 'connected',
    checkedAt: '2026-09-16T14:59:50.000Z',
    atrasoSeg: LIMIAR_ATRASO_SEG + 60,
    atrasoMedidoEm: FRESCO,
  },
];

const RESULTADOS = CENARIOS.map(toneFor);
const TONS = [...new Set(RESULTADOS.map((r) => r.tone))] as HealthTone[];
const MOTIVOS = [...new Set(RESULTADOS.map((r) => r.detail).filter((d): d is string => !!d))];

describe.each(['pt-BR.json', 'en.json'])('dicionário %s', (arquivo) => {
  const dic = JSON.parse(readFileSync(`messages/${arquivo}`, 'utf8')).ChannelHealth as Record<
    string,
    unknown
  >;

  it('CRÍTICO: todo MOTIVO que a régua produz tem frase', () => {
    expect(MOTIVOS.filter((d) => typeof dic[`detail_${d}`] !== 'string')).toEqual([]);
  });

  it('CRÍTICO: todo TOM que a régua produz tem frase', () => {
    expect(TONS.filter((t) => typeof dic[`tone_${t}`] !== 'string')).toEqual([]);
  });

  it('o atraso de entrega (1002) está entre os motivos cobertos', () => {
    // Fixa o caso que motivou o nível 3 — sem ele, este arquivo passaria a
    // cobrar só o que já existia antes dele.
    expect(MOTIVOS).toContain('lagging');
    expect(typeof dic.detail_lagging).toBe('string');
  });

  it('as frases do atraso levam o marcador {tempo}', () => {
    // As duas são montadas com valor; sem o marcador, o popover diria
    // "Entregando com de atraso".
    expect(String(dic.deliveryLag)).toContain('{tempo}');
    expect(String(dic.lagMeasured)).toContain('{tempo}');
  });
});
