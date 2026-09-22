import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const troca = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession: troca } }),
}))

import { GET } from './route'

// O pedido como ele chega em produção (medido em 22/09/2026): o standalone
// monta a URL com `0.0.0.0:3000`, e o domínio público vem nos cabeçalhos
// que o Traefik repassa.
function pedido(busca: string) {
  return new NextRequest(`https://0.0.0.0:3000/auth/callback${busca}`, {
    headers: {
      host: 'crm.example.com',
      'x-forwarded-host': 'crm.example.com',
      'x-forwarded-proto': 'https',
    },
  })
}

describe('/auth/callback', () => {
  beforeEach(() => {
    troca.mockReset().mockResolvedValue({ error: null })
  })

  it('⚠️ código válido: vai para o `next` NO DOMÍNIO PÚBLICO, nunca em 0.0.0.0', async () => {
    const r = await GET(pedido('?code=abc&next=/reset-password'))
    expect(troca).toHaveBeenCalledWith('abc')
    expect(r.headers.get('location')).toBe('https://crm.example.com/reset-password')
  })

  it('link vencido ou já usado: volta para "esqueci a senha", também no domínio público', async () => {
    troca.mockResolvedValue({ error: { message: 'expired' } })
    const r = await GET(pedido('?code=abc&next=/reset-password'))
    expect(r.headers.get('location')).toBe('https://crm.example.com/forgot-password?erro=link')
  })

  it('sem código: nem tenta trocar, e volta para "esqueci a senha"', async () => {
    const r = await GET(pedido('?next=/reset-password'))
    expect(troca).not.toHaveBeenCalled()
    expect(r.headers.get('location')).toBe('https://crm.example.com/forgot-password?erro=link')
  })

  it.each(['/.//evil.example', '/..//evil.example', '/%2e%2e//evil.example/x'])(
    '`next` com segmento de ponto (%s) não sai do nosso domínio',
    async (next) => {
      const r = await GET(pedido(`?code=abc&next=${encodeURIComponent(next)}`))
      expect(r.headers.get('location')).toBe('https://crm.example.com/dashboard')
    },
  )

  it('`next` para outro domínio não sai do nosso (open redirect)', async () => {
    const r = await GET(pedido('?code=abc&next=https://evil.example/x'))
    expect(new URL(r.headers.get('location')!).host).toBe('crm.example.com')
  })
})
