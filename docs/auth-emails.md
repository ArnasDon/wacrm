# Auth emails: confirmation and password-reset links

wacrm uses Supabase Auth for sign-up, sign-in and password reset. Two
of those flows send an email with a link, and the link has to come back
to **your** deployment. This page explains how the app asks for that,
what Supabase needs to be told for it to comply, and what the symptoms
look like when it isn't.

## What the app does

Every emailed link is asked to return to the app's own origin at
`/auth/callback`, which exchanges the link for a session and then
forwards to the page the flow needs:

| Flow | Started from | Link returns to |
|---|---|---|
| Email confirmation after sign-up | `/signup` | `/auth/callback?next=/dashboard` (or `/join/<token>` when signing up from an invite) |
| Password reset | `/forgot-password` | `/auth/callback?next=/reset-password` |

"The app's own origin" is the origin the browser loaded the page from
(`window.location.origin`) — `https://crm.example.com` in production,
`http://localhost:3000` in local dev. No environment variable is
involved.

`/auth/callback` accepts both link shapes Supabase can produce — the
default `?code=` (PKCE) and `?token_hash=&type=` from a customised
template — validates `next` so it can only point at a same-origin path,
and redirects with a *relative* `Location`, so it works unchanged
behind Cloudflare Tunnel, nginx, Hostinger, Vercel or any other proxy.

## What Supabase needs

Supabase only honours a requested redirect when it matches its
**Redirect URLs** allow-list. Otherwise it **silently falls back to the
Site URL**, whose default is `http://localhost:3000`. That fallback is
the whole story behind "the confirmation link points at localhost".

### Hosted Supabase (supabase.com)

Dashboard → **Authentication → URL Configuration**:

1. **Site URL** — your production origin, e.g. `https://crm.example.com`.
2. **Redirect URLs** — add a wildcard for every origin the app runs on:

   ```text
   https://crm.example.com/**
   http://localhost:3000/**
   ```

   The `/**` matters: the app's redirect carries a path and a query
   string (`/auth/callback?next=…`), which a bare origin entry does not
   match.

Changes take effect immediately, but an email that was already sent
keeps the link it was sent with — request a fresh one to test.

### Self-hosted Supabase (Docker)

The Studio page under **Authentication → URL Configuration does not
persist settings** on a self-hosted stack; the auth service (GoTrue)
reads them from its environment. In the `.env` next to your
`docker-compose.yml`:

```env
SITE_URL=https://crm.example.com
ADDITIONAL_REDIRECT_URLS=https://crm.example.com/**,http://localhost:3000/**
```

(Older setups name these `GOTRUE_SITE_URL` and `GOTRUE_URI_ALLOW_LIST`.)
Restart the auth container afterwards. A self-hosted stack whose `.env`
still has the example `SITE_URL=http://localhost:3000` produces exactly
the symptom in [issue #595](https://github.com/ArnasDon/wacrm/issues/595).

### Local Supabase CLI (`supabase start`)

`supabase/config.toml` in this repo exists only for the migration CI
job and deliberately carries no `[auth]` section. If you run the local
stack, add:

```toml
[auth]
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/**"]
```

## Opening the link on another device

The default flow is PKCE: the browser that *requested* the email holds
a one-time code verifier in a cookie, and `/auth/callback` needs it to
complete the exchange. Open the link on a different device or browser
and the callback lands on `/login` with a message saying the link
couldn't be used. Two things to know:

- **Email confirmation still succeeded.** Supabase verified the address
  before redirecting; the user can simply sign in.
- **Password reset must be finished in the same browser** it was
  requested from — or request a new link there.

To make links device-independent, switch the Supabase email templates
(**Authentication → Email Templates**) to the token-hash form, which
`/auth/callback` also accepts:

```html
<!-- Confirm signup -->
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/dashboard">Confirm your email</a>

<!-- Reset password -->
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password">Reset your password</a>
```

These links are built from the **Site URL**, so that setting must be
your production origin.

## Symptoms → causes

| You see | Likely cause |
|---|---|
| Link in the email is `http://localhost:3000…` in production | Site URL still at its default and/or your origin missing from Redirect URLs (see above). On self-hosted: `SITE_URL` in the Docker `.env`. |
| Link points at the right domain but a 404 | You're on a build older than the one that added `/auth/callback` and `/reset-password`. Update your fork. |
| `/login` says the link expired | Links are single-use and time-limited (Supabase default: 1 hour for recovery). Request a new one. |
| `/login` says the link couldn't be used | Opened in a different browser than the one that requested it (PKCE), or already used. See the section above. |
| Link works on localhost but not through a tunnel/proxy | Should not happen — the callback redirects with a relative `Location`. Check that your proxy forwards the `/auth/callback` path and its query string untouched. |

## Related

- Invite links (`/join/<token>`) are generated by the app, not by
  Supabase — see `NEXT_PUBLIC_SITE_URL` and `ALLOWED_INVITE_HOSTS` in
  `.env.local.example`.
- Sign-in itself (`/login`) never involves an emailed link.
