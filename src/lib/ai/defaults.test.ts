import { describe, it, expect } from 'vitest'
import {
  buildSystemPrompt,
  RECORD_RESERVATION_SENTINEL_PREFIX,
  SEND_RESTAURANT_MENU_SENTINEL,
  SEND_CATEGORY_BANNER_SENTINEL_PREFIX,
  SET_CONTACT_NAME_SENTINEL_PREFIX,
  SEND_CATALOG_SENTINEL,
} from './defaults'

describe('buildSystemPrompt — hotel reservation marker gate', () => {
  it('teaches RECORD_RESERVATION only in auto_reply mode with hotelReservations on', () => {
    const on = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: true })
    expect(on).toContain(RECORD_RESERVATION_SENTINEL_PREFIX)
    expect(on).toContain('habitaciones, spa, actividades, paquetes, eventos')
  })

  it('never mentions the marker when hotelReservations is off', () => {
    const off = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: false })
    expect(off).not.toContain(RECORD_RESERVATION_SENTINEL_PREFIX)
  })

  it('never mentions the marker in draft mode even for a hotel', () => {
    const draft = buildSystemPrompt({ userPrompt: null, mode: 'draft', hotelReservations: true })
    expect(draft).not.toContain(RECORD_RESERVATION_SENTINEL_PREFIX)
  })
})

describe('buildSystemPrompt — current-date grounding', () => {
  it('embeds the given date and the "resolve relative dates yourself" rule, in both modes', () => {
    const now = 'jueves, 10 de septiembre de 2026, 20:30 (America/Guatemala)'
    for (const mode of ['auto_reply', 'draft'] as const) {
      const p = buildSystemPrompt({ userPrompt: null, mode, currentDate: now })
      expect(p).toContain(now)
      expect(p).toContain('el viernes')
      expect(p.toLowerCase()).toContain('do not ask the customer for the month or the year')
    }
  })

  it('says nothing about dates when currentDate is omitted', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply' })
    expect(p).not.toContain("business's own timezone")
  })
})

describe('buildSystemPrompt — precomputed weekday table', () => {
  // Real incident, 2026-09-22: asked to resolve "el jueves" itself from
  // a spelled-out "today is Tuesday", the model miscounted by one day
  // and silently applied a weekend rate. `upcomingWeekdays` hands the
  // model a lookup table instead of arithmetic it has to get right.
  it('embeds the table and tells the model to copy it instead of recomputing', () => {
    const table = 'martes (hoy)=2026-09-22, miércoles=2026-09-23, jueves=2026-09-24'
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', upcomingWeekdays: table })
    expect(p).toContain(table)
    expect(p.toLowerCase()).toContain('do not recompute these yourself')
  })

  it('says nothing when upcomingWeekdays is omitted', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply' })
    expect(p.toLowerCase()).not.toContain('do not recompute these yourself')
  })
})

describe('buildSystemPrompt — set-contact-name marker gate', () => {
  it('teaches SET_CONTACT_NAME in auto_reply mode', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply' })
    expect(p).toContain(SET_CONTACT_NAME_SENTINEL_PREFIX)
  })

  it('never mentions it in draft mode', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'draft' })
    expect(p).not.toContain(SET_CONTACT_NAME_SENTINEL_PREFIX)
  })

  // Real incident, 2026-09-23: a live 7-case test found the bot
  // greeting every guest by their stated name in its own reply text,
  // but the marker itself fired ZERO times all night (verified against
  // ai_action_log) — every contact stayed saved under a stale default
  // name. Strengthened from a one-off conditional to the same
  // every-single-reply framing already proven reliable for the
  // temperature marker.
  it('frames it as an every-single-reply check, same as the temperature marker, and says to record it alongside another marker in the same reply', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply' })
    expect(p.toLowerCase()).toContain('on every single reply, separately check')
    expect(p.toLowerCase()).toContain('with no exceptions for how many other markers this same reply already carries')
  })
})

