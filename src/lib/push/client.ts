// Browser-only helpers for Web Push opt-in. Never import from server code.

export const PUSH_PREF_KEY = 'wacrm:push-enabled'
export const PUSH_CHANGE_EVENT = 'wacrm:push-change'

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function readPushPref(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(PUSH_PREF_KEY) === '1'
  } catch {
    return false
  }
}

function writePushPref(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(PUSH_PREF_KEY, '1')
    else window.localStorage.removeItem(PUSH_PREF_KEY)
  } catch {
    /* best effort */
  }
  window.dispatchEvent(new Event(PUSH_CHANGE_EVENT))
}

export function subscribePushPref(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === PUSH_PREF_KEY) onChange()
  }
  window.addEventListener(PUSH_CHANGE_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(PUSH_CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export type EnablePushResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'denied' | 'not_configured' | 'error' }

function sameKey(current: ArrayBuffer | null, wanted: Uint8Array): boolean {
  if (!current) return false
  const a = new Uint8Array(current)
  if (a.length !== wanted.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== wanted[i]) return false
  return true
}

async function ensureSubscription(): Promise<PushSubscription | null> {
  const keyRes = await fetch('/api/push/public-key', { credentials: 'same-origin' })
  if (!keyRes.ok) return null
  const key = (await keyRes.json()) as { configured: boolean; publicKey: string | null }
  if (!key.configured || !key.publicKey) return null

  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  const wanted = urlBase64ToUint8Array(key.publicKey)
  let sub = await reg.pushManager.getSubscription()
  // A subscription made with an older/different VAPID key is rejected by the
  // push service. After keys are rotated, drop it and subscribe again.
  if (sub && !sameKey(sub.options.applicationServerKey, wanted)) {
    await sub.unsubscribe()
    sub = null
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: wanted,
    })
  }
  return sub
}

async function postSubscription(sub: PushSubscription): Promise<boolean> {
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  })
  return res.ok
}

export async function enablePush(): Promise<EnablePushResult> {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' }
  try {
    let perm = Notification.permission
    if (perm === 'default') perm = await Notification.requestPermission()
    if (perm !== 'granted') return { ok: false, reason: 'denied' }

    const keyRes = await fetch('/api/push/public-key', { credentials: 'same-origin' })
    const key = keyRes.ok ? ((await keyRes.json()) as { configured: boolean }) : null
    if (!key || !key.configured) return { ok: false, reason: 'not_configured' }

    const sub = await ensureSubscription()
    if (!sub || !(await postSubscription(sub))) return { ok: false, reason: 'error' }
    writePushPref(true)
    return { ok: true }
  } catch (err) {
    console.error('[push] enable failed:', err)
    return { ok: false, reason: 'error' }
  }
}

export async function disablePush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {})
      await sub.unsubscribe()
    }
  } finally {
    writePushPref(false)
  }
}

/** Re-registers this device on app load so an expired subscription heals itself. */
export async function syncPushSubscription(): Promise<void> {
  if (!isPushSupported() || !readPushPref() || Notification.permission !== 'granted') return
  try {
    const sub = await ensureSubscription()
    if (sub) await postSubscription(sub)
  } catch (err) {
    console.error('[push] sync failed:', err)
  }
}

export interface TestPushResult {
  sent: number
  configured: boolean
  subscriptions: number
  errors: string[]
}

export async function sendTestPush(): Promise<TestPushResult | null> {
  try {
    const res = await fetch('/api/push/test', { method: 'POST', credentials: 'same-origin' })
    if (!res.ok) return null
    return (await res.json()) as TestPushResult
  } catch {
    return null
  }
}
