import type { SupabaseClient } from '@supabase/supabase-js'
import { formatCurrency } from '@/lib/currency'
import { formatDateEs } from '@/lib/products/rates'
import { loadStayPricingInputs, priceStay, type StayForPricing } from '@/lib/reservations/price'
import { replyNamesProduct } from './hotel-media-intent'

/** Quote a suggested room as an alternative, never select it or update the request. */
export async function loadRecommendedRoomEstimate(args: {
  db: SupabaseClient; accountId: string; conversationId: string; roomNames: string[]
  modelText: string; todayISO: string; currency: string; english?: boolean
}): Promise<{ text: string; question: string; productName: string; total: number } | null> {
  const { db, accountId, conversationId, roomNames, modelText, todayISO, currency, english } = args
  if (!roomNames.length || !/opci[o\u00f3]n|recomiend|alternativa|le ofrecemos|se ajusta|le encaja|ideal|option|recommend|good fit/i.test(modelText)) return null
  const { data: stay, error } = await db.from('reservation_requests')
    .select('product_id, service_name, guests, rooms, check_in, check_out, adults, children_ages, guest_confirmed_at')
    .eq('account_id', accountId).eq('conversation_id', conversationId).eq('category', 'habitaciones')
    .eq('status', 'pending').eq('is_active_build', true).maybeSingle()
  if (error || !stay || stay.product_id || stay.service_name?.trim() || stay.guest_confirmed_at
    || !stay.check_in || !stay.check_out || stay.check_in < todayISO || !stay.guests || (stay.rooms ?? 1) !== 1) return null
  const { data: products, error: productError } = await db.from('products').select('id, name')
    .eq('account_id', accountId).eq('is_active', true)
  if (productError) return null
  const normalized = modelText.toLowerCase()
  const candidates = (products ?? []).filter(p => roomNames.includes(p.name) && replyNamesProduct(modelText, p.name))
    .sort((a, b) => normalized.indexOf(a.name.toLowerCase()) - normalized.indexOf(b.name.toLowerCase()))
  for (const product of candidates) {
    const before = normalized.slice(Math.max(0, normalized.indexOf(product.name.toLowerCase()) - 65), normalized.indexOf(product.name.toLowerCase()))
    const clause = before.split(/[.!?;\n]|\bpero\b|\ben cambio\b/).at(-1) ?? ''
    const after = normalized.slice(normalized.indexOf(product.name.toLowerCase()) + product.name.length)
    if (/\bno (?:hay|tenemos|ofrecemos|recomiendo)|sin disponibilidad|agotad|vendid/.test(clause)
      || /^\s*(?:ya )?(?:no esta|esta agotada|esta vendida|sin disponibilidad)/.test(after)) continue
    const { rates, maxGuests } = await loadStayPricingInputs(db, accountId, product.id)
    const quote = priceStay(rates, stay as StayForPricing, maxGuests)
    if (quote.kind !== 'quoted' || !quote.nights.length || quote.missing.length || quote.partial.length || quote.total <= 0) continue
    const total = quote.total * quote.rooms
    const amount = formatCurrency(total, currency)
    const nights = quote.nights.length
    const text = english
      ? `As a reference, ${product.name} for ${stay.guests} guests from ${stay.check_in} to ${stay.check_out} (${nights} ${nights === 1 ? 'night' : 'nights'}) has an estimated total of ${amount}, subject to hotel availability and final rate confirmation.`
      : `Como referencia, la ${product.name} para ${stay.guests} personas del ${formatDateEs(stay.check_in)} al ${formatDateEs(stay.check_out)}, por ${nights} ${nights === 1 ? 'noche' : 'noches'}, tiene un total estimado de ${amount}, sujeto a disponibilidad y confirmaci\u00f3n de la tarifa final del hotel.`
    return { text, total, productName: product.name, question: english ? `Would you prefer the ${product.name}?` : `\u00bfPrefiere la ${product.name}?` }
  }
  return null
}