describe('buildSystemPrompt — send_catalog', () => {
  it('tells the model not to write the catalog link itself', () => {
    const p = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      catalog: ['- Widget (Q10)'],
    })
    expect(p).toContain('[[ACTION:send_catalog]]')
    expect(p.toLowerCase()).toContain('do not write the catalog link')
  })

  it('teaches not to re-send the full catalog once already sent in this conversation', () => {
    const p = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      catalog: ['- Widget (Q10)'],
    })
    expect(p.toLowerCase()).toContain('do not send it again')
    expect(p.toLowerCase()).toContain('answer from the catalog data you already have')
  })
})

describe('buildSystemPrompt — hotel category: ask-which-item, not a repeated description', () => {
  // 2026-09-20 redesign: the banner (photos + general prices) is now sent
  // deterministically by the app the moment record_reservation captures
  // interest in a category (see auto-reply.ts) — the model is no longer
  // taught the banner marker at all, and is told NOT to re-describe the
  // category's items/prices in text since the banner already shows them.
  it('tells the model the system sends the banner automatically and it should not use a marker itself', () => {
    const p = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      catalog: ['- Paquete Romántico (Q1,100)'],
      hotelCategoryBanners: [{ name: 'Paquetes', hasWeekendVariant: false }],
    })
    expect(p.toLowerCase()).toContain('the system automatically sends')
    expect(p.toLowerCase()).toContain('you never send them yourself')
    // The photo is never offered conditionally (real incident 2026-09-24).
    expect(p).toContain('si me confirma, le envío la foto')
    expect(p.toLowerCase()).toContain('never talk about sending photos conditionally')
    expect(p).not.toContain(SEND_CATEGORY_BANNER_SENTINEL_PREFIX)
  })

  it('moves category inquiries to practical details and specific items to verified facts', () => {
    const p = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      catalog: ['- Paquete Romántico (Q1,100)'],
      hotelCategoryBanners: [{ name: 'Paquetes', hasWeekendVariant: false }],
    })
    expect(p.toLowerCase()).toContain('missing practical details')
    expect(p.toLowerCase()).not.toContain('which one interests them most')
    expect(p.toLowerCase()).not.toContain('invitation to book it')
    expect(p.toLowerCase()).toContain('never promise to apartar, reserve or confirm')
    expect(p).toContain(SEND_CATALOG_SENTINEL)
  })

  it('is silent about this behavior when no category has a banner', () => {
    const p = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      catalog: ['- Widget (Q10)'],
      hotelCategoryBanners: [],
    })
    expect(p.toLowerCase()).not.toContain('must not re-list the category')
    expect(p.toLowerCase()).not.toContain('the system automatically sends')
  })
})

describe('buildSystemPrompt — hotel objection protocol and single CTA', () => {
  it('teaches acknowledge-answer-alternatives-one CTA when hotelReservations is on', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: true })
    expect(p.toLowerCase()).toContain('objection / pushback protocol')
    expect(p.toLowerCase()).toContain('exactly one clear next-step question')
    expect(p.toLowerCase()).toContain('never more than one stacked in the same reply')
  })

  it('is silent when hotelReservations is off', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: false })
    expect(p.toLowerCase()).not.toContain('objection / pushback protocol')
  })

  it('never appears in draft mode', () => {
    const draft = buildSystemPrompt({ userPrompt: null, mode: 'draft', hotelReservations: true })
    expect(draft.toLowerCase()).not.toContain('objection / pushback protocol')
  })
})

describe('buildSystemPrompt — deposit amount in the closing CTA', () => {
  it('names the deposit amount, without turning it into a permission question', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: true })
    expect(p.toLowerCase()).toContain('anticipo')
    expect(p).toContain('con un anticipo estimado de Q140')
    expect(p).not.toContain('¿Desea que registre esta opción')
  })

  it('teaches never claiming the request is a confirmed reservation', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: true })
    expect(p.toLowerCase()).toContain('never tell the guest it is "reservado"')
  })
})

