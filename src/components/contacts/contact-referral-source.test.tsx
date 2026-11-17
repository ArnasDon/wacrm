import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@app-messages'

import { ContactReferralSourceLine } from './contact-referral-source'

function render(referralSource: unknown, receivedAt: string | null = '2026-11-01T10:00:00.000Z') {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <ContactReferralSourceLine referralSource={referralSource} receivedAt={receivedAt} />
    </NextIntlClientProvider>,
  )
}

describe('ContactReferralSourceLine', () => {
  it('shows the source, headline and date with a safe outbound link', () => {
    const html = render({
      source_type: 'ad',
      source_url: 'https://fb.me/abc',
      headline: 'Spring sale',
    })

    expect(html).toContain('Came from:')
    expect(html).toContain('Ad')
    expect(html).toContain('Spring sale')
    expect(html).toContain('Nov 1, 2026')
    expect(html).toContain('href="https://fb.me/abc"')
    expect(html).toContain('rel="noopener noreferrer nofollow"')
    expect(html).toContain('target="_blank"')
  })

  it('renders no link for an unsafe source URL', () => {
    const html = render({ source_type: 'post', source_url: 'javascript:alert(1)', headline: 'Launch' })

    expect(html).toContain('Post')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('javascript:')
  })

  it('renders nothing for a contact without a referral', () => {
    expect(render(null, null)).toBe('')
  })
})
