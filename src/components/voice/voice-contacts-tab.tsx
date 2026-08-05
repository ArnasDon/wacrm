"use client"

// Lista de contactos del softphone (tab Contacts). ScrollArea + slice,
// sin virtualización (DAD §4.1 — no hay react-window en el repo).

import { useEffect, useState } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { createClient } from "@/lib/supabase/client"
import type { Contact } from "@/types"

export function VoiceContactsTab({
  onCall,
}: {
  onCall: (number: string) => void
}) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    let active = true
    supabase
      .from("contacts")
      .select("id, name, phone")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!active) return
        setContacts((data as Contact[]) ?? [])
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading contacts…</div>
  }

  if (contacts.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No contacts yet.</div>
  }

  return (
    <ScrollArea className="h-[380px]">
      <ul className="divide-y divide-border">
        {contacts.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => c.phone && onCall(c.phone)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent"
            >
              <Avatar className="h-8 w-8">
                <AvatarImage src={c.avatar_url ?? undefined} />
                <AvatarFallback>{(c.name ?? c.phone ?? "?").slice(0, 1)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{c.name ?? "Unnamed"}</p>
                <p className="truncate text-xs text-muted-foreground">{c.phone}</p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </ScrollArea>
  )
}
