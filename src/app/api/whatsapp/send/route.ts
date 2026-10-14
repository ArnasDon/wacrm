import { withAccount, getLocalAccountContext } from '@/lib/db/context';
import { hasMinRole } from '@/lib/auth/roles';
import {
  RequestError,
  assertSameOrigin,
  localErrorResponse,
} from '@/lib/api/local-route';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { queryRows } from '@/lib/db/rows';
import { sendLocalMessage } from '@/lib/whatsapp/send-message-local';
import {
  SendMessageError,
  validateSendMessageParams,
  type SendMessageParams,
} from '@/lib/whatsapp/send-message-shared';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const context = await getLocalAccountContext();
    if (!hasMinRole(context.role, 'agent'))
      throw new RequestError('Insufficient permissions.', 403);
    const limit = checkRateLimit(`send:${context.userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new RequestError('A JSON object is required.');
    const conversationIdInput =
      typeof body.conversation_id === 'string' ? body.conversation_id : '';
    const contactId =
      typeof body.contact_id === 'string' ? body.contact_id : '';
    if (
      (!conversationIdInput && !contactId) ||
      typeof body.message_type !== 'string'
    )
      throw new RequestError(
        'Either conversation_id or contact_id, plus message_type, are required.'
      );
    const params: SendMessageParams = {
      conversationId: conversationIdInput,
      messageType: body.message_type,
      contentText:
        typeof body.content_text === 'string' ? body.content_text : null,
      mediaUrl: typeof body.media_url === 'string' ? body.media_url : null,
      filename: typeof body.filename === 'string' ? body.filename : null,
      templateName:
        typeof body.template_name === 'string' ? body.template_name : null,
      templateLanguage:
        typeof body.template_language === 'string'
          ? body.template_language
          : null,
      templateParams: Array.isArray(body.template_params)
        ? body.template_params.filter(
            (value): value is string => typeof value === 'string'
          )
        : undefined,
      templateMessageParams: body.template_message_params,
      interactivePayload:
        body.interactive_payload && typeof body.interactive_payload === 'object'
          ? (body.interactive_payload as InteractiveMessagePayload)
          : null,
      replyToMessageId:
        typeof body.reply_to_message_id === 'string'
          ? body.reply_to_message_id
          : null,
    };
    validateSendMessageParams(params);
    if (
      params.replyToMessageId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        params.replyToMessageId
      )
    )
      throw new SendMessageError(
        'bad_request',
        'Invalid reply_to_message_id.',
        400
      );
    if (
      conversationIdInput &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        conversationIdInput
      )
    )
      throw new SendMessageError('not_found', 'Conversation not found.', 404);
    if (
      contactId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        contactId
      )
    )
      throw new SendMessageError('not_found', 'Contact not found.', 404);

    params.conversationId = await withAccount(context, async (db) => {
      if (conversationIdInput) {
        const rows = await queryRows<{ id: string }>(
          db,
          'SELECT id FROM public.conversations WHERE id=$1 AND account_id=$2',
          [conversationIdInput, context.accountId]
        );
        if (!rows[0])
          throw new SendMessageError(
            'not_found',
            'Conversation not found.',
            404
          );
        return rows[0].id;
      }
      // Serialize creation for a contact so concurrent sends converge on one thread.
      const contacts = await queryRows<{ id: string }>(
        db,
        'SELECT id FROM public.contacts WHERE id=$1 AND account_id=$2 FOR UPDATE',
        [contactId, context.accountId]
      );
      if (!contacts[0])
        throw new SendMessageError('not_found', 'Contact not found.', 404);
      const existing = await queryRows<{ id: string }>(
        db,
        'SELECT id FROM public.conversations WHERE account_id=$1 AND contact_id=$2 ORDER BY created_at LIMIT 1',
        [context.accountId, contactId]
      );
      if (existing[0]) return existing[0].id;
      const created = await queryRows<{ id: string }>(
        db,
        'INSERT INTO public.conversations(user_id,account_id,contact_id) VALUES($1,$2,$3) RETURNING id',
        [context.userId, context.accountId, contactId]
      );
      return created[0].id;
    });
    const result = await sendLocalMessage(context, params);
    return Response.json({
      success: true,
      message_id: result.messageId,
      whatsapp_message_id: result.whatsappMessageId,
    });
  } catch (error) {
    if (error instanceof SendMessageError)
      return Response.json(
        { error: error.message },
        {
          status: error.status,
          headers: { 'Cache-Control': 'private, no-store' },
        }
      );
    return localErrorResponse(error);
  }
}