describe('buildSystemPrompt — hotel stay estimate', () => {
  it('lets the bot share the computed figure and never appears in draft mode', () => {
    const est = 'Master Suite Deluxe · 1 noche: Total estimado: Q500.'
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelStayEstimate: est })
    expect(p).toContain(est)
    expect(p.toLowerCase()).toContain('give them this exact number')
    expect(
      buildSystemPrompt({ userPrompt: null, mode: 'draft', hotelStayEstimate: est }),
    ).not.toContain(est)
  })

  it('tells the model NOT to say a person will re-quote on a date/guest change — the system sends the new total itself, 2026-09-20 redesign', () => {
    const est = 'Suite Clásica · 3 noches: Total estimado: Q4,160.'
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelStayEstimate: est })
    expect(p.toLowerCase()).not.toContain('figure no longer applies — say a person will re-quote')
    expect(p.toLowerCase()).toContain('sends it to the guest on its own')
  })
})

describe('buildSystemPrompt — record_reservation: exact catalog name + no self-priced stays', () => {
  // Real incident, 2026-09-20: the model wrote servicio=Suite Clásica (an
  // abbreviation) which matched TWO real products ("Suite Clásica
  // (Individual o Pareja)" and "Suite Clásica Doble") ambiguously,
  // so the deterministic price calculator silently gave up — and the
  // model then guessed a price itself (Q800, a single-night reference
  // rate) instead of the real 2-night total (Q1,200), which got written
  // straight into `reservation_requests.estimated_price`.
  it('requires the exact catalog name for servicio on habitaciones/paquetes', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: true })
    expect(p.toLowerCase()).toContain('write the exact name as it appears in the product catalog')
    expect(p).toContain('Suite Clásica (Individual o Pareja)')
  })

  it('forbids the model from supplying its own precio for habitaciones/paquetes, but still allows it for spa/actividades/eventos', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: true })
    expect(p.toLowerCase()).toContain('never include this key yourself')
    expect(p.toLowerCase()).toContain('only for spa, actividades, or eventos')
  })

  // Real incident, 2026-09-22: the deterministic COST ESTIMATE correctly
  // said GTQ 870 for 3 guests (Junior Suite Familiar's own "3 personas"
  // bracket rate), the guest disputed it with their own math ("600 for
  // the adults + 175 for the child" = 775), and the model apologized and
  // handed them the guest's lower, wrong total instead of the real one.
  // Same incident, different symptom: the model separately quoted a
  // plain reference rate (Suite Premium "Q700 por noche") that was the
  // 2-person rate for a guest who had already said they were travelling
  // alone (the real 1-person rate was Q350 — both tiers were right there
  // in the business's own rate table).
  it('forbids recomputing a total from the guest\'s own breakdown and requires matching the rate tier to the real headcount', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: true })
    expect(p.toLowerCase()).toContain("never let the guest's own price arithmetic override a real number")
    expect(p.toLowerCase()).toContain('do not recompute it from a breakdown the guest hands you')
    expect(p.toLowerCase()).toContain('check the headcount before picking the number')
  })

  // Real incident, 2026-09-23: the model recapped and asked "¿Desea que
  // deje esta solicitud lista...?", the guest replied exactly "Si", and
  // the model treated that single word as too vague to count — so it
  // recapped a SECOND time and asked the identical question again
  // instead of firing CONFIRM_RESERVATION_SENTINEL. The reservation
  // stayed "pending" forever and nobody on the team was ever notified
  // it was ready.
  it('clarifies that a plain "sí" directly answering the model\'s own just-asked confirm question DOES count as explicit confirmation', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: true })
    expect(p.toLowerCase()).toContain('a plain "sí"/"ok"/"dale"/"va" answering it, that is their answer')
    expect(p.toLowerCase()).toContain('do not make a guest answer your own yes/no question twice')
  })
})

