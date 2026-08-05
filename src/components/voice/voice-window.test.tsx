import { beforeEach, describe, expect, it, vi } from "vitest"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

// VoiceWindow — tabs (Contacts/Recent/Keypad), incoming (Accept/Reject),
// active (timer, End). El repo NO usa jsdom/testing-library: patrón
// renderToStaticMarkup (node env). La lógica interactiva del keypad se
// extrae a la función pura `appendKey` y se testea directo. (DAD §7.)

vi.mock("@/hooks/use-telnyx", () => ({
  useTelnyx: vi.fn(),
}))

import { VoiceWindow } from "./voice-window"
import { appendKey } from "./voice-keypad-tab"
import { useTelnyx, type UseTelnyxReturn } from "@/hooks/use-telnyx"

const mockUseTelnyx = vi.mocked(useTelnyx)

function baseMock(overrides: Partial<UseTelnyxReturn> = {}): UseTelnyxReturn {
  return {
    connectionStatus: "connected",
    isRegistered: true,
    currentCall: null,
    makeCall: vi.fn(async () => true),
    answer: vi.fn(),
    reject: vi.fn(),
    hangup: vi.fn(),
    toggleMute: vi.fn(),
    toggleHold: vi.fn(),
    sendDTMF: vi.fn(),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  mockUseTelnyx.mockReturnValue(baseMock())
})

describe("appendKey (keypad, lógica pura)", () => {
  it("concatena teclas en el orden pulsado", () => {
    expect(appendKey(appendKey(appendKey("", "1"), "2"), "3")).toBe("123")
  })
})

describe("VoiceWindow", () => {
  it("renderiza las 3 tabs", () => {
    const html = renderToStaticMarkup(
      React.createElement(VoiceWindow, { onClose: () => {} }),
    )
    expect(html).toContain("Contacts")
    expect(html).toContain("Recent")
    expect(html).toContain("Keypad")
  })

  it("renderiza incoming: Accept + Reject + número del que llama", () => {
    mockUseTelnyx.mockReturnValue(
      baseMock({
        currentCall: {
          id: "c1",
          state: "ringing_inbound",
          direction: "inbound",
          callerNumber: "+15550123",
          duration: 0,
          isMuted: false,
          isOnHold: false,
        },
      }),
    )
    const html = renderToStaticMarkup(React.createElement(VoiceWindow, { onClose: () => {} }))
    expect(html).toContain("Accept")
    expect(html).toContain("Reject")
    expect(html).toContain("+15550123")
  })

  it("renderiza active: timer mm:ss y botón End", () => {
    mockUseTelnyx.mockReturnValue(
      baseMock({
        currentCall: {
          id: "c1",
          state: "active",
          direction: "outbound",
          destinationNumber: "+15550123",
          duration: 95,
          isMuted: false,
          isOnHold: false,
        },
      }),
    )
    const html = renderToStaticMarkup(React.createElement(VoiceWindow, { onClose: () => {} }))
    expect(html).toContain("01:35")
    expect(html).toContain("End call")
  })

  it("muestra aviso offline cuando no está registrado", () => {
    mockUseTelnyx.mockReturnValue(baseMock({ isRegistered: false, connectionStatus: "error" }))
    const html = renderToStaticMarkup(React.createElement(VoiceWindow, { onClose: () => {} }))
    expect(html).toContain("Phone offline")
  })
})
