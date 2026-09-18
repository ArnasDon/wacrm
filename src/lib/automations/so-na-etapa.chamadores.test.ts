import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ============================================================
// As DUAS pontas da automação presa à etapa, e o padrão das automações novas
// — travados estruturalmente. Teste de comportamento com mock não pega
// "esqueci de chamar": o dreno do funil nem tem teste de laço, e é nele que
// mora a ponta que mantém a tela honesta.
// ============================================================

const src = path.join(__dirname, '..', '..')

/** Fonte sem comentários — os arquivos citam as funções ao EXPLICAR decisões. */
function fonte(relativo: string): string {
  return fs
    .readFileSync(path.join(src, relativo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

describe('ponta 1 — a retomada confere a etapa ANTES de rodar qualquer passo', () => {
  it('resumePendingExecution chama cardSaiuDaEtapa antes de executeStepsFrom', () => {
    const motor = fonte('lib/automations/engine.ts')
    const inicio = motor.indexOf('export async function resumePendingExecution')
    expect(inicio).toBeGreaterThan(-1)
    const corpo = motor.slice(inicio, motor.indexOf('export async function', inicio + 10))

    const confere = corpo.indexOf('cardSaiuDaEtapa(')
    expect(confere).toBeGreaterThan(-1)
    expect(confere).toBeLessThan(corpo.indexOf('executeStepsFrom('))
    // ⚠️ E DEPOIS do freio de `is_active`: automação desligada cancela sem
    // pagar a leitura do card.
    expect(confere).toBeGreaterThan(corpo.indexOf('automation.is_active'))
  })
})

describe('ponta 2 — o dreno do funil cancela na hora em que o card sai', () => {
  const dreno = fonte('lib/automations/drain-events.ts')
  const laco = dreno.slice(dreno.indexOf('export async function drenarEventosDeFunil'))

  it('chama cancelarEsperasAoSairDaEtapa só para evento de ETAPA', () => {
    expect(laco).toMatch(
      /linha\.tipo === 'deal_stage_changed'\)\s*\{\s*await cancelarEsperasAoSairDaEtapa\(/,
    )
  })

  it('⚠️ ANTES das guardas de ciclo/atraso e do despacho — evento velho não dispara, mas o card saiu', () => {
    const cancela = laco.indexOf('cancelarEsperasAoSairDaEtapa(')
    expect(cancela).toBeGreaterThan(-1)
    expect(cancela).toBeLessThan(laco.indexOf('fechaCiclo(linha)'))
    expect(cancela).toBeLessThan(laco.indexOf('runAutomationsForTrigger('))
    // Depois da reivindicação: duas pontas drenando não cancelam em dobro.
    expect(cancela).toBeGreaterThan(laco.indexOf("is('processado_em', null)"))
  })
})

describe('automação de etapa NOVA nasce presa (decisão do operador, 18/09/2026)', () => {
  it('o construtor aberto por ?stage= semeia parar_ao_sair: true', () => {
    expect(fonte('app/(dashboard)/automations/new/page.tsx')).toMatch(
      /trigger_config:\s*\{\s*stage_ids:\s*\[stage\],\s*parar_ao_sair:\s*true\s*\}/,
    )
  })
})
