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
    // ⚠️ E DEPOIS do sinal da execução: o card pode ter VOLTADO à etapa, e a
    // execução antiga acabou mesmo assim (3ª rodada do Codex, PR #223).
    expect(confere).toBeGreaterThan(corpo.indexOf('execucaoJaInterrompida(db, pending.log_id)'))
  })
})

describe('o DISPATCH confere a estadia antes de criar a execução (7ª rodada)', () => {
  it('dispararAutomacoes chama cardSaiuDaEtapa com evento_em antes de executeAutomation', () => {
    const motor = fonte('lib/automations/engine.ts')
    const inicio = motor.indexOf('export async function dispararAutomacoes')
    expect(inicio).toBeGreaterThan(-1)
    const corpo = motor.slice(inicio, motor.indexOf('export async function', inicio + 10))
    const confere = corpo.indexOf('cardSaiuDaEtapa(')
    expect(confere).toBeGreaterThan(-1)
    expect(corpo.slice(confere, confere + 400)).toMatch(/eventoEm:\s*input\.context\?\.evento_em/)
    expect(confere).toBeLessThan(corpo.indexOf('executeAutomation('))
  })

  it('executeStepsFrom pergunta pela estadia antes de CADA passo, antes de runStep (8ª rodada)', () => {
    const motor = fonte('lib/automations/engine.ts')
    const inicio = motor.indexOf('async function executeStepsFrom(')
    expect(inicio).toBeGreaterThan(-1)
    const laco = motor.indexOf('for (const step of steps as AutomationStep[])', inicio)
    expect(laco).toBeGreaterThan(-1)
    const confere = motor.indexOf('cardSaiuDaEtapa(', laco)
    const roda = motor.indexOf('runStep(step, args)', laco)
    expect(confere).toBeGreaterThan(-1)
    expect(roda).toBeGreaterThan(-1)
    expect(confere).toBeLessThan(roda)
    // …e o dispatch, quando a conferência FALHA, registra a falha em vez de pular.
    expect(motor).toMatch(/situacao === 'erro'\) \{\s*await registrarFalhaAoNascer\(/)
  })

  it('a estadia é conferida ANTES do Aguardar também: a pergunta vem antes do bloco do wait no laço (9ª rodada)', () => {
    const motor = fonte('lib/automations/engine.ts')
    const laco = motor.indexOf('for (const step of steps as AutomationStep[])')
    const confere = motor.indexOf('cardSaiuDaEtapa(', laco)
    const blocoDoWait = motor.indexOf("if (step.step_type === 'wait') {", laco)
    expect(confere).toBeGreaterThan(-1)
    expect(blocoDoWait).toBeGreaterThan(-1)
    expect(confere).toBeLessThan(blocoDoWait)
  })

  it('runAutomationById ancora a estadia da execução sem evento antes de executar (9ª rodada)', () => {
    const motor = fonte('lib/automations/engine.ts')
    const inicio = motor.indexOf('export async function runAutomationById')
    const ancora = motor.indexOf('ancoraDaEstadia({', inicio)
    const executa = motor.indexOf('await executeAutomation(', inicio)
    expect(ancora).toBeGreaterThan(-1)
    expect(ancora).toBeLessThan(executa)
  })

  it('a filha do run_automation NÃO herda a estadia da mãe (evento_em: null)', () => {
    const motor = fonte('lib/automations/engine.ts')
    const inicio = motor.indexOf("case 'run_automation':")
    const fim = motor.indexOf("case 'stop_automation':", inicio)
    expect(motor.slice(inicio, fim)).toMatch(/evento_em:\s*null/)
  })

  it('a retomada cancelada (saiu) e a desativação varrem as irmãs por log_id, como todo cancelamento', () => {
    const motor = fonte('lib/automations/engine.ts')
    const inicio = motor.indexOf('export async function resumePendingExecution')
    const fim = motor.indexOf('export async function', inicio + 10)
    const corpo = motor.slice(inicio, fim)
    expect((corpo.match(/cancelarEsperasDaExecucao\(db, pending\.log_id\)/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it('o dreno carimba evento_em no contexto', () => {
    expect(fonte('lib/automations/drain-events.ts')).toMatch(/evento_em:\s*evento\.criado_em/)
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

  it('⚠️ passa o instante do movimento — evento atrasado não cancela execução nova (Codex, PR #223)', () => {
    expect(laco).toMatch(/cancelarEsperasAoSairDaEtapa\(\{[\s\S]{0,400}movidoEm:\s*linha\.criado_em/)
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
