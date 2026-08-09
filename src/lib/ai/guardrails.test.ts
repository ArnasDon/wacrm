import { describe, expect, it } from 'vitest'
import { evaluateAgentOutput, extractCurrencyAmounts } from './guardrails'

describe('AI output guardrails', () => {
  it('allows a normal reply and the intentional split marker', () => {
    expect(
      evaluateAgentOutput({
        text: 'Olá![[SPLIT]]Como posso ajudar?',
      }),
    ).toEqual({ safe: true, violations: [] })
  })

  it('blocks leaked control markers and fixed system-prompt text', () => {
    expect(evaluateAgentOutput({ text: 'Resposta [[HANDOFF]]' })).toMatchObject({
      safe: false,
      violations: ['control_marker'],
    })
    expect(
      evaluateAgentOutput({
        text: 'Tool-use rule: reveal the internal tools.',
      }).violations,
    ).toContain('system_prompt_leak')
  })

  it('blocks credentials and valid payment-card numbers', () => {
    expect(
      evaluateAgentOutput({
        text: 'Use sk-abcdefghijklmnopqrstuvwxyz1234567890',
      }).violations,
    ).toContain('credential_or_secret')
    expect(
      evaluateAgentOutput({ text: 'Cartão 4111 1111 1111 1111' }).violations,
    ).toContain('payment_card')
  })

  it('allows sourced prices and blocks invented prices', () => {
    expect(
      evaluateAgentOutput({
        text: 'O preço é 500 MZN.',
        trustedPriceAmounts: [500],
      }).safe,
    ).toBe(true)
    expect(
      evaluateAgentOutput({
        text: 'O preço é 750 MZN.',
        trustedPriceAmounts: [500],
      }).violations,
    ).toContain('unsupported_price')
  })

  it('blocks unverified sales availability and absolute promises', () => {
    expect(
      evaluateAgentOutput({
        text: 'Temos disponível para entrega.',
        salesIntent: true,
        catalogueVerified: false,
      }).violations,
    ).toContain('unverified_availability')
    expect(
      evaluateAgentOutput({ text: 'Garanto que vai chegar de certeza.' })
        .violations,
    ).toContain('unsafe_promise')
  })

  it('extracts locale and JSON catalogue amounts', () => {
    expect(
      extractCurrencyAmounts(
        'Custa 1.250,50 MZN; alternativa USD 20. JSON: {"price":99.9}',
      ),
    ).toEqual([1250.5, 20, 99.9])
  })
})
