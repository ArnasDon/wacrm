import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ============================================================
// QUEM cancela as esperas "parar se o cliente responder", e EM QUE ORDEM —
// travado estruturalmente (o desenho de `reopen.chamadores.test.ts`).
//
// Teste de comportamento com mock não pega "esqueci de chamar num dos
// transportes", e esse é o erro que este projeto já cometeu: o helper de
// reabrir conversa existia e só o webhook da META o chamava — produção roda
// Evolution, e a regra não valia para nenhuma mensagem real. Ler o fonte pega.
// ============================================================

const src = path.join(__dirname, '..', '..')

/** Fonte sem comentários — os arquivos citam a função ao EXPLICAR decisões. */
function fonte(relativo: string): string {
  return fs
    .readFileSync(path.join(src, relativo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

const CHAMADA = 'cancelarEsperasPorResposta('

describe('a resposta do cliente cancela a espera nos DOIS transportes', () => {
  it('Evolution: dentro de persistInboundMessage, ANTES de robôs e automações', () => {
    const arquivo = fonte('lib/whatsapp/inbound-store.ts')
    const inicio = arquivo.indexOf('export async function persistInboundMessage')
    expect(inicio).toBeGreaterThan(-1)
    const corpo = arquivo.slice(inicio)

    const cancela = corpo.indexOf(CHAMADA)
    expect(cancela).toBeGreaterThan(-1)
    // ⚠️ A ORDEM é a feature: depois do despacho, a mensagem cancelaria a
    // espera da automação que ela mesma acabou de iniciar.
    expect(cancela).toBeLessThan(corpo.indexOf('dispatchInboundToFlows('))
    expect(cancela).toBeLessThan(corpo.indexOf('runAutomationsForTrigger('))
  })

  it('Meta: no webhook, ANTES de robôs e automações', () => {
    const arquivo = fonte('app/api/whatsapp/webhook/route.ts')
    const cancela = arquivo.indexOf(CHAMADA)
    expect(cancela).toBeGreaterThan(-1)
    expect(cancela).toBeLessThan(arquivo.indexOf('dispatchInboundToFlows('))
    expect(cancela).toBeLessThan(arquivo.indexOf('runAutomationsForTrigger('))
  })

  it('⚠️ mensagem da EQUIPE pelo celular pareado não cancela nada', () => {
    // A caixa diz "se o CLIENTE responder". O celular pareado é por onde o
    // escritório mais fala (948 mensagens contra 8 pelo CRM): cancelar ali
    // pararia a sequência a cada mensagem que o advogado manda.
    const arquivo = fonte('lib/whatsapp/inbound-store.ts')
    const inicio = arquivo.indexOf('export async function persistDeviceMessage')
    const fim = arquivo.indexOf('export async function persistInboundMessage')
    expect(inicio).toBeGreaterThan(-1)
    expect(fim).toBeGreaterThan(inicio)
    expect(arquivo.slice(inicio, fim)).not.toContain(CHAMADA)
  })
})

describe('DEFAULT-DENY: ninguém mais chama', () => {
  // Chamador novo entra aqui por decisão visível no diff. Um 3º call site é
  // decisão de produto — "a mensagem de QUEM para a sequência?" —, não
  // conveniência: grupo, Instagram, envio da equipe e robô ficam de fora.
  const PERMITIDOS = new Set([
    'app/api/whatsapp/webhook/route.ts',
    'lib/whatsapp/inbound-store.ts',
  ])

  function arquivosDe(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const cheio = path.join(dir, e.name)
      if (e.isDirectory()) return arquivosDe(cheio)
      return /\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name) ? [cheio] : []
    })
  }

  it('só os dois caminhos de ingestão do WhatsApp', () => {
    const chamadores = arquivosDe(src)
      .map((cheio) => path.relative(src, cheio))
      .filter((rel) => rel !== 'lib/automations/parar-se-responder.ts')
      .filter((rel) => fonte(rel).includes('cancelarEsperasPorResposta'))
      .sort()

    expect(chamadores).toEqual([...PERMITIDOS].sort())
  })
})

