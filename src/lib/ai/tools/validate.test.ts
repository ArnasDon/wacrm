import { describe, it, expect } from 'vitest'
import { validateToolConfig } from './validate'

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    name: 'check_stock',
    description: 'Checks stock for a SKU',
    method: 'GET',
    url: 'https://api.example.com/stock',
    auth_type: 'none',
    parameters: [],
    ...overrides,
  }
}

describe('validateToolConfig', () => {
  it('accepts a minimal valid config', () => {
    expect(validateToolConfig(baseConfig(), { requireSecret: false })).toEqual([])
  })

  it('rejects an invalid name', () => {
    const issues = validateToolConfig(baseConfig({ name: 'Check Stock!' }), {
      requireSecret: false,
    })
    expect(issues.map((i) => i.path)).toContain('name')
  })

  it('requires a description', () => {
    const issues = validateToolConfig(baseConfig({ description: '' }), {
      requireSecret: false,
    })
    expect(issues.map((i) => i.path)).toContain('description')
  })

  it('rejects an unknown method', () => {
    const issues = validateToolConfig(baseConfig({ method: 'TRACE' }), {
      requireSecret: false,
    })
    expect(issues.map((i) => i.path)).toContain('method')
  })

  it('rejects a non-http(s) URL', () => {
    const issues = validateToolConfig(baseConfig({ url: 'ftp://example.com' }), {
      requireSecret: false,
    })
    expect(issues.map((i) => i.path)).toContain('url')
  })

  it('rejects a malformed URL', () => {
    const issues = validateToolConfig(baseConfig({ url: 'not a url' }), {
      requireSecret: false,
    })
    expect(issues.map((i) => i.path)).toContain('url')
  })

  it('requires a credential when requireSecret is true', () => {
    const issues = validateToolConfig(baseConfig({ auth_type: 'bearer' }), {
      requireSecret: true,
    })
    expect(issues.map((i) => i.path)).toContain('auth_secret')
  })

  it('does not require a credential when one is already stored', () => {
    const issues = validateToolConfig(baseConfig({ auth_type: 'bearer' }), {
      requireSecret: false,
    })
    expect(issues.map((i) => i.path)).not.toContain('auth_secret')
  })

  it('requires a header name for api_key auth', () => {
    const issues = validateToolConfig(
      baseConfig({ auth_type: 'api_key', auth_secret: 'x' }),
      { requireSecret: false },
    )
    expect(issues.map((i) => i.path)).toContain('auth_header_name')
  })

  it('rejects duplicate parameter names', () => {
    const issues = validateToolConfig(
      baseConfig({
        parameters: [
          { name: 'sku', in: 'query', type: 'string', required: true },
          { name: 'sku', in: 'body', type: 'string', required: false },
        ],
      }),
      { requireSecret: false },
    )
    expect(issues.some((i) => i.path === 'parameters[1].name')).toBe(true)
  })

  it('rejects an unknown parameter location or type', () => {
    const issues = validateToolConfig(
      baseConfig({
        parameters: [{ name: 'sku', in: 'nowhere', type: 'object', required: true }],
      }),
      { requireSecret: false },
    )
    expect(issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(['parameters[0].in', 'parameters[0].type']),
    )
  })

  it('caps the number of parameters', () => {
    const parameters = Array.from({ length: 21 }, (_, i) => ({
      name: `p${i}`,
      in: 'query',
      type: 'string',
      required: false,
    }))
    const issues = validateToolConfig(baseConfig({ parameters }), { requireSecret: false })
    expect(issues.map((i) => i.path)).toContain('parameters')
  })
})
