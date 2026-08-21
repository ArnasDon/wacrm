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
 * Creates an Envio + its 2 lotes + their leads from the campaign JSON
 * file the user uploads (same format the Campanhas system exports:
 * `{campaign, creative, recipients}`). Both lotes are created
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

    let lote1Size: number
    let lote2Size: number
    if (typeof body.lote1_size === 'number' && Number.isInteger(body.lote1_size)) {
      if (body.lote1_size < 0 || body.lote1_size > parsed.leads.length) {
        return NextResponse.json({ error: 'lote1_size out of range' }, { status: 400 })
      }
      lote1Size = body.lote1_size
      lote2Size = parsed.leads.length - lote1Size
    } else {
      ;[lote1Size, lote2Size] = splitIntoLotes(parsed.leads.length)
    }

    const { data: lotes, error: lotesErr } = await supabase
      .from('envio_lotes')
      .insert([
        { envio_id: envio.id, numero_lote: 1, quantidade_leads: lote1Size },
        { envio_id: envio.id, numero_lote: 2, quantidade_leads: lote2Size },
      ])
      .select('id, numero_lote')
    if (lotesErr || !lotes) {
      throw new Error(lotesErr?.message ?? 'failed to create lotes')
    }

    const lote1Id = lotes.find((l) => l.numero_lote === 1)!.id
    const lote2Id = lotes.find((l) => l.numero_lote === 2)!.id

    const leadRows = parsed.leads.map((lead, index) => ({
      lote_id: index < lote1Size ? lote1Id : lote2Id,
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
