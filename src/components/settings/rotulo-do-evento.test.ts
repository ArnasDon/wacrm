import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DEAL_WEBHOOK_EVENTS, WEBHOOK_EVENTS } from '@/lib/webhooks/events';

import { EVENTOS_POR_GRUPO } from './documentacao/rotulos-dos-eventos';

// ============================================================
// Pino do rótulo de cada evento de webhook ENVIADO — o par de
// `rotulo-da-secao.test.ts` e `rotulo-do-gatilho.test.ts`.
//
// A aba Webhooks → Enviados e a Documentação mostram, para cada evento, um
// rótulo e uma descrição traduzidos (`useRotulosDosEventos`). As chamadas
// são literais — o portão de i18n do CI as confere —, mas o que garante que
// TODO evento do vocabulário tem entrada é este teste: um evento novo em
// `WEBHOOK_EVENTS` sem as duas chaves nos DOIS dicionários reprova aqui, em
// vez de aparecer na tela como `Settings.webhooks.catalogoDeEventos.…`.
// ============================================================

/** `message.status_updated` → `messageStatusUpdated` (o ponto é separador no next-intl). */
function chaveDoEvento(evento: string): string {
  return evento.replace(/[._](\w)/g, (_, c: string) => c.toUpperCase());
}

function catalogo(arquivo: string): Record<string, unknown> {
  const bruto = JSON.parse(readFileSync(`messages/${arquivo}`, 'utf8'));
  return bruto.Settings?.webhooks?.catalogoDeEventos ?? {};
}

const FONTE = readFileSync(
  'src/components/settings/documentacao/rotulos-dos-eventos.ts',
  'utf8'
);

describe.each(['pt-BR.json', 'en.json'])('dicionário %s', (arquivo) => {
  const cat = catalogo(arquivo);

  it('CRÍTICO: todo evento tem rótulo e descrição', () => {
    const faltando = WEBHOOK_EVENTS.filter((ev) => {
      const e = cat[chaveDoEvento(ev)] as Record<string, unknown> | undefined;
      return typeof e?.rotulo !== 'string' || typeof e?.descricao !== 'string';
    });
    expect(faltando).toEqual([]);
  });

  it('não sobra evento órfão no dicionário', () => {
    const conhecidas = new Set(WEBHOOK_EVENTS.map(chaveDoEvento));
    expect(Object.keys(cat).filter((k) => !conhecidas.has(k))).toEqual([]);
  });

  it('os dois grupos têm rótulo', () => {
    const bruto = JSON.parse(readFileSync(`messages/${arquivo}`, 'utf8'));
    expect(typeof bruto.Settings.webhooks.grupoMensagens).toBe('string');
    expect(typeof bruto.Settings.webhooks.grupoNegocios).toBe('string');
  });
});

describe('o hook usa as chaves que o dicionário tem', () => {
  it.each([...WEBHOOK_EVENTS])('%s: rótulo e descrição por chave LITERAL', (ev) => {
    const c = chaveDoEvento(ev);
    expect(FONTE).toContain(`"catalogoDeEventos.${c}.rotulo"`);
    expect(FONTE).toContain(`"catalogoDeEventos.${c}.descricao"`);
  });
});

describe('grupos', () => {
  it('todo evento aparece em exatamente um grupo', () => {
    const todos = EVENTOS_POR_GRUPO.flatMap((g) => g.eventos);
    expect([...todos].sort()).toEqual([...WEBHOOK_EVENTS].sort());
  });

  it('o grupo de negócios é exatamente DEAL_WEBHOOK_EVENTS', () => {
    const negocios = EVENTOS_POR_GRUPO.find((g) => g.grupo === 'negocios')!;
    expect([...negocios.eventos].sort()).toEqual([...DEAL_WEBHOOK_EVENTS].sort());
  });
});
