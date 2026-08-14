import { describe, expect, it } from 'vitest'

import { buildAttribution, referrerDomain } from './attribution'

describe('referrerDomain — el dominio "de donde viene"', () => {
  it('extrae el hostname de un referrer completo', () => {
    expect(referrerDomain('https://www.google.com/search?q=x')).toBe('www.google.com')
    expect(referrerDomain('https://facebook.com/')).toBe('facebook.com')
  })

  it('devuelve undefined con referrer vacío o inválido', () => {
    expect(referrerDomain('')).toBeUndefined()
    expect(referrerDomain('not a url')).toBeUndefined()
  })
})

describe('buildAttribution — fbc/fbp/referrer (loop de conversiones)', () => {
  it('persiste fbc/fbp del DOM y el dominio del referrer', () => {
    const attr = buildAttribution({
      search: '?gclid=Cj0KCQ',
      referrer: 'https://www.facebook.com/?utm_source=fb',
      landingPath: '/landing/implantes/',
      fbc: 'fb.1.1700000000.abcd',
      fbp: 'fb.1.1700000000.1234',
    })
    expect(attr.fbc).toBe('fb.1.1700000000.abcd')
    expect(attr.fbp).toBe('fb.1.1700000000.1234')
    expect(attr.referrer).toBe('www.facebook.com')
  })

  it('sin fbc/fbp en el DOM conserva los persistidos en la cookie', () => {
    const attr = buildAttribution({
      search: '',
      referrer: '',
      landingPath: '/',
      existing: { fbc: 'fb.1.111', fbp: 'fb.1.222', referrer: 'google.com' },
    })
    expect(attr.fbc).toBe('fb.1.111')
    expect(attr.fbp).toBe('fb.1.222')
    expect(attr.referrer).toBe('google.com')
  })

  it('el gclid manda en channel aunque el referrer diga facebook', () => {
    const attr = buildAttribution({
      search: '?gclid=Cj0KCQ',
      referrer: 'https://facebook.com/',
      landingPath: '/',
    })
    expect(attr.channel).toBe('google')
    expect(attr.referrer).toBe('facebook.com')
  })
})