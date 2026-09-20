import { describe, it, expect } from 'vitest'
import {
  ETER_AGENT_TOOLS,
  COMMERCIAL_MODE_DISABLED_TOOL_NAMES,
  getEterAgentTools,
} from './schema'

// ============================================================
// Bloco 3-A — the commercial persona qualifies a lead and hands over a
// scheduling link; it must never book/move/cancel a meeting itself.
// getEterAgentTools is the single place that enforces the exclusion for
// whichever call site eventually wires ETER_AGENT_TOOLS into a model
// turn (see the doc comment in schema.ts — nothing does yet).
// ============================================================

describe('getEterAgentTools', () => {
  it('returns every tool unfiltered for the normal (non-commercial) persona', () => {
    expect(getEterAgentTools({ commercial: false })).toBe(ETER_AGENT_TOOLS)
  })

  it('drops book_meeting, reschedule, and cancel_booking for the commercial persona', () => {
    const names = getEterAgentTools({ commercial: true }).map((t) => t.name)
    for (const disabled of COMMERCIAL_MODE_DISABLED_TOOL_NAMES) {
      expect(names).not.toContain(disabled)
    }
  })

  it('keeps every non-calendar-write tool for the commercial persona', () => {
    const commercialNames = getEterAgentTools({ commercial: true }).map((t) => t.name)
    const expectedKept = ETER_AGENT_TOOLS.map((t) => t.name).filter(
      (n) => !COMMERCIAL_MODE_DISABLED_TOOL_NAMES.has(n),
    )
    expect(commercialNames.sort()).toEqual(expectedKept.sort())
  })
})
