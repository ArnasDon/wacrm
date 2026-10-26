import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  sendMediaMessage,
  sendTemplateMessage,
  sendTextMessage,
} from './meta-api'

/**
 * Meta addresses a send by EITHER `to` + `recipient_type` (phone
 * number) or `recipient` (business-scoped user ID) — never both. A
 * contact who has adopted a WhatsApp username has no phone number for
 * us to put in `to`, so the send helpers have to switch fields based on
 * the identifier they're handed (issue #519).
 *
 * Docs: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/
 */

let captured: Record<string, unknown> | null = null

function captureFetch() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    captured = JSON.parse(String(init.body))
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.OK' }] }), {
      status: 200,
    })
  })
}

const BASE = { phoneNumberId: 'pn-1', accessToken: 'tok' } as const
const BSUID = 'US.13491208655302741918'
const PARENT_BSUID = 'US.ENT.11815799212886844830'

beforeEach(() => {
  captured = null
  vi.stubGlobal('fetch', captureFetch())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('phone recipients keep the legacy envelope', () => {
  it('sendTextMessage uses to + recipient_type', async () => {
    await sendTextMessage({ ...BASE, to: '15551230000', text: 'hi' })
    expect(captured).toMatchObject({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '15551230000',
    })
    expect(captured).not.toHaveProperty('recipient')
  })

  it('sendMediaMessage uses to + recipient_type', async () => {
    await sendMediaMessage({
      ...BASE,
      to: '15551230000',
      kind: 'image',
      link: 'https://cdn.test/a.jpg',
    })
    expect(captured).toMatchObject({ to: '15551230000' })
    expect(captured).not.toHaveProperty('recipient')
  })

  it('sendTemplateMessage uses to + recipient_type', async () => {
    await sendTemplateMessage({ ...BASE, to: '15551230000', templateName: 'hi' })
    expect(captured).toMatchObject({ to: '15551230000' })
    expect(captured).not.toHaveProperty('recipient')
  })
})

describe('BSUID recipients switch to Meta`s `recipient` field', () => {
  it('sendTextMessage sends recipient and drops to/recipient_type', async () => {
    await sendTextMessage({ ...BASE, to: BSUID, text: 'hi' })
    expect(captured).toMatchObject({
      messaging_product: 'whatsapp',
      recipient: BSUID,
      type: 'text',
    })
    // Sending both is a 400 from Meta.
    expect(captured).not.toHaveProperty('to')
    expect(captured).not.toHaveProperty('recipient_type')
  })

  it('sendMediaMessage sends recipient', async () => {
    await sendMediaMessage({
      ...BASE,
      to: BSUID,
      kind: 'document',
      link: 'https://cdn.test/a.pdf',
      filename: 'a.pdf',
    })
    expect(captured).toMatchObject({ recipient: BSUID, type: 'document' })
    expect(captured).not.toHaveProperty('to')
  })

  it('sendTemplateMessage sends recipient', async () => {
    await sendTemplateMessage({ ...BASE, to: BSUID, templateName: 'hi' })
    expect(captured).toMatchObject({ recipient: BSUID, type: 'template' })
    expect(captured).not.toHaveProperty('to')
  })

  it('accepts a parent BSUID too', async () => {
    await sendTextMessage({ ...BASE, to: PARENT_BSUID, text: 'hi' })
    expect(captured).toMatchObject({ recipient: PARENT_BSUID })
    expect(captured).not.toHaveProperty('to')
  })

  it('leaves the rest of the payload untouched', async () => {
    await sendTextMessage({
      ...BASE,
      to: BSUID,
      text: 'hi',
      contextMessageId: 'wamid.PARENT',
    })
    expect(captured).toMatchObject({
      recipient: BSUID,
      text: { body: 'hi' },
      context: { message_id: 'wamid.PARENT' },
    })
  })
})
