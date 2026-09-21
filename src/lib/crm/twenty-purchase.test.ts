import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// Coverage for twenty-purchase.ts (Bloco 5):
//   - mapeamento de fase: só `stage === 'CLIENTE'` dispara o Purchase
//   - sem pointOfContactId → skip
//   - sem conversa correspondente (crm_person_id) → skip, nada enviado
//   - com ctwa_clid → caminho 'ctwa' (ctwa_clid + waba_id)
//   - sem ctwa_clid → caminho 'system_generated' (email/telefone
//     hasheados a partir da pessoa no Twenty)
//   - sem email nem telefone no Twenty → skip
// ============================================================

const h = vi.hoisted(() => ({
  getTwentyPerson: vi.fn(),
  sendPurchaseCapiEvent: vi.fn(),
}))
vi.mock('./twenty-client', () => ({ getTwentyPerson: h.getTwentyPerson }))
vi.mock('@/lib/meta/conversions-api', () => ({ sendPurchaseCapiEvent: h.sendPurchaseCapiEvent }))

import { handleOpportunityWon, isWonStage } from './twenty-purchase'

interface Row {
  data: unknown
  error: unknown
}

function makeDb(opts: { conversation?: Row; wabaConfig?: Row }) {
  const {
    conversation = { data: { id: 'conv-1', account_id: 'acct-1', ctwa_clid: 'clid-123' }, error: null },
    wabaConfig = { data: { waba_id: 'waba-1' }, error: null },
  } = opts

  const db = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            if (table === 'conversations') return Promise.resolve(conversation)
            if (table === 'whatsapp_config') return Promise.resolve(wabaConfig)
            return Promise.resolve({ data: null, error: null })
          },
        }),
      }),
    }),
  }
  return db
}

const BASE_ARGS = {
  opportunityId: 'opp-1',
  amountMicros: 500_000_000,
  currencyCode: 'EUR',
  pointOfContactId: 'person-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.sendPurchaseCapiEvent.mockResolvedValue(undefined)
})

describe('isWonStage', () => {
  it('só CLIENTE conta como ganho', () => {
    expect(isWonStage('CLIENTE')).toBe(true)
    expect(isWonStage('PROPOSTA')).toBe(false)
    expect(isWonStage('PERDIDO')).toBe(false)
    expect(isWonStage(null)).toBe(false)
    expect(isWonStage(undefined)).toBe(false)
  })
})

