// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ============================================================
// BusinessProfileSettings — per-section save + camelCase mapping fix.
//
// Two bugs, both pinned down by this suite:
//
// 1. The ORIGINAL single "Guardar" button sent the entire `profile`
//    snapshot on every save. A browser tab whose local state didn't yet
//    include a field could silently overwrite that field back to empty
//    on its next save, even one a DIFFERENT, more recent save had
//    already set. Fixed by giving each section its own button, each
//    sending ONLY that section's keys.
//
// 2. `fromApi()` used to read snake_case field names (`business_name`,
//    `google_maps_url`, ...) but GET/PUT /api/ai/business-profile
//    actually return `BusinessProfileRow` — camelCase (`businessName`,
//    `googleMapsUrl`, ...). Every single-word field (phone, address,
//    city, ...) is spelled the same in both conventions, so those
//    looked fine; every multi-word field silently reverted to its
//    empty default on every load AND every post-save resync. This
//    suite's own mock used to make the SAME mistake in reverse (storing
//    and echoing back snake_case), which is exactly why it never caught
//    the bug — `mockBackend` below now stores and returns the real
//    camelCase shape, translating the incoming snake_case PUT body the
//    same way `service.ts`'s `inputToRow()` + `toProfile()` do.
// ============================================================

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    accountId: 'acct-1',
    accountRole: 'admin',
    profileLoading: false,
    defaultCurrency: 'USD',
  }),
}))

