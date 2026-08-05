"use client"

// Llamada entrante (spec §4.3): Accept bg-green-600 (token semántico no
// existe — única excepción documentada) / Reject bg-destructive.

import { Phone, PhoneOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { TelnyxCallInfo } from "@/hooks/use-telnyx"

export function VoiceIncomingView({
  call,
  onAnswer,
  onReject,
}: {
  call: TelnyxCallInfo
  onAnswer: () => void
  onReject: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-10">
      <div className="h-16 w-16 rounded-full bg-primary/10 text-3xl leading-[4rem] text-primary">
        {call.callerName ?? call.callerNumber ?? "?"}
      </div>
      <div className="text-center">
        <p className="text-lg font-semibold">{call.callerName ?? "Incoming call"}</p>
        <p className="text-sm text-muted-foreground">{call.callerNumber}</p>
      </div>
      <div className="flex gap-4">
        <Button onClick={onAnswer} className="gap-2 bg-green-600 hover:bg-green-700">
          <Phone className="h-4 w-4" />
          Accept
        </Button>
        <Button variant="destructive" onClick={onReject} className="gap-2">
          <PhoneOff className="h-4 w-4" />
          Reject
        </Button>
      </div>
    </div>
  )
}
