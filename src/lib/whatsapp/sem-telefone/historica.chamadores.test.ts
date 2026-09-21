import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// A garantia de que mensagem HISTÓRICA não dispara nada é ESTRUTURAL, no
// desenho de `cb-groups/persist.ts` (grupo não dispara motor): o arquivo não
// IMPORTA os motores. Teste de comportamento com mock não pega "alguém
// acrescentou a chamada num refactor" — ler o fonte pega.
//
// O que uma mensagem com carimbo antigo NÃO pode fazer, e por quê — ver o
// cabeçalho de `historica.ts` e docs/PLANO-lid-sem-telefone.md, 4.3.
// ============================================================

const aqui = __dirname;

/** Fonte sem comentários: o arquivo CITA os nomes ao explicar o que fica de fora. */
function fonte(arquivo: string): string {
  return fs
    .readFileSync(path.join(aqui, arquivo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const PROIBIDOS = [
  // os motores de conversa
  '@/lib/automations/engine',
  '@/lib/flows/engine',
  '@/lib/ai/auto-reply',
  'runAutomationsForTrigger',
  'dispatchInboundToFlows',
  'dispatchInboundToAiReply',
  // o que decide por gente
  'routeContactToPipeline',
  'reopenClosedConversation',
  'followConversationChannel',
  // a medição de atraso de entrega (1002) e o cancelamento de esperas (#223)
  'registrarEntrega',
  'cancelarEsperasPorResposta',
  // o caminho normal inteiro (que chama tudo acima)
  'persistInboundMessage',
  'persistDeviceMessage',
];

describe('historica.ts não dispara motor nenhum', () => {
  const f = fonte('historica.ts');

  for (const nome of PROIBIDOS) {
    it(`não cita ${nome}`, () => {
      expect(f).not.toContain(nome);
    });
  }

  it('de `inbound-store` só importa TIPO (import type some na compilação)', () => {
    const imports = f.match(/import[^;]*from\s+'@\/lib\/whatsapp\/inbound-store'/g) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const i of imports) expect(i.startsWith('import type')).toBe(true);
  });

  it('grava o canal NO PRÓPRIO insert, com a rede de segurança da FK', () => {
    expect(f).toContain('gravarComCanal(');
    expect(f).toContain('channel_id: canal,');
  });
});

// A `tardia` é a ÚNICA exceção, e ela é estreita: a recuperada que ainda é a
// última da conversa REABRE a conversa encerrada (`tardia.ts`) — e só. Motor,
// funil, canal, atraso de entrega e cancelamento de espera continuam fora.
describe('tardia.ts reabre e acerta a prévia — e mais nada', () => {
  const f = fonte('tardia.ts');

  for (const nome of PROIBIDOS.filter((n) => n !== 'reopenClosedConversation')) {
    it(`não cita ${nome}`, () => {
      expect(f).not.toContain(nome);
    });
  }

  it('reabre pelo MESMO helper dos quatro caminhos normais, sem nomear responsável', () => {
    expect(f).toContain("from '@/lib/conversations/reopen'");
    expect(f).toContain('reopenClosedConversation(');
    // Cliente e celular pareado reabrem SEM responsável: `assignTo` aqui poria
    // a conversa em nome de alguém que não decidiu nada.
    expect(f).not.toContain('assignTo');
  });

  it('a prévia é a canônica (a mais recente pelo carimbo), não o texto desta mensagem', () => {
    expect(f).toContain('atualizarPreviaDaConversa(');
    expect(f).not.toContain('last_message_text');
  });
});

describe('só a TARDIA reflete na conversa — e quem decide isso é `entregar.ts`', () => {
  it('`refletirComoUltima` só é chamada em entregar.ts, e só no modo tardia', () => {
    const entregar = fonte('entregar.ts');
    expect(entregar).toMatch(/modo === 'tardia'\s*\?\s*\(\)\s*=>\s*refletirComoUltima\(/);
    for (const arquivo of ['historica.ts', 'receber.ts', 'religar.ts', 'retidas.ts', 'resolver-lid.ts']) {
      expect(fonte(arquivo), arquivo).not.toContain('refletirComoUltima');
    }
  });
});

describe('quem decide o modo é `entregar.ts` — os dois chamadores passam por ele', () => {
  for (const arquivo of ['receber.ts', 'religar.ts']) {
    it(`${arquivo} entrega por entregarRecuperada, nunca direto`, () => {
      const f = fonte(arquivo);
      expect(f).toContain('entregarRecuperada(');
      expect(f).not.toContain('gravarHistorica(');
      expect(f).not.toContain('persistInboundMessage(');
      expect(f).not.toContain('persistDeviceMessage(');
    });
  }
});
