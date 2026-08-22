import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/baileys/admin-client'
import { getOrCreateConnection, isConnected, getConnectionStatus } from '@/lib/baileys/connection'
import { sendText, sendImageWithCaption, BaileysSendError } from '@/lib/baileys/send'
import { randomAttemptDelayMs } from '@/lib/envios/lote-engine'

/**
 * Envios queue tick — mirrors GET /api/automations/cron (same
 * x-cron-secret pattern, same optimistic-claim-then-process shape),
 * but with its own dedicated secret (ENVIOS_CRON_SECRET) so the two
 * can be rotated/disabled independently. Meant to be hit by an
 * external pinger (cron-job.org) every ~30s.
 *
 * Deliberately outside /api/whatsapp/* — that prefix requires a user
 * session (src/middleware.ts), which would break an external cron
 * caller entirely.
 *
 * Processes at most one due lead per active lote per tick — the
 * random 60-240s delay between sends (spec's anti-detection
 * requirement) lives in when a lead's `next_attempt_at` gets set, not
 * in this tick's cadence.
 */
export async function GET(request: Request) {
  const expected = process.env.ENVIOS_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (suppliedBuf.length !== expectedBuf.length || !timingSafeEqual(suppliedBuf, expectedBuf)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseAdmin()

  const { data: activeLotes, error: lotesErr } = await db
    .from('envio_lotes')
    .select('id, envio_id')
    .eq('status', 'em_andamento')
  if (lotesErr) {
    return NextResponse.json({ error: lotesErr.message }, { status: 500 })
  }
  if (!activeLotes || activeLotes.length === 0) {
    return NextResponse.json({ processed: 0, paused: 0 })
  }

  const envioIds = [...new Set(activeLotes.map((l) => l.envio_id as string))]
  const { data: envios } = await db
    .from('envios')
    .select('id, account_id, mensagem_imagem_url')
    .in('id', envioIds)
  const envioById = new Map((envios ?? []).map((e) => [e.id as string, e]))

  let processed = 0
  let paused = 0

  for (const lote of activeLotes) {
    const envio = envioById.get(lote.envio_id as string)
    if (!envio) continue

    const nowIso = new Date().toISOString()
    const { data: due } = await db
      .from('envio_leads')
      .select('id, telefone, mensagem')
      .eq('lote_id', lote.id)
      .eq('status', 'na_fila')
      .not('next_attempt_at', 'is', null)
      .lte('next_attempt_at', nowIso)
      .order('next_attempt_at', { ascending: true })
      .limit(1)
    const lead = due?.[0]
    if (!lead) continue

    // Optimistic claim — same shape as automations/cron.ts.
    const { data: claimed } = await db
      .from('envio_leads')
      .update({ status: 'enviando' })
      .eq('id', lead.id)
      .eq('status', 'na_fila')
      .select('id')
      .maybeSingle()
    if (!claimed) continue

    await getOrCreateConnection(envio.account_id as string)
    if (!isConnected(envio.account_id as string)) {
      // Give the lead back to the queue either way.
      await db
        .from('envio_leads')
        .update({ status: 'na_fila', next_attempt_at: null })
        .eq('id', lead.id)

      // Still mid-reconnect (socket exists, handshake not done, no QR
      // needed) — don't pause, just skip this tick. The socket is
      // usually ready by the next one (~30s later).
      if (getConnectionStatus(envio.account_id as string) === 'connecting') {
        continue
      }

      // Actually closed — spec: pause automatically on a disconnected
      // session, don't keep retrying.
      await db.from('envio_lotes').update({ status: 'pausado' }).eq('id', lote.id)
      paused++
      continue
    }

    try {
      if (envio.mensagem_imagem_url) {
        await sendImageWithCaption(
          envio.account_id as string,
          lead.telefone as string,
          envio.mensagem_imagem_url as string,
          lead.mensagem as string,
        )
      } else {
        await sendText(envio.account_id as string, lead.telefone as string, lead.mensagem as string)
      }
      await db
        .from('envio_leads')
        .update({ status: 'enviado', enviado_em: new Date().toISOString() })
        .eq('id', lead.id)
    } catch (err) {
      // One bad number never blocks the rest of the lote (spec).
      const message = err instanceof BaileysSendError ? err.message : 'Falha ao enviar mensagem'
      await db.from('envio_leads').update({ status: 'falhou', erro: message }).eq('id', lead.id)
    }
    processed++

    // Chain the next lead (random 60-240s delay) or close out the lote.
    const { data: nextLead } = await db
      .from('envio_leads')
      .select('id')
      .eq('lote_id', lote.id)
      .eq('status', 'na_fila')
      .is('next_attempt_at', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (nextLead) {
      const nextAttemptAt = new Date(Date.now() + randomAttemptDelayMs()).toISOString()
      await db.from('envio_leads').update({ next_attempt_at: nextAttemptAt }).eq('id', nextLead.id)
    } else {
      await db
        .from('envio_lotes')
        .update({ status: 'concluido', concluido_em: new Date().toISOString() })
        .eq('id', lote.id)

      const { data: siblingLotes } = await db
        .from('envio_lotes')
        .select('status')
        .eq('envio_id', lote.envio_id)
      if (siblingLotes && siblingLotes.every((l) => l.status === 'concluido')) {
        await db.from('envios').update({ status: 'concluido' }).eq('id', lote.envio_id)
      }
    }
  }

  return NextResponse.json({ processed, paused })
}
