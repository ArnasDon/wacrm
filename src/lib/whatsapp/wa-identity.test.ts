import { describe, expect, it } from 'vitest'
import {
  contactHandle,
  hasUsableIdentity,
  identityDisplayName,
  isBusinessScopedUserId,
  resolveContactSendTarget,
  resolveInboundIdentity,
} from './wa-identity'

// The two payload shapes, verbatim from Meta's BSUID docs.
const LEGACY_CONTACT = {
  profile: { name: 'Ada' },
  wa_id: '15551230000',
}

const USERNAME_ONLY_CONTACT = {
  profile: { name: 'Sheena Nelson', username: 'realsheenanelson' },
  user_id: 'US.13491208655302741918',
  parent_user_id: 'US.ENT.11815799212886844830',
}

describe('isBusinessScopedUserId', () => {
  it('accepts both BSUID shapes', () => {
    expect(isBusinessScopedUserId('US.13491208655302741918')).toBe(true)
    expect(isBusinessScopedUserId('US.ENT.11815799212886844830')).toBe(true)
  })

  // The send path picks Meta's `recipient` field over `to` on the
  // strength of this check, so a false positive would misroute a
  // perfectly good phone number.
  it('never mistakes a phone number for a BSUID', () => {
    for (const phone of [
      '15551230000',
      '+1 (555) 123-0000',
      '37063949836',
      '0',
    ]) {
      expect(isBusinessScopedUserId(phone)).toBe(false)
    }
  })

  it('rejects empty and malformed values', () => {
    expect(isBusinessScopedUserId('')).toBe(false)
    expect(isBusinessScopedUserId(null)).toBe(false)
    expect(isBusinessScopedUserId(undefined)).toBe(false)
    expect(isBusinessScopedUserId('US.')).toBe(false)
    expect(isBusinessScopedUserId('USA.1349120865530274')).toBe(false)
    expect(isBusinessScopedUserId('13491208655302741918')).toBe(false)
  })
})

describe('resolveInboundIdentity', () => {
  it('reads the legacy phone-only payload unchanged', () => {
    expect(
      resolveInboundIdentity({ from: '15551230000' }, LEGACY_CONTACT)
    ).toEqual({
      phone: '15551230000',
      waUserId: null,
      waParentUserId: null,
      waUsername: null,
      name: 'Ada',
    })
  })

  it('reads a username-only payload with no phone anywhere', () => {
    expect(
      resolveInboundIdentity(
        {
          from_user_id: 'US.13491208655302741918',
          from_parent_user_id: 'US.ENT.11815799212886844830',
        },
        USERNAME_ONLY_CONTACT
      )
    ).toEqual({
      phone: '',
      waUserId: 'US.13491208655302741918',
      waParentUserId: 'US.ENT.11815799212886844830',
      waUsername: 'realsheenanelson',
      name: 'Sheena Nelson',
    })
  })

  it('keeps both keys during the transition, when Meta sends both', () => {
    const identity = resolveInboundIdentity(
      { from: '16505551234', from_user_id: 'US.13491208655302741918' },
      {
        profile: { name: 'Pablo', username: 'pablomorales' },
        wa_id: '16505551234',
        user_id: 'US.13491208655302741918',
      }
    )
    expect(identity.phone).toBe('16505551234')
    expect(identity.waUserId).toBe('US.13491208655302741918')
    expect(identity.waUsername).toBe('pablomorales')
  })

  it('normalizes the phone the way the DB does', () => {
    expect(
      resolveInboundIdentity({ from: '+1 (555) 123-0000' }).phone
    ).toBe('15551230000')
  })

  it('falls back to the contacts entry when the message omits identity', () => {
    const identity = resolveInboundIdentity({}, USERNAME_ONLY_CONTACT)
    expect(identity.phone).toBe('')
    expect(identity.waUserId).toBe('US.13491208655302741918')
  })

  it('prefers the message-level fields when the two disagree', () => {
    const identity = resolveInboundIdentity(
      { from: '15559990000', from_user_id: 'GB.99999999999999999999' },
      LEGACY_CONTACT
    )
    expect(identity.phone).toBe('15559990000')
    expect(identity.waUserId).toBe('GB.99999999999999999999')
  })

  // A junk value written to `wa_user_id` would become a permanent wrong
  // contact key, so anything not BSUID-shaped is discarded and the
  // phone fallback carries the delivery.
  it('discards a BSUID field that is not BSUID-shaped', () => {
    const identity = resolveInboundIdentity(
      { from: '15551230000', from_user_id: 'not-a-bsuid' },
      LEGACY_CONTACT
    )
    expect(identity.waUserId).toBeNull()
    expect(identity.phone).toBe('15551230000')
  })

  it('strips a leading @ from the username', () => {
    expect(
      resolveInboundIdentity({}, { profile: { username: '@ada' }, wa_id: '1' })
        .waUsername
    ).toBe('ada')
  })

  it('survives a contacts entry that is missing entirely', () => {
    expect(resolveInboundIdentity({ from: '15551230000' })).toEqual({
      phone: '15551230000',
      waUserId: null,
      waParentUserId: null,
      waUsername: null,
      name: '',
    })
  })
})

