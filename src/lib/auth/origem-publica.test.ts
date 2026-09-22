import { describe, expect, it } from 'vitest'

import { origemPublica } from './origem-publica'

// A URL que o standalone monta em produção (medido em 22/09/2026).
const DE_DENTRO = new URL('https://0.0.0.0:3000/auth/callback?code=x')

describe('origemPublica', () => {
  it('⚠️ atrás do proxy, a origem é o domínio público — nunca 0.0.0.0', () => {
    const h = new Headers({
      host: 'crm.example.com',
      'x-forwarded-host': 'crm.example.com',
      'x-forwarded-proto': 'https',
    })
    expect(origemPublica(h, DE_DENTRO)).toBe('https://crm.example.com')
  })

  it('só com o Host, o protocolo vem do pedido', () => {
    const h = new Headers({ host: 'crm.example.com' })
    expect(origemPublica(h, DE_DENTRO)).toBe('https://crm.example.com')
  })

  it('cabeçalho em lista: vale o primeiro', () => {
    const h = new Headers({
      'x-forwarded-host': 'crm.example.com, proxy.interno',
      'x-forwarded-proto': 'https, http',
    })
    expect(origemPublica(h, DE_DENTRO)).toBe('https://crm.example.com')
  })

  it('no next dev, sem proxy: o localhost e o http do pedido', () => {
    const h = new Headers({ host: 'localhost:3000' })
    expect(origemPublica(h, new URL('http://localhost:3000/auth/callback'))).toBe(
      'http://localhost:3000',
    )
  })

  it('sem cabeçalho nenhum, cai na URL do pedido', () => {
    expect(origemPublica(new Headers(), DE_DENTRO)).toBe('https://0.0.0.0:3000')
  })
})
