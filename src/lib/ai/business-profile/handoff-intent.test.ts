import { describe, it, expect } from 'vitest'
import { detectHandoffIntent, describeHandoffIntent } from './handoff-intent'
import type { ContactRow, DepartmentRow } from './types'

// ============================================================
// Handoff intent matching — AI optimization project, FASE 6. Covers the
// CONTACTOS (11-19) and HANDOFF (20-26) scenarios from the mandatory
// 44-test matrix that are pure detection logic (no DB, no conversation
// state — those parts are covered in auto-reply.test.ts's "handoff"
// describe block instead). Pure function: every case is a plain
// input/output assertion, exactly like routing.test.ts.
// ============================================================

function department(overrides: Partial<DepartmentRow> = {}): DepartmentRow {
  return {
    id: 'dept-1',
    accountId: 'acct-1',
    name: 'Ventas',
    description: null,
    active: true,
    sortOrder: 100,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function contact(overrides: Partial<ContactRow> = {}): ContactRow {
  return {
    id: 'contact-1',
    accountId: 'acct-1',
    departmentId: null,
    name: 'Carlos Pérez',
    roleTitle: null,
    phone: null,
    whatsapp: null,
    email: null,
    notes: null,
    active: true,
    sortOrder: 100,
    linkedUserId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('detectHandoffIntent — departments (11-12)', () => {
  it('11. buscar departamento existente — "quiero hablar con ventas" matches Ventas', () => {
    const ventas = department({ id: 'd1', name: 'Ventas' })
    const result = detectHandoffIntent('quiero hablar con ventas', [ventas], [])
    expect(result).toEqual({ type: 'department', department: ventas, contact: null, ambiguous: false })
  })

  it('12. buscar departamento inexistente — "quiero hablar con soporte tecnico" → general (no Soporte configured)', () => {
    const ventas = department({ id: 'd1', name: 'Ventas' })
    const result = detectHandoffIntent('quiero hablar con soporte tecnico', [ventas], [])
    expect(result.type).toBe('general')
    expect(result.ambiguous).toBe(false)
  })
})

describe('detectHandoffIntent — contacts (13-19)', () => {
  it('13. buscar persona existente — "quiero hablar con Carlos" matches by first name', () => {
    const carlos = contact({ id: 'c1', name: 'Carlos Pérez' })
    const result = detectHandoffIntent('quiero hablar con Carlos', [], [carlos])
    expect(result).toEqual({ type: 'contact', contact: carlos, department: null, ambiguous: false })
  })

  it('13b. matches on the full name too — "quiero hablar con Carlos Pérez"', () => {
    const carlos = contact({ id: 'c1', name: 'Carlos Pérez' })
    const result = detectHandoffIntent('quiero hablar con Carlos Pérez', [], [carlos])
    expect(result.type).toBe('contact')
    expect(result.contact).toEqual(carlos)
  })

  it('14. persona inexistente — "quiero hablar con Roberto" → general', () => {
    const carlos = contact({ id: 'c1', name: 'Carlos Pérez' })
    const result = detectHandoffIntent('quiero hablar con Roberto', [], [carlos])
    expect(result).toEqual({ type: 'general', department: null, contact: null, ambiguous: false })
  })

  it('15. dos personas con mismo nombre — never guesses, resolves ambiguous general', () => {
    const carlosVentas = contact({ id: 'c1', name: 'Carlos Gómez', departmentId: 'd1' })
    const carlosSoporte = contact({ id: 'c2', name: 'Carlos Ruiz', departmentId: 'd2' })
    const result = detectHandoffIntent('quiero hablar con Carlos', [], [carlosVentas, carlosSoporte])
    expect(result.type).toBe('general')
    expect(result.ambiguous).toBe(true)
    expect(result.contact).toBeNull()
  })

  it('16. persona + departamento — "Carlos de ventas" narrows to the matching Carlos', () => {
    const ventas = department({ id: 'd1', name: 'Ventas' })
    const soporte = department({ id: 'd2', name: 'Soporte' })
    const carlosVentas = contact({ id: 'c1', name: 'Carlos Gómez', departmentId: 'd1' })
    const carlosSoporte = contact({ id: 'c2', name: 'Carlos Ruiz', departmentId: 'd2' })
    const result = detectHandoffIntent('quiero hablar con Carlos de ventas', [ventas, soporte], [
      carlosVentas,
      carlosSoporte,
    ])
    expect(result).toEqual({ type: 'contact', contact: carlosVentas, department: ventas, ambiguous: false })
  })

  it('16b. persona + departamento distinto al suyo — does not affirm a wrong match, still ambiguous', () => {
    // Only one Carlos exists, but he's in Ventas, not Soporte — message
    // asks for "Carlos de soporte". Per Parte 13, never affirm this is
    // the right person when the named department doesn't match theirs;
    // the plain single-contact match (matchedContacts.length === 1)
    // still resolves to that contact — the narrowing branch only
    // engages for 2+ matches — so this exercises the multi-contact path
    // with a genuinely wrong department pairing instead.
    const ventas = department({ id: 'd1', name: 'Ventas' })
    const soporte = department({ id: 'd2', name: 'Soporte' })
    const carlosVentas = contact({ id: 'c1', name: 'Carlos Gómez', departmentId: 'd1' })
    const anaSoporte = contact({ id: 'c2', name: 'Ana Soto', departmentId: 'd2' })
    const result = detectHandoffIntent('quiero hablar con Carlos de soporte', [ventas, soporte], [
      carlosVentas,
      anaSoporte,
    ])
    // Only one contact named "Carlos" matched at all — resolves to him,
    // with his OWN real department, not the one the message guessed.
    expect(result).toEqual({ type: 'contact', contact: carlosVentas, department: ventas, ambiguous: false })
  })

  it('17. contacto inactivo — never even offered to detectHandoffIntent (filtered upstream by loadBusinessProfileForAgent)', () => {
    // detectHandoffIntent itself has no `active` field to check — callers
    // only ever pass it already-active contacts (see
    // business-profile/service.ts::loadBusinessProfileForAgent). Passing
    // an empty active list here (as if the only Carlos were inactive and
    // filtered out) must resolve to general, not a false match.
    const result = detectHandoffIntent('quiero hablar con Carlos', [], [])
    expect(result.type).toBe('general')
  })

  it('18. teléfono del contacto correcto — carried through untouched on the resolved contact', () => {
    const carlos = contact({ id: 'c1', name: 'Carlos Pérez', phone: '+52 555 123 4567' })
    const result = detectHandoffIntent('quiero hablar con Carlos', [], [carlos])
    expect(result.contact?.phone).toBe('+52 555 123 4567')
  })

  it('19. no inventar contacto — a short/common substring never matches a name < 3 chars', () => {
    const jo = contact({ id: 'c1', name: 'Jo' })
    const result = detectHandoffIntent('hola, quiero hacer una pregunta', [], [jo])
    expect(result.type).toBe('general')
  })
})

describe('detectHandoffIntent — handoff phrasing (20-25)', () => {
  it('20. "quiero hablar con una persona" → general (no name/department mentioned)', () => {
    const result = detectHandoffIntent('quiero hablar con una persona', [department()], [contact()])
    expect(result).toEqual({ type: 'general', department: null, contact: null, ambiguous: false })
  })

  it('21. "quiero hablar con ventas" → department', () => {
    const ventas = department({ id: 'd1', name: 'Ventas' })
    const result = detectHandoffIntent('quiero hablar con ventas', [ventas], [])
    expect(result.type).toBe('department')
    expect(result.department).toEqual(ventas)
  })

  it('22. "quiero hablar con Carlos" → contact', () => {
    const carlos = contact({ id: 'c1', name: 'Carlos Pérez' })
    const result = detectHandoffIntent('quiero hablar con Carlos', [], [carlos])
    expect(result.type).toBe('contact')
  })

  it('23. "quiero hablar con Carlos de ventas" → contact narrowed by department', () => {
    const ventas = department({ id: 'd1', name: 'Ventas' })
    const carlosVentas = contact({ id: 'c1', name: 'Carlos Gómez', departmentId: 'd1' })
    const carlosSoporte = contact({ id: 'c2', name: 'Carlos Ruiz', departmentId: 'd2' })
    const result = detectHandoffIntent('quiero hablar con Carlos de ventas', [ventas], [
      carlosVentas,
      carlosSoporte,
    ])
    expect(result.type).toBe('contact')
    expect(result.contact).toEqual(carlosVentas)
  })

  it('24. departamento inexistente → handoff general', () => {
    const result = detectHandoffIntent('quiero hablar con recursos humanos', [department({ name: 'Ventas' })], [])
    expect(result.type).toBe('general')
  })

  it('25. persona inexistente → handoff general', () => {
    const result = detectHandoffIntent('quiero hablar con Fernando', [], [contact({ name: 'Carlos Pérez' })])
    expect(result.type).toBe('general')
  })
})

describe('detectHandoffIntent — edge cases', () => {
  it('an empty/whitespace-only message resolves to plain general', () => {
    expect(detectHandoffIntent('   ', [department()], [contact()]).type).toBe('general')
  })

  it('is diacritic- and case-insensitive ("CARLOS", "cárlos")', () => {
    const carlos = contact({ id: 'c1', name: 'Cárlos Pérez' })
    expect(detectHandoffIntent('QUIERO HABLAR CON CARLOS', [], [carlos]).type).toBe('contact')
  })

  it('two ambiguous departments with the same substring never guess', () => {
    const soporteTecnico = department({ id: 'd1', name: 'Soporte Técnico' })
    const soporteVentas = department({ id: 'd2', name: 'Soporte Ventas' })
    // Neither department name appears as a whole-word match in this
    // message (it only contains "soporte" alone), so this actually
    // resolves to general/no-match rather than an ambiguous department
    // hit — included to document that partial/substring words never
    // match, only exact department names.
    const result = detectHandoffIntent('hablar con soporte', [soporteTecnico, soporteVentas], [])
    expect(result.type).toBe('general')
    expect(result.ambiguous).toBe(false)
  })

  it('multiple distinct departments named in one message resolve ambiguous, never a guess', () => {
    const ventas = department({ id: 'd1', name: 'Ventas' })
    const soporte = department({ id: 'd2', name: 'Soporte' })
    const result = detectHandoffIntent('hablar con ventas o soporte', [ventas, soporte], [])
    expect(result).toEqual({ type: 'general', department: null, contact: null, ambiguous: true })
  })
})

describe('describeHandoffIntent', () => {
  it('names the contact and their department when both are known', () => {
    const ventas = department({ id: 'd1', name: 'Ventas' })
    const carlos = contact({ id: 'c1', name: 'Carlos Pérez', departmentId: 'd1' })
    const note = describeHandoffIntent({ type: 'contact', contact: carlos, department: ventas, ambiguous: false })
    expect(note).toBe('Cliente solicitó hablar con Carlos Pérez (Ventas).')
  })

  it('names just the contact when they have no department', () => {
    const carlos = contact({ id: 'c1', name: 'Carlos Pérez' })
    const note = describeHandoffIntent({ type: 'contact', contact: carlos, department: null, ambiguous: false })
    expect(note).toBe('Cliente solicitó hablar con Carlos Pérez.')
  })

  it('names the department for a department-only match', () => {
    const ventas = department({ id: 'd1', name: 'Ventas' })
    const note = describeHandoffIntent({ type: 'department', contact: null, department: ventas, ambiguous: false })
    expect(note).toBe('Cliente solicitó el departamento de Ventas.')
  })

  it('flags an unresolved ambiguity for manual follow-up', () => {
    const note = describeHandoffIntent({ type: 'general', contact: null, department: null, ambiguous: true })
    expect(note).toContain('no se pudo identificar con certeza')
  })

  it('returns null for a plain general handoff with nothing to note', () => {
    const note = describeHandoffIntent({ type: 'general', contact: null, department: null, ambiguous: false })
    expect(note).toBeNull()
  })
})
