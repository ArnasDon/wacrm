import { afterEach, describe, expect, it } from 'vitest'
import {
  novyraServerConfigured,
  shouldUseNovyraSource,
} from './knowledge-sources'

const ENV_KEYS = [
  'NOVYRA_SUPABASE_URL',
  'NOVYRA_SUPABASE_ANON_KEY',
  'NOVYRA_CRM_USER_EMAIL',
  'NOVYRA_CRM_USER_PASSWORD',
  'NOVYRA_AGENT_CODE',
  'NOVYRA_COUNTRY_CODE',
] as const

const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = original[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('NOVYRA source policy', () => {
  it('does not consult NOVYRA when the source is disabled', () => {
    expect(shouldUseNovyraSource(false, true)).toBe(false)
  })

  it('consults NOVYRA only for the enabled agent', () => {
    const agentAEnabled = true
    const agentBEnabled = false
    expect(shouldUseNovyraSource(agentAEnabled, true)).toBe(true)
    expect(shouldUseNovyraSource(agentBEnabled, true)).toBe(false)
  })

  it('fails safely when server configuration is incomplete', () => {
    expect(shouldUseNovyraSource(true, false)).toBe(false)
  })

  it('requires every server credential before reporting configured', () => {
    for (const key of ENV_KEYS) process.env[key] = 'configured'
    expect(novyraServerConfigured()).toBe(true)
    delete process.env.NOVYRA_CRM_USER_PASSWORD
    expect(novyraServerConfigured()).toBe(false)
  })
})
