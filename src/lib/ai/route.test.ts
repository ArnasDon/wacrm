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
      toolKeys: ['search_knowledge', 'handoff_human'],
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
})
