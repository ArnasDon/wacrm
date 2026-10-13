import { describe, it, expect, vi } from 'vitest'
import { resolveRecipientJid, BaileysSendError } from './send'

describe('resolveRecipientJid', () => {
  it('resolves Brazilian 9-digit number when WhatsApp has 8-digit legacy JID', async () => {
    const mockSock = {
      onWhatsApp: vi.fn().mockImplementation(async (...numbers: string[]) => {
        // Simulates WhatsApp having the user registered with 8 digits
        return numbers.map((num) => ({
          jid: num.includes('93779871') ? '558393779871@s.whatsapp.net' : null,
          exists: num.includes('93779871'),
        })).filter(r => r.exists)
      }),
    }

    const jid = await resolveRecipientJid(mockSock, '+55 (83) 99377-9871')
    expect(jid).toBe('558393779871@s.whatsapp.net')
    expect(mockSock.onWhatsApp).toHaveBeenCalledWith('5583993779871', '558393779871')
  })

  it('resolves Brazilian 8-digit number when WhatsApp has modern 9-digit JID', async () => {
    const mockSock = {
      onWhatsApp: vi.fn().mockImplementation(async (...numbers: string[]) => {
        return numbers.map((num) => ({
          jid: num.includes('993779871') ? '5583993779871@s.whatsapp.net' : null,
          exists: num.includes('993779871'),
        })).filter(r => r.exists)
      }),
    }

    const jid = await resolveRecipientJid(mockSock, '558393779871')
    expect(jid).toBe('5583993779871@s.whatsapp.net')
    expect(mockSock.onWhatsApp).toHaveBeenCalledWith('5583993779871', '558393779871')
  })

  it('throws BaileysSendError when onWhatsApp confirms number does not exist', async () => {
    const mockSock = {
      onWhatsApp: vi.fn().mockResolvedValue([
        { jid: '5583993779871@s.whatsapp.net', exists: false },
        { jid: '558393779871@s.whatsapp.net', exists: false },
      ]),
    }

    await expect(resolveRecipientJid(mockSock, '5583993779871')).rejects.toThrow(
      BaileysSendError,
    )
  })

  it('falls back to sanitized JID if onWhatsApp query fails or returns empty', async () => {
    const mockSock = {
      onWhatsApp: vi.fn().mockRejectedValue(new Error('Network timeout')),
    }

    const jid = await resolveRecipientJid(mockSock, '5583993779871')
    expect(jid).toBe('5583993779871@s.whatsapp.net')
  })
})
