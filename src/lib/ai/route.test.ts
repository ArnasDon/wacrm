import { describe, expect, it } from 'vitest'
import { DEFAULT_AGENT_TOOLS } from './tool-permissions'
import { classifyIntent, routeToolPermissions } from './route'

describe('classifyIntent', () => {
  it('sends an explicit complaint directly to a human', () => {
    expect(
      classifyIntent({
        lastMessageText: 'Isto é inadmissível, quero falar com uma pessoa real.',
      }),
    ).toMatchObject({ intent: 'complaint', forceHandoff: true })
  })

  it('sends a sensitive account mutation directly to a human', () => {
    expect(
      classifyIntent({
        lastMessageText: 'Quero mudar o titular e o IBAN da minha conta.',
      }),
    ).toMatchObject({ intent: 'account', forceHandoff: true })
  })

  it('routes catalogue requests to sales tools', () => {
    const route = classifyIntent({
      lastMessageText: 'Têm este produto em azul e qual é o preço?',
    })
    expect(route).toMatchObject({
      intent: 'sales',
      modelTier: 'smart',
      forceHandoff: false,
    })
    expect(route.toolKeys).toContain('search_catalog')
    expect(route.toolKeys).not.toContain('search_knowledge')
  })

  it('uses no tools for a simple greeting and FAQ tools for ambiguity', () => {
    expect(classifyIntent({ lastMessageText: 'Olá!' })).toMatchObject({
      intent: 'smalltalk',
      modelTier: 'fast',
      toolKeys: [],
    })
    expect(
      classifyIntent({ lastMessageText: 'Como funciona a entrega?' }),
    ).toMatchObject({
      intent: 'faq',
      modelTier: 'fast',
    })
  })

  it('intersects route tools with configured permissions', () => {
    const permissions = {
      ...DEFAULT_AGENT_TOOLS,
      search_catalog: true,
      create_deal: false,
    }
    const routed = routeToolPermissions(
      permissions,
      classifyIntent({ lastMessageText: 'Quero comprar este produto.' }),
    )
    expect(routed.search_catalog).toBe(true)
    expect(routed.create_deal).toBe(false)
    expect(routed.search_knowledge).toBe(false)
  })

  // Regression test for a live bug report: a real shopping conversation
  // ("Legging" -> "Azul" -> "Me mostre as duas opções") never matched the
  // SALES keyword list once — none of those messages contain a listed
  // keyword — so every turn fell through to 'faq' and lost catalogue
  // access, including the final turn, which was a direct follow-up to
  // the bot's own question and had nothing to do with FAQs. The bot had
  // no tool left to fulfil it and handed off to a human unnecessarily.
  it('keeps catalogue tools available on the faq fallback (a keyword list can never cover a business\'s own product vocabulary)', () => {
    for (const message of ['Legging', 'Azul', 'Me mostre as duas opções']) {
      const route = classifyIntent({ lastMessageText: message })
      expect(route.intent).toBe('faq')
      expect(route.toolKeys).toContain('search_catalog')
      expect(route.toolKeys).toContain('send_product')
    }
  })

  it('faq fallback still respects the account\'s own configured permissions — cannot grant what is not configured', () => {
    const permissions = { ...DEFAULT_AGENT_TOOLS, search_catalog: false, send_product: false }
    const routed = routeToolPermissions(
      permissions,
      classifyIntent({ lastMessageText: 'Me mostre as duas opções' }),
    )
    expect(routed.search_catalog).toBe(false)
    expect(routed.send_product).toBe(false)
  })
})
