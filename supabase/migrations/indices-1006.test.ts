import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// A 1006 existe para as duas consultas novas do PR #223. O que este pino cobra
// é o que passa em revisão e some na tela: um índice PARCIAL só é usado quando
// a consulta carrega os MESMOS filtros do predicado — mudar um lado sem o
// outro deixa o índice de pé e inútil, sem erro nenhum.
const sql = fs.readFileSync(path.join(__dirname, '1006_cb_indices_da_estadia_e_da_resposta.sql'), 'utf8')
const fonte = (relativo: string) =>
  fs.readFileSync(path.join(__dirname, '..', '..', 'src', relativo), 'utf8')

describe('1006 — índices das consultas novas do PR #223', () => {
  it('⚠️ o índice parcial de messages ESPELHA os filtros de clienteRespondeuDesde', () => {
    expect(sql).toMatch(
      /create index if not exists messages_cliente_por_gravada_em_idx\s+on public\.messages \(conversation_id, gravada_em desc\)\s+where sender_type = 'customer' and deleted_at is null;/
    )
    const modulo = fonte('lib/automations/parar-se-responder.ts')
    const inicio = modulo.indexOf('export async function clienteRespondeuDesde')
    const corpo = modulo.slice(inicio)
    expect(corpo).toMatch(/\.in\('conversation_id', ids\)/)
    expect(corpo).toMatch(/\.eq\('sender_type', 'customer'\)/)
    expect(corpo).toMatch(/\.is\('deleted_at', null\)/)
    expect(corpo).toMatch(/\.gt\('gravada_em', desde\)/)
  })

  it('os índices da fila de eventos cobrem a estadia por CARD e por CONTATO, na ordem das consultas', () => {
    expect(sql).toMatch(
      /cb_automation_events_por_card_idx\s+on public\.cb_automation_events \(account_id, deal_id, tipo, criado_em desc\)/
    )
    expect(sql).toMatch(
      /cb_automation_events_por_contato_idx\s+on public\.cb_automation_events \(account_id, contact_id, tipo, criado_em desc\)/
    )
    const modulo = fonte('lib/automations/so-na-etapa.ts')
    expect(modulo).toMatch(/\.eq\('deal_id', dealId\)/)
    expect(modulo).toMatch(/\.eq\('contact_id', contactId as string\)/)
    expect(modulo).toMatch(/\.eq\('tipo', 'deal_stage_changed'\)/)
    expect(modulo).toMatch(/\.gt\('criado_em', eventoEm\)/)
  })

  it('a conferência mede o RESULTADO no catálogo (pg_indexes), sem exigir dado', () => {
    expect(sql).toMatch(/from pg_indexes/)
    expect(sql).toMatch(/create index if not exists/)
  })
})
