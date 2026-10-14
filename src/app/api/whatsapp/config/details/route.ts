import { accountRoute, readObject, RequestError } from '@/lib/api/local-route';
import {
  readWhatsAppConfig,
  setMirrorPreference,
} from '@/lib/db/whatsapp-config';
export function GET(request: Request) {
  return accountRoute(request, 'viewer', async (db, ctx) => {
    const raw = await readWhatsAppConfig(db, ctx.accountId);
    if (!raw) return { config: null };
    // Never return encrypted tokens either: this endpoint is form metadata.
    return {
      config: {
        id: raw.id,
        user_id: raw.user_id,
        phone_number_id: raw.phone_number_id,
        waba_id: raw.waba_id,
        status: raw.status,
        connected_at: raw.connected_at,
        registered_at: raw.registered_at,
        subscribed_apps_at: raw.subscribed_apps_at,
        last_registration_error: raw.last_registration_error,
        mirror_inbound_media: raw.mirror_inbound_media,
      },
    };
  });
}
export function PATCH(request: Request) {
  return accountRoute(request, 'admin', async (db, ctx) => {
    const { mirror_inbound_media } = await readObject(request);
    if (typeof mirror_inbound_media !== 'boolean')
      throw new RequestError('Invalid media preference.');
    await setMirrorPreference(db, ctx.accountId, mirror_inbound_media);
    return { ok: true };
  });
}
