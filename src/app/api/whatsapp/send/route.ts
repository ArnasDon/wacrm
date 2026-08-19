import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import {
  sendMessageToConversation,
  validateSendMessageParams,
  SendMessageError,
} from '@/lib/whatsapp/send-message'
import { findOrCreateConversation } from '@/lib/whatsapp/find-or-create-conversation'

// The dashboard's outbound-send endpoint. It owns auth, per-user rate
// limiting, and the two ways the UI targets a thread — an existing
// `conversation_id` (inbox) or a `contact_id` (Contact detail →
// find-or-create the conversation). The actual Meta plumbing (validate
// → send → persist → pause flows) lives in the shared
// `sendMessageToConversation` core, which the public `/api/v1/messages`
// endpoint reuses. This route is a thin adapter: resolve the
// conversation, delegate, then map `SendMessageError` back onto the
// dashboard's internal `{ error }` shape.
export async function POST(request: Request) {
  try {
    // Requires the 'agent' role, matching both `canSendMessages` and the
    // `messages_modify` RLS policy (migration 017).
    //
    // Resolving `account_id` off the profile — which any 'viewer' has —
    // was previously the only gate. RLS did block the message INSERT, but
    // the send core calls Meta BEFORE it persists, so a viewer's request
    // still delivered a real WhatsApp message to the customer and merely
    // failed to record it (surfacing as "sent to Meta but failed to save
    // to DB"). RLS can't un-send that, so the role check belongs here.
    const { supabase, accountId, userId } = await requireRole('agent')

    // Per-user rate limit. Bucket key is scoped to this route so
    // `/broadcast` has an independent budget.
    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      // `conversation_id` targets an existing thread (inbox). `contact_id`
      // lets a caller initiate from a contact that may have no conversation
      // yet (Contact detail → Send template) — we find-or-create one below.
      conversation_id: conversationIdInput,
      contact_id,
      message_type,
      content_text,
      media_url,
      filename,
      template_name,
      template_language,
      template_params,
      template_message_params,
      interactive_payload,
      reply_to_message_id,
      // BLOCO 3/4: when a compose was primed from a follow-up suggestion
      // in the Central de IA ("Enviar pelo CRM"), the composer threads
      // this id through so a successful send auto-resolves that specific
      // suggestion — see the block below. Absent for every other send;
      // zero effect on the existing send paths.
      followup_suggestion_id,
      // Central de Ações' Follow-up "Enviar mensagem" (action-item-detail-
      // sheet.tsx) threads the action_items.id through so this same send
      // request also claims the single-send guard — see the block below.
      // Absent for every other send; zero effect on the existing paths.
      action_item_id,
    } = body

    if ((!conversationIdInput && !contact_id) || !message_type) {
      return NextResponse.json(
        {
          error:
            'Either conversation_id or contact_id, plus message_type, are required',
        },
        { status: 400 }
      )
    }

    // Validate the message shape up front — before the contact_id path
    // finds-or-creates a conversation — so an invalid payload 400s
    // without leaving an orphan empty conversation behind.
    try {
      validateSendMessageParams({
        messageType: message_type,
        contentText: content_text,
        mediaUrl: media_url,
        templateName: template_name,
        interactivePayload: interactive_payload,
      })
    } catch (err) {
      if (err instanceof SendMessageError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }

    // Resolve the target conversation. With `conversation_id` we load the
    // existing thread; with `contact_id` we find-or-create one for the
    // contact so a business-initiated template send (Contact detail view)
    // reuses the shared send core below.
    let conversationId: string | null = null

    if (conversationIdInput) {
      const { data, error: convError } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversationIdInput)
        .eq('account_id', accountId)
        .single()

      if (convError || !data) {
        return NextResponse.json(
          { error: 'Conversation not found' },
          { status: 404 }
        )
      }
      conversationId = data.id
    } else {
      // contact_id path: verify the contact is in this account first so a
      // caller can't open a conversation against someone else's contact.
      const { data: contactRow, error: contactErr } = await supabase
        .from('contacts')
        .select('id')
        .eq('id', contact_id)
        .eq('account_id', accountId)
        .maybeSingle()

      if (contactErr || !contactRow) {
        return NextResponse.json(
          { error: 'Contact not found' },
          { status: 404 }
        )
      }

      const resolved = await findOrCreateConversation(
        supabase,
        accountId,
        userId,
        contact_id
      )
      if (!resolved) {
        return NextResponse.json(
          { error: 'Failed to open a conversation for this contact' },
          { status: 500 }
        )
      }
      conversationId = resolved
    }

    if (!conversationId) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    // Central de Ações Follow-up single-send guard (migration 072):
    // claim `action_items.followup_sent_at` atomically — a conditional
    // UPDATE, not a SELECT-then-write — so two concurrent requests for
    // the same Follow-up (double click, two tabs, or the Pipeline and
    // Central de Ações entry points both open the same row) can't both
    // win. Only one `UPDATE ... WHERE followup_sent_at IS NULL` affects
    // a row; the loser gets back no row and is rejected here, BEFORE
    // Meta is ever called — the backend, not client `disabled` state, is
    // the actual barrier (AGENTS task §10). `rescheduleFollowup` clears
    // this column when a new follow-up cycle starts, so a later,
    // legitimate resend is never permanently blocked.
    let claimedActionItemId: string | null = null
    if (typeof action_item_id === 'string' && action_item_id) {
      const { data: claimed, error: claimError } = await supabase
        .from('action_items')
        .update({ followup_sent_at: new Date().toISOString() })
        .eq('id', action_item_id)
        .eq('account_id', accountId)
        .eq('conversation_id', conversationId)
        .eq('type', 'followup')
        .is('followup_sent_at', null)
        .select('id')
        .maybeSingle()
      if (claimError) {
        return NextResponse.json(
          { error: 'Failed to check follow-up send status' },
          { status: 500 }
        )
      }
      if (!claimed) {
        return NextResponse.json(
          { error: 'Este follow-up já teve uma mensagem enviada.' },
          { status: 409 }
        )
      }
      claimedActionItemId = claimed.id
    }

    // Delegate to the shared send core (validates, sends to Meta with
    // phone-variant retry, persists, pauses active flow runs). Its
    // `SendMessageError` carries a machine code + HTTP status; the
    // dashboard maps it to the internal `{ error }` shape.
    try {
      const result = await sendMessageToConversation(supabase, accountId, {
        conversationId,
        messageType: message_type,
        contentText: content_text,
        mediaUrl: media_url,
        filename,
        templateName: template_name,
        templateLanguage: template_language,
        templateParams: template_params,
        templateMessageParams: template_message_params,
        interactivePayload: interactive_payload,
        replyToMessageId: reply_to_message_id,
        senderId: userId,
      })

      // Best-effort, never blocks the response: a successful send from a
      // follow-up-primed composer resolves that suggestion automatically
      // (BLOCO 3/4 spec: "Registrar o envio no histórico" right when the
      // send happens). Scoped by account_id + status='pending' so a stale
      // or already-resolved id is silently a no-op, never an error here —
      // "Follow-up realizado" in the Central de IA remains available as a
      // manual fallback either way.
      if (typeof followup_suggestion_id === 'string' && followup_suggestion_id) {
        try {
          const { error: resolveError } = await supabase
            .from('ai_suggestions')
            .update({
              status: 'done',
              resolved_by: userId,
              resolved_at: new Date().toISOString(),
              snoozed_until: null,
            })
            .eq('id', followup_suggestion_id)
            .eq('account_id', accountId)
            .eq('category', 'followup')
            .eq('status', 'pending')
          if (resolveError) {
            console.error('[whatsapp/send] follow-up auto-resolve failed:', resolveError)
          }
        } catch (err) {
          console.error('[whatsapp/send] follow-up auto-resolve threw:', err)
        }
      }

      return NextResponse.json({
        success: true,
        message_id: result.messageId,
        whatsapp_message_id: result.whatsappMessageId,
      })
    } catch (err) {
      // The send itself failed — release the claim above so this
      // cycle's guard isn't permanently burned by a transient error;
      // the user can just retry.
      if (claimedActionItemId) {
        await supabase
          .from('action_items')
          .update({ followup_sent_at: null })
          .eq('id', claimedActionItemId)
      }
      if (err instanceof SendMessageError) {
        return NextResponse.json(
          { error: err.message },
          { status: err.status }
        )
      }
      throw err
    }
  } catch (error) {
    // requireRole throws Unauthorized/Forbidden; toErrorResponse maps
    // those to 401/403 and collapses anything else to a generic 500.
    console.error('Error in WhatsApp send POST:', error)
    return toErrorResponse(error)
  }
}
