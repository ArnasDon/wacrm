import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTwentyPerson, TwentyNotConfiguredError } from './twenty-client'

const ORIGINAL_ENV = { ...process.env }

function mockFetchOk(body: Record<string, unknown>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  })
}

describe('createTwentyPerson', () => {
  beforeEach(() => {
    process.env.TWENTY_BASE_URL = 'https://crm.example.com'
    process.env.TWENTY_API_KEY = 'test-key'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.restoreAllMocks()
  })

  it('separa indicativo e número nacional para um número português', async () => {
    const fetchMock = mockFetchOk({ data: { createPerson: { id: 'person-1' } } })
    vi.stubGlobal('fetch', fetchMock)

    await createTwentyPerson({ name: 'Lead Teste', phone: '351939000016' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.phones).toEqual({
      primaryPhoneNumber: '939000016',
      primaryPhoneCountryCode: '',
      primaryPhoneCallingCode: '+351',
      additionalPhones: [],
    })
  })

  it('assume +351 quando o número não tem indicativo conhecido', async () => {
    const fetchMock = mockFetchOk({ data: { createPerson: { id: 'person-2' } } })
    vi.stubGlobal('fetch', fetchMock)

    await createTwentyPerson({ name: 'Lead Sem Indicativo', phone: '939000016' })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.phones.primaryPhoneCallingCode).toBe('+351')
    expect(body.phones.primaryPhoneNumber).toBe('939000016')
  })

  it('nunca envia o número completo com indicativo dentro de primaryPhoneNumber', async () => {
    const fetchMock = mockFetchOk({ data: { createPerson: { id: 'person-3' } } })
    vi.stubGlobal('fetch', fetchMock)

    await createTwentyPerson({ name: 'Lead', phone: '351939000016' })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.phones.primaryPhoneNumber).not.toBe('351939000016')
  })

  it('lança TwentyNotConfiguredError quando faltam as credenciais', async () => {
    delete process.env.TWENTY_BASE_URL
    delete process.env.TWENTY_API_KEY
    await expect(
      createTwentyPerson({ name: 'Lead', phone: '351939000016' }),
    ).rejects.toBeInstanceOf(TwentyNotConfiguredError)
  })

  it('lança erro com o corpo da resposta quando o Twenty devolve não-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () =>
        Promise.resolve(
          '{"statusCode":400,"error":"Error","messages":["Provided phone number is invalid 351939000016"],"code":"INVALID_PHONE_NUMBER"}',
        ),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      createTwentyPerson({ name: 'Lead', phone: '351939000016' }),
    ).rejects.toThrow(/INVALID_PHONE_NUMBER/)
  })
})
