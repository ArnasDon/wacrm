import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Pino estrutural do dreno como fonte dos webhooks `deal.*`.
//
// O laço do dreno não tem teste de comportamento (é E/S pura contra a fila),
// e as duas decisões abaixo só se veem LENDO o fonte:
//
//   1. A coleta vem DEPOIS da reivindicação — senão o aviso imediato e o cron,
//      drenando ao mesmo tempo, entregariam o mesmo movimento duas vezes — e
//      ANTES das guardas de ciclo/atraso/contato, que decidem só se AUTOMAÇÃO
//      dispara (decisão do operador, 23/09/2026: evento atrasado SAI, com a
//      hora real). Coletada depois delas, um card movido com o agendador fora
//      do ar por uma hora nunca chegaria ao n8n, e ninguém veria o motivo.
//   2. A entrega é UMA chamada, FORA do laço: dentro dele, cada evento
//      esperaria o prazo de entrega em série, e a rota do aviso imediato —
//      que o navegador aguarda depois de arrastar o card — ficaria refém de
//      um endpoint lento.
// ============================================================

const src = path.join(__dirname, '..', '..');

/** Fonte sem comentários — o arquivo cita as funções ao EXPLICAR decisões. */
function fonte(relativo: string): string {
  return fs
    .readFileSync(path.join(src, relativo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** Índice do `}` que fecha o bloco aberto pelo primeiro `{` a partir de `inicio`. */
function fimDoBloco(texto: string, inicio: number): number {
  const abre = texto.indexOf('{', inicio);
  let nivel = 0;
  for (let i = abre; i < texto.length; i++) {
    if (texto[i] === '{') nivel++;
    if (texto[i] === '}') {
      nivel--;
      if (nivel === 0) return i;
    }
  }
  return -1;
}

const dreno = fonte('lib/automations/drain-events.ts');
const funcao = dreno.slice(dreno.indexOf('export async function drenarEventosDeFunil'));
const inicioDoLaco = funcao.indexOf('for (const linha of pendentes');
const fimDoLaco = fimDoBloco(funcao, inicioDoLaco);
const laco = funcao.slice(inicioDoLaco, fimDoLaco + 1);

describe('o dreno coleta cada linha reivindicada para os webhooks deal.*', () => {
  it('o laço existe e foi delimitado', () => {
    expect(inicioDoLaco).toBeGreaterThan(-1);
    expect(fimDoLaco).toBeGreaterThan(inicioDoLaco);
  });

  it('a coleta vem DEPOIS de `if (!reivindicado) continue` e ANTES de `fechaCiclo(linha)`', () => {
    const coleta = laco.indexOf('paraOsWebhooks.push(linha)');
    expect(coleta).toBeGreaterThan(-1);
    expect(coleta).toBeGreaterThan(laco.indexOf('if (!reivindicado) continue'));
    expect(coleta).toBeLessThan(laco.indexOf('fechaCiclo(linha)'));
    // …e antes do atraso e do "sem contato", que moram em motivoParaNaoDisparar.
    expect(coleta).toBeLessThan(laco.indexOf('motivoParaNaoDisparar('));
  });

  it('coleta UMA vez por linha (um só push no laço)', () => {
    expect(laco.match(/paraOsWebhooks\.push\(/g) ?? []).toHaveLength(1);
  });

  it('não desmonta a ponta 2 da etapa: o bloco da etapa continua abrindo com o cancelamento', () => {
    expect(laco).toMatch(
      /linha\.tipo === 'deal_stage_changed'\)\s*\{\s*await cancelarEsperasAoSairDaEtapa\(/,
    );
  });
});

describe('a entrega é chamada uma vez, fora do laço', () => {
  it('exatamente uma chamada a entregarEventosDeFunil no arquivo', () => {
    expect(dreno.match(/entregarEventosDeFunil\(/g) ?? []).toHaveLength(1);
  });

  it('fica DEPOIS do fim do laço, e com await', () => {
    const entrega = funcao.indexOf('entregarEventosDeFunil(');
    expect(entrega).toBeGreaterThan(fimDoLaco);
    expect(funcao.slice(entrega - 20, entrega)).toMatch(/await\s+$/);
    expect(laco).not.toContain('entregarEventosDeFunil(');
  });

  it('recebe as linhas coletadas', () => {
    expect(funcao).toMatch(/entregarEventosDeFunil\(\s*db\s*,\s*paraOsWebhooks\s*\)/);
  });

  it('⚠️ fica fora do try/catch do laço: um estouro no meio não perde o aviso do que já foi reivindicado', () => {
    const entrega = funcao.indexOf('entregarEventosDeFunil(');
    const catchDoDreno = funcao.indexOf("console.error('[automations] drenagem falhou'");
    expect(catchDoDreno).toBeGreaterThan(-1);
    expect(entrega).toBeGreaterThan(catchDoDreno);
  });
});
