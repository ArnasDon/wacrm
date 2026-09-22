import { describe, expect, it } from 'vitest'

import { DESTINO_PADRAO, destinoSeguro } from './destino-seguro'

describe('destinoSeguro', () => {
  it('aceita caminho relativo deste site', () => {
    expect(destinoSeguro('/reset-password')).toBe('/reset-password')
    expect(destinoSeguro('/inbox?c=abc')).toBe('/inbox?c=abc')
    expect(destinoSeguro('/settings#perfis')).toBe('/settings#perfis')
  })

  it('cai no padrão quando não veio nada', () => {
    expect(destinoSeguro(null)).toBe(DESTINO_PADRAO)
    expect(destinoSeguro(undefined)).toBe(DESTINO_PADRAO)
    expect(destinoSeguro('')).toBe(DESTINO_PADRAO)
    expect(destinoSeguro('   ')).toBe(DESTINO_PADRAO)
  })

  // As quatro formas que uma checagem por `startsWith('/')` deixaria passar.
  it.each([
    ['protocol-relative', '//evil.example'],
    ['barra invertida normalizada', '/\\evil.example'],
    ['URL absoluta', 'https://evil.example/x'],
    ['esquema sem host', 'javascript:alert(1)'],
  ])('recusa saída do domínio: %s', (_nome, entrada) => {
    expect(destinoSeguro(entrada)).toBe(DESTINO_PADRAO)
  })

  // Segmento de ponto: resolve DENTRO da base (a origem confere) e deixa
  // `//evil.example`, que o redirecionamento leria como outro host.
  it.each([
    '/.//evil.example',
    '/..//evil.example',
    '/%2e//evil.example',
    '/%2e%2e//evil.example',
    '/a/..//evil.example',
    '/././/evil.example/x?y=1',
  ])('recusa segmento de ponto que vira //: %s', (entrada) => {
    expect(destinoSeguro(entrada)).toBe(DESTINO_PADRAO)
  })

  it('barra dupla NO MEIO do caminho continua sendo caminho nosso', () => {
    expect(destinoSeguro('/inbox//x')).toBe('/inbox//x')
  })

  it('recusa caractere de controle', () => {
    expect(destinoSeguro('/a\nb')).toBe(DESTINO_PADRAO)
    expect(destinoSeguro('/a\rb')).toBe(DESTINO_PADRAO)
    expect(destinoSeguro('/a\tb')).toBe(DESTINO_PADRAO)
  })

  it('recusa caminho que não começa com barra', () => {
    expect(destinoSeguro('dashboard')).toBe(DESTINO_PADRAO)
    expect(destinoSeguro('../etc')).toBe(DESTINO_PADRAO)
  })

  it('não é enganado por barra percent-encoded', () => {
    // `%2f` NÃO é decodificado antes de resolver, então isto continua
    // sendo um caminho nosso — e tem de passar, senão a função estaria
    // recusando destino legítimo por medo de um vetor que não existe.
    expect(destinoSeguro('/%2f%2fevil.example')).toBe('/%2f%2fevil.example')
  })
})
