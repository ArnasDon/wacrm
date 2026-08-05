"use client"

// ============================================================
// VoicePanel — softphone embebible (Fase 2, DAD §4.3).
// Mismo contenido que VoiceWindow pero sin el wrapper flotante
// (`fixed bottom-6 right-6`): se usa en la página /calls dentro
// de un contenedor con altura fija. VoiceWindow reutiliza este
// panel dentro de su ventana flotante.
// ============================================================

import { useEffect } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTelnyx } from "@/hooks/use-telnyx"
import { VoiceActiveView } from "@/components/voice/voice-active-view"
import { VoiceContactsTab } from "@/components/voice/voice-contacts-tab"
import { VoiceIncomingView } from "@/components/voice/voice-incoming-view"
import { VoiceKeypadTab } from "@/components/voice/voice-keypad-tab"
import { VoiceRecentTab } from "@/components/voice/voice-recent-tab"

export function VoicePanel() {
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

  const ringing = currentCall?.state === "ringing_inbound"

  return (
    <>
      {/* <audio id="remoteAudio"> global: el hook adjunta aquí la remoteStream. */}
      <audio id="remoteAudio" className="hidden" autoPlay />

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
    </>
  )
}
