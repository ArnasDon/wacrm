"use client"

// Llamada activa (spec §4.3): timer mm:ss, Mute/Hold, End bg-destructive.

import { Mic, MicOff, Pause, PhoneOff, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { TelnyxCallInfo } from "@/hooks/use-telnyx"

function formatTimer(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
}

export function VoiceActiveView({
  call,
  onHangup,
  onToggleMute,
  onToggleHold,
}: {
  call: TelnyxCallInfo
  onHangup: () => void
  onToggleMute: () => void
  onToggleHold: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-10">
      <div className="text-center">
        <p className="text-lg font-semibold">
          {call.direction === "outbound" ? call.destinationNumber : call.callerNumber}
        </p>
        <p className="font-mono text-3xl font-semibold tabular-nums">{formatTimer(call.duration)}</p>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" className="h-12 w-12" onClick={onToggleMute} title="Mute">
          {call.isMuted ? <MicOff className="h-5 w-5 text-destructive" /> : <Mic className="h-5 w-5" />}
        </Button>
        <Button variant="outline" size="icon" className="h-12 w-12" onClick={onToggleHold} title="Hold">
          {call.isOnHold ? <Play className="h-5 w-5" /> : <Pause className="h-5 w-5" />}
        </Button>
        <Button variant="destructive" size="icon" className="h-12 w-12" onClick={onHangup} title="End call">
          <PhoneOff className="h-5 w-5" />
        </Button>
      </div>
    </div>
  )
}
