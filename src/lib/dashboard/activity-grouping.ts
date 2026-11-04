export interface InboundMessageRow {
  id: string
  conversationId: string
  who: string
  at: string
}

export interface InboundMessageGroup {
  id: string
  conversationId: string
  who: string
  at: string
  count: number
}

export function groupInboundMessages(rows: InboundMessageRow[]): InboundMessageGroup[] {
  const groups = new Map<string, InboundMessageGroup>()
  for (const row of rows) {
    const existing = groups.get(row.conversationId)
    if (!existing) {
      groups.set(row.conversationId, { ...row, count: 1 })
      continue
    }
    existing.count += 1
    if (row.at > existing.at) {
      existing.at = row.at
      existing.id = row.id
    }
  }
  return [...groups.values()].sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
}
