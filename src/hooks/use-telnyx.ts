"use client"

// ============================================================
// useTelnyx — wrapper del softphone WebRTC (Fase 2, DAD §4.1).
// Adaptado de policyjar src/hooks/use-telnyx.ts, SIN ACD/colas,
// diagnostics, lifecycle recovery ni auto-answer de server-initiated
// calls (WACRM single-account personal: el operador contesta/llama
// desde la ventana VoIP).
//
// API del SDK verificada en context7 (@team-telnyx/webrtc):
//   new TelnyxRTC({ login_token }) → client.connect()
//   client.on('telnyx.ready' | 'telnyx.error' | 'telnyx.notification')
//   client.newCall({ destinationNumber, callerNumber })
//   call.answer() / call.hangup() / call.muteAudio() / call.unmuteAudio()
//   call.hold() / call.unhold() / call.dtmf()
//   call.remoteStream → <audio>.srcObject
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react"
import { TelnyxRTC } from "@telnyx/webrtc"

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "config_error"

export type CallState =
  | "idle"
  | "ringing_inbound"
  | "ringing_outbound"
  | "active"
  | "held"
  | "ended"

export interface TelnyxCallInfo {
  id: string
  state: CallState
  direction: "inbound" | "outbound"
  /** Número del que llama (inbound) o destino (outbound). */
  callerNumber?: string
  callerName?: string
  destinationNumber?: string
  duration: number
  isMuted: boolean
  isOnHold: boolean
}

