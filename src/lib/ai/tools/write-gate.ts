// ============================================================
// The write gate — central security rule for the EterWA agent's
// calendar tools (see the Fase 2 task brief: "nos workflows n8n
// analisados, deixar o LLM chamar DELETE_CALENDAR directamente é a
// falha mais perigosa. Não a repetimos.").
//
// This is enforced as a MECHANISM, not a prompt instruction: the tool
// handlers for `book_meeting` / `reschedule` / `cancel_booking`
// (src/lib/ai/tools/handlers/*.ts) are structurally unable to touch
// Google Calendar or `bookings` — they only ever write a row to
// `agent_pending_actions` (via pending-actions.repo.ts) and tell the
// model the proposal is awaiting confirmation. The only code path that
// performs the actual mutation is `confirmPendingAction` below, and
// that is meant to be called by product code — e.g. the WhatsApp
// inbound webhook, once it detects the lead's explicit "sim, confirmo"
// in a later message — never by the model itself. A prompt telling the
// model "don't book without confirmation" is not a guarantee (models
// can be prompt-injected, can misread ambiguous confirmation, can just
// be wrong); a handler that CANNOT perform the write is.
// ============================================================

import type { ToolDefinition } from './schema'

const WRITE_TOOL_NAMES = new Set(['book_meeting', 'reschedule', 'cancel_booking'])

export function isWriteTool(toolName: string): boolean {
  return WRITE_TOOL_NAMES.has(toolName)
}

/** Read tools (`check_availability`, `find_event`) plus every tool
 *  that isn't a gated write — everything except the three calendar
 *  mutations executes immediately when the model calls it. */
export function isDirectlyExecutableTool(toolName: string, allTools: readonly ToolDefinition[]): boolean {
  return allTools.some((t) => t.name === toolName) && !isWriteTool(toolName)
}
