"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getIceServers } from "@/lib/whatsapp/webrtc-config";

/**
 * Browser softphone for inbound WhatsApp Business calls (Phase 3).
 *
 * The signalling is non-trickle: WhatsApp delivers the customer's full
 * SDP offer on the webhook, and we send back one complete SDP answer
 * once local ICE gathering finishes. So the flow on Answer is:
 *
 *   getUserMedia(audio) -> RTCPeerConnection -> setRemoteDescription(offer)
 *   -> createAnswer -> setLocalDescription -> wait for ICE complete
 *   -> POST /api/whatsapp/calls/{id} { action:'accept', sdp }
 *
 * Hang up POSTs `terminate` and tears the peer connection down. The
 * hook owns only the media + signalling; the incoming-call alert and
 * the active-call widget (Phase 4) drive it.
 */

export type CallPhase =
  | "idle"
  | "connecting"
  | "connected"
  | "ended"
  | "failed";

export interface AnswerableCall {
  /** Internal call_logs UUID — the API route key. */
  id: string;
  /** Customer's SDP offer captured by the webhook. */
  offer_sdp: string | null;
}

interface UseWebrtcCallResult {
  phase: CallPhase;
  /** Internal id of the call currently held by the hook, if any. */
  activeCallId: string | null;
  muted: boolean;
  error: string | null;
  /** Attach to a hidden <audio autoPlay> so remote audio plays. */
  remoteAudioRef: React.RefObject<HTMLAudioElement | null>;
  answer: (call: AnswerableCall) => Promise<void>;
  hangup: () => Promise<void>;
  toggleMute: () => void;
}

/** Resolve once the peer connection has gathered all ICE candidates. */
function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    // Safety net — don't hang forever if a candidate stalls.
    const timeout = setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    }, 3000);
    const check = () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timeout);
        pc.removeEventListener("icegatheringstatechange", check);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", check);
  });
}

async function postCallAction(
  callId: string,
  action: "accept" | "reject" | "terminate",
  sdp?: string,
): Promise<void> {
  const res = await fetch(`/api/whatsapp/calls/${callId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, sdp }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Call ${action} failed (${res.status})`);
  }
}

export function useWebrtcCall(): UseWebrtcCallResult {
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  const cleanup = useCallback(() => {
    pcRef.current?.getSenders().forEach((s) => s.track?.stop());
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
  }, []);

  const answer = useCallback(
    async (call: AnswerableCall) => {
      if (pcRef.current) {
        // Already on a call — refuse rather than clobber it.
        setError("Already on a call.");
        return;
      }
      if (!call.offer_sdp) {
        setError("Call has no SDP offer yet.");
        return;
      }
      setError(null);
      setPhase("connecting");
      setActiveCallId(call.id);

      try {
        const localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        localStreamRef.current = localStream;

        const pc = new RTCPeerConnection({ iceServers: getIceServers() });
        pcRef.current = pc;

        localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

        pc.ontrack = (event) => {
          const [remoteStream] = event.streams;
          if (remoteAudioRef.current && remoteStream) {
            remoteAudioRef.current.srcObject = remoteStream;
          }
        };

        pc.onconnectionstatechange = () => {
          const s = pc.connectionState;
          if (s === "connected") setPhase("connected");
          else if (s === "failed") {
            setPhase("failed");
            setError("Media connection failed.");
          } else if (s === "disconnected" || s === "closed") {
            setPhase((p) => (p === "connected" ? "ended" : p));
          }
        };

        await pc.setRemoteDescription({ type: "offer", sdp: call.offer_sdp });
        const localDesc = await pc.createAnswer();
        await pc.setLocalDescription(localDesc);
        await waitForIceGathering(pc);

        const finalSdp = pc.localDescription?.sdp;
        if (!finalSdp) throw new Error("Failed to produce an SDP answer.");

        await postCallAction(call.id, "accept", finalSdp);
      } catch (err) {
        cleanup();
        setPhase("failed");
        setActiveCallId(null);
        setError(err instanceof Error ? err.message : "Could not answer call.");
      }
    },
    [cleanup],
  );

  const hangup = useCallback(async () => {
    const id = activeCallId;
    cleanup();
    setPhase("ended");
    setActiveCallId(null);
    setMuted(false);
    if (id) {
      try {
        await postCallAction(id, "terminate");
      } catch (err) {
        // Best-effort — the local side is already torn down.
        console.error("[webrtc] terminate failed:", err);
      }
    }
  }, [activeCallId, cleanup]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    setMuted((prev) => {
      const next = !prev;
      stream.getAudioTracks().forEach((t) => (t.enabled = !next));
      return next;
    });
  }, []);

  // Tear down media if the component using the hook unmounts mid-call.
  useEffect(() => cleanup, [cleanup]);

  return {
    phase,
    activeCallId,
    muted,
    error,
    remoteAudioRef,
    answer,
    hangup,
    toggleMute,
  };
}
