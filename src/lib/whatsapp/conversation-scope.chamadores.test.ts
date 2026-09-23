import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ============================================================
// Pino estrutural do upstream #589 (GHSA-m4fx-g6pr-hrw8): todo envio do
// ROBÔ que grava em `messages` (em service-role, pelo id da conversa que veio
// do contexto) confere que a conversa é da conta ANTES de escolher o canal —
// e portanto antes do provedor: depois de a mensagem sair, não há o que
// desfazer. Os testes de comportamento listam os envios de HOJE; este pega o
// envio NOVO que alguém escrever nestes arquivos e esquecer a conferência.
// ============================================================

const RAIZ = join(__dirname, '..', '..', '..')
const ARQUIVOS = ['src/lib/flows/meta-send.ts', 'src/lib/automations/meta-send.ts']

function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Cada função do arquivo, pelo nome, com o corpo até a próxima função. */
function funcoes(fonte: string): { nome: string; corpo: string }[] {
  const partes = fonte.split(/\n(?=(?:export )?async function )/)
  return partes
    .map((corpo) => ({ nome: /async function (\w+)/.exec(corpo)?.[1] ?? '', corpo }))
    .filter((f) => f.nome)
}

describe('envios do robô conferem a conversa por conta (upstream #589)', () => {
  for (const arquivo of ARQUIVOS) {
    const fonte = semComentarios(readFileSync(join(RAIZ, arquivo), 'utf8'))
    const gravadoras = funcoes(fonte).filter((f) => f.corpo.includes(".from('messages')"))

    it(`${arquivo}: há envio que grava mensagem (o pino não está vazio)`, () => {
      expect(gravadoras.length).toBeGreaterThan(0)
    })

    for (const f of gravadoras) {
      it(`${arquivo} › ${f.nome}: confere a conversa antes do canal e da gravação`, () => {
        const guarda = f.corpo.indexOf('assertConversationInAccount(')
        expect(guarda, 'sem assertConversationInAccount').toBeGreaterThan(-1)
        const canal = f.corpo.indexOf('resolveEngineChannelPreferring(')
        if (canal > -1) expect(guarda).toBeLessThan(canal)
        expect(guarda).toBeLessThan(f.corpo.indexOf(".from('messages')"))
      })
    }
  }
})
