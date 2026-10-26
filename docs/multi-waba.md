# Several WhatsApp Business Accounts on one wacrm deployment

Issue #500 asked how one deployment can serve accounts whose numbers
belong to different WhatsApp Business Accounts (WABAs), given that
`META_APP_SECRET` and `META_APP_ID` are deployment-wide environment
variables. Short answer: WABAs are already per account; only the Meta
*App* is deployment-wide, and since #500 the webhook accepts several
app secrets. This page walks through the three setups.

## What is per account and what is per deployment

| Value | Lives in | Scope |
| --- | --- | --- |
| Phone Number ID, WABA ID, access token, verify token, two-step PIN | `whatsapp_config` (one row per wacrm account, token encrypted) | per account |
| Webhook callback URL | your Meta App → WhatsApp → Configuration | per Meta App |
| `META_APP_SECRET` | server environment | per deployment — **may list several** |
| `META_APP_ID` | server environment | per deployment — single value |

Meta signs every webhook delivery with the secret of the App the WABA
is subscribed to. wacrm checks that signature against
`META_APP_SECRET` before it looks at the body, then routes the payload
to the account whose row holds the `phone_number_id` in the delivery.

## Setup A — many accounts, one Meta App, many WABAs (works out of the box)

This is the normal case for an agency or a company with several
brands. Nothing to configure beyond a single-tenant install.

1. Create one Meta App and add the WhatsApp product. Under
   **WhatsApp → Configuration** set the callback URL to
   `https://<your host>/api/whatsapp/webhook` and subscribe to the
   `messages` field. Set `META_APP_SECRET` to this app's secret.
2. For each WABA, make sure the Business portfolio that owns it has
   access to the app (Business Settings → Accounts → WhatsApp accounts →
   Assigned assets, or add the WABA through the app's WhatsApp product).
3. Each wacrm account opens Settings → WhatsApp connection and enters
   its own Phone Number ID, WABA ID, a System User access token that
   can manage *that* WABA, a verify token, and (for production numbers)
   the two-step PIN.

On save, wacrm verifies the number with the token, registers it
(`POST /{phone_number_id}/register`, PIN required) and subscribes the
WABA to the app (`POST /{waba_id}/subscribed_apps`).
From then on Meta delivers every WABA's events to the one callback URL
and wacrm fans them out by `phone_number_id`.

Constraints:

* One phone number can be connected to one wacrm account only — the
  route refuses a `phone_number_id` already claimed by another account.
* The **verify token** typed into the Meta App's webhook settings must
  equal the verify token saved by at least one wacrm account; the
  handshake (`GET /api/whatsapp/webhook`) accepts any account's token.
  Using the same string in every account keeps this simple.

## Setup B — WABAs under different Meta Apps

Sometimes the WABAs cannot share an app: two clients each own their own
Meta App and portfolio, or an existing app cannot be granted access to
another business's WABA. Each app signs webhooks with its own secret,
so wacrm needs all of them.

1. In **every** Meta App, set the same callback URL
   (`https://<your host>/api/whatsapp/webhook`) and subscribe to
   `messages`. Use a verify token that at least one wacrm account has
   saved (see the note above).
2. Set `META_APP_SECRET` to the comma-separated list of all those apps'
   secrets:

   ```
   META_APP_SECRET=secret-of-app-one,secret-of-app-two
   ```

   Whitespace around commas is ignored, empty slots are dropped. A
   delivery is accepted when its `X-Hub-Signature-256` matches **any**
   listed secret; each comparison is constant-time. An empty or
   comma-only value still fails closed — every request is rejected.
3. Each wacrm account connects its number exactly as in setup A, using a
   token generated inside the Business portfolio that owns its app.
   The save subscribes the WABA to *that* app (the one the token
   belongs to).

Rotating a secret: add the new one to the list, redeploy, then rotate
in Meta, then remove the old one. Deliveries keep verifying throughout.

## Setup C — what is not supported: a per-account Meta App ID

`META_APP_ID` is used for exactly one thing: Meta's Resumable Upload
when a message template has an **image header** (the header sample must
be an app-scoped upload handle, not a URL). It is a single value.

With setup B, every account's image-header template upload therefore
goes through the one app named in `META_APP_ID`, authenticated with
that account's own token. If the account's token was generated under a
different app's portfolio, Meta rejects the upload and the template
submit returns that error. Text-only templates, sending, receiving and
everything else are unaffected.

Workarounds until a per-account app id exists:

* Put the WABAs that need image-header templates under the app named
  in `META_APP_ID`; or
* Create image-header templates directly in WhatsApp Manager — once
  approved, wacrm lists and sends them like any other template.

A per-account `app_id` column on `whatsapp_config` would lift this; it
is not planned for the near term because the only consumer is the
template header upload.

## Checking a multi-WABA deployment

* Settings → WhatsApp connection → **Verify with Meta** runs, per
  account, the per-check diagnostic (`phone_metadata_ok`,
  `waba_subscribed_to_app`, `locally_marked_registered`).
  `waba_subscribed_to_app` false means the save never managed to
  subscribe the WABA to its app — re-enter the token and save again.
* A webhook delivery that is rejected with 401 means no configured
  secret produced its signature — the WABA is subscribed to an app
  whose secret is missing from `META_APP_SECRET`.
