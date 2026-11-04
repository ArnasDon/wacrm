import type { SupabaseClient } from '@supabase/supabase-js'
import { groupInboundMessages } from './activity-grouping'
import type { ActivityItem } from './types'
import { getT } from '@/lib/i18n/translate'

const BROADCAST_STATUS_KEYS = new Set(['draft', 'scheduled', 'sending', 'sent', 'failed'])

type DB = SupabaseClient

export async function loadActivity(db: DB, limit = 20): Promise<ActivityItem[]> {
  const [msgs, contacts, deals, broadcasts, autoLogs] = await Promise.all([
    db
      .from('messages')
      .select('id, content_text, sender_type, created_at, conversation_id, conversations(contact_id, contacts(name, phone))')
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(40),
    db
      .from('contacts')
      .select('id, name, phone, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('deals')
      .select('id, title, updated_at, stage:pipeline_stages(name)')
      .order('updated_at', { ascending: false })
      .limit(10),
    db
      .from('broadcasts')
      .select('id, name, status, total_recipients, created_at')
      .order('created_at', { ascending: false })
      .limit(5),
    db
      .from('automation_logs')
      .select('id, trigger_event, status, created_at, automation:automations(name), contact:contacts(name, phone)')
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const items: ActivityItem[] = []
  const t = getT('Dashboard.activityFeed.items')

  const inbound = (msgs.data ?? []) as unknown as Array<{
    id: string
    created_at: string
    conversation_id: string
    conversations:
      | { contact_id: string | null; contacts: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null }[]
      | { contact_id: string | null; contacts: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null }
      | null
  }>

  const grouped = groupInboundMessages(
    inbound.map((m) => {
      const conv = Array.isArray(m.conversations) ? m.conversations[0] : m.conversations
      const contact = Array.isArray(conv?.contacts) ? conv?.contacts[0] : conv?.contacts
      return {
        id: m.id,
        conversationId: m.conversation_id,
        who: contact?.name || contact?.phone || t('unknown'),
        at: m.created_at,
      }
    }),
  )

  for (const g of grouped) {
    items.push({
      id: `msg-${g.id}`,
      kind: 'message',
      text: g.count > 1 ? t('newMessages', { who: g.who, count: g.count }) : t('newMessage', { who: g.who }),
      at: g.at,
      href: `/inbox?c=${g.conversationId}`,
    })
  }

  for (const c of (contacts.data ?? []) as Array<{ id: string; name: string | null; phone: string; created_at: string }>) {
    items.push({
      id: `contact-${c.id}`,
      kind: 'contact',
      text: t('newContact', { name: c.name || c.phone }),
      at: c.created_at,
      href: '/contacts',
    })
  }

  for (const d of (deals.data ?? []) as unknown as Array<{
    id: string
    title: string
    updated_at: string
    stage: { name: string }[] | { name: string } | null
  }>) {
    const stage = Array.isArray(d.stage) ? d.stage[0] : d.stage
    items.push({
      id: `deal-${d.id}`,
      kind: 'deal',
      text: stage?.name
        ? t('dealInStage', { title: d.title, stage: stage.name })
        : t('dealUpdated', { title: d.title }),
      at: d.updated_at,
      href: '/pipelines',
    })
  }

  for (const b of (broadcasts.data ?? []) as Array<{
    id: string
    name: string
    status: string
    total_recipients: number
    created_at: string
  }>) {
    const count = String(b.total_recipients)
    const status = BROADCAST_STATUS_KEYS.has(b.status)
      ? t(`broadcastStatusNames.${b.status}`)
      : b.status
    items.push({
      id: `broadcast-${b.id}`,
      kind: 'broadcast',
      text:
        b.status === 'sent'
          ? t('broadcastSent', { name: b.name, count })
          : t('broadcastStatus', { name: b.name, status, count }),
      at: b.created_at,
      href: '/broadcasts',
    })
  }

  for (const l of (autoLogs.data ?? []) as unknown as Array<{
    id: string
    trigger_event: string
    status: string
    created_at: string
    automation: { name: string }[] | { name: string } | null
    contact: { name: string | null; phone: string }[] | { name: string | null; phone: string } | null
  }>) {
    const automation = Array.isArray(l.automation) ? l.automation[0] : l.automation
    const contact = Array.isArray(l.contact) ? l.contact[0] : l.contact
    const who = contact?.name || contact?.phone || t('aContact')
    const autoName = automation?.name || t('automationFallback')
    items.push({
      id: `auto-${l.id}`,
      kind: 'automation',
      text: t(l.status === 'failed' ? 'automationFailed' : 'automationTriggered', { name: autoName, who }),
      at: l.created_at,
    })
  }

  return items
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, limit)
}
