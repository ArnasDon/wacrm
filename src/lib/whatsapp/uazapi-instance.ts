/**
 * Uazapi instance attachment — verify a token's status and configure
 * the inbound webhook. Distinct from `providers/uazapi.ts` (message
 * send/receive), which handles day-to-day send/receive traffic.
 *
 * wacrm's role is deliberately narrow: it never creates an instance
 * (no admin-token `/instance/create`) and never drives the WhatsApp
 * session lifecycle (no `/instance/connect` QR flow, no
 * `/instance/disconnect`). The instance is created AND logged in
 * directly in the Uazapi panel by whoever manages it; wacrm only
 * attaches to an already-authenticated instance token, receives
 * inbound messages via webhook, and sends through the same token
 * (see /api/uazapi/instance and /api/uazapi/webhook/[configId]).
 */

interface UazapiErrorBody {
  error?: string
  message?: string
}

async function throwUazapiError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as UazapiErrorBody
    message = data.error || data.message || fallback
  } catch {
    // not JSON — keep fallback
  }
  throw new Error(message)
}

function baseUrlOf(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '')
}

export interface InstanceStatusArgs {
  baseUrl: string
  instanceToken: string
}

export interface InstanceStatusResult {
  connected: boolean
  loggedIn: boolean
}

/**
 * GET /instance/status — used purely to (a) validate a token when
 * it's first attached and (b) show the WhatsApp session's live state
 * in Settings. Never followed by a connect/pairing call.
 */
export async function getInstanceStatus(args: InstanceStatusArgs): Promise<InstanceStatusResult> {
  const response = await fetch(`${baseUrlOf(args.baseUrl)}/instance/status`, {
    headers: { token: args.instanceToken },
  })
  if (!response.ok) {
    await throwUazapiError(response, `Uazapi instance status failed: ${response.status}`)
  }
  const data = (await response.json()) as { status?: { connected?: boolean; loggedIn?: boolean } }
  return {
    connected: Boolean(data.status?.connected),
    loggedIn: Boolean(data.status?.loggedIn),
  }
}

export interface ConfigureWebhookArgs {
  baseUrl: string
  instanceToken: string
  url: string
  events?: string[]
}

/** POST /webhook — points the instance's inbound events at our route. Idempotent. */
export async function configureWebhook(args: ConfigureWebhookArgs): Promise<void> {
  const response = await fetch(`${baseUrlOf(args.baseUrl)}/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      token: args.instanceToken,
    },
    body: JSON.stringify({
      url: args.url,
      events: args.events || ['messages', 'connection'],
      enabled: true,
    }),
  })
  if (!response.ok) {
    await throwUazapiError(response, `Uazapi webhook configuration failed: ${response.status}`)
  }
}
