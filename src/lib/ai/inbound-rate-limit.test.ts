import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  checkPerNumberRateLimit,
  checkNewNumberRateLimit,
  isExemptFromRateLimit,
} from './inbound-rate-limit'

function dbWithRpc(
  impl: (name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>,
): SupabaseClient {
  return { rpc: impl } as unknown as SupabaseClient
}

describe('isExemptFromRateLimit', () => {
  it('isento quando o número está em team_phone_numbers', () => {
    expect(
      isExemptFromRateLimit(
        { teamPhoneNumbers: ['351911111111'], notifyPhoneNumbers: [] },
        '351911111111',
      ),
    ).toBe(true)
  })

  it('isento quando o número está em notify_phone_numbers', () => {
    expect(
      isExemptFromRateLimit(
        { teamPhoneNumbers: [], notifyPhoneNumbers: ['351922222222'] },
        '351922222222',
      ),
    ).toBe(true)
  })

  it('tolera diferença de prefixo de tronco (phonesMatch)', () => {
    expect(
      isExemptFromRateLimit(
        { teamPhoneNumbers: ['+351 91 111 1111'], notifyPhoneNumbers: [] },
        '351911111111',
      ),
    ).toBe(true)
  })

  it('não é isento quando o número não consta em nenhuma lista', () => {
    expect(
      isExemptFromRateLimit(
        { teamPhoneNumbers: ['351911111111'], notifyPhoneNumbers: [] },
        '351900000017',
      ),
    ).toBe(false)
  })

  it('não é isento quando não há número de contacto', () => {
    expect(
      isExemptFromRateLimit(
        { teamPhoneNumbers: ['351911111111'], notifyPhoneNumbers: [] },
        null,
      ),
    ).toBe(false)
  })
})

describe('checkPerNumberRateLimit', () => {
  it('permite quando isento, sem sequer chamar a base de dados', async () => {
    const rpc = vi.fn()
    const decision = await checkPerNumberRateLimit({
      db: dbWithRpc(rpc),
      accountId: 'acct-1',
      phone: '351900000017',
      isExempt: true,
      limitPerMinute: 10,
    })
    expect(decision).toEqual({ allowed: true })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('permite a mensagem 10 (contagem = limite)', async () => {
    const decision = await checkPerNumberRateLimit({
      db: dbWithRpc(async () => ({ data: 10, error: null })),
      accountId: 'acct-1',
      phone: '351900000017',
      isExempt: false,
      limitPerMinute: 10,
    })
    expect(decision.allowed).toBe(true)
  })

  it('bloqueia a mensagem 11 (contagem > limite)', async () => {
    const decision = await checkPerNumberRateLimit({
      db: dbWithRpc(async () => ({ data: 11, error: null })),
      accountId: 'acct-1',
      phone: '351900000017',
      isExempt: false,
      limitPerMinute: 10,
    })
    expect(decision).toEqual({ allowed: false, reason: 'per_number_limit' })
  })

  it('deixa passar quando a base de dados devolve erro', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const decision = await checkPerNumberRateLimit({
      db: dbWithRpc(async () => ({ data: null, error: { message: 'boom' } })),
      accountId: 'acct-1',
      phone: '351900000017',
      isExempt: false,
      limitPerMinute: 10,
    })
    expect(decision).toEqual({ allowed: true })
    errorSpy.mockRestore()
  })

  it('deixa passar quando a chamada lança excepção', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const decision = await checkPerNumberRateLimit({
      db: dbWithRpc(async () => {
        throw new Error('network down')
      }),
      accountId: 'acct-1',
      phone: '351900000017',
      isExempt: false,
      limitPerMinute: 10,
    })
    expect(decision).toEqual({ allowed: true })
    errorSpy.mockRestore()
  })

  it('usa uma chave de bucket por conta+número, truncada ao minuto UTC', async () => {
    const rpc = vi.fn(async () => ({ data: 1, error: null }))
    const now = new Date('2026-09-21T09:30:47.123Z')
    await checkPerNumberRateLimit({
      db: dbWithRpc(rpc),
      accountId: 'acct-1',
      phone: '351900000017',
      isExempt: false,
      limitPerMinute: 10,
      now,
    })
    expect(rpc).toHaveBeenCalledWith('rate_limit_increment_and_check', {
      p_bucket_key: 'msg:acct-1:351900000017',
      p_window_start: '2026-09-21T09:30:00.000Z',
    })
  })
})

describe('checkNewNumberRateLimit', () => {
  it('permite sempre quando não é um contacto novo, sem chamar a base de dados', async () => {
    const rpc = vi.fn()
    const decision = await checkNewNumberRateLimit({
      db: dbWithRpc(rpc),
      accountId: 'acct-1',
      isNewContact: false,
      limitPerHour: 60,
    })
    expect(decision).toEqual({ allowed: true })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('permite o número novo 60 (contagem = limite)', async () => {
    const decision = await checkNewNumberRateLimit({
      db: dbWithRpc(async () => ({ data: 60, error: null })),
      accountId: 'acct-1',
      isNewContact: true,
      limitPerHour: 60,
    })
    expect(decision.allowed).toBe(true)
  })

  it('bloqueia o número novo 61 (contagem > limite)', async () => {
    const decision = await checkNewNumberRateLimit({
      db: dbWithRpc(async () => ({ data: 61, error: null })),
      accountId: 'acct-1',
      isNewContact: true,
      limitPerHour: 60,
    })
    expect(decision).toEqual({ allowed: false, reason: 'new_numbers_limit' })
  })

  it('deixa passar quando a base de dados devolve erro', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const decision = await checkNewNumberRateLimit({
      db: dbWithRpc(async () => ({ data: null, error: { message: 'boom' } })),
      accountId: 'acct-1',
      isNewContact: true,
      limitPerHour: 60,
    })
    expect(decision).toEqual({ allowed: true })
    errorSpy.mockRestore()
  })

  it('usa uma chave de bucket por conta, truncada à hora UTC', async () => {
    const rpc = vi.fn(async () => ({ data: 1, error: null }))
    const now = new Date('2026-09-21T09:30:47.123Z')
    await checkNewNumberRateLimit({
      db: dbWithRpc(rpc),
      accountId: 'acct-1',
      isNewContact: true,
      limitPerHour: 60,
      now,
    })
    expect(rpc).toHaveBeenCalledWith('rate_limit_increment_and_check', {
      p_bucket_key: 'newnum:acct-1',
      p_window_start: '2026-09-21T09:00:00.000Z',
    })
  })
})
