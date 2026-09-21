import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ============================================================
// QUEM reabre uma conversa encerrada — a decisão de produto, travada
// estruturalmente (o mesmo desenho de `pipeline-routing.chamadores.test.ts`).
//
// A regra é "qualquer mensagem de GENTE, nos dois sentidos, devolve a
// conversa à caixa de entrada". O bug de origem (2026-09-02): o helper existia
// desde o upstream (#409) e só o webhook da META o chamava — produção roda
// Evolution, então a regra não valia para nenhuma mensagem real, e uma
// conversa encerrada acumulava resposta do cliente fora da caixa. Teste de
// comportamento com mock não pega "esqueci de chamar"; ler o fonte pega.
// ============================================================

const raiz = path.join(__dirname, '..', '..')

/** Fonte sem comentários — os arquivos citam o helper ao EXPLICAR decisões. */
function fonte(relativo: string): string {
  return fs
    .readFileSync(path.join(raiz, relativo), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

describe('reabre: os caminhos de mensagem decididos por gente', () => {
  const DEVEM_REABRIR = [
    { arquivo: 'app/api/whatsapp/webhook/route.ts', quem: 'ingestão (Meta)' },
    { arquivo: 'lib/whatsapp/inbound-store.ts', quem: 'ingestão + celular pareado (Evolution)' },
    { arquivo: 'lib/whatsapp/send-message.ts', quem: 'núcleo de envio (compositor, ficha, agendada, API v1)' },
    { arquivo: 'lib/instagram/persistir.ts', quem: 'ingestão (Instagram Direct)' },
    // A mensagem recuperada sem telefone que AINDA é a última da conversa
    // (1010): quem encerrou o fez sem vê-la. A histórica comum não reabre —
    // ver `sem-telefone/modo.ts`.
    { arquivo: 'lib/whatsapp/sem-telefone/tardia.ts', quem: 'recuperada tardia, ainda a última (Evolution)' },
  ]

  for (const { arquivo, quem } of DEVEM_REABRIR) {
    it(`${quem} chama reopenClosedConversation`, () => {
      expect(fonte(arquivo)).toContain('reopenClosedConversation')
    })
  }

  // Duas funções no mesmo arquivo, e a do celular pareado é a que carrega o
  // volume real (1.041 mensagens contra 8 pelo CRM). Afirmar sobre o ARQUIVO
  // deixaria passar o esquecimento numa das duas.
  it('as DUAS funções do inbound-store reabrem — ingestão e celular pareado', () => {
    const src = fonte('lib/whatsapp/inbound-store.ts')
    const inicio = src.indexOf('export async function persistDeviceMessage')
    const fim = src.indexOf('export async function persistInboundMessage')
    expect(inicio).toBeGreaterThan(-1)
    expect(fim).toBeGreaterThan(inicio)
    expect(src.slice(inicio, fim)).toContain('reopenClosedConversation')
    expect(src.slice(fim)).toContain('reopenClosedConversation')
  })

  it('a reabertura NÃO confia no status que o chamador leu (Codex, PR #232)', () => {
    // O atalho `if (conversation.status !== 'closed') return false` lia a
    // linha carregada no começo da requisição: um encerramento no meio fazia
    // a mensagem nova cair numa conversa encerrada sem reabri-la. Quem decide
    // é o UPDATE condicional (`.eq('status', 'closed')`), sempre.
    const src = fonte('lib/conversations/reopen.ts')
    expect(src).not.toMatch(/conversation\.status/)
    expect(src).toMatch(/\.eq\('status', 'closed'\)/)
  })

  it('o núcleo de envio reabre ATRIBUINDO a quem enviou', () => {
    // A regra do operador: quem reabre fica responsável. `senderUserId` é
    // nulo no envio por chave de API, e aí não há quem nomear.
    expect(fonte('lib/whatsapp/send-message.ts')).toMatch(
      /reopenClosedConversation\([\s\S]{0,200}assignTo:\s*senderUserId/,
    )
  })
})

describe('NÃO reabre: disparo em massa e resposta de robô', () => {
  // Não são omissões: um broadcast para 500 encerradas devolveria as 500 à
  // caixa de uma vez, e "o robô respondeu" não é gente retomando um
  // atendimento. Se o cliente responder, a mensagem DELE reabre.
  const NAO_PODEM = [
    { arquivo: 'lib/whatsapp/broadcast-core.ts', quem: 'broadcast' },
    { arquivo: 'lib/whatsapp/broadcast-resume.ts', quem: 'retomada de broadcast' },
    { arquivo: 'lib/flows/meta-send.ts', quem: 'fluxo/IA/automação (o sender real)' },
    { arquivo: 'lib/automations/meta-send.ts', quem: 'automação (wrapper)' },
    { arquivo: 'lib/cb-channels/engine-send.ts', quem: 'resolução de canal do motor' },
    { arquivo: 'lib/cb-groups/persist.ts', quem: 'grupo (não encerra, não reabre)' },
  ]

  for (const { arquivo, quem } of NAO_PODEM) {
    it(`${quem} não chama reopenClosedConversation`, () => {
      expect(fonte(arquivo)).not.toContain('reopenClosedConversation')
    })
  }
})