export interface UseTelnyxReturn {
  connectionStatus: ConnectionStatus
  isRegistered: boolean
  currentCall: TelnyxCallInfo | null
  makeCall: (destinationNumber: string) => Promise<boolean>
  answer: () => void
  reject: () => void
  hangup: () => void
  toggleMute: () => void
  toggleHold: () => void
  sendDTMF: (digit: string) => void
  connect: () => Promise<void>
  disconnect: () => void
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Tolerancia de reconexión tras un telnyx.socket.close. */
const REGISTRATION_TIMEOUT_MS = 15_000

function mapCallState(sdkState: string, direction: string): CallState {
  switch (sdkState) {
    case "new":
    case "trying":
    case "requesting":
    case "early":
      return direction === "inbound" ? "ringing_inbound" : "ringing_outbound"
    case "ringing":
      return "ringing_inbound"
    case "active":
      return "active"
    case "held":
      return "held"
    case "hangup":
    case "destroy":
    case "purge":
      return "ended"
    default:
      return "idle"
  }
}

export function useTelnyx(): UseTelnyxReturn {
  const clientRef = useRef<any>(null)
  const callRef = useRef<any>(null)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const callStartTimeRef = useRef<number | null>(null)

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected")
  const [isRegistered, setIsRegistered] = useState(false)
  const [currentCall, setCurrentCall] = useState<TelnyxCallInfo | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [isOnHold, setIsOnHold] = useState(false)

  const connectionStatusRef = useRef<ConnectionStatus>("disconnected")
  useEffect(() => {
    connectionStatusRef.current = connectionStatus
  }, [connectionStatus])

  const isMutedRef = useRef(false)
  useEffect(() => {
    isMutedRef.current = isMuted
  }, [isMuted])

  // ---- Remote audio: elemento <audio id="remoteAudio"> fijo en el DOM
  // (voice-window). El SDK advierte NO usar client.remoteElement (causa
  // circular JSON en ICE signaling) — se adjunta manualmente por call.
  const attachRemoteAudio = useCallback(() => {
    const call = callRef.current
    if (!call?.remoteStream) return
    const audioEl = document.getElementById("remoteAudio") as HTMLAudioElement | null
    if (audioEl && audioEl.srcObject !== call.remoteStream) {
      audioEl.srcObject = call.remoteStream
      audioEl.play().catch(() => {})
    }
  }, [])

  const cleanupRemoteAudio = useCallback(() => {
    const audioEl = document.getElementById("remoteAudio") as HTMLAudioElement | null
    if (!audioEl) return
    try {
      audioEl.pause()
    } catch {
      /* ignore */
    }
    audioEl.srcObject = null
  }, [])

  // ---- Timer mm:ss ----
  const startDurationTimer = useCallback(() => {
    callStartTimeRef.current = Date.now()
    if (durationIntervalRef.current) clearInterval(durationIntervalRef.current)
    durationIntervalRef.current = setInterval(() => {
      if (callStartTimeRef.current) {
        const elapsed = Math.floor((Date.now() - callStartTimeRef.current) / 1000)
        setCurrentCall((prev) => (prev ? { ...prev, duration: elapsed } : null))
      }
    }, 1000)
  }, [])

  const stopDurationTimer = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current)
      durationIntervalRef.current = null
    }
    callStartTimeRef.current = null
  }, [])

  const connect = useCallback(async () => {
    if (clientRef.current) {
      setConnectionStatus("connected")
      return
    }
    setConnectionStatus("connecting")

    try {
      const res = await fetch("/api/telnyx/token", { method: "POST" })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { retryable?: boolean }
        setConnectionStatus(body.retryable === false ? "config_error" : "error")
        return
      }
      const cred = (await res.json()) as { token?: string; sip_username?: string | null; sip_password?: string | null }

      const client = new TelnyxRTC({ login_token: cred.token })
      clientRef.current = client

      client.on("telnyx.ready", () => {
        setIsRegistered(true)
        setConnectionStatus("connected")
      })

      client.on("telnyx.error", () => {
        setConnectionStatus("error")
      })

      client.on("telnyx.socket.close", () => {
        setConnectionStatus("disconnected")
        setIsRegistered(false)
      })

      client.on("telnyx.notification", (notification: any) => {
        if (notification?.type !== "callUpdate" || !notification.call) return
        const call = notification.call
        callRef.current = call

        const direction: "inbound" | "outbound" =
          call.direction === "inbound" ? "inbound" : "outbound"
        const callState = mapCallState(call.state, direction)

        const callerNumber =
          call.options?.remoteCallerNumber ||
          call.options?.callerNumber ||
          call.options?.destinationNumber
        const callerName = call.options?.remoteCallerName || call.options?.callerName || undefined
        const destinationNumber = call.options?.destinationNumber || undefined

        if (callState === "ended") {
          stopDurationTimer()
          cleanupRemoteAudio()
          callRef.current = null
          setIsMuted(false)
          setIsOnHold(false)
          setCurrentCall((prev) =>
            prev
              ? {
                  ...prev,
                  state: "ended" as CallState,
                  isMuted: false,
                  isOnHold: false,
                }
              : null,
          )
        } else {
          if (callState === "active" && callStartTimeRef.current === null) {
            startDurationTimer()
          }
          attachRemoteAudio()
          setIsOnHold(callState === "held")
          setCurrentCall({
            id: call.id,
            state: callState,
            direction,
            callerNumber,
            callerName,
            destinationNumber,
            duration: callStartTimeRef.current
              ? Math.floor((Date.now() - callStartTimeRef.current) / 1000)
              : 0,
            isMuted: isMutedRef.current,
            isOnHold: callState === "held",
          })
        }
      })

      // Timeout si telnyx.ready no llega (socket colgado).
      const timeout = setTimeout(() => {
        if (connectionStatusRef.current === "connecting") {
          setConnectionStatus("error")
          setIsRegistered(false)
        }
      }, REGISTRATION_TIMEOUT_MS)

      await client.connect()
      clearTimeout(timeout)
    } catch {
      setConnectionStatus("error")
    }
  }, [attachRemoteAudio, cleanupRemoteAudio, startDurationTimer, stopDurationTimer])

  const disconnect = useCallback(() => {
    stopDurationTimer()
    cleanupRemoteAudio()
    if (clientRef.current) {
      try {
        clientRef.current.disconnect()
      } catch {
        /* ignore */
      }
    }
    clientRef.current = null
    callRef.current = null
    setIsRegistered(false)
    setConnectionStatus("disconnected")
    setCurrentCall(null)
  }, [cleanupRemoteAudio, stopDurationTimer])

  // Cleanup en desmontaje.
  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  const makeCall = useCallback(
    async (destinationNumber: string): Promise<boolean> => {
      if (!clientRef.current || !destinationNumber) return false
      try {
        const call = clientRef.current.newCall({ destinationNumber })
        callRef.current = call
        setCurrentCall({
          id: call.id,
          state: "ringing_outbound",
          direction: "outbound",
          destinationNumber,
          duration: 0,
          isMuted: false,
          isOnHold: false,
        })
        return true
      } catch {
        return false
      }
    },
    [],
  )

  const answer = useCallback(() => {
    try {
      callRef.current?.answer()
    } catch {
      /* ignore */
    }
  }, [])

  const reject = useCallback(() => {
    try {
      callRef.current?.reject()
    } catch {
      /* ignore */
    }
  }, [])

  const hangup = useCallback(() => {
    try {
      // DAD §3.3 (anti-486, softphone): call.hangup() y dereferenciar —
      // nunca call.reject() en una llamada activa.
      callRef.current?.hangup()
    } catch {
      /* ignore */
    }
    callRef.current = null
    stopDurationTimer()
    cleanupRemoteAudio()
  }, [cleanupRemoteAudio, stopDurationTimer])

  const toggleMute = useCallback(() => {
    const call = callRef.current
    if (!call) return
    try {
      if (isMutedRef.current) call.unmuteAudio()
      else call.muteAudio()
      setIsMuted(!isMutedRef.current)
    } catch {
      /* ignore */
    }
  }, [])

  const toggleHold = useCallback(() => {
    const call = callRef.current
    if (!call) return
    try {
      if (isOnHold) call.unhold()
      else call.hold()
      setIsOnHold(!isOnHold)
    } catch {
      /* ignore */
    }
  }, [isOnHold])

  const sendDTMF = useCallback((digit: string) => {
    try {
      callRef.current?.dtmf(digit)
    } catch {
      /* ignore */
    }
  }, [])

  return {
    connectionStatus,
    isRegistered,
    currentCall,
    makeCall,
    answer,
    reject,
    hangup,
    toggleMute,
    toggleHold,
    sendDTMF,
    connect,
    disconnect,
  }
}
