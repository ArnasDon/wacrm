"use client"

// VoiceLauncher — botón flotante que abre/cierra la VoiceWindow (softphone
// Fase 2). Se monta en el dashboard-shell para estar disponible en todo
// el dashboard, como la spec de ventana flotante (DAD §4.3).

import { useState } from "react"
import { Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { VoiceWindow } from "@/components/voice/voice-window"

export function VoiceLauncher() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {open && <VoiceWindow onClose={() => setOpen(false)} />}
      <Button
        type="button"
        size="icon"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-40 h-12 w-12 rounded-full shadow-lg"
        aria-label="Open VoIP phone"
      >
        <Phone className="h-5 w-5" />
      </Button>
    </>
  )
}