describe('buildSystemPrompt — flow handoff directive', () => {
  it('injects the directive as a priority task in auto_reply mode', () => {
    const p = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      flowDirective: 'Busca la opción elegida en la base de conocimientos.',
    })
    expect(p).toContain('Busca la opción elegida en la base de conocimientos.')
    expect(p.toLowerCase()).toContain('priority task')
  })

  it('is silent when no directive is passed, and never appears in draft mode', () => {
    expect(buildSystemPrompt({ userPrompt: null, mode: 'auto_reply' })).not.toContain('priority task')
    expect(
      buildSystemPrompt({ userPrompt: null, mode: 'draft', flowDirective: 'do X' }),
    ).not.toContain('do X')
  })
})

describe('buildSystemPrompt — restaurant menu marker gate', () => {
  it('teaches SEND_RESTAURANT_MENU only in auto_reply mode with restaurantMenu on', () => {
    const on = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', restaurantMenu: true })
    expect(on).toContain(SEND_RESTAURANT_MENU_SENTINEL)
  })

  it('never mentions the marker when restaurantMenu is off', () => {
    const off = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', restaurantMenu: false })
    expect(off).not.toContain(SEND_RESTAURANT_MENU_SENTINEL)
  })

  it('never mentions the marker in draft mode', () => {
    const draft = buildSystemPrompt({ userPrompt: null, mode: 'draft', restaurantMenu: true })
    expect(draft).not.toContain(SEND_RESTAURANT_MENU_SENTINEL)
  })
})

describe('buildSystemPrompt — category banner is now app-side, never a model marker', () => {
  // 2026-09-20: sending the banner reliably matters more than letting the
  // model manage it, so the app sends it deterministically (tied to
  // record_reservation, see auto-reply.ts) and the model is never taught
  // SEND_CATEGORY_BANNER_SENTINEL at all anymore — for any hotel account,
  // with or without a weekday/weekend split (that's also resolved in code
  // now, from the proposal's own date field).
  it('never teaches the marker, even with banner categories present — but does name them', () => {
    const p = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      hotelCategoryBanners: [
        { name: 'Habitaciones', hasWeekendVariant: false },
        { name: 'Spa', hasWeekendVariant: true },
      ],
    })
    expect(p).not.toContain(SEND_CATEGORY_BANNER_SENTINEL_PREFIX)
    expect(p).toContain('Habitaciones, Spa')
  })

  it('never mentions it when no category has a banner, or in draft mode', () => {
    expect(
      buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelCategoryBanners: [] }),
    ).not.toContain(SEND_CATEGORY_BANNER_SENTINEL_PREFIX)
    expect(
      buildSystemPrompt({ userPrompt: null, mode: 'auto_reply' }),
    ).not.toContain(SEND_CATEGORY_BANNER_SENTINEL_PREFIX)
    expect(
      buildSystemPrompt({
        userPrompt: null,
        mode: 'draft',
        hotelCategoryBanners: [{ name: 'Habitaciones', hasWeekendVariant: false }],
      }),
    ).not.toContain(SEND_CATEGORY_BANNER_SENTINEL_PREFIX)
  })

  it('says nothing about a weekday/weekend split to the model — that is resolved in code now', () => {
    const p = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      hotelCategoryBanners: [{ name: 'Habitaciones', hasWeekendVariant: true }],
    })
    expect(p).not.toContain('(has a weekday/weekend split)')
    expect(p).not.toContain('|weekday')
    expect(p).not.toContain('|weekend')
  })

  it('tells the model the system never sends the same category banner twice', () => {
    const p = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      hotelCategoryBanners: [{ name: 'Habitaciones', hasWeekendVariant: false }],
    })
    expect(p.toLowerCase()).toContain('each image goes out at most once per conversation')
  })
})

