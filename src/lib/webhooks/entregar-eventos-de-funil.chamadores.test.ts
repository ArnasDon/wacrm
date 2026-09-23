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
//   2. A entrega é UMA, FORA do laço, e AGENDADA com `after()` — com a
//      queda para `await` quando não há requisição onde agendar. Dentro do
//      laço, cada evento esperaria o prazo de entrega em série; aguardada no
//      fim (a forma até 23/09/2026), um endpoint lento custava ~ceil(N/4) × 5 s
//      no caminho de quem chama: o navegador depois de arrastar o card, e o
//      cron ANTES dos lembretes, do batimento e das retomadas do "Aguardar".
//      Um `after()` sem a queda perderia os avisos fora de requisição
//      (`after()` lança lá); uma queda sem o `after()` devolveria a espera.
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

describe('a entrega é agendada uma vez, fora do laço, com a queda para await', () => {
  it('exatamente uma chamada a entregarEventosDeFunil no arquivo', () => {
    // Uma só: o `after()` e a queda chamam a MESMA função local, então as
    // duas saídas não podem divergir no que entregam.
    expect(dreno.match(/entregarEventosDeFunil\(/g) ?? []).toHaveLength(1);
  });

  it('recebe as linhas coletadas', () => {
    expect(funcao).toMatch(/entregarEventosDeFunil\(\s*db\s*,\s*paraOsWebhooks\s*\)/);
  });

  it('`after` vem de next/server', () => {
    expect(dreno).toMatch(/import\s*\{\s*after\s*\}\s*from\s*'next\/server'/);
  });

  it('o agendamento fica DEPOIS do fim do laço, e UMA vez', () => {
    const entrega = funcao.indexOf('entregarEventosDeFunil(');
    expect(entrega).toBeGreaterThan(fimDoLaco);
    expect(laco).not.toContain('entregarEventosDeFunil(');
    expect(laco).not.toMatch(/\bafter\(/);
    expect(funcao.match(/\bafter\(/g) ?? []).toHaveLength(1);
  });

  it('⚠️ agenda com after() e, se after() lançar, AGUARDA a mesma entrega', () => {
    // A forma: `const entregar = () => entregarEventosDeFunil(db, paraOsWebhooks)`
    // seguida de `try { after(entregar) } catch { await entregar() }`.
    const m = funcao.match(
      /const\s+(\w+)\s*=\s*\(\)\s*=>\s*entregarEventosDeFunil\(\s*db\s*,\s*paraOsWebhooks\s*\);?\s*try\s*\{\s*after\(\s*(\w+)\s*\);?\s*\}\s*catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*await\s+(\w+)\(\);?\s*\}/
    );
    expect(m).not.toBeNull();
    const [, nome, agendado, aguardado] = m!;
    expect(agendado).toBe(nome);
    expect(aguardado).toBe(nome);
  });

  it('não aguarda a entrega FORA da queda (senão a espera volta ao caminho de quem chama)', () => {
    expect(funcao).not.toMatch(/await\s+entregarEventosDeFunil\(/);
    expect(funcao.match(/await\s+entregar\(\)/g) ?? []).toHaveLength(1);
  });

  it('⚠️ fica fora do try/catch do laço: um estouro no meio não perde o aviso do que já foi reivindicado', () => {
    const entrega = funcao.indexOf('entregarEventosDeFunil(');
    const catchDoDreno = funcao.indexOf("console.error('[automations] drenagem falhou'");
    expect(catchDoDreno).toBeGreaterThan(-1);
    expect(entrega).toBeGreaterThan(catchDoDreno);
  });
});
