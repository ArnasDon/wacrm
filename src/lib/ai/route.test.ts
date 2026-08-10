import { describe, expect, it } from 'vitest'
import { classifyIntent } from './route'

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

  it('picks the smart model tier for a sales-flavoured message, without gating any tool', () => {
    const route = classifyIntent({
      lastMessageText: 'Têm este produto em azul e qual é o preço?',
    })
    expect(route).toEqual({ intent: 'sales', modelTier: 'smart', forceHandoff: false })
  })

  it('uses the fast tier for a simple greeting and for ambiguous FAQ-shaped messages', () => {
    expect(classifyIntent({ lastMessageText: 'Olá!' })).toMatchObject({
      intent: 'smalltalk',
      modelTier: 'fast',
    })
    expect(
      classifyIntent({ lastMessageText: 'Como funciona a entrega?' }),
    ).toMatchObject({
      intent: 'faq',
      modelTier: 'fast',
    })
  })

  // This router used to also decide which tools the agent could call per
  // intent (a SALES keyword list gating catalogue access). It no longer
  // does — see route.ts's module doc for the live bug that caused (a real
  // shopping conversation about leggings lost catalogue access on every
  // turn because none of "Legging" / "Azul" / "Me mostre as duas opções"
  // matched the keyword list, and the bot handed off on an ordinary
  // follow-up it had no tool left to answer). RouteDecision intentionally
  // carries no tool information anymore — this test guards against that
  // capability-gating pattern quietly creeping back in.
  it('never returns tool information — capability is the account\'s decision alone, not this router\'s', () => {
    for (const message of ['Legging', 'Azul', 'Me mostre as duas opções', 'Quero comprar isto']) {
      const route = classifyIntent({ lastMessageText: message })
      expect(route).not.toHaveProperty('toolKeys')
    }
  })
})
