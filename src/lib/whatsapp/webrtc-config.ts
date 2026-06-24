/**
 * ICE server configuration for the browser softphone.
 *
 * STUN-only by default (Google's public STUN). A TURN relay is
 * required for reliable connectivity behind symmetric NAT / strict
 * firewalls — Phase 6 wires it via these NEXT_PUBLIC_* env vars so no
 * code change is needed to enable it:
 *
 *   NEXT_PUBLIC_TURN_URL=turn:turn.example.com:3478
 *   NEXT_PUBLIC_TURN_USERNAME=...
 *   NEXT_PUBLIC_TURN_CREDENTIAL=...
 *
 * TURN credentials are necessarily visible to the browser; prefer
 * short-lived/ephemeral credentials in production.
 */
export function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ]

  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    })
  }

  return servers
}

/** True when a TURN relay is configured — surfaced in settings/diagnostics. */
export function hasTurnConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_TURN_URL)
}
