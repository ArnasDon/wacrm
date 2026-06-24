"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, PhoneIncoming, Mic, MicOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useWebrtcCall, type AnswerableCall } from "@/hooks/use-webrtc-call";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { CallLog } from "@/types";

/**
 * Global call surface for inbound WhatsApp voice calls (Phase 4).
 *
 * Mounted once in the dashboard shell so a call can arrive on any
 * screen. Subscribes to `call_logs` (RLS scopes to the agent's
 * account), pops an Answer/Decline card when a row goes `ringing`,
 * and — once answered — shows a compact active-call widget wired to
 * the WebRTC softphone. Renders nothing when idle.
 */

const TERMINAL_STATUSES = new Set([
  "completed",
  "missed",
  "declined",
  "failed",
]);

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function CallCenter() {
  const supabase = createClient();
  const {
    phase,
    activeCallId,
    muted,
    error,
    remoteAudioRef,
    answer,
    hangup,
    toggleMute,
  } = useWebrtcCall();

  // The ringing call awaiting Answer/Decline (null once answered/cleared).
  const [incoming, setIncoming] = useState<CallLog | null>(null);
  const [incomingName, setIncomingName] = useState<string>("");
  const [declining, setDeclining] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Keep handlers stable for the realtime callback (React 19 ref rule).
  const incomingRef = useRef<CallLog | null>(null);
  useEffect(() => {
    incomingRef.current = incoming;
  });
  const activeRef = useRef<string | null>(null);
  useEffect(() => {
    activeRef.current = activeCallId;
  });
  const hangupRef = useRef(hangup);
  useEffect(() => {
    hangupRef.current = hangup;
  });

  // Surface media errors as a toast (kept out of the render path).
  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  // Live timer while connected.
  useEffect(() => {
    if (phase !== "connected") {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const t = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, [phase]);

  const fetchContactName = useCallback(
    async (contactId: string) => {
      const { data } = await supabase
        .from("contacts")
        .select("name, phone")
        .eq("id", contactId)
        .maybeSingle();
      setIncomingName(data?.name || data?.phone || "Unknown caller");
    },
    [supabase],
  );

  // Realtime subscription to call_logs (RLS = this account's calls only).
  useEffect(() => {
    const channel = supabase
      .channel("call-center")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "call_logs" },
        (payload) => {
          const row = payload.new as CallLog | undefined;
          if (!row || !row.status) return;

          // A new (or still-) ringing inbound call we aren't already on.
          if (
            row.direction === "inbound" &&
            row.status === "ringing" &&
            row.id !== activeRef.current
          ) {
            setIncoming(row);
            void fetchContactName(row.contact_id);
            return;
          }

          // The ringing call we were showing went terminal before we
          // answered (caller hung up / timed out) → dismiss the card.
          if (
            incomingRef.current &&
            row.id === incomingRef.current.id &&
            TERMINAL_STATUSES.has(row.status)
          ) {
            setIncoming(null);
            return;
          }

          // The call we're actively on ended remotely (caller hung up)
          // → tear our side down too.
          if (
            row.id === activeRef.current &&
            TERMINAL_STATUSES.has(row.status)
          ) {
            void hangupRef.current();
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, fetchContactName]);

  const onAnswer = useCallback(async () => {
    const call = incoming;
    if (!call) return;
    setIncoming(null);
    const answerable: AnswerableCall = { id: call.id, offer_sdp: call.offer_sdp ?? null };
    await answer(answerable);
  }, [incoming, answer]);

  const onDecline = useCallback(async () => {
    const call = incoming;
    if (!call) return;
    setDeclining(true);
    try {
      await fetch(`/api/whatsapp/calls/${call.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject" }),
      });
    } catch {
      toast.error("Could not decline the call.");
    } finally {
      setDeclining(false);
      setIncoming(null);
    }
  }, [incoming]);

  const onCall = phase === "connecting" || phase === "connected";

  return (
    <>
      {/* Remote audio sink — always mounted so the stream has somewhere
          to play the moment tracks arrive. */}
      <audio ref={remoteAudioRef} autoPlay className="hidden" />

      {/* Incoming-call card (only when ringing and not yet on a call). */}
      {incoming && !onCall && (
        <div className="fixed bottom-4 right-4 z-50 w-72 rounded-xl border border-border bg-card p-4 shadow-lg">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <PhoneIncoming className="size-5 animate-pulse" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {incomingName || "Incoming call"}
              </p>
              <p className="text-xs text-muted-foreground">
                WhatsApp voice call…
              </p>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              size="sm"
              className="flex-1 bg-green-600 hover:bg-green-700"
              onClick={onAnswer}
            >
              <Phone className="size-4" /> Answer
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="flex-1"
              onClick={onDecline}
              disabled={declining}
            >
              <PhoneOff className="size-4" /> Decline
            </Button>
          </div>
        </div>
      )}

      {/* Active-call widget. */}
      {onCall && (
        <div className="fixed bottom-4 right-4 z-50 w-72 rounded-xl border border-border bg-card p-4 shadow-lg">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-green-600/10 text-green-600">
              <Phone className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {incomingName || "On call"}
              </p>
              <p className="text-xs text-muted-foreground">
                {phase === "connecting"
                  ? "Connecting…"
                  : `Connected · ${formatDuration(elapsed)}`}
              </p>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={toggleMute}
              disabled={phase !== "connected"}
            >
              {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              {muted ? "Unmute" : "Mute"}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="flex-1"
              onClick={() => void hangup()}
            >
              <PhoneOff className="size-4" /> End
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
