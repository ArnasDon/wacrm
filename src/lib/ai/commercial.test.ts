import { describe, it, expect } from 'vitest'
import {
  personaFromAdId,
  buildCommercialAdOpeningMessage,
  COMMERCIAL_AD_PERSONA_BY_AD_ID,
} from './commercial'

// ============================================================
// Abertura por persona (Ricardo, 24/09/2026) — mapeamento ad_id →
// persona e texto de abertura da primeira mensagem de uma conversa
// vinda de anúncio. Ver src/lib/ai/commercial.ts e
// dispatchInboundToAiReply (auto-reply.ts) para onde isto é usado.
// ============================================================

describe('personaFromAdId', () => {
  it('mapeia os anúncios actuais de CEO', () => {
    expect(personaFromAdId('120249664433370585')).toBe('ceo')
    expect(personaFromAdId('120249685585350585')).toBe('ceo')
  })

  it('mapeia o anúncio actual de director comercial', () => {
    expect(personaFromAdId('120249664433640585')).toBe('director_comercial')
  })

  it('mapeia o anúncio actual de empresário', () => {
    expect(personaFromAdId('120249664434280585')).toBe('empresario')
  })

  it('mapeia também os anúncios antigos ainda em posts activos', () => {
    expect(personaFromAdId('120249645217990585')).toBe('ceo')
    expect(personaFromAdId('120249645233150585')).toBe('director_comercial')
    expect(personaFromAdId('120249645233480585')).toBe('empresario')
  })

  it('devolve null para um ad_id desconhecido', () => {
    expect(personaFromAdId('000000000000000000')).toBeNull()
  })

  it('devolve null sem ad_id (null ou undefined)', () => {
    expect(personaFromAdId(null)).toBeNull()
    expect(personaFromAdId(undefined)).toBeNull()
  })
})

describe('buildCommercialAdOpeningMessage', () => {
  it('usa a pergunta de CEO para um ad_id de CEO', () => {
    const text = buildCommercialAdOpeningMessage('120249664433370585')
    expect(text).toContain('Sou o agente da Eter Growth')
    expect(text).toContain('é o responsável máximo da empresa, ou trata disto outra pessoa?')
  })

  it('usa a pergunta de director comercial para esse ad_id', () => {
    const text = buildCommercialAdOpeningMessage('120249664433640585')
    expect(text).toContain('é quem lidera a equipa comercial, ou trata disto outra pessoa?')
  })

  it('usa a pergunta de empresário para esse ad_id', () => {
    const text = buildCommercialAdOpeningMessage('120249664434280585')
    expect(text).toContain('a empresa é sua, ou trata disto outra pessoa?')
  })

  it('usa a pergunta genérica sem ad_id', () => {
    const text = buildCommercialAdOpeningMessage(null)
    expect(text).toContain('é o responsável comercial da empresa, ou trata disto por outra via?')
  })

  it('usa a pergunta genérica com um ad_id não mapeado', () => {
    const text = buildCommercialAdOpeningMessage('999999999999999999')
    expect(text).toContain('é o responsável comercial da empresa, ou trata disto por outra via?')
  })

  it('trata sempre por você, nunca por tu, e não usa travessão', () => {
    for (const adId of [null, ...Object.keys(COMMERCIAL_AD_PERSONA_BY_AD_ID)]) {
      const text = buildCommercialAdOpeningMessage(adId)
      expect(text).not.toMatch(/\btu\b/i)
      expect(text).not.toContain('—')
    }
  })
})
