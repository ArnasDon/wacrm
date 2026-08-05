"use client"

// Keypad 3x4 del softphone (tab Keypad). Dial desde el grid.

import { useState } from "react"
import { Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"]

/** Lógica pura del keypad (testable sin DOM): concatena la tecla pulsada. */
export function appendKey(current: string, key: string): string {
  return current + key
}

export function VoiceKeypadTab({ onCall }: { onCall: (number: string) => void }) {
  const [number, setNumber] = useState("")

  function press(key: string) {
    setNumber((n) => appendKey(n, key))
  }

  return (
    <div className="flex flex-col items-center gap-4 p-4">
      <Input
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        placeholder="Number…"
        inputMode="tel"
        className="text-center text-lg font-semibold"
      />
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <Button key={k} variant="outline" size="lg" onClick={() => press(k)} className="h-14 w-16 text-lg">
            {k}
          </Button>
        ))}
      </div>
      <Button
        variant="default"
        size="lg"
        className="w-full gap-2"
        disabled={!number}
        onClick={() => {
          if (number) onCall(number)
        }}
      >
        <Phone className="h-4 w-4" />
        Call
      </Button>
    </div>
  )
}
