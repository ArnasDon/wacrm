export interface AiAccountStatus {
  autoReplyOn: boolean
}

export const AI_ACCOUNT_STATUS_TTL_MS = 30_000

const statusCache = new Map<string, { status: AiAccountStatus; expiresAt: number }>()

export function invalidateAiAccountStatus(accountId?: string): void {
  if (accountId) statusCache.delete(accountId)
  else statusCache.clear()
}

export async function fetchAiAccountStatus(
  accountId: string,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<AiAccountStatus> {
  const cached = statusCache.get(accountId)
  if (cached && cached.expiresAt > now()) return cached.status
  try {
    const res = await fetchImpl('/api/ai/config', { cache: 'no-store' })
    if (!res.ok) return { autoReplyOn: false }
    const j = await res.json()
    const status = {
      autoReplyOn: !!(j?.configured && j?.is_active && j?.auto_reply_enabled),
    }
    statusCache.set(accountId, { status, expiresAt: now() + AI_ACCOUNT_STATUS_TTL_MS })
    return status
  } catch {
    return { autoReplyOn: false }
  }
}
