"use client"

// Historial de llamadas recientes (tab Recent). calls DESC initiated_at
// (DAD §11 paso 11 — mismo query que el sidebar). Con playback de la
// grabación vía el proxy autenticado cuando existe.

import { useEffect, useState } from "react"
import { PhoneIncoming, PhoneMissed, PhoneOutgoing, Play } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { createClient } from "@/lib/supabase/client"
import type { Call } from "@/types"

function formatDuration(sec?: number | null): string {
  if (!sec || sec <= 0) return "—"
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function VoiceRecentTab() {
  const [calls, setCalls] = useState<Call[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    let active = true
    supabase
      .from("calls")
      .select("*")
      .order("initiated_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (!active) return
        setCalls((data as Call[]) ?? [])
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading calls…</div>
  }

  if (calls.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No calls yet.</div>
  }

  return (
    <ScrollArea className="h-[380px]">
      <ul className="divide-y divide-border">
        {calls.map((c) => {
          const Icon =
            c.disposition === "missed" ? PhoneMissed : c.direction === "inbound" ? PhoneIncoming : PhoneOutgoing
          return (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
              <Icon
                className={
                  c.disposition === "missed"
                    ? "h-4 w-4 shrink-0 text-destructive"
                    : "h-4 w-4 shrink-0 text-muted-foreground"
                }
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {c.direction === "inbound" ? c.from_number : c.to_number}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(c.initiated_at).toLocaleString()} · {formatDuration(c.duration_sec)}
                </p>
              </div>
              {c.disposition === "missed" && (
                <Badge variant="destructive" className="text-[10px]">
                  missed
                </Badge>
              )}
              {c.recording_url && (
                <a
                  href={c.recording_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  title="Play recording"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span className="sr-only">Play recording</span>
                </a>
              )}
            </li>
          )
        })}
      </ul>
    </ScrollArea>
  )
}
