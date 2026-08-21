import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { splitIntoLotes } from '@/lib/envios/lote-engine'

interface LeadInput {
  nome?: string | null
  telefone: string
}

interface CreateEnvioBody {
  nome: string
  mensagem_texto: string
  mensagem_imagem_url?: string | null
  campanha_id?: string | null
  leads: LeadInput[]
  /**
   * Manual override for lote 1's size (spec: "permitir ajuste manual
   * do tamanho de cada lote antes de confirmar"). Omitted = automatic
   * split (first lote rounded down). Must be within [0, leads.length].
   */
  lote1_size?: number
}

/**
 * Creates an Envio + its 2 lotes + their leads from the JSON the user
 * already uploads today (message + optional image + a lead list).
 * Both lotes are created `aguardando` — nothing is sent until "Iniciar
 * lote" is called (POST .../lotes/[numero]/iniciar).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const body = (await request.json()) as Partial<CreateEnvioBody>
    const nome = body.nome?.trim()
    const mensagemTexto = body.mensagem_texto?.trim()
    const leads = Array.isArray(body.leads) ? body.leads : []

    if (!nome) {
      return NextResponse.json({ error: 'nome is required' }, { status: 400 })
    }
    if (!mensagemTexto) {
      return NextResponse.json({ error: 'mensagem_texto is required' }, { status: 400 })
    }
    const validLeads = leads
      .map((l) => ({ nome: l.nome?.trim() || null, telefone: l.telefone?.trim() }))
      .filter((l): l is { nome: string | null; telefone: string } => Boolean(l.telefone))
    if (validLeads.length === 0) {
      return NextResponse.json({ error: 'leads must contain at least one valid phone' }, { status: 400 })
    }

    const { data: envio, error: envioErr } = await supabase
      .from('envios')
      .insert({
        account_id: accountId,
        campanha_id: body.campanha_id ?? null,
        nome,
        mensagem_texto: mensagemTexto,
        mensagem_imagem_url: body.mensagem_imagem_url ?? null,
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
      if (body.lote1_size < 0 || body.lote1_size > validLeads.length) {
        return NextResponse.json({ error: 'lote1_size out of range' }, { status: 400 })
      }
      lote1Size = body.lote1_size
      lote2Size = validLeads.length - lote1Size
    } else {
      ;[lote1Size, lote2Size] = splitIntoLotes(validLeads.length)
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

    const leadRows = validLeads.map((lead, index) => ({
      lote_id: index < lote1Size ? lote1Id : lote2Id,
      nome: lead.nome,
      telefone: lead.telefone,
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
