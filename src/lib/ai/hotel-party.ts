/** Repair an omitted child-age field only when the marker's own explicit
 * note accounts for every guest. Never infer ages from prices or capacity. */
export function repairHotelPartyFields(fields: Record<string, string>): Record<string, string> {
  if (fields.edades_ninos?.trim() || !fields.nota) return fields
  const adults = Number(fields.adultos)
  const guests = Number(fields.personas)
  if (!Number.isInteger(adults) || adults < 1 || !Number.isInteger(guests) || guests <= adults) return fields
  const note = fields.nota.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/\b(sin ninos|no (?:viaja|viene|asiste)|otra habitacion|otro grupo)\b/.test(note)) return fields
  const matches = [...note.matchAll(/\b(\d+|un|una)\s+nin[oa]s?\s+de\s+(\d+(?:\s*(?:,|y)\s*\d+)*)\s*anos?\b/g)]
  if (matches.length !== 1) return fields
  const [, countText, ageText] = matches[0]
  const count = /^(un|una)$/.test(countText) ? 1 : Number(countText)
  const ages = ageText.match(/\d+/g)!.map(Number)
  if (count !== ages.length || adults + count !== guests || ages.some((age) => age < 0 || age > 17)) return fields
  const repaired: Record<string, string> = { ...fields, edades_ninos: ages.join(',') }
  delete repaired.ninos
  return repaired
}
