import type { MessageStatus } from '@/types'

export const MESSAGE_STATUSES: readonly MessageStatus[] = [
  'sending',
  'sent',
  'delivered',
  'read',
  'failed',
]

const SUCCESS_LADDER: readonly MessageStatus[] = ['sending', 'sent', 'delivered', 'read']

const FAILABLE_FROM: readonly MessageStatus[] = ['sending', 'sent']

export function isMessageStatus(value: unknown): value is MessageStatus {
  return typeof value === 'string' && (MESSAGE_STATUSES as readonly string[]).includes(value)
}

export function canAdvanceMessageStatus(current: string, incoming: string): boolean {
  if (!isMessageStatus(incoming) || !isMessageStatus(current)) return false
  if (incoming === 'failed') return FAILABLE_FROM.includes(current)
  if (current === 'failed') return false
  return SUCCESS_LADDER.indexOf(incoming) > SUCCESS_LADDER.indexOf(current)
}

export function statusesAdvanceableTo(incoming: string): MessageStatus[] {
  return MESSAGE_STATUSES.filter((current) => canAdvanceMessageStatus(current, incoming))
}

function applyOrder(status: string): number {
  const rung = SUCCESS_LADDER.indexOf(status as MessageStatus)
  return rung < 0 ? SUCCESS_LADDER.length : rung
}

export function furthestReachableStatus(
  current: string,
  candidates: readonly string[],
): MessageStatus | null {
  let reached: string = current
  let moved = false
  const ordered = [...candidates].sort((a, b) => applyOrder(a) - applyOrder(b))
  for (const candidate of ordered) {
    if (canAdvanceMessageStatus(reached, candidate)) {
      reached = candidate
      moved = true
    }
  }
  return moved ? (reached as MessageStatus) : null
}
