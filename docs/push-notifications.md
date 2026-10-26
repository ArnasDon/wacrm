# Push notifications (phone + closed browser)

WACRM can notify you of new customer messages **even when no browser tab is open**, using standard
Web Push (service worker + VAPID). On Android Chrome the notification has **Reply** (type right in the
notification) and **Open chat** actions. No Firebase account and no extra service are needed.

The older in-tab alert (Settings → Browser notifications) still works; a device that turns Push on is
served by the service worker instead, so you never get duplicates.

## One-time setup (self-hosters)

1. **Apply the migration** `supabase/migrations/060_push_subscriptions.sql` in the Supabase SQL editor.
   It only *adds* one new table; nothing existing is changed.
2. **Generate VAPID keys** (any computer with Node): `npx web-push generate-vapid-keys`
3. **Add three environment variables** to the WACRM app (Coolify → app → Environment Variables):
   - `VAPID_PUBLIC_KEY` — the "Public Key"
   - `VAPID_PRIVATE_KEY` — the "Private Key" (**secret**, server only)
   - `VAPID_SUBJECT` — `mailto:you@yourdomain.com`
   Keys are read at runtime; redeploy/restart once so the app sees them.
4. The site must be served over **HTTPS** (it already is for WhatsApp).

## Turn it on (each phone / computer)

1. Open WACRM in **Chrome on the phone** → ⋮ menu → **Add to Home screen / Install app** (recommended).
2. Settings → Browser notifications → switch on the browser alert, then **"Phone & closed-browser alerts (push)"**.
3. Allow notifications when asked, then press **Send test push**. A notification should appear in seconds.

## How it works

`WhatsApp → /api/whatsapp/webhook → (existing idempotent insert) → notifyInboundPush → Web Push service → service worker (public/sw.js) → notification`

- Payload (encrypted in transit) contains only: conversation id, contact name, short preview, link, time.
- A message replayed by Meta is already dropped by the existing idempotent insert, so it cannot notify twice.
- One alert per conversation (`tag`): a new message replaces the old alert.
- If you are already looking at that chat on a visible tab, no alert is shown.
- Expired subscriptions (HTTP 404/410) are removed automatically. A device re-registers itself whenever WACRM is opened.
- Every member who turned push on receives alerts for the account's incoming messages.

## Quick reply

The **Reply** action uses the browser's inline text box (`NotificationAction type: "text"`), supported
by Chrome on Android. Your reply is sent with your logged-in session to the existing `POST /api/whatsapp/send`
(same role check, same rate limit, same 24-hour WhatsApp rule). It then shows **Reply sent ✓** or **Reply NOT sent**
with a **Retry** button. Browsers without inline text support open the chat instead.
If your login session has expired the notification says so; open WACRM and sign in again.

## Roll back

Remove the three env vars (push turns itself off; nothing else is affected) and, optionally,
`DROP TABLE push_subscriptions;`. Delete `public/sw.js` to remove the service worker entirely.

## Known limits

- iPhone/iOS only supports Web Push for apps added to the Home Screen (iOS 16.4+) and has no inline reply.
- Android battery-saver or "Restricted" battery mode for Chrome can delay or block pushes.
- A reply whose confirmation is lost to a network drop can be sent twice if you press Retry.