describe('o motor cuida da MARCA nas duas pontas', () => {
  const motor = fonte('lib/automations/engine.ts')

  it('estaciona a espera com contextoDaEspera', () => {
    expect(motor).toMatch(/context:\s*contextoDaEspera\(args\.context,\s*cfg,\s*step\.id\)/)
  })

  it('⚠️ a retomada pergunta se a EXECUÇÃO já foi interrompida, antes de rodar qualquer passo (Codex, PR #223)', () => {
    // A resposta do cliente cancela a marcada e as irmãs que estavam na fila;
    // a continuação que estacionou um instante DEPOIS só é barrada aqui.
    const inicio = motor.indexOf('export async function resumePendingExecution')
    const corpo = motor.slice(inicio, motor.indexOf('export async function', inicio + 10))
    const pergunta = corpo.indexOf('execucaoJaInterrompida(db, pending.log_id)')
    expect(pergunta).toBeGreaterThan(-1)
    expect(pergunta).toBeLessThan(corpo.indexOf('executeStepsFrom('))
  })

  it('⚠️⚠️ o ESTACIONAMENTO passa SÓ pela função cb_estacionar_espera (1005) — nunca INSERT direto na fila', () => {
    // A função trava o registro e recusa a execução interrompida NA MESMA
    // transação. Um INSERT direto reabriria o vão entre "perguntar" e
    // "inserir" (4ª e 5ª rodadas do Codex).
    const inicio = motor.indexOf('async function executeStepsFrom')
    const corpo = motor.slice(inicio, motor.indexOf('async function runStep', inicio))
    expect(corpo.split("'cb_estacionar_espera'").length - 1).toBe(2)
    expect(corpo).not.toContain('.insert(')
  })

  it('⚠️ a retomada limpa a marca antes de qualquer passo rodar', () => {
    // Sem isto a marca de uma espera viaja para as seguintes (que o operador
    // pode NÃO ter marcado), para a retentativa e para o `run_automation`.
    const inicio = motor.indexOf('export async function resumePendingExecution')
    expect(inicio).toBeGreaterThan(-1)
    const corpo = motor.slice(inicio, motor.indexOf('export async function', inicio + 10))
    expect(corpo).toMatch(/context:\s*semMarcaDeResposta\(pending\.context/)
  })
})

describe('a ORDEM de todo cancelamento por lote: foto da fila → MARCA → segunda varredura por log_id (6ª rodada)', () => {
  // Entre a foto e a marca, um ramo ainda rodando pode estacionar uma irmã: a
  // marca a impede de retomar, mas só a segunda varredura a tira da aba.
  const casos = [
    { arquivo: 'app/api/cb/execucoes/parar-automacao/route.ts', inicio: 'export async function POST' },
    { arquivo: 'lib/automations/engine.ts', inicio: "case 'stop_automation': {" },
    { arquivo: 'lib/automations/parar-se-responder.ts', inicio: 'export async function cancelarEsperasPorResposta' },
  ]
  for (const { arquivo, inicio } of casos) {
    it(`${arquivo}: marca antes de varrer por log_id`, () => {
      const src = fonte(arquivo)
      const a = src.indexOf(inicio)
      expect(a).toBeGreaterThan(-1)
      const corpo = src.slice(a, a + 6000)
      const marca = corpo.indexOf('marcarExecucoesInterrompidas(')
      const varredura = corpo.indexOf(".in('log_id'")
      expect(marca).toBeGreaterThan(-1)
      expect(varredura).toBeGreaterThan(marca)
    })
  }

  it('a saída da etapa (dreno) marca antes de cancelar por log_id', () => {
    const src = fonte('lib/automations/so-na-etapa.ts')
    const a = src.indexOf('export async function cancelarEsperasAoSairDaEtapa')
    const corpo = src.slice(a)
    expect(corpo.indexOf('marcarExecucoesInterrompidas(')).toBeLessThan(corpo.indexOf(".in('log_id'"))
  })
})