describe('hasUsableIdentity', () => {
  it('is true with either key', () => {
    expect(
      hasUsableIdentity(resolveInboundIdentity({ from: '15551230000' }))
    ).toBe(true)
    expect(
      hasUsableIdentity(
        resolveInboundIdentity({ from_user_id: 'US.13491208655302741918' })
      )
    ).toBe(true)
  })

  it('is false when Meta sent neither', () => {
    expect(
      hasUsableIdentity(resolveInboundIdentity({}, { profile: { name: 'Ada' } }))
    ).toBe(false)
  })
})

describe('identityDisplayName', () => {
  it('walks name → username → phone → BSUID', () => {
    expect(
      identityDisplayName(
        resolveInboundIdentity({ from: '15551230000' }, LEGACY_CONTACT)
      )
    ).toBe('Ada')

    expect(
      identityDisplayName(
        resolveInboundIdentity(
          { from: '15551230000' },
          { profile: { username: 'ada' }, wa_id: '15551230000' }
        )
      )
    ).toBe('ada')

    expect(identityDisplayName(resolveInboundIdentity({ from: '15551230000' }))).toBe(
      '15551230000'
    )

    expect(
      identityDisplayName(
        resolveInboundIdentity({ from_user_id: 'US.13491208655302741918' })
      )
    ).toBe('US.13491208655302741918')
  })
})

describe('resolveContactSendTarget', () => {
  it('prefers a usable phone number', () => {
    expect(
      resolveContactSendTarget({
        phone: '+1 (555) 123-0000',
        wa_user_id: 'US.13491208655302741918',
      })
    ).toEqual({ target: '15551230000', isPhone: true })
  })

  it('falls back to the BSUID when there is no phone', () => {
    expect(
      resolveContactSendTarget({
        phone: '',
        wa_user_id: 'US.13491208655302741918',
      })
    ).toEqual({ target: 'US.13491208655302741918', isPhone: false })
  })

  it('falls back to the BSUID when the phone is unusable', () => {
    // Too short to be E.164 — the old code sent it to Meta anyway.
    expect(
      resolveContactSendTarget({
        phone: '123',
        wa_user_id: 'US.13491208655302741918',
      })
    ).toEqual({ target: 'US.13491208655302741918', isPhone: false })
  })

  it('returns null when there is nothing to address', () => {
    expect(resolveContactSendTarget({ phone: '' })).toBeNull()
    expect(resolveContactSendTarget({ phone: '123' })).toBeNull()
    expect(resolveContactSendTarget(null)).toBeNull()
    expect(resolveContactSendTarget(undefined)).toBeNull()
  })

  it('refuses a wa_user_id that is not BSUID-shaped', () => {
    expect(
      resolveContactSendTarget({ phone: '', wa_user_id: 'garbage' })
    ).toBeNull()
  })
})

describe('contactHandle', () => {
  it('shows the phone when there is one', () => {
    expect(contactHandle({ phone: '+15551230000' })).toBe('+15551230000')
  })

  it('shows @username for a contact with no phone', () => {
    expect(
      contactHandle({ phone: '', wa_username: 'realsheenanelson' })
    ).toBe('@realsheenanelson')
  })

  it('falls back to the BSUID rather than rendering a blank row', () => {
    expect(
      contactHandle({ phone: '', wa_user_id: 'US.13491208655302741918' })
    ).toBe('US.13491208655302741918')
  })

  it('is empty only when the contact carries no identity at all', () => {
    expect(contactHandle({})).toBe('')
    expect(contactHandle({ phone: null, wa_username: null, wa_user_id: null })).toBe('')
  })
})
