import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { splitIntoLotes } from '@/lib/envios/lote-engine'
import { parseCampaignFile } from '@/lib/envios/parse-campaign-file'

interface CreateEnvioBody {
  /** Raw text of the uploaded campaign JSON — parsed server-side (authoritative, never trusts the client's preview). */
  campanha_json: string
  /** User-edited envio name; falls back to `campaign.name` from the file when omitted. */
  nome?: string
  campanha_id?: string | null
  /**
   * Manual override for lote 1's size (spec: "permitir ajuste manual
   * do tamanho de cada lote antes de confirmar"). Omitted = automatic
   * split (first lote rounded down). Must be within [0, leads.length].
   */
  lote1_size?: number
}

/**
 * Creates an Envio + its lote(s) + their leads from the campaign JSON
 * file the user uploads (same format the Campanhas system exports:
 * `{campaign, creative, recipients}`). Small lists get a single lote
 * (see `splitIntoLotes`); larger ones get 2. Every lote is created
 * `aguardando` — nothing is sent until "Iniciar lote" is called
 * (POST .../lotes/[numero]/iniciar).
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

    const nome = body.nome?.trim() || parsed.nome

    const { data: envio, error: envioErr } = await supabase
      .from('envios')
      .insert({
        account_id: accountId,
        campanha_id: body.campanha_id ?? null,
        nome,
        mensagem_imagem_url: parsed.imagemUrl,
        created_by: userId,
      })
      .select('id')
      .single()
    if (envioErr || !envio) {
      throw new Error(envioErr?.message ?? 'failed to create envio')
    }

    const totalLeads = parsed.leads.length
    let lote1Size: number
    let lote2Size: number
    if (typeof body.lote1_size === 'number' && Number.isInteger(body.lote1_size)) {
      if (body.lote1_size < 0 || body.lote1_size > totalLeads) {
        return NextResponse.json({ error: 'lote1_size out of range' }, { status: 400 })
      }
      lote1Size = body.lote1_size
      lote2Size = totalLeads - lote1Size
    } else {
      ;[lote1Size, lote2Size] = splitIntoLotes(totalLeads)
    }

    // A lote created with 0 leads never reaches `concluido` — the cron
    // tick has nothing to advance — which permanently blocks lote 2
    // (isLote2Blocked waits on lote 1's status). Collapse any split
    // that would leave a side empty (automatic or manual override)
    // into a single lote 1 holding every lead, and skip lote 2 outright.
    if (lote1Size === 0 || lote2Size === 0) {
      lote1Size = totalLeads
      lote2Size = 0
    }

    const loteRows =
      lote2Size > 0
        ? [
            { envio_id: envio.id, numero_lote: 1, quantidade_leads: lote1Size },
            { envio_id: envio.id, numero_lote: 2, quantidade_leads: lote2Size },
          ]
        : [{ envio_id: envio.id, numero_lote: 1, quantidade_leads: lote1Size }]

    const { data: lotes, error: lotesErr } = await supabase
      .from('envio_lotes')
      .insert(loteRows)
      .select('id, numero_lote')
    if (lotesErr || !lotes) {
      throw new Error(lotesErr?.message ?? 'failed to create lotes')
    }

    const lote1Id = lotes.find((l) => l.numero_lote === 1)!.id
    const lote2Id = lotes.find((l) => l.numero_lote === 2)?.id ?? null

    const leadRows = parsed.leads.map((lead, index) => ({
      lote_id: lote2Id && index >= lote1Size ? lote2Id : lote1Id,
      nome: lead.nome,
      telefone: lead.telefone,
      mensagem: lead.mensagem,
    }))
    const { error: leadsErr } = await supabase.from('envio_leads').insert(leadRows)
    if (leadsErr) {
      throw new Error(leadsErr.message)
    }

    return NextResponse.json({ id: envio.id }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
