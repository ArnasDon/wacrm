// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ============================================================
// BusinessProfileSettings — per-section save fix.
//
// Root cause this suite pins down: the ORIGINAL single "Guardar" button
// sent the entire `profile` snapshot on every save. A browser tab whose
// local state didn't yet include a field (never typed, or lost across a
// reload) would silently overwrite that field back to empty on its next
// save — even a field a DIFFERENT, more recent save had already set.
// The fix gives each section its own button, each sending ONLY that
// section's keys, relying on the API's pre-existing (and already
// correct) partial-update contract. These tests exercise the REAL
// component against a fetch mock that merges partial PUT bodies the
// same way `upsertBusinessProfile` does — only keys present in the
// request are ever changed — so a cross-section overwrite would show up
// here exactly as it would in production.
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

import { BusinessProfileSettings } from './business-profile-settings'

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

/**
 * Fetch mock with an in-memory "current row" that PUT requests merge
 * into — shallow `{ ...row, ...body }`, exactly mirroring
 * `upsertBusinessProfile`'s partial-write contract (only keys present
 * in the request body are changed; every absent key is left untouched).
 * This is what makes the "no sobrescritura entre secciones" tests below
 * meaningful: if the component ever regressed to sending the full
 * snapshot again, a later section's save WOULD stomp an earlier one
 * here exactly as it would against real Supabase.
 */
function mockBackend(initialRow: Record<string, unknown> | null = null) {
  let row: Record<string, unknown> | null = initialRow
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
      row = { ...(row ?? {}), ...body }
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

describe('BusinessProfileSettings — per-section save', () => {
  it('Identidad: saves only identity fields, none of the other 16 keys', async () => {
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
  })

  it('Ubicación: saves location fields including a real Google Maps URL — never null when filled', async () => {
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
    // The regression this whole fix was for: googleMapsUrl must NOT
    // silently become null when the user actually filled it.
    expect(backend.puts[0].google_maps_url).not.toBeNull()
    expect(backend.getRow()?.google_maps_url).toBe('https://maps.google.com/?q=Duarte+88')
  })

  it('Horarios: enabling a day with open/close times persists the full nested object, never {}', async () => {
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
    expect(backend.puts[0]).toEqual({
      business_hours: { monday: { enabled: true, open: '09:00', close: '18:00' } },
    })
    expect(backend.getRow()?.business_hours).not.toEqual({})
  })

  it('Delivery/Pagos: saves delivery + payment fields as one section', async () => {
    const backend = mockBackend()
    render(<BusinessProfileSettings />)
    await screen.findByText('deliveryTitle')

    fireEvent.click(screen.getAllByRole('checkbox').find((c) => c.closest('label')?.textContent === 'deliveryEnabled')!)
    fireEvent.change(fieldByLabel('coverageAreas'), { target: { value: 'Loma de Cabrera, Dajabón' } })
    fireEvent.change(fieldByLabel('paymentMethods'), { target: { value: 'Efectivo, Transferencia' } })
    fireEvent.click(saveButton('delivery'))

    await waitFor(() => expect(backend.puts).toHaveLength(1))
    expect(backend.puts[0]).toEqual({
      delivery_enabled: true,
      delivery_description: null,
      delivery_coverage_areas: ['Loma de Cabrera', 'Dajabón'],
      payment_methods: ['Efectivo', 'Transferencia'],
    })
  })

  it('Políticas: saves the four policy fields', async () => {
    const backend = mockBackend()
    render(<BusinessProfileSettings />)
    await screen.findByText('policiesTitle')

    fireEvent.change(fieldByLabel('warrantyPolicy'), { target: { value: '90 días' } })
    fireEvent.click(saveButton('policies'))

    await waitFor(() => expect(backend.puts).toHaveLength(1))
    expect(backend.puts[0]).toEqual({
      warranty_policy: '90 días',
      return_policy: null,
      financing_policy: null,
      delivery_policy: null,
    })
  })

  it('Links/FAQ: shared button saves both arrays together, nothing else', async () => {
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
  })

  it('no sobrescritura entre secciones: saving Location after Identity leaves Identity intact', async () => {
    const backend = mockBackend()
    render(<BusinessProfileSettings />)
    await screen.findByText('identityTitle')

    fireEvent.change(fieldByLabel('businessName'), { target: { value: 'Kuki CompuCell' } })
    fireEvent.click(saveButton('identity'))
    await waitFor(() => expect(backend.puts).toHaveLength(1))
    expect(backend.getRow()?.business_name).toBe('Kuki CompuCell')

    // A second save — of a COMPLETELY different section — must not even
    // mention business_name, let alone null it out.
    fireEvent.change(fieldByLabel('address'), { target: { value: 'Duarte 88' } })
    fireEvent.click(saveButton('location'))
    await waitFor(() => expect(backend.puts).toHaveLength(2))

    expect(backend.puts[1]).not.toHaveProperty('business_name')
    expect(backend.getRow()?.business_name).toBe('Kuki CompuCell')
    expect(backend.getRow()?.address).toBe('Duarte 88')
  })

  it('reload/relectura: a fresh mount shows exactly the stored values in every section', async () => {
    mockBackend({
      business_name: 'Kuki CompuCell',
      phone: '809-284-3495',
      address: 'Duarte 88',
      city: 'Loma de Cabrera',
      google_maps_url: 'https://maps.google.com/?q=Duarte+88',
      business_hours: { monday: { enabled: true, open: '09:00', close: '18:00' } },
      delivery_enabled: true,
      payment_methods: ['Efectivo'],
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
    expect(screen.getByDisplayValue('Instagram')).toBeTruthy()
    expect(screen.getByDisplayValue('¿Hacen envíos?')).toBeTruthy()
  })

  it('valores vacíos: an untouched section is never sent, so it can never be nulled by another save', async () => {
    const backend = mockBackend({ business_name: 'Kuki CompuCell' })
    render(<BusinessProfileSettings />)
    await screen.findByText('locationTitle')

    // Save Location while every location field is still empty — this
    // section's OWN empty fields legitimately become null, but nothing
    // about identity is even present in the body.
    fireEvent.click(saveButton('location'))

    await waitFor(() => expect(backend.puts).toHaveLength(1))
    expect(backend.puts[0]).toEqual({ address: null, city: null, state: null, country: null, google_maps_url: null })
    expect(backend.puts[0]).not.toHaveProperty('business_name')
    expect(backend.getRow()?.business_name).toBe('Kuki CompuCell')
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