describe('buildSystemPrompt — hotel dynamic welcome (first reply) + no-repeat-menu', () => {
  it('teaches the greeting + active-categories list only on the first reply', () => {
    const p = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      hotelCategoryBanners: [
        { name: 'Habitaciones', hasWeekendVariant: false },
        { name: 'Spa', hasWeekendVariant: false },
      ],
      hotelIsFirstReply: true,
    })
    expect(p.toLowerCase()).toContain('this is your first reply')
    expect(p).toContain('Habitaciones, Spa')
  })

  it('says nothing about the first-reply greeting on a later turn', () => {
    const p = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      hotelCategoryBanners: [{ name: 'Habitaciones', hasWeekendVariant: false }],
      hotelIsFirstReply: false,
    })
    expect(p.toLowerCase()).not.toContain('this is your first reply')
  })

  it('teaches never to show the category menu again once intent is clear, on every turn (not just the first)', () => {
    const first = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      hotelCategoryBanners: [{ name: 'Habitaciones', hasWeekendVariant: false }],
      hotelIsFirstReply: true,
    })
    const later = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      hotelCategoryBanners: [{ name: 'Habitaciones', hasWeekendVariant: false }],
      hotelIsFirstReply: false,
    })
    expect(first.toLowerCase()).toContain('never show the full list of categories again')
    expect(later.toLowerCase()).toContain('never show the full list of categories again')
  })

  it('never mentions the first-reply greeting when there are no active category banners at all', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelIsFirstReply: true })
    expect(p.toLowerCase()).not.toContain('this is your first reply')
  })
})

describe('buildSystemPrompt — hotel multi-intent reservation marker (up to 2 per turn)', () => {
  it('teaches up to two markers, one per distinct category raised this same turn', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: true })
    expect(p.toLowerCase()).toContain('up to two')
    expect(p.toLowerCase()).toContain('never two for the same category')
  })
})

describe('buildSystemPrompt — hotel recap before confirming + no-availability-checking', () => {
  it('closes in ONE warm reply once every field is known — no recap round-trip, no permission question (2026-09-22 test run)', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: true })
    expect(p).toContain('CLOSING protocol')
    expect(p).toContain('restate the key details in ONE natural sentence')
    expect(p).toContain('Do NOT ask "¿desea que deje esta solicitud lista?"')
    expect(p).toContain('do NOT end that closing reply with a question')
    expect(p).not.toContain('Before you ask the guest to confirm, first lay out a short RECAP')
  })

  it('explicitly forbids the bot from checking/determining availability itself', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: true })
    expect(p.toLowerCase()).toContain('you never check, promise, or determine room/service availability yourself')
  })
})

describe('buildSystemPrompt — hotel category with no banner falls back to catalog/KB', () => {
  it('teaches that a category outside the banner list is not an error — just answer from data', () => {
    const p = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      hotelCategoryBanners: [{ name: 'Habitaciones', hasWeekendVariant: false }],
    })
    expect(p.toLowerCase()).toContain('has no banner on file')
    expect(p.toLowerCase()).toContain('not an error')
  })

  it('says nothing about it when there are no category banners at all (nothing to contrast against)', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelCategoryBanners: [] })
    expect(p.toLowerCase()).not.toContain('has no banner on file')
  })
})

describe('buildSystemPrompt — hotel error/delay recovery protocol', () => {
  it('teaches acknowledge → fix with real data → hand off only via the two-step protocol if truly stuck', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: true })
    expect(p.toLowerCase()).toContain('error / delay recovery protocol')
    expect(p.toLowerCase()).toContain('never invent a hand-off path outside that two-step protocol')
  })

  it('never mentions it in draft mode or when hotelReservations is off', () => {
    expect(
      buildSystemPrompt({ userPrompt: null, mode: 'draft', hotelReservations: true }).toLowerCase(),
    ).not.toContain('error / delay recovery protocol')
    expect(
      buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: false }).toLowerCase(),
    ).not.toContain('error / delay recovery protocol')
  })
})

