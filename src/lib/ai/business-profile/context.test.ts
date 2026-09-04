import { describe, it, expect } from 'vitest'
import { buildBusinessProfileContext } from './context'
import type { BusinessProfileRow, DepartmentRow, ContactRow } from './types'

// ============================================================
// buildBusinessProfileContext — AI optimization project, FASE 6. Covers
// the BUSINESS PROFILE scenarios (1-10) from the mandatory 44-test
// matrix. Pure formatting — no DB, no I/O — every case is a plain
// input/output assertion, exactly like routing.test.ts /
// handoff-intent.test.ts.
// ============================================================

function profile(overrides: Partial<BusinessProfileRow> = {}): BusinessProfileRow {
  return {
    id: 'profile-1',
    accountId: 'acct-1',
    businessName: null,
    description: null,
    phone: null,
    whatsapp: null,
    email: null,
    website: null,
    address: null,
    city: null,
    state: null,
    country: null,
    googleMapsUrl: null,
    businessHours: {},
    deliveryEnabled: false,
    deliveryDescription: null,
    deliveryCoverageAreas: [],
    paymentMethods: [],
    warrantyPolicy: null,
    returnPolicy: null,
    financingPolicy: null,
    deliveryPolicy: null,
    links: [],
    faq: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('buildBusinessProfileContext — presence/absence (1-2)', () => {
  it('1. negocio con profile completo → returns a non-null block with the header', () => {
    const result = buildBusinessProfileContext(profile({ businessName: 'Ferretería El Tornillo' }), [], [])
    expect(result).not.toBeNull()
    expect(result).toContain('BUSINESS PROFILE')
    expect(result).toContain('Ferretería El Tornillo')
  })

  it('2. negocio sin profile → null, so callers omit the section entirely', () => {
    expect(buildBusinessProfileContext(null, [], [])).toBeNull()
  })

  it('an all-null/empty profile with no departments/contacts is still treated as "nothing configured"', () => {
    expect(buildBusinessProfileContext(profile(), [], [])).toBeNull()
  })
})

describe('buildBusinessProfileContext — account isolation (3)', () => {
  it("3. profile de otra cuenta nunca aparece — the function only ever sees what its caller passed it", () => {
    // Isolation itself is a service-layer/RLS property (see
    // business-profile/service.ts and migration 050) — this function has
    // no accountId at all, so the only way another account's data could
    // ever appear here is if the caller passed it in. Documented here so
    // the "10 campos" suite doesn't skip the isolation scenario silently.
    const mine = profile({ accountId: 'acct-1', businessName: 'Mi Negocio' })
    const result = buildBusinessProfileContext(mine, [], [])
    expect(result).toContain('Mi Negocio')
    expect(result).not.toContain('acct-2')
  })
})

describe('buildBusinessProfileContext — fields (4-10)', () => {
  it('4. horario correcto — renders each configured day in order, closed days included', () => {
    const result = buildBusinessProfileContext(
      profile({
        businessHours: {
          monday: { enabled: true, open: '09:00', close: '18:00' },
          tuesday: { enabled: true, open: '09:00', close: '18:00' },
          sunday: { enabled: false, open: null, close: null },
        },
      }),
      [],
      [],
    )
    expect(result).toContain('Lunes: 09:00 a 18:00')
    expect(result).toContain('Martes: 09:00 a 18:00')
    expect(result).toContain('Domingo: cerrado')
    // Order follows WEEKDAYS (Mon..Sun), not insertion order.
    const lunesIdx = result!.indexOf('Lunes')
    const martesIdx = result!.indexOf('Martes')
    const domingoIdx = result!.indexOf('Domingo')
    expect(lunesIdx).toBeLessThan(martesIdx)
    expect(martesIdx).toBeLessThan(domingoIdx)
  })

  it('5. teléfono correcto', () => {
    const result = buildBusinessProfileContext(profile({ phone: '+52 555 000 1111' }), [], [])
    expect(result).toContain('Teléfono: +52 555 000 1111')
  })

  it('6. WhatsApp correcto', () => {
    const result = buildBusinessProfileContext(profile({ whatsapp: '+52 555 222 3333' }), [], [])
    expect(result).toContain('WhatsApp: +52 555 222 3333')
  })

  it('7. dirección correcta — address + city/state/country grouped', () => {
    const result = buildBusinessProfileContext(
      profile({ address: 'Av. Reforma 123', city: 'CDMX', state: 'CDMX', country: 'México' }),
      [],
      [],
    )
    expect(result).toContain('Dirección: Av. Reforma 123')
    expect(result).toContain('CDMX, CDMX, México')
  })

  it('8. delivery correcto — enabled with description and coverage areas', () => {
    const result = buildBusinessProfileContext(
      profile({
        deliveryEnabled: true,
        deliveryDescription: 'Entrega en 24h',
        deliveryCoverageAreas: ['Centro', 'Norte'],
      }),
      [],
      [],
    )
    expect(result).toContain('Delivery: sí')
    expect(result).toContain('Entrega en 24h')
    expect(result).toContain('Zonas de cobertura: Centro, Norte')
  })

  it('8b. delivery explicitly off is stated honestly, not silently omitted', () => {
    const result = buildBusinessProfileContext(
      profile({ deliveryEnabled: false, deliveryDescription: 'Ya no ofrecemos delivery' }),
      [],
      [],
    )
    expect(result).toContain('Delivery: no')
  })

  it('9. métodos de pago', () => {
    const result = buildBusinessProfileContext(
      profile({ paymentMethods: ['Efectivo', 'Tarjeta', 'Transferencia'] }),
      [],
      [],
    )
    expect(result).toContain('Métodos de pago: Efectivo, Tarjeta, Transferencia')
  })

  it('10. política correcta — warranty/return/financing/delivery policies all render', () => {
    const result = buildBusinessProfileContext(
      profile({
        warrantyPolicy: '6 meses de garantía',
        returnPolicy: '30 días para devoluciones',
        financingPolicy: 'A meses sin intereses',
        deliveryPolicy: 'Entrega en 48h hábiles',
      }),
      [],
      [],
    )
    expect(result).toContain('Garantía: 6 meses de garantía')
    expect(result).toContain('Devoluciones: 30 días para devoluciones')
    expect(result).toContain('Financiamiento: A meses sin intereses')
    expect(result).toContain('Política de entrega: Entrega en 48h hábiles')
  })
})

describe('buildBusinessProfileContext — links, FAQ, and directory', () => {
  it('renders links and FAQ when configured', () => {
    const result = buildBusinessProfileContext(
      profile({
        links: [{ label: 'Instagram', url: 'https://instagram.com/mi_negocio', type: 'social' }],
        faq: [{ question: '¿Tienen garantía?', answer: 'Sí, 6 meses.' }],
      }),
      [],
      [],
    )
    expect(result).toContain('Enlaces: Instagram (https://instagram.com/mi_negocio)')
    expect(result).toContain('1. ¿Tienen garantía? → Sí, 6 meses.')
  })

  it('groups active contacts under their department, and orphans under "Otros contactos"', () => {
    const ventas: DepartmentRow = {
      id: 'd1',
      accountId: 'acct-1',
      name: 'Ventas',
      description: null,
      active: true,
      sortOrder: 100,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }
    const carlos: ContactRow = {
      id: 'c1',
      accountId: 'acct-1',
      departmentId: 'd1',
      name: 'Carlos Pérez',
      roleTitle: 'Gerente',
      phone: '555-1111',
      whatsapp: null,
      email: null,
      notes: 'Nota interna que nunca debe llegar al modelo',
      active: true,
      sortOrder: 100,
      linkedUserId: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }
    const orphan: ContactRow = { ...carlos, id: 'c2', departmentId: null, name: 'Ana Soto', roleTitle: null }
    const result = buildBusinessProfileContext(null, [ventas], [carlos, orphan])
    expect(result).toContain('Ventas: Carlos Pérez (Gerente — tel: 555-1111)')
    expect(result).toContain('Otros contactos: Ana Soto')
    // notes is an internal admin annotation — must never reach the model.
    expect(result).not.toContain('Nota interna')
  })
})

describe('buildBusinessProfileContext — never reveals implementation', () => {
  it('the header instructs the model never to name the Business Profile/DB to the customer', () => {
    const result = buildBusinessProfileContext(profile({ businessName: 'X' }), [], [])
    expect(result).toContain('Nunca reveles')
  })
})