// Stable reference across renders, same reasoning as data-sources-
// settings.test.tsx: BusinessProfileSettings' `load` is a useCallback
// keyed on `t` — a fresh mock closure every render would re-fire GET.
const translate = (key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key
vi.mock('next-intl', () => ({
  useTranslations: () => translate,
}))

// sonner's toast has no <Toaster/> mounted in this test tree, and (confirmed
// by running this suite before adding this mock) its output does not land
// anywhere `screen` can find via text queries — so success/error are
// asserted against this spy instead of DOM content. `vi.hoisted` is
// required here (not a plain top-level const) because `vi.mock` factories
// are hoisted above normal variable declarations.
const { toastMock } = vi.hoisted(() => ({ toastMock: { success: vi.fn(), error: vi.fn() } }))
vi.mock('sonner', () => ({ toast: toastMock }))

import { BusinessProfileSettings, fromApi } from './business-profile-settings'
import type { BusinessProfileRow } from '@/lib/ai/business-profile/types'

// Section save buttons render in this fixed top-to-bottom order (see
// business-profile-settings.tsx); the translation mock renders every
// one as the literal text "save", so tests distinguish them by DOM
// position rather than label — exactly like a screen reader user would
// have to without distinct labels, which is itself informative.
const SECTION_INDEX = {
  identity: 0,
  location: 1,
  hours: 2,
  delivery: 3,
  policies: 4,
  linksFaq: 5,
} as const

// This project has no @testing-library/jest-dom dependency (confirmed:
// absent from package.json and unused anywhere in src/), so assertions
// below read raw DOM properties (`.value`, `.disabled`,
// `.hasAttribute(...)`) instead of jest-dom's `toHaveValue`/
// `toBeDisabled`/`toHaveAttribute` convenience matchers, which are not
// available in this test environment.
function saveButton(section: keyof typeof SECTION_INDEX): HTMLButtonElement {
  return screen.getAllByRole('button', { name: 'save' })[SECTION_INDEX[section]] as HTMLButtonElement
}

/**
 * Every field in this component follows the same DOM shape:
 * `<div class="space-y-1.5"><Label>{t(key)}</Label><Input|Textarea /></div>`
 * — the `<Label>` here is a plain `<label>` with no `htmlFor` and does
 * NOT wrap the field (they're siblings), so `getByLabelText` can't find
 * the association. This walks the same DOM shape directly instead of
 * changing the component just to satisfy a test query.
 */
function fieldByLabel(labelText: string): HTMLInputElement | HTMLTextAreaElement {
  const label = screen.getByText(labelText)
  const field = label.parentElement?.querySelector('input, textarea')
  if (!field) throw new Error(`No input/textarea found next to label "${labelText}"`)
  return field as HTMLInputElement | HTMLTextAreaElement
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

// The exact snake_case → camelCase translation route.ts's readString()
// (incoming key) / service.ts's toProfile() (outgoing key) apply in
// production — used below to make the mock's PUT handler behave like
// the real backend instead of just echoing the request verbatim.
const SNAKE_TO_CAMEL: Record<string, string> = {
  business_name: 'businessName',
  google_maps_url: 'googleMapsUrl',
  business_hours: 'businessHours',
  delivery_enabled: 'deliveryEnabled',
  delivery_description: 'deliveryDescription',
  delivery_coverage_areas: 'deliveryCoverageAreas',
  payment_methods: 'paymentMethods',
  warranty_policy: 'warrantyPolicy',
  return_policy: 'returnPolicy',
  financing_policy: 'financingPolicy',
  delivery_policy: 'deliveryPolicy',
}

/**
 * Fetch mock whose internal "current row" is stored and returned in the
 * REAL camelCase shape (`BusinessProfileRow`) — never the request's own
 * snake_case keys. PUT merges only the keys present in the body (mirrors
 * `upsertBusinessProfile`'s partial-write contract: absent keys are left
 * untouched), translating each snake_case request key to its camelCase
 * column the same way `service.ts` does, so a regression to the full
 * legacy snapshot in either direction would fail these tests.
 */
function mockBackend(initialRow: Partial<BusinessProfileRow> | null = null) {
  let row: Partial<BusinessProfileRow> | null = initialRow
  const puts: Record<string, unknown>[] = []
  let putGate: Promise<void> | null = null

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (String(url) !== '/api/ai/business-profile') return jsonResponse({}, 404)

    if (method === 'GET') {
      return jsonResponse({ profile: row, departments: [], contacts: [] })
    }
    if (method === 'PUT') {
      if (putGate) await putGate
      const body = JSON.parse(String(init!.body)) as Record<string, unknown>
      puts.push(body)
      const camelPatch: Record<string, unknown> = {}
      for (const [snakeKey, value] of Object.entries(body)) {
        camelPatch[SNAKE_TO_CAMEL[snakeKey] ?? snakeKey] = value
      }
      row = { ...(row ?? {}), ...camelPatch }
      return jsonResponse({ success: true, profile: row })
    }
    return jsonResponse({}, 404)
  })
  vi.stubGlobal('fetch', fetchMock)

  return {
    puts,
    getRow: () => row,
    /** Holds every subsequent PUT open until `release()` is called —
     *  used by the double-submit test to create a real race window. */
    holdPuts: () => {
      let release!: () => void
      putGate = new Promise((r) => { release = r })
      return () => { release(); putGate = null }
    },
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('fromApi() — camelCase mapping (unit)', () => {
  it('preserves every multi-word field from a realistic camelCase API response', () => {
    const apiResponse: BusinessProfileRow = {
      id: 'profile-1',
      accountId: 'acct-1',
      businessName: 'Kuki CompuCell',
      description: null,
      phone: null,
      whatsapp: null,
      email: null,
      website: null,
      address: null,
      city: null,
      state: null,
      country: null,
      googleMapsUrl: 'https://maps.google.com/?q=Duarte+88',
      businessHours: { monday: { enabled: true, open: '08:00', close: '18:00' } },
      deliveryEnabled: true,
      deliveryDescription: 'Delivery nacional',
      deliveryCoverageAreas: [],
      paymentMethods: ['Efectivo', 'Transferencia'],
      warrantyPolicy: '90 días',
      returnPolicy: '7 días',
      financingPolicy: 'Disponible',
      deliveryPolicy: 'Entrega según zona',
      links: [],
      faq: [],
      createdAt: 'now',
      updatedAt: 'now',
    }

    const result = fromApi(apiResponse)

    expect(result.businessName).toBe('Kuki CompuCell')
    expect(result.googleMapsUrl).toBe('https://maps.google.com/?q=Duarte+88')
    expect(result.businessHours).toEqual({ monday: { enabled: true, open: '08:00', close: '18:00' } })
    expect(result.deliveryEnabled).toBe(true)
    expect(result.deliveryDescription).toBe('Delivery nacional')
    expect(result.paymentMethods).toBe('Efectivo, Transferencia')
    expect(result.warrantyPolicy).toBe('90 días')
    expect(result.returnPolicy).toBe('7 días')
    expect(result.financingPolicy).toBe('Disponible')
    expect(result.deliveryPolicy).toBe('Entrega según zona')
  })

  it('returns the empty profile for null (unconfigured account), not an error', () => {
    expect(fromApi(null).businessName).toBe('')
  })
})

describe('BusinessProfileSettings — per-section save', () => {
  it('Identidad: saves only identity fields, stays visible after the PUT, and after reload', async () => {
    const backend = mockBackend()
    render(<BusinessProfileSettings />)
    await screen.findByText('identityTitle')

    fireEvent.change(fieldByLabel('businessName'), { target: { value: 'Kuki CompuCell' } })
    fireEvent.change(fieldByLabel('phone'), { target: { value: '809-284-3495' } })
    fireEvent.click(saveButton('identity'))

    await waitFor(() => expect(backend.puts).toHaveLength(1))
    expect(backend.puts[0]).toEqual({
      business_name: 'Kuki CompuCell',
      description: null,
      phone: '809-284-3495',
      whatsapp: null,
      email: null,
      website: null,
    })
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('saveSuccess'))
    // The bug this fix targets: businessName must still be showing in
    // the input right after its own save resolves, not reverted to ''.
    await waitFor(() => expect(fieldByLabel('businessName').value).toBe('Kuki CompuCell'))
    expect(fieldByLabel('phone').value).toBe('809-284-3495')

    // And it must survive an unrelated remount (a page reload), reading
    // back from the same camelCase shape the mock now returns.
    cleanup()
    render(<BusinessProfileSettings />)
    await screen.findByText('identityTitle')
    expect(fieldByLabel('businessName').value).toBe('Kuki CompuCell')
  })

  it('Ubicación: address/city/state/country/googleMapsUrl all stay visible after saving', async () => {
    const backend = mockBackend()
    render(<BusinessProfileSettings />)
    await screen.findByText('locationTitle')

    fireEvent.change(fieldByLabel('address'), { target: { value: 'Duarte 88' } })
    fireEvent.change(fieldByLabel('city'), { target: { value: 'Loma de Cabrera' } })
    fireEvent.change(fieldByLabel('state'), { target: { value: 'Dajabon' } })
    fireEvent.change(fieldByLabel('country'), { target: { value: 'Republica Dominicana' } })
    fireEvent.change(fieldByLabel('googleMapsUrl'), {
      target: { value: 'https://maps.google.com/?q=Duarte+88' },
    })
    fireEvent.click(saveButton('location'))

    await waitFor(() => expect(backend.puts).toHaveLength(1))
    expect(backend.puts[0]).toEqual({
      address: 'Duarte 88',
      city: 'Loma de Cabrera',
      state: 'Dajabon',
      country: 'Republica Dominicana',
      google_maps_url: 'https://maps.google.com/?q=Duarte+88',
    })
    // The original regression: googleMapsUrl must not become null when
    // filled, and — the newly-fixed regression — must still be VISIBLE
    // in the input after the save, not reset to '' by fromApi().
    expect(backend.getRow()?.googleMapsUrl).toBe('https://maps.google.com/?q=Duarte+88')
    await waitFor(() => expect(fieldByLabel('googleMapsUrl').value).toBe('https://maps.google.com/?q=Duarte+88'))
    expect(fieldByLabel('address').value).toBe('Duarte 88')
    expect(fieldByLabel('city').value).toBe('Loma de Cabrera')
    expect(fieldByLabel('state').value).toBe('Dajabon')
    expect(fieldByLabel('country').value).toBe('Republica Dominicana')
  })

  it('Horarios: monday through sunday, enabled/open/close all stay visible after saving, never {}', async () => {
    const backend = mockBackend()
    render(<BusinessProfileSettings />)
    await screen.findByText('hoursTitle')

    // WEEKDAYS = [monday, tuesday, ...] — the first checkbox is Monday.
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    const timeInputs = document.querySelectorAll('input[type="time"]')
    fireEvent.change(timeInputs[0], { target: { value: '09:00' } })
    fireEvent.change(timeInputs[1], { target: { value: '18:00' } })
    fireEvent.click(saveButton('hours'))

    await waitFor(() => expect(backend.puts).toHaveLength(1))
    const monday = { monday: { enabled: true, open: '09:00', close: '18:00' } }
    expect(backend.puts[0]).toEqual({ business_hours: monday })
    expect(backend.getRow()?.businessHours).toEqual(monday)
    expect(backend.getRow()?.businessHours).not.toEqual({})

    // Visible in the UI after the save, not collapsed back to {} by
    // fromApi() misreading `businessHours` as `business_hours`.
    await waitFor(() => expect(screen.getAllByRole('checkbox')[0].hasAttribute('data-checked')).toBe(true))
    const timeInputsAfter = document.querySelectorAll('input[type="time"]')
    expect((timeInputsAfter[0] as HTMLInputElement).value).toBe('09:00')
    expect((timeInputsAfter[1] as HTMLInputElement).value).toBe('18:00')
  })

  it('Delivery/Pagos: deliveryEnabled/deliveryDescription/deliveryCoverageAreas/paymentMethods stay visible after saving', async () => {
    const backend = mockBackend()
    render(<BusinessProfileSettings />)
    await screen.findByText('deliveryTitle')

    fireEvent.click(screen.getAllByRole('checkbox').find((c) => c.closest('label')?.textContent === 'deliveryEnabled')!)
    fireEvent.change(fieldByLabel('deliveryDetails'), { target: { value: 'Entrega en 24h' } })
    fireEvent.change(fieldByLabel('coverageAreas'), { target: { value: 'Loma de Cabrera, Dajabón' } })
    fireEvent.change(fieldByLabel('paymentMethods'), { target: { value: 'Efectivo, Transferencia' } })
    fireEvent.click(saveButton('delivery'))

    await waitFor(() => expect(backend.puts).toHaveLength(1))
    expect(backend.puts[0]).toEqual({
      delivery_enabled: true,
      delivery_description: 'Entrega en 24h',
      delivery_coverage_areas: ['Loma de Cabrera', 'Dajabón'],
      payment_methods: ['Efectivo', 'Transferencia'],
    })
    expect(backend.getRow()?.deliveryEnabled).toBe(true)

    await waitFor(() => expect(fieldByLabel('deliveryDetails').value).toBe('Entrega en 24h'))
    expect(fieldByLabel('coverageAreas').value).toBe('Loma de Cabrera, Dajabón')
    expect(fieldByLabel('paymentMethods').value).toBe('Efectivo, Transferencia')
    expect(
      screen.getAllByRole('checkbox').find((c) => c.closest('label')?.textContent === 'deliveryEnabled')!.hasAttribute('data-checked'),
    ).toBe(true)
  })

  it('Políticas: warranty/return/financing/delivery policy text all stay visible after saving', async () => {
    const backend = mockBackend()
    render(<BusinessProfileSettings />)
    await screen.findByText('policiesTitle')

    fireEvent.change(fieldByLabel('warrantyPolicy'), { target: { value: '90 días' } })
    fireEvent.change(fieldByLabel('returnPolicy'), { target: { value: '7 días' } })
    fireEvent.change(fieldByLabel('financingPolicy'), { target: { value: 'Disponible' } })
    fireEvent.change(fieldByLabel('deliveryPolicy'), { target: { value: 'Entrega según zona' } })
    fireEvent.click(saveButton('policies'))

    await waitFor(() => expect(backend.puts).toHaveLength(1))
    expect(backend.puts[0]).toEqual({
      warranty_policy: '90 días',
      return_policy: '7 días',
      financing_policy: 'Disponible',
      delivery_policy: 'Entrega según zona',
    })
    expect(backend.getRow()?.warrantyPolicy).toBe('90 días')

    await waitFor(() => expect(fieldByLabel('warrantyPolicy').value).toBe('90 días'))
    expect(fieldByLabel('returnPolicy').value).toBe('7 días')
    expect(fieldByLabel('financingPolicy').value).toBe('Disponible')
    expect(fieldByLabel('deliveryPolicy').value).toBe('Entrega según zona')
  })

  it('Links/FAQ: shared button saves both arrays together and they stay visible after saving', async () => {
    const backend = mockBackend()
    render(<BusinessProfileSettings />)
    await screen.findByText('linksTitle')

    fireEvent.click(screen.getByText('addLink'))
    fireEvent.change(screen.getByPlaceholderText('linkLabelPlaceholder'), { target: { value: 'Instagram' } })
    fireEvent.change(screen.getByPlaceholderText('https://…'), { target: { value: 'https://instagram.com/kuki' } })
    fireEvent.click(screen.getByText('addFaqItem'))
    fireEvent.change(screen.getByPlaceholderText('faqQuestionPlaceholder'), { target: { value: '¿Hacen envíos?' } })
    fireEvent.change(screen.getByPlaceholderText('faqAnswerPlaceholder'), { target: { value: 'Sí, a todo el país.' } })
    fireEvent.click(saveButton('linksFaq'))

    await waitFor(() => expect(backend.puts).toHaveLength(1))
    expect(backend.puts[0]).toEqual({
      links: [{ label: 'Instagram', url: 'https://instagram.com/kuki', type: 'website' }],
      faq: [{ question: '¿Hacen envíos?', answer: 'Sí, a todo el país.' }],
    })

    await waitFor(() => expect(screen.getByDisplayValue('Instagram')).toBeTruthy())
    expect(screen.getByDisplayValue('¿Hacen envíos?')).toBeTruthy()
  })

  it('no sobrescritura entre secciones: saving Location after Identity leaves Identity intact', async () => {
    const backend = mockBackend()
    render(<BusinessProfileSettings />)
    await screen.findByText('identityTitle')

    fireEvent.change(fieldByLabel('businessName'), { target: { value: 'Kuki CompuCell' } })
    fireEvent.click(saveButton('identity'))
    await waitFor(() => expect(backend.puts).toHaveLength(1))
    expect(backend.getRow()?.businessName).toBe('Kuki CompuCell')

    // A second save — of a COMPLETELY different section — must not even
    // mention business_name, let alone null it out.
    fireEvent.change(fieldByLabel('address'), { target: { value: 'Duarte 88' } })
    fireEvent.click(saveButton('location'))
    await waitFor(() => expect(backend.puts).toHaveLength(2))

    expect(backend.puts[1]).not.toHaveProperty('business_name')
    expect(backend.getRow()?.businessName).toBe('Kuki CompuCell')
    expect(backend.getRow()?.address).toBe('Duarte 88')
    // Visible in the DOM too, not just in the mock's internal row.
    expect(fieldByLabel('businessName').value).toBe('Kuki CompuCell')
    expect(fieldByLabel('address').value).toBe('Duarte 88')
  })

  it('reload/relectura: a fresh mount shows exactly the stored values in every section', async () => {
    mockBackend({
      businessName: 'Kuki CompuCell',
      phone: '809-284-3495',
      address: 'Duarte 88',
      city: 'Loma de Cabrera',
      googleMapsUrl: 'https://maps.google.com/?q=Duarte+88',
      businessHours: { monday: { enabled: true, open: '09:00', close: '18:00' } },
      deliveryEnabled: true,
      deliveryDescription: 'Entrega en 24h',
      paymentMethods: ['Efectivo'],
      warrantyPolicy: '90 días',
      returnPolicy: '7 días',
      financingPolicy: 'Disponible',
      deliveryPolicy: 'Entrega según zona',
      links: [{ label: 'Instagram', url: 'https://instagram.com/kuki', type: 'website' }],
      faq: [{ question: '¿Hacen envíos?', answer: 'Sí' }],
    })
    render(<BusinessProfileSettings />)
    await screen.findByText('identityTitle')

    expect(fieldByLabel('businessName').value).toBe('Kuki CompuCell')
    expect(fieldByLabel('phone').value).toBe('809-284-3495')
    expect(fieldByLabel('address').value).toBe('Duarte 88')
    expect(fieldByLabel('googleMapsUrl').value).toBe('https://maps.google.com/?q=Duarte+88')
    expect(screen.getAllByRole('checkbox')[0].hasAttribute('data-checked')).toBe(true) // Monday enabled
    expect((document.querySelectorAll('input[type="time"]')[0] as HTMLInputElement).value).toBe('09:00')
    expect(fieldByLabel('deliveryDetails').value).toBe('Entrega en 24h')
    expect(fieldByLabel('paymentMethods').value).toBe('Efectivo')
    expect(fieldByLabel('warrantyPolicy').value).toBe('90 días')
    expect(fieldByLabel('returnPolicy').value).toBe('7 días')
    expect(fieldByLabel('financingPolicy').value).toBe('Disponible')
    expect(fieldByLabel('deliveryPolicy').value).toBe('Entrega según zona')
    expect(screen.getByDisplayValue('Instagram')).toBeTruthy()
    expect(screen.getByDisplayValue('¿Hacen envíos?')).toBeTruthy()
  })

  it('valores vacíos: an untouched section is never sent, so it can never be nulled by another save', async () => {
    const backend = mockBackend({ businessName: 'Kuki CompuCell' })
    render(<BusinessProfileSettings />)
    await screen.findByText('locationTitle')

    // Save Location while every location field is still empty — this
    // section's OWN empty fields legitimately become null, but nothing
    // about identity is even present in the body.
    fireEvent.click(saveButton('location'))

    await waitFor(() => expect(backend.puts).toHaveLength(1))
    expect(backend.puts[0]).toEqual({ address: null, city: null, state: null, country: null, google_maps_url: null })
    expect(backend.puts[0]).not.toHaveProperty('business_name')
    expect(backend.getRow()?.businessName).toBe('Kuki CompuCell')
  })

  it('error: a failed save shows an error and does not clear the field the user typed', async () => {
    render(<BusinessProfileSettings />)
    await screen.findByText('identityTitle')
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (String(url) === '/api/ai/business-profile' && method === 'GET') {
        return jsonResponse({ profile: null, departments: [], contacts: [] })
      }
      return jsonResponse({ error: 'Internal server error' }, 500)
    }))

    fireEvent.change(fieldByLabel('businessName'), { target: { value: 'Kuki CompuCell' } })
    fireEvent.click(saveButton('identity'))

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Internal server error'))
    // The failed PUT's response is never applied — the user's own typed
    // value must still be sitting in the field, unsaved but not lost.
    expect(fieldByLabel('businessName').value).toBe('Kuki CompuCell')
  })

  it('doble submit: a second click while a save is in flight does not fire a second request', async () => {
    const backend = mockBackend()
    const release = backend.holdPuts()
    render(<BusinessProfileSettings />)
    await screen.findByText('identityTitle')

    fireEvent.change(fieldByLabel('businessName'), { target: { value: 'Kuki CompuCell' } })
    fireEvent.click(saveButton('identity'))
    await waitFor(() => expect(saveButton('identity').disabled).toBe(true))

    // Every section button — not just the one clicked — is disabled
    // while a save is in flight.
    expect(saveButton('location').disabled).toBe(true)
    fireEvent.click(saveButton('identity'))
    fireEvent.click(saveButton('location'))

    release();
    await waitFor(() => expect(backend.puts).toHaveLength(1))
    await waitFor(() => expect(saveButton('identity').disabled).toBe(false))
  })
})
