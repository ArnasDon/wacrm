/**
 * How a Flow menu node (`send_buttons` / `send_list`) is presented on
 * each channel — the single source of truth shared by the sender
 * (`meta-send.ts`) and the builder's channel preview
 * (`flow-channel-preview.tsx`), so the two can never drift.
 *
 * Two channels matter here:
 *   - `whatsapp` — real interactive messages: reply buttons (≤3) or a
 *     tap-to-open list. Clean body text, options rendered by WhatsApp.
 *   - `meta` — Instagram + Facebook Messenger. Their closest analogue
 *     is a flat row of quick-reply chips, which don't always render on
 *     the customer's client, so we ALSO spell the options into the body
 *     as a numbered list. The flow engine accepts a typed "1" / label
 *     reply (`matchTypedOption`), so the menu stays usable either way.
 *
 * Pure — no DB, no network. Safe to import from a client component.
 */

export type FlowChannel = 'whatsapp' | 'meta'

export interface MenuOption {
  title: string
  reply_id: string
}

export type MenuPresentation =
  | 'native_buttons' // WhatsApp reply buttons
  | 'native_list' // WhatsApp tap-to-open list
  | 'quick_reply_chips' // Instagram / Facebook chips + numbered body

export interface RenderedMenu {
  /** Body text as the customer sees it (numbered list appended for `meta`). */
  body: string
  options: MenuOption[]
  presentation: MenuPresentation
  /** send_list only — the label on the tap-to-open row. */
  buttonLabel?: string
}

/** Read the ordered options off a send_buttons / send_list node config. */
export function flattenMenuOptions(node: {
  node_type: string
  config: Record<string, unknown>
}): MenuOption[] {
  const cfg = node.config as Record<string, unknown>
  if (node.node_type === 'send_buttons') {
    const buttons = Array.isArray(cfg.buttons) ? cfg.buttons : []
    return buttons.map((b) => {
      const r = (b ?? {}) as Record<string, unknown>
      return {
        title: typeof r.title === 'string' ? r.title : '',
        reply_id: typeof r.reply_id === 'string' ? r.reply_id : '',
      }
    })
  }
  if (node.node_type === 'send_list') {
    const sections = Array.isArray(cfg.sections) ? cfg.sections : []
    return sections.flatMap((s) => {
      const rows = Array.isArray((s as Record<string, unknown>)?.rows)
        ? ((s as Record<string, unknown>).rows as unknown[])
        : []
      return rows.map((row) => {
        const r = (row ?? {}) as Record<string, unknown>
        return {
          title: typeof r.title === 'string' ? r.title : '',
          reply_id: typeof r.reply_id === 'string' ? r.reply_id : '',
        }
      })
    })
  }
  return []
}

/**
 * Append the options to a body as a 1-based numbered list. Used for the
 * `meta` channel, where chips are unreliable. No-op when there are no
 * options.
 */
export function appendNumberedOptions(
  body: string,
  options: Array<{ title: string }>,
): string {
  if (options.length === 0) return body
  const list = options.map((o, i) => `${i + 1}. ${o.title}`).join('\n')
  return body ? `${body}\n\n${list}` : list
}

/** Full presentation of a menu node on one channel. */
export function renderMenuForChannel(
  node: { node_type: string; config: Record<string, unknown> },
  channel: FlowChannel,
): RenderedMenu {
  const cfg = node.config as Record<string, unknown>
  const bodyText = typeof cfg.text === 'string' ? cfg.text : ''
  const options = flattenMenuOptions(node)
  const buttonLabel =
    typeof cfg.button_label === 'string' ? cfg.button_label : undefined

  if (channel === 'meta') {
    return {
      body: appendNumberedOptions(bodyText, options),
      options,
      presentation: 'quick_reply_chips',
      buttonLabel,
    }
  }

  return {
    body: bodyText,
    options,
    presentation:
      node.node_type === 'send_list' ? 'native_list' : 'native_buttons',
    buttonLabel,
  }
}
