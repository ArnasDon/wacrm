"use client"

// ============================================================
// VoiceWindow — ventana flotante VoIP (Fase 2, DAD §4.3 spec exacta).
// <div className="fixed bottom-6 right-6 z-50 flex h-[520px] w-[380px] flex-col
//                 overflow-hidden rounded-xl border bg-card shadow-2xl">
// Tabs: Contacts | Recent | Keypad (activo con border-b-2 border-primary).
// Incoming: Accept bg-green-600 / Reject bg-destructive.
// Active: timer mm:ss, Mute/Hold/Keypad, End bg-destructive.
// ============================================================

import { useEffect } from "react"
import { Phone, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTelnyx } from "@/hooks/use-telnyx"
import { VoiceActiveView } from "@/components/voice/voice-active-view"
import { VoiceContactsTab } from "@/components/voice/voice-contacts-tab"
import { VoiceIncomingView } from "@/components/voice/voice-incoming-view"
import { VoiceKeypadTab } from "@/components/voice/voice-keypad-tab"
import { VoiceRecentTab } from "@/components/voice/voice-recent-tab"

export function VoiceWindow({ onClose }: { onClose: () => void }) {
  const {
    connectionStatus,
    isRegistered,
    currentCall,
    makeCall,
    answer,
    reject,
    hangup,
    toggleMute,
    toggleHold,
    connect,
  } = useTelnyx()

  useEffect(() => {
    void connect()
  }, [connect])

  const busy = currentCall?.state === "active" || currentCall?.state === "held"
  const ringing = currentCall?.state === "ringing_inbound"

  return (
    <div className="fixed bottom-6 right-6 z-50 flex h-[520px] w-[380px] flex-col overflow-hidden rounded-xl border bg-card shadow-2xl">
      {/* <audio id="remoteAudio"> global: el hook adjunta aquí la remoteStream. */}
      <audio id="remoteAudio" className="hidden" autoPlay />

      <header className="flex h-12 shrink-0 items-center justify-between bg-primary px-4 text-primary-foreground">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Phone className="h-4 w-4" />
          VoIP
          <span className="text-xs font-normal opacity-80">
            {isRegistered ? "· online" : connectionStatus === "connecting" ? "· connecting…" : "· offline"}
          </span>
        </span>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X className="h-4 w-4" />
        </Button>
      </header>

      {!isRegistered && connectionStatus !== "connecting" && (
        <div className="border-b border-border bg-muted px-4 py-2 text-xs text-muted-foreground">
          {connectionStatus === "config_error"
            ? "Telnyx not configured — check Settings."
            : "Phone offline — configure Telnyx in Settings."}
        </div>
      )}

      {ringing && currentCall ? (
        <VoiceIncomingView call={currentCall} onAnswer={answer} onReject={reject} />
      ) : currentCall && (currentCall.state === "active" || currentCall.state === "held" || currentCall.state === "ringing_outbound") ? (
        <VoiceActiveView call={currentCall} onHangup={hangup} onToggleMute={toggleMute} onToggleHold={toggleHold} />
      ) : (
        <Tabs defaultValue="contacts" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-4 mt-3 grid w-auto grid-cols-3 gap-1">
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
            <TabsTrigger value="recent">Recent</TabsTrigger>
            <TabsTrigger value="keypad">Keypad</TabsTrigger>
          </TabsList>
          <TabsContent value="contacts" className="min-h-0 flex-1">
            <VoiceContactsTab onCall={(n) => void makeCall(n)} />
          </TabsContent>
          <TabsContent value="recent" className="min-h-0 flex-1">
            <VoiceRecentTab />
          </TabsContent>
          <TabsContent value="keypad" className="min-h-0 flex-1">
            <VoiceKeypadTab onCall={(n) => void makeCall(n)} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