describe('handleOpportunityWon', () => {
  it('ignora fases que não são CLIENTE, sem tocar na base de dados nem na Meta', async () => {
    const db = makeDb({})
    const result = await handleOpportunityWon({ db: db as never, stage: 'PROPOSTA', ...BASE_ARGS })
    expect(result).toEqual({ outcome: 'skipped', reason: 'not_won_stage' })
    expect(h.sendPurchaseCapiEvent).not.toHaveBeenCalled()
  })

  it('ignora quando não há pointOfContactId', async () => {
    const db = makeDb({})
    const result = await handleOpportunityWon({ db: db as never, stage: 'CLIENTE', ...BASE_ARGS, pointOfContactId: null })
    expect(result).toEqual({ outcome: 'skipped', reason: 'no_point_of_contact' })
    expect(h.sendPurchaseCapiEvent).not.toHaveBeenCalled()
  })

  it('ignora quando não há conversa ligada a esta pessoa (crm_person_id não encontrado)', async () => {
    const db = makeDb({ conversation: { data: null, error: null } })
    const result = await handleOpportunityWon({ db: db as never, stage: 'CLIENTE', ...BASE_ARGS })
    expect(result).toEqual({ outcome: 'skipped', reason: 'no_matching_conversation' })
    expect(h.sendPurchaseCapiEvent).not.toHaveBeenCalled()
  })

  it('caminho ctwa: conversa com ctwa_clid envia Purchase com ctwa_clid + waba_id, sem consultar o Twenty', async () => {
    const db = makeDb({})
    const result = await handleOpportunityWon({ db: db as never, stage: 'CLIENTE', ...BASE_ARGS })
    expect(result).toEqual({ outcome: 'sent', userDataKind: 'ctwa' })
    expect(h.getTwentyPerson).not.toHaveBeenCalled()
    expect(h.sendPurchaseCapiEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        conversationId: 'conv-1',
        opportunityId: 'opp-1',
        amountEur: 500,
        currencyCode: 'EUR',
        userData: { kind: 'ctwa', ctwaClid: 'clid-123', wabaId: 'waba-1' },
      }),
    )
  })

  it('ignora o caminho ctwa quando a conta não tem waba_id configurado', async () => {
    const db = makeDb({ wabaConfig: { data: null, error: null } })
    const result = await handleOpportunityWon({ db: db as never, stage: 'CLIENTE', ...BASE_ARGS })
    expect(result).toEqual({ outcome: 'skipped', reason: 'waba_id_not_found' })
    expect(h.sendPurchaseCapiEvent).not.toHaveBeenCalled()
  })

  it('caminho system_generated: sem ctwa_clid, busca a pessoa no Twenty e envia email/telefone hasheados', async () => {
    const db = makeDb({ conversation: { data: { id: 'conv-1', account_id: 'acct-1', ctwa_clid: null }, error: null } })
    h.getTwentyPerson.mockResolvedValue({ id: 'person-1', email: 'Teste@Exemplo.com', phone: '351939000016' })

    const result = await handleOpportunityWon({ db: db as never, stage: 'CLIENTE', ...BASE_ARGS })
    expect(result).toEqual({ outcome: 'sent', userDataKind: 'system_generated' })
    expect(h.getTwentyPerson).toHaveBeenCalledWith('person-1')

    const call = h.sendPurchaseCapiEvent.mock.calls[0][0]
    expect(call.userData.kind).toBe('system_generated')
    // SHA-256 de "teste@exemplo.com" (lowercase/trim) e "351939000016" —
    // não repetir o hash aqui pixel a pixel, só confirmar a forma e que
    // não vai em claro.
    expect(call.userData.emailHash).toMatch(/^[a-f0-9]{64}$/)
    expect(call.userData.phoneHash).toMatch(/^[a-f0-9]{64}$/)
    expect(call.userData.emailHash).not.toContain('exemplo.com')
  })

  it('caminho system_generated: sem email nem telefone no Twenty → skip, sem enviar nada', async () => {
    const db = makeDb({ conversation: { data: { id: 'conv-1', account_id: 'acct-1', ctwa_clid: null }, error: null } })
    h.getTwentyPerson.mockResolvedValue({ id: 'person-1', email: null, phone: null })

    const result = await handleOpportunityWon({ db: db as never, stage: 'CLIENTE', ...BASE_ARGS })
    expect(result).toEqual({ outcome: 'skipped', reason: 'no_email_or_phone' })
    expect(h.sendPurchaseCapiEvent).not.toHaveBeenCalled()
  })

  it('caminho system_generated: pessoa não encontrada no Twenty (null) → skip', async () => {
    const db = makeDb({ conversation: { data: { id: 'conv-1', account_id: 'acct-1', ctwa_clid: null }, error: null } })
    h.getTwentyPerson.mockResolvedValue(null)

    const result = await handleOpportunityWon({ db: db as never, stage: 'CLIENTE', ...BASE_ARGS })
    expect(result).toEqual({ outcome: 'skipped', reason: 'no_email_or_phone' })
    expect(h.sendPurchaseCapiEvent).not.toHaveBeenCalled()
  })

  it('caminho system_generated: falha ao ler a pessoa no Twenty → skip, nunca lança', async () => {
    const db = makeDb({ conversation: { data: { id: 'conv-1', account_id: 'acct-1', ctwa_clid: null }, error: null } })
    h.getTwentyPerson.mockRejectedValue(new Error('network error'))

    const result = await handleOpportunityWon({ db: db as never, stage: 'CLIENTE', ...BASE_ARGS })
    expect(result).toEqual({ outcome: 'skipped', reason: 'twenty_person_lookup_failed' })
    expect(h.sendPurchaseCapiEvent).not.toHaveBeenCalled()
  })
})
