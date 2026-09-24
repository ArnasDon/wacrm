import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { findConfigForPage, processLeadgenEvent, type LeadgenChangeValue } from '@/lib/meta/leads'

// ============================================================
// POST /api/meta/leads/webhook — Lead Ads: a Meta chama isto quando
// alguém submete o formulário nativo (`leadgen`) ligado a uma Página.
// Payload diferente do webhook de mensagens (src/app/api/whatsapp/
// webhook/route.ts): não traz os dados do lead, só o `leadgen_id` —
// a leitura real acontece em src/lib/meta/leads.ts via Graph API.
//
// Subscrição: field `leadgen` no objecto `page` (não `whatsapp_
// business_account`). GET/verify token dedicado
// (META_LEADS_VERIFY_TOKEN) porque esta subscrição é ao nível da
// Página, feita separadamente da subscrição da WABA — ver o relatório
// da tarefa para o passo exacto de configuração no App Dashboard.
//
// Assinatura: mesmo HMAC-SHA256 (X-Hub-Signature-256 com
// META_APP_SECRET) que o webhook de mensagens — é o App Secret da
// mesma app Meta (Eter_Wpp) que assina ambos.
//
// `after()` — mesma razão documentada no webhook de mensagens: ack a
// Meta dentro do timeout, processar depois, sem floating promise (ver
// o comentário lá para o porquê de isto importar em serverless).
// ============================================================

export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

interface LeadgenWebhookEntry {
  /** Page id — the referral webhook's `entry.id` for a `page` object
   *  subscription is the Page id. */
  id: string
  changes?: Array<{
    field: string
    value: LeadgenChangeValue
  }>
}

// GET — webhook verification handshake (hub.challenge echo).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const challenge = searchParams.get('hub.challenge')
  const verifyToken = searchParams.get('hub.verify_token')

  const expected = process.env.META_LEADS_VERIFY_TOKEN
  if (!expected) {
    console.error(
      '[meta leads webhook] META_LEADS_VERIFY_TOKEN não definido — a recusar verificação. ' +
        'Ver o relatório da tarefa para o comando que gera e regista o valor.',
    )
    return NextResponse.json({ error: 'not configured' }, { status: 503 })
  }

  if (mode !== 'subscribe' || !challenge || !verifyToken || verifyToken !== expected) {
    return NextResponse.json({ error: 'Verification token mismatch' }, { status: 403 })
  }

  return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

// POST — leadgen events.
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    console.warn('[meta leads webhook] rejeitado — assinatura inválida')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: { entry?: LeadgenWebhookEntry[] }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  after(async () => {
    try {
      await processWebhook(body)
    } catch (error) {
      console.error('[meta leads webhook] erro a processar webhook:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processWebhook(body: { entry?: LeadgenWebhookEntry[] }) {
  if (!body.entry) return

  for (const entry of body.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'leadgen') continue

      const value = change.value
      if (!value?.leadgen_id) {
        console.warn('[meta leads webhook] evento leadgen sem leadgen_id — ignorado.')
        continue
      }

      const pageId = value.page_id || entry.id
      const config = await findConfigForPage(supabaseAdmin(), pageId)
      if (!config) {
        console.error(
          `[meta leads webhook] sem whatsapp_config.meta_page_id a corresponder a page_id=${pageId} — ` +
            `lead descartado (leadgen_id=${value.leadgen_id}).`,
        )
        continue
      }

      try {
        await processLeadgenEvent(supabaseAdmin(), config, value)
      } catch (error) {
        console.error(
          `[meta leads webhook] falha a processar leadgen_id=${value.leadgen_id}:`,
          error instanceof Error ? error.message : error,
        )
      }
    }
  }
}
