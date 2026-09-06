import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveBaseUrl } from '@/lib/http/base-url'
import { parseOtpType, sanitizeNext } from '@/lib/auth/confirm-params'

/**
 * Bot-safe landing page for Supabase Auth e-mail links (platform company
 * invite, password recovery — see `inviteUserByEmail` in
 * `api/admin/companies/route.ts` and `resetPasswordForEmail` in
 * `forgot-password/page.tsx`).
 *
 * Why this route exists
 * --------------------
 * The default Supabase e-mail template links straight to Supabase's own
 * `/auth/v1/verify` endpoint, which **consumes the one-time token on any
 * GET** and then 302s to `/auth/callback`. Link-preview and security
 * scanners (WhatsApp, Gmail, Outlook Safe Links, antivirus proxies)
 * fetch that URL to build a preview — burning the token before the real
 * person ever clicks. The recipient then lands on
 * `/login?error=invalid_or_expired_link` ("That link has expired or was
 * already used").
 *
 * The fix: point the e-mail templates at *this* route instead, using
 * `{{ .TokenHash }}` — e.g.
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/reset-password
 *
 * The GET here renders a plain HTML page with a single <form method="POST">
 * button and **no JavaScript** — it does not verify anything. A prefetch
 * bot issues the GET, sees markup, and moves on; the token stays valid.
 * Only when a human clicks "Confirmar y continuar" does the POST call
 * `verifyOtp`, exchange the token for a session, and forward to `next`.
 *
 * `/auth/callback` is kept as-is for links already in flight (and any
 * template still on `{{ .ConfirmationURL }}`); those remain burnable
 * until the templates are swapped, but nothing regresses.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEFAULT_NEXT = '/reset-password'

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function htmlPage(body: string, status = 200): Response {
  return new Response(
    `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Confirma tu acceso</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px; background: #f4f4f5;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #18181b;
  }
  .card {
    width: 100%; max-width: 420px; background: #fff; border: 1px solid #e4e4e7;
    border-radius: 14px; padding: 32px; text-align: center;
    box-shadow: 0 1px 3px rgba(0,0,0,.06);
  }
  .icon {
    width: 48px; height: 48px; margin: 0 auto 16px; border-radius: 12px;
    background: #eef2ff; display: flex; align-items: center; justify-content: center; font-size: 22px;
  }
  h1 { font-size: 19px; margin: 0 0 8px; }
  p { margin: 0 0 20px; color: #52525b; }
  button, a.btn {
    display: inline-block; width: 100%; padding: 11px 16px; border: 0; border-radius: 10px;
    background: #4f46e5; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer;
    text-decoration: none;
  }
  button:hover, a.btn:hover { background: #4338ca; }
  .muted { margin-top: 16px; font-size: 13px; color: #71717a; }
  .muted a { color: #4f46e5; }
  @media (prefers-color-scheme: dark) {
    body { background: #09090b; color: #fafafa; }
    .card { background: #18181b; border-color: #27272a; box-shadow: none; }
    .icon { background: #1e1b4b; }
    p { color: #a1a1aa; }
    .muted { color: #a1a1aa; }
  }
</style>
</head>
<body>
<div class="card">
${body}
</div>
</body>
</html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  )
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = parseOtpType(searchParams.get('type'))
  const next = sanitizeNext(searchParams.get('next'), DEFAULT_NEXT)

  if (!tokenHash || !type) {
    return htmlPage(
      `<div class="icon">⚠️</div>
       <h1>Enlace inválido o incompleto</h1>
       <p>Este enlace no trae la información necesaria. Solicita uno nuevo y ábrelo de inmediato.</p>
       <a class="btn" href="/forgot-password">Solicitar un enlace nuevo</a>`,
      400,
    )
  }

  return htmlPage(
    `<div class="icon">🔒</div>
     <h1>Confirma tu acceso</h1>
     <p>Pulsa el botón para activar tu cuenta y elegir tu contraseña. Este paso evita que el enlace se invalide solo al pasar por WhatsApp o el correo.</p>
     <form method="POST" action="/auth/confirm">
       <input type="hidden" name="token_hash" value="${esc(tokenHash)}" />
       <input type="hidden" name="type" value="${esc(type)}" />
       <input type="hidden" name="next" value="${esc(next)}" />
       <button type="submit">Confirmar y continuar</button>
     </form>
     <div class="muted">¿El enlace ya no funciona? <a href="/forgot-password">Solicita uno nuevo</a>.</div>`,
  )
}

export async function POST(request: Request) {
  const baseUrl = resolveBaseUrl(request)
  const form = await request.formData()
  const tokenHash = String(form.get('token_hash') ?? '')
  const type = parseOtpType(String(form.get('type') ?? ''))
  const next = sanitizeNext(String(form.get('next') ?? ''), DEFAULT_NEXT)

  if (tokenHash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) {
      return NextResponse.redirect(`${baseUrl}${next}`, { status: 303 })
    }
  }

  return NextResponse.redirect(`${baseUrl}/login?error=invalid_or_expired_link`, {
    status: 303,
  })
}
