import { getLocalAccountContext, withAccount } from '@/lib/db/context';
import { queryRows } from '@/lib/db/rows';
import {
  assertSameOrigin,
  RequestError,
  localErrorResponse,
} from '@/lib/api/local-route';
import { hasMinRole } from '@/lib/auth/roles';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { decrypt } from '@/lib/whatsapp/encryption';
import { resolveContactSendTarget } from '@/lib/whatsapp/wa-identity';
import { sendReactionMessage } from '@/lib/whatsapp/meta-api';

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const context = await getLocalAccountContext();
    if (!hasMinRole(context.role, 'agent'))
      throw new RequestError('Insufficient permissions.', 403);
    const limit = checkRateLimit(`react:${context.userId}`, RATE_LIMITS.react);
    if (!limit.success) return rateLimitResponse(limit);
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const messageId = body?.message_id;
    const emoji = body?.emoji;
    if (
      typeof messageId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        messageId
      ) ||
      typeof emoji !== 'string'
    )
      throw new RequestError('message_id and emoji are required.');
    const target = await withAccount(context, async (db) => {
      const rows = await queryRows<{
        wa_message_id: string | null;
        phone_number_id: string;
        access_token: string;
        phone: string;
        wa_user_id: string | null;
      }>(
        db,
        `SELECT m.message_id AS wa_message_id,w.phone_number_id,w.access_token,ct.phone,ct.wa_user_id
         FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id AND c.account_id=$2
         JOIN public.contacts ct ON ct.id=c.contact_id AND ct.account_id=c.account_id
         CROSS JOIN public.whatsapp_config w WHERE m.id=$1 AND w.account_id=c.account_id`,
        [messageId, context.accountId]
      );
      if (!rows[0]) throw new RequestError('Message not found.', 404);
      if (!rows[0].wa_message_id)
        throw new RequestError(
          'Cannot react to a message that has not been sent to WhatsApp.',
          400
        );
      const recipient = resolveContactSendTarget({
        phone: rows[0].phone,
        wa_user_id: rows[0].wa_user_id,
      });
      if (!recipient)
        throw new RequestError(
          'Contact has no phone number or WhatsApp user ID.',
          400
        );
      return { ...rows[0], to: recipient.target };
    });
    try {
      await sendReactionMessage({
        phoneNumberId: target.phone_number_id,
        accessToken: decrypt(target.access_token),
        to: target.to,
        targetMessageId: target.wa_message_id!,
        emoji,
      });
    } catch (error) {
      console.error(
        '[whatsapp/react] Meta send failed:',
        error instanceof Error ? error.message : 'internal'
      );
      return Response.json(
        {
          error: `Meta API error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
        { status: 502 }
      );
    }
    await withAccount(context, async (db) => {
      if (emoji === '') {
        await db.query(
          "DELETE FROM public.message_reactions WHERE message_id=$1 AND actor_type='agent' AND actor_id=$2",
          [messageId, context.userId]
        );
      } else {
        await db.query(
          `INSERT INTO public.message_reactions(message_id,conversation_id,actor_type,actor_id,emoji)
          SELECT m.id,m.conversation_id,'agent',$2,$3 FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
          WHERE m.id=$1 AND c.account_id=$4
          ON CONFLICT(message_id,actor_type,actor_id) DO UPDATE SET emoji=EXCLUDED.emoji,created_at=now()`,
          [messageId, context.userId, emoji, context.accountId]
        );
      }
    });
    return Response.json(
      { success: true },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return localErrorResponse(error);
  }
}
