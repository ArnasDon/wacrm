/**
 * VAPID config for Web Push. Generate a keypair once with
 * `npx web-push generate-vapid-keys` and set:
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY  (also sent to the browser)
 *   VAPID_PRIVATE_KEY             (server only — never exposed)
 *   VAPID_SUBJECT                 (a mailto: or https: contact, optional)
 *
 * When the keys aren't set, push is simply inert: `isPushConfigured()`
 * is false, `sendPushToUser` no-ops, the settings toggle hides itself.
 */
export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function getVapidConfig(): VapidConfig | null {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:soporte@chatsandia.com';
  return { publicKey, privateKey, subject };
}

export function isPushConfigured(): boolean {
  return getVapidConfig() !== null;
}
