import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { splitIntoLotes, variantIndexForPosition, MAX_LOTES } from '@/lib/envios/lote-engine'
import { parseCampaignFile } from '@/lib/envios/parse-campaign-file'

interface CreateEnvioBody {
  /** Raw text of the uploaded campaign JSON — parsed server-side (authoritative, never trusts the client's preview). */
  campanha_json: string
  /** User-edited envio name; falls back to `campaign.name` from the file when omitted. */
  nome?: string
  campanha_id?: string | null
  /**
   * How many lotes to split the leads into (spec: "N lotes
   * configuráveis"). Omitted = 2 (legacy default). Leads are
   * distributed as evenly as possible (`splitIntoLotes`); the actual
   * number of lotes created may be smaller than requested if the list
   * is too short to give every lote a minimum size.
   */
  numero_lotes?: number
}

/**
 * Creates an Envio + its lote(s) + their leads from the campaign JSON
 * file the user uploads (same format the Campanhas system exports:
 * `{campaign, creative, recipients}`, optionally with a `messages`
 * array of A/B/C+ variants). Leads are split across `numero_lotes`
 * lotes as evenly as possible (see `splitIntoLotes`). When the file
 * carries `messages` variants, each lead's final text is the variant
 * at its round-robin position within its own lote (see
 * `variantIndexForPosition`); otherwise each lead keeps its own
 * `recipients[i].message`. Every lote is created `aguardando` —
 * nothing is sent until "Iniciar lote" is called (POST
 * .../lotes/[numero]/iniciar).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const body = (await request.json()) as Partial<CreateEnvioBody>
    if (!body.campanha_json || typeof body.campanha_json !== 'string') {
      return NextResponse.json({ error: 'campanha_json is required' }, { status: 400 })
    }

    let parsed
    try {
      parsed = parseCampaignFile(body.campanha_json)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Arquivo de campanha inválido'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    let numeroLotes = 2
    if (body.numero_lotes !== undefined) {
      if (!Number.isInteger(body.numero_lotes) || body.numero_lotes < 1 || body.numero_lotes > MAX_LOTES) {
        return NextResponse.json({ error: `numero_lotes must be an integer between 1 and ${MAX_LOTES}` }, { status: 400 })
      }
      numeroLotes = body.numero_lotes
    }

    const nome = body.nome?.trim() || parsed.nome

    const { data: envio, error: envioErr } = await supabase
      .from('envios')
      .insert({
        account_id: accountId,
        campanha_id: body.campanha_id ?? null,
        nome,
        mensagem_imagem_url: parsed.imagemUrl,
        variantes_mensagem: parsed.variants,
        created_by: userId,
      })
      .select('id')
      .single()
    if (envioErr || !envio) {
      throw new Error(envioErr?.message ?? 'failed to create envio')
    }

    const totalLeads = parsed.leads.length
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

    const variants = parsed.variants
    const leadRows = parsed.leads.map((lead, index) => {
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
