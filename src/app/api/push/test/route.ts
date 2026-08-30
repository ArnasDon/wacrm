import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { checkSharedRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { sendPushToUser } from '@/lib/push/send';
import { isPushConfigured } from '@/lib/push/vapid';

/**
 * POST /api/push/test — sends a test notification to the caller's own
 * devices. Wired to the "Enviar prueba" button in Settings so a user
 * can confirm end-to-end delivery right after enabling.
 */
export async function POST() {
  try {
    const { supabase, userId } = await getCurrentAccount();

    if (!isPushConfigured()) {
      return NextResponse.json({ error: 'Push is not configured on this server' }, { status: 503 });
    }

    const limit = await checkSharedRateLimit(`push-test:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const result = await sendPushToUser(supabase, userId, {
      title: 'Chat Sandía',
      body: 'Las notificaciones push están funcionando en este dispositivo. ✅',
      url: '/notifications',
      tag: 'push-test',
    });

    if (result.sent === 0) {
      return NextResponse.json(
        { error: 'No hay dispositivos suscritos', ...result },
        { status: 409 },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