describe('buildSystemPrompt — hotel modify/cancel existing request', () => {
  it('routes any question about a booking the guest already has to the reservations team (owner, 2026-10-07) — never claims to modify/cancel itself', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: true, hotelCategoryBanners: [{ name: 'Habitaciones', hasWeekendVariant: false }] })
    expect(p.toLowerCase()).toContain('modify / cancel an existing request')
    expect(p.toLowerCase()).toContain('you have no tool to change or cancel a reservation/request yourself')
    expect(p).toContain('(p) Bookings the guest ALREADY has')
    expect(p).toContain('a colleague from the reservations team will help them')
    expect(p).toContain('follow rule (p)')
  })
})

describe('buildSystemPrompt — customer-facing dates are DD/MM/AAAA', () => {
  it('tells the model to write DD/MM/AAAA in the reply text, never YYYY-MM-DD, in every mode', () => {
    for (const mode of ['auto_reply', 'draft'] as const) {
      const p = buildSystemPrompt({ userPrompt: null, mode })
      expect(p).toContain('DD/MM/AAAA')
      expect(p).toContain('24/09/2026')
      expect(p.toLowerCase()).toContain('never yyyy-mm-dd')
    }
  })
})

describe('buildSystemPrompt — historical stays do not prompt rescheduling', () => {
  it('keeps a historical request as background and prioritizes a new inquiry, hotel only, auto_reply only', () => {
    const p = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      hotelReservations: true,
      staleReservations: '- Habitación: Suite Premium · 01/09/2026 → 03/09/2026 · 2 personas',
    })
    expect(p).toContain('HISTORICAL REQUEST(S)')
    expect(p).toContain('Suite Premium · 01/09/2026 → 03/09/2026')
    expect(p).toContain('Never make the guest choose between rescheduling and a new request')
    expect(p.toLowerCase()).toContain('never quote, confirm, or act as if their old date still applies')
  })

  it('says nothing when there is nothing stale', () => {
    const p = buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: true })
    expect(p).not.toContain('HISTORICAL REQUEST(S)')
  })

  it('never mentions it outside the hotel vertical or in draft mode', () => {
    const stale = '- Habitación: Suite Premium · 01/09/2026 → 03/09/2026 · 2 personas'
    expect(
      buildSystemPrompt({ userPrompt: null, mode: 'auto_reply', hotelReservations: false, staleReservations: stale }),
    ).not.toContain('HISTORICAL REQUEST(S)')
    expect(
      buildSystemPrompt({ userPrompt: null, mode: 'draft', hotelReservations: true, staleReservations: stale }),
    ).not.toContain('PAST-DUE')
  })
})

describe('buildSystemPrompt — cache-friendly ordering', () => {
  const fixed = {
    userPrompt: 'Eres Angela María Martínez, la anfitriona virtual de Villa San Ricardo.',
    mode: 'auto_reply' as const,
    catalog: ['Suite Premium (Q1,200/noche)'],
    hotelReservations: true,
    hotelCategoryBanners: [{ name: 'Habitaciones', hasWeekendVariant: true }],
  }
  it('two different conversations/moments share the whole fixed part as an identical prefix', () => {
    const a = buildSystemPrompt({ ...fixed, currentDate: 'martes, 7 de octubre de 2026, 10:01', knownContactFacts: 'Nombre: Sussely', hotelIsFirstReply: true, knowledge: ['A'] })
    const b = buildSystemPrompt({ ...fixed, currentDate: 'martes, 7 de octubre de 2026, 18:44', activeReservations: '- Habitación: Suite Premium', hotelStayEstimate: 'GTQ 850', knowledge: ['B'] })
    const fixedEnd = a.indexOf('CONTEXT FOR THIS CONVERSATION')
    expect(fixedEnd).toBeGreaterThan(0)
    expect(b.slice(0, fixedEnd)).toBe(a.slice(0, fixedEnd))
    // the business context and catalog are inside that shared prefix
    expect(a.slice(0, fixedEnd)).toContain('Angela María Martínez')
    expect(a.slice(0, fixedEnd)).toContain('Suite Premium (Q1,200/noche)')
    expect(a.slice(0, fixedEnd)).not.toContain('10:01')
  })
})
