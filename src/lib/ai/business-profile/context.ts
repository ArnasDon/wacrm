// ============================================================
// Business Profile → system-prompt context (AI optimization project,
// FASE 6). Pure formatting — no I/O, no DB — mirrors the same pattern
// as catalog/context.ts::catalogContextToPromptText: returns null for
// an empty/unconfigured account so callers omit the section entirely
// rather than injecting an empty "BUSINESS PROFILE" header for nothing.
// ============================================================

import { WEEKDAYS, type BusinessProfileRow, type DepartmentRow, type ContactRow, type Weekday } from './types'

const WEEKDAY_LABEL: Record<Weekday, string> = {
  monday: 'Lunes',
  tuesday: 'Martes',
  wednesday: 'Miércoles',
  thursday: 'Jueves',
  friday: 'Viernes',
  saturday: 'Sábado',
  sunday: 'Domingo',
}

function formatHours(profile: BusinessProfileRow): string | null {
  const lines: string[] = []
  for (const day of WEEKDAYS) {
    const entry = profile.businessHours[day]
    if (!entry) continue
    if (!entry.enabled) {
      lines.push(`${WEEKDAY_LABEL[day]}: cerrado`)
    } else if (entry.open && entry.close) {
      lines.push(`${WEEKDAY_LABEL[day]}: ${entry.open} a ${entry.close}`)
    }
  }
  return lines.length > 0 ? lines.join('\n') : null
}

function formatContact(c: ContactRow): string {
  const details = [
    c.roleTitle,
    c.phone ? `tel: ${c.phone}` : null,
    c.whatsapp ? `WhatsApp: ${c.whatsapp}` : null,
    c.email ? `email: ${c.email}` : null,
  ]
    .filter(Boolean)
    .join(' — ')
  return details ? `${c.name} (${details})` : c.name
}

/**
 * Directory section grouping active contacts by their active
 * department — contacts with no department, or whose department is
 * inactive/missing, are listed under a generic "Otros contactos"
 * bucket rather than silently dropped. `notes` is DELIBERATELY never
 * included here — it's an internal admin annotation (see
 * account_business_contacts.notes in migration 050), never
 * agent-facing.
 */
function formatDirectory(departments: DepartmentRow[], contacts: ContactRow[]): string | null {
  if (departments.length === 0 && contacts.length === 0) return null

  const byDepartment = new Map<string, ContactRow[]>()
  const departmentById = new Map(departments.map((d) => [d.id, d]))
  const orphans: ContactRow[] = []

  for (const contact of contacts) {
    const department = contact.departmentId ? departmentById.get(contact.departmentId) : undefined
    if (!department) {
      orphans.push(contact)
      continue
    }
    const list = byDepartment.get(department.id)
    if (list) list.push(contact)
    else byDepartment.set(department.id, [contact])
  }

  const blocks: string[] = []
  for (const department of departments) {
    const people = byDepartment.get(department.id) ?? []
    const peopleText = people.length > 0 ? people.map(formatContact).join('; ') : '(sin contacto asignado)'
    blocks.push(`${department.name}: ${peopleText}`)
  }
  if (orphans.length > 0) {
    blocks.push(`Otros contactos: ${orphans.map(formatContact).join('; ')}`)
  }
  return blocks.join('\n')
}

/**
 * Render the account's Business Profile (+ department/contact
 * directory) as one system-prompt section. Returns null when there is
 * genuinely nothing configured, so accounts that never set this up see
 * byte-for-byte the same prompt as before this feature existed.
 */
export function buildBusinessProfileContext(
  profile: BusinessProfileRow | null,
  departments: DepartmentRow[],
  contacts: ContactRow[],
): string | null {
  if (!profile && departments.length === 0 && contacts.length === 0) return null

  const parts: string[] = []

  if (profile) {
    if (profile.businessName) parts.push(`Nombre: ${profile.businessName}`)
    if (profile.description) parts.push(`Descripción: ${profile.description}`)

    const contactLines = [
      profile.phone ? `Teléfono: ${profile.phone}` : null,
      profile.whatsapp ? `WhatsApp: ${profile.whatsapp}` : null,
      profile.email ? `Email: ${profile.email}` : null,
      profile.website ? `Sitio web: ${profile.website}` : null,
    ].filter(Boolean)
    if (contactLines.length > 0) parts.push(contactLines.join('\n'))

    const locationLines = [
      profile.address ? `Dirección: ${profile.address}` : null,
      [profile.city, profile.state, profile.country].filter(Boolean).join(', ') || null,
      profile.googleMapsUrl ? `Google Maps: ${profile.googleMapsUrl}` : null,
    ].filter(Boolean)
    if (locationLines.length > 0) parts.push(locationLines.join('\n'))

    const hours = formatHours(profile)
    if (hours) parts.push(`Horario:\n${hours}`)

    if (profile.deliveryEnabled) {
      const deliveryLines = [
        'Delivery: sí',
        profile.deliveryDescription,
        profile.deliveryCoverageAreas.length > 0
          ? `Zonas de cobertura: ${profile.deliveryCoverageAreas.join(', ')}`
          : null,
      ].filter(Boolean)
      parts.push(deliveryLines.join('\n'))
    } else if (profile.deliveryDescription || profile.deliveryCoverageAreas.length > 0) {
      // Configured details but the toggle is off — still honest to
      // state "no" explicitly rather than silently show delivery info
      // for a business that turned it off.
      parts.push('Delivery: no')
    }

    if (profile.paymentMethods.length > 0) {
      parts.push(`Métodos de pago: ${profile.paymentMethods.join(', ')}`)
    }

    const policies = [
      profile.warrantyPolicy ? `Garantía: ${profile.warrantyPolicy}` : null,
      profile.returnPolicy ? `Devoluciones: ${profile.returnPolicy}` : null,
      profile.financingPolicy ? `Financiamiento: ${profile.financingPolicy}` : null,
      profile.deliveryPolicy ? `Política de entrega: ${profile.deliveryPolicy}` : null,
    ].filter(Boolean)
    if (policies.length > 0) parts.push(policies.join('\n'))

    if (profile.links.length > 0) {
      parts.push(`Enlaces: ${profile.links.map((l) => `${l.label} (${l.url})`).join('; ')}`)
    }

    if (profile.faq.length > 0) {
      const faqText = profile.faq.map((item, i) => `${i + 1}. ${item.question} → ${item.answer}`).join('\n')
      parts.push(`Preguntas frecuentes:\n${faqText}`)
    }
  }

  const directory = formatDirectory(departments, contacts)
  if (directory) parts.push(`Departamentos y contactos internos:\n${directory}`)

  if (parts.length === 0) return null

  return (
    'BUSINESS PROFILE — fuente estructurada OFICIAL para identidad del negocio, contacto general, ' +
    'ubicación, horario, delivery, métodos de pago, políticas y directorio interno de departamentos/' +
    'contactos. Para productos, precio, stock o disponibilidad usa el catálogo, nunca este bloque. ' +
    'Si un dato no aparece aquí, no está configurado — no lo inventes; dilo honestamente. ' +
    'Nunca reveles que esta información viene de un "Business Profile", una base de datos o un sistema — ' +
    'respóndela con naturalidad, como lo haría un empleado del negocio.\n\n' +
    parts.join('\n\n')
  )
}
