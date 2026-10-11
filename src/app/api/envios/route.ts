import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { splitIntoLotes, variantIndexForPosition, MAX_LOTES } from '@/lib/envios/lote-engine'
import { parseCampaignFile } from '@/lib/envios/parse-campaign-file'

interface CreateEnvioLeadInput {
  nome?: string | null
  telefone: string
  mensagem?: string | null
}

interface CreateEnvioBody {
  /** Raw text of the uploaded campaign JSON — optional when direct fields are supplied. */
  campanha_json?: string
  /** User-edited envio name; falls back to `campaign.name` from the file when omitted. */
  nome?: string
  campanha_id?: string | null
  /** How many lotes to split the leads into. */
  numero_lotes?: number
  /** Direct fields for manual creation without a JSON file */
  mensagem?: string
  variantes?: string[]
  imagem_url?: string | null
  leads?: CreateEnvioLeadInput[]
}

/**
 * Normalizes phone numbers, automatically prefixing Brazilian country code (55)
 * when a 10 or 11 digit local number is supplied.
 */
function normalizeRecipientPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    return `55${digits}`
  }
  return digits
}

/**
 * Creates an Envio + its lote(s) + their leads either from an uploaded
 * campaign JSON file OR directly via explicit message and recipients.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const body = (await request.json()) as Partial<CreateEnvioBody>

    let nome = body.nome?.trim() || ''
    let imagemUrl: string | null = body.imagem_url?.trim() || null
    let variants: string[] | null = null
    let leads: Array<{ nome: string | null; telefone: string; mensagem: string | null }> = []

    if (body.campanha_json && typeof body.campanha_json === 'string' && body.campanha_json.trim()) {
      let parsed
      try {
        parsed = parseCampaignFile(body.campanha_json)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Arquivo de campanha inválido'
        return NextResponse.json({ error: message }, { status: 400 })
      }
      nome = nome || parsed.nome
      imagemUrl = imagemUrl || parsed.imagemUrl
      variants = parsed.variants
      leads = parsed.leads
    } else {
      // Direct manual creation without JSON
      if (Array.isArray(body.variantes) && body.variantes.length > 0) {
        const cleaned = body.variantes.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
        if (cleaned.length > 0) variants = cleaned
      } else if (typeof body.mensagem === 'string' && body.mensagem.trim()) {
        variants = [body.mensagem.trim()]
      }

      if (!Array.isArray(body.leads) || body.leads.length === 0) {
        return NextResponse.json(
          { error: 'Nenhum destinatário informado. Forneça uma lista de leads ou um arquivo de campanha.' },
          { status: 400 },
        )
      }

      leads = body.leads.map((l, i) => {
        const rawPhone = typeof l.telefone === 'string' ? l.telefone.trim() : ''
        const telefone = normalizeRecipientPhone(rawPhone)
        if (!telefone || telefone.length < 8) {
          throw new Error(`Destinatário ${i + 1} possui telefone inválido: "${rawPhone}"`)
        }
        const leadNome = typeof l.nome === 'string' && l.nome.trim() ? l.nome.trim() : null
        const leadMensagem = typeof l.mensagem === 'string' && l.mensagem.trim() ? l.mensagem.trim() : null
        if (!variants && !leadMensagem) {
          throw new Error(`Mensagem não informada para o destinatário ${l.nome || l.telefone}`)
        }
        return { nome: leadNome, telefone, mensagem: leadMensagem }
      })
    }

    if (!nome) {
      return NextResponse.json({ error: 'Nome do envio é obrigatório' }, { status: 400 })
    }

    if (leads.length === 0) {
      return NextResponse.json({ error: 'Nenhum destinatário válido informado' }, { status: 400 })
    }

    if (!variants && leads.some((l) => !l.mensagem)) {
      return NextResponse.json({ error: 'Mensagem é obrigatória' }, { status: 400 })
    }

    let numeroLotes = leads.length > 10 ? 2 : 1
    if (body.numero_lotes !== undefined) {
      if (!Number.isInteger(body.numero_lotes) || body.numero_lotes < 1 || body.numero_lotes > MAX_LOTES) {
        return NextResponse.json({ error: `numero_lotes must be an integer between 1 and ${MAX_LOTES}` }, { status: 400 })
      }
      numeroLotes = body.numero_lotes
    }

    const { data: envio, error: envioErr } = await supabase
      .from('envios')
      .insert({
        account_id: accountId,
        campanha_id: body.campanha_id ?? null,
        nome,
        mensagem_imagem_url: imagemUrl,
        variantes_mensagem: variants,
        created_by: userId,
      })
      .select('id')
      .single()
    if (envioErr || !envio) {
      throw new Error(envioErr?.message ?? 'failed to create envio')
    }

    const totalLeads = leads.length
    const loteSizes = splitIntoLotes(totalLeads, numeroLotes)

    const loteRows = loteSizes.map((quantidade_leads, i) => ({
      envio_id: envio.id,
      numero_lote: i + 1,
      quantidade_leads,
    }))

    const { data: lotes, error: lotesErr } = await supabase
      .from('envio_lotes')
      .insert(loteRows)
      .select('id, numero_lote')
    if (lotesErr || !lotes) {
      throw new Error(lotesErr?.message ?? 'failed to create lotes')
    }

    const lotesByNumero = new Map(lotes.map((l) => [l.numero_lote as number, l.id as string]))

    // Cumulative ranges over the sorted leads array — lote i owns
    // [start, start + loteSizes[i]).
    let offset = 0
    const ranges = loteSizes.map((size, i) => {
      const range = { loteId: lotesByNumero.get(i + 1)!, start: offset, end: offset + size }
      offset += size
      return range
    })

    const leadRows = leads.map((lead, index) => {
      const range = ranges.find((r) => index >= r.start && index < r.end)!
      const positionInLote = index - range.start
      const varianteIndice = variants ? variantIndexForPosition(positionInLote, variants.length) : null
      const mensagem = variants ? variants[varianteIndice!] : lead.mensagem!
      return {
        lote_id: range.loteId,
        nome: lead.nome,
        telefone: lead.telefone,
        mensagem,
        variante_indice: varianteIndice,
      }
    })
    const { error: leadsErr } = await supabase.from('envio_leads').insert(leadRows)
    if (leadsErr) {
      throw new Error(leadsErr.message)
    }

    return NextResponse.json({ id: envio.id }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
