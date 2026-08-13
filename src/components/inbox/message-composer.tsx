"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  KeyboardEvent,
} from "react";
import {
  Send,
  LayoutTemplate,
  Paperclip,
  Image as ImageIcon,
  Video,
  FileText,
  Mic,
  Trash2,
  Lock,
  X,
  Loader2,
} from "lucide-react";
import { GatedButton } from "@/components/ui/gated-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useCan } from "@/hooks/use-can";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
  ALLOWED_MIME_TYPES_BY_KIND,
} from "@/lib/storage/upload-media";
import {
  isQuickTimeVideo,
  convertMovToMp4ViaWebCodecs,
} from "@/lib/media/transcode-mov-webcodecs";
import { ReplyQuote } from "./reply-quote";
import { useTranslations } from "next-intl";
import type { QuickReply } from "@/types";

/** Media content types an agent can send from the composer. */
export type ComposerMediaKind = "image" | "video" | "document" | "audio";

/** Supabase Storage bucket holding agent-sent chat attachments (migration 023). */
export const CHAT_MEDIA_BUCKET = "chat-media";

/** Meta caps media captions at 1024 chars. Enforced here and in the send route. */
export const MEDIA_CAPTION_MAX = 1024;

/** Hard cap on a single voice recording so it can't blow the upload/
 *  transcode limits — auto-stops the recorder when reached. */
const MAX_RECORDING_SECONDS = 5 * 60;

export interface SendMediaPayload {
  kind: ComposerMediaKind;
  /** Public chat-media URL Meta fetches at send time. */
  mediaUrl: string;
  /** Storage object path — lets the caller GC the object if the send fails. */
  path: string;
  /** Optional caption (image/video/document only). */
  caption?: string;
  /** Original file name — surfaced to the recipient for documents. */
  filename?: string;
  replyToId?: string;
}

interface ReplyDraft {
  /** Internal UUID of the message being replied to — sent back through onSend. */
  id: string;
  authorLabel: string;
  preview: string;
}

// Mirrors the chat-media bucket's allowed_mime_types (migration 023) for
// the file picker so unsupported files are rejected before upload rather
// than failing with a confusing Storage error. Audio has no picker — it's
// captured via the recorder and, unlike the other kinds, never goes
// through the staged-draft preview below (see the recording state
// machine further down).
const PICKER_ACCEPT: Record<"image" | "video" | "document", string> = {
  image: "image/png,image/jpeg,image/webp",
  // video/quicktime + .mov: iPhone recordings are transcoded to MP4
  // client-side before upload (see transcode-mov.ts) — listed here so
  // they don't get filtered out of the OS picker in the first place.
  video: "video/mp4,video/3gpp,video/quicktime,.mov",
  document:
    "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain",
};

interface MediaDraft {
  kind: Exclude<ComposerMediaKind, "audio">;
  mediaUrl: string;
  /** Storage path — used to GC the object if the draft is discarded. */
  path: string;
  filename: string;
  caption: string;
}

interface MessageComposerProps {
  sessionExpired: boolean;
  onSend: (text: string, replyToId?: string) => void;
  onSendMedia: (payload: SendMediaPayload) => void;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
  /**
   * One-shot draft to seed the text field with (BLOCO 3/4: a follow-up
   * message "loaded but not sent" from the Central de IA). Only seeds
   * on change, never overwrites what the agent is actively typing — the
   * caller is responsible for only setting this once per conversation.
   */
  initialText?: string;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Accent/case-insensitive comparison for shortcut matching ("apres" must
// match "apresentação").
function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function stripLeadingSlash(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}

/** Finds the "/shortcut" token touching the caret, if any — mirrors
 *  WhatsApp Business: the slash must start a word (string start or right
 *  after whitespace) and nothing between it and the caret may contain
 *  whitespace, otherwise it's just a literal "/" in running text. */
function findSlashToken(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (ch === "/") {
      const before = i === 0 ? undefined : value[i - 1];
      if (before === undefined || /\s/.test(before)) {
        return { start: i, query: value.slice(i, caret) };
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
    i--;
  }
  return null;
}

/** Worker that encodes mic input to Ogg/Opus entirely in the browser
 *  (vendored from opus-recorder into /public). Recording client-side in a
 *  Meta-accepted format means no server ffmpeg / transcode step. */
const OPUS_ENCODER_PATH = "/opus/encoderWorker.min.js";

// Vertical drag distance (px) that arms "locked" (hands-free) recording —
// same idea as WhatsApp's own slide-up-to-lock gesture. Slightly more
// than a hair-trigger tap needs, on purpose: the progressive visual
// buildup below (the hint growing/brightening as it approaches this) is
// what should carry the "am I close?" feeling, not a razor-thin
// threshold — this just guards against arming on a barely-there twitch.
//
// Deliberately vertical-only, with no horizontal check at all: a
// natural upward swipe always drifts sideways some, and penalizing
// that (requiring a perfectly straight line) is exactly what reads as
// "mechanical" instead of a natural continuation of the press. A
// diagonal drag locks exactly as readily as a straight one.
const LOCK_THRESHOLD_PX = 80;

type MicPhase = "idle" | "recording" | "paused" | "sending";

export function MessageComposer({
  sessionExpired,
  onSend,
  onSendMedia,
  onOpenTemplates,
  replyTo,
  onClearReply,
  initialText,
}: MessageComposerProps) {
  const t = useTranslations("Inbox.composer");

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Only re-runs when the draft string itself changes — this seeds the
  // field once and never fights with the agent's own typing afterwards.
  useEffect(() => {
    if (initialText) {
      setText(initialText);
      textareaRef.current?.focus();
    }
  }, [initialText]);

  // ---- "/shortcut" quick-reply autocomplete ---------------------------
  //
  // Only `kind === "text"` replies are eligible: their content is a plain
  // string that can drop straight into the textarea. Interactive quick
  // replies (buttons/list payloads) have no scalar text form and the
  // composer's onSend contract only carries a string, so they're left out
  // of suggestions rather than lossily flattened into text.
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [slashToken, setSlashToken] = useState<{ start: number; query: string } | null>(
    null,
  );
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  // Caret position to restore after a suggestion is inserted — the text
  // update itself is async (setState), so the actual focus/selection call
  // happens in the effect below once the new value has committed to the DOM.
  const pendingCaretRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/quick-replies", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setQuickReplies((data.quick_replies as QuickReply[]) ?? []);
        }
      } catch {
        // Best-effort — the composer works fine without suggestions.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const suggestions = useMemo(() => {
    if (!slashToken) return [];
    // A bare "/" (nothing typed yet) shouldn't dump every quick reply —
    // only start suggesting once there's at least one character to filter by.
    if (slashToken.query.length < 2) return [];
    const query = normalizeForMatch(stripLeadingSlash(slashToken.query));
    return quickReplies
      .filter(
        (qr) =>
          qr.kind === "text" &&
          !!qr.content_text &&
          normalizeForMatch(stripLeadingSlash(qr.title)).startsWith(query),
      )
      .slice(0, 8);
  }, [slashToken, quickReplies]);

  // Media attachment state. `draft` holds an uploaded-but-not-yet-sent
  // image/video/document; `busy` covers the upload window. Voice notes
  // never populate this — see the recording state machine below, which
  // has its own inline discard/send bar instead of routing through the
  // draft preview.
  const [draft, setDraft] = useState<MediaDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  // Mirror of `draft` for the unmount cleanup, which can't read render
  // state. Kept in sync below so navigating away with a staged-but-unsent
  // attachment GCs the orphaned object.
  const draftRef = useRef<MediaDraft | null>(null);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Best-effort GC of a staged object the user never sent. Fire-and-forget.
  const removeStaged = useCallback((path: string | undefined) => {
    if (!path) return;
    void deleteAccountMedia(CHAT_MEDIA_BUCKET, path).catch(() => {});
  }, []);

  // ---- Voice recording ------------------------------------------------
  //
  // Press-and-hold, WhatsApp-style. State machine:
  //   idle       → nothing recording, normal composer row shown.
  //   recording  → mic is live (holding, or holding-then-locked); timer
  //                ticking. `locked` (separate flag) tracks whether the
  //                finger can be lifted without stopping the capture.
  //   paused     → capture has stopped (released without locking, or hit
  //                the max-duration cap) but the agent hasn't decided
  //                trash vs send yet. Upload may still be in flight —
  //                `pendingActionRef` queues whichever the agent picks so
  //                it fires the moment the upload resolves instead of
  //                needing its own loading UI.
  //   sending    → agent tapped send while `locked` (recorder was still
  //                running); stopping it, encoding, and uploading all
  //                happen before the message actually goes out.
  //
  // The bar shown for all three non-idle phases is the same trash/timer/
  // send layout — only the timer (ticking vs frozen) and the lock
  // indicator differ.
  const [micPhase, setMicPhase] = useState<MicPhase>("idle");
  const [locked, setLocked] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<import("opus-recorder").default | null>(null);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Set once the encoded+uploaded file is ready, so a Send/Trash tap that
  // arrives after upload completes can act immediately.
  const uploadedAudioRef = useRef<{ mediaUrl: string; path: string } | null>(null);
  // Set when the agent decides trash/send *before* the upload (still in
  // flight) resolves — finalizeRecording checks this once it lands.
  const pendingActionRef = useRef<"discard" | "send" | null>(null);
  const micButtonRef = useRef<HTMLButtonElement>(null);
  const lockHintRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<{ startY: number } | null>(null);

  // Viewers (read-only role) can browse the inbox but never send.
  // For solo users this is always true — single-owner accounts pass
  // every capability — so the disabled branch is a no-op there.
  const canSend = useCan("send-messages");
  const readOnly = !canSend;
  // Media (like free-form text) is only allowed inside the 24h window.
  const inputsDisabled = readOnly || sessionExpired;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    // Max 4 lines (~96px)
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || sessionExpired) return;

    setSending(true);
    try {
      onSend(trimmed, replyTo?.id);
      setText("");
      setSlashToken(null);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } finally {
      setSending(false);
    }
  }, [text, sending, sessionExpired, onSend, replyTo?.id]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setText(value);
      adjustHeight();
      setSlashToken(findSlashToken(value, e.target.selectionStart ?? value.length));
      setActiveSuggestion(0);
    },
    [adjustHeight]
  );

  // Replaces just the "/shortcut" token with the saved content, leaving
  // everything before/after it untouched — the caret lands right after
  // the inserted text so the agent can keep editing before sending.
  const applySuggestion = useCallback(
    (qr: QuickReply) => {
      if (!slashToken) return;
      const insertion = qr.content_text ?? "";
      const before = text.slice(0, slashToken.start);
      const after = text.slice(slashToken.start + slashToken.query.length);
      pendingCaretRef.current = before.length + insertion.length;
      setText(`${before}${insertion}${after}`);
      setSlashToken(null);
      setActiveSuggestion(0);
    },
    [slashToken, text],
  );

  // Re-measures height and restores the caret after a suggestion insert —
  // deferred here (rather than inline in applySuggestion) because the
  // textarea's DOM value only reflects the new text after this effect
  // runs, one render after the setText() call above.
  useEffect(() => {
    adjustHeight();
    if (pendingCaretRef.current !== null) {
      const pos = pendingCaretRef.current;
      pendingCaretRef.current = null;
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    }
  }, [text, adjustHeight]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (slashToken && suggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveSuggestion((i) => (i + 1) % suggestions.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveSuggestion((i) => (i - 1 + suggestions.length) % suggestions.length);
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          applySuggestion(suggestions[activeSuggestion]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashToken(null);
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [slashToken, suggestions, activeSuggestion, applySuggestion, handleSend]
  );

  // Upload a captured file to chat-media and stage it as a draft.
  const stageUpload = useCallback(
    async (kind: Exclude<ComposerMediaKind, "audio">, pickedFile: File) => {
      // iPhone .mov (QuickTime/HEVC by default since iOS 11): neither
      // the chat-media bucket's MIME whitelist nor Meta's outbound video
      // codec requirement (H.264/AAC in MP4/3GPP) accept it. Transcode
      // to a real .mp4 client-side first, so every check and the upload
      // itself below run completely unchanged, exactly as for a native
      // .mp4 — see transcode-mov-webcodecs.ts (native WebCodecs, not
      // ffmpeg.wasm — validated live on iPhone: a 41s/116MB 4K HEVC
      // clip converted in 24.9s; the old ffmpeg.wasm path could hang
      // indefinitely on the same class of file).
      let file = pickedFile;
      if (kind === "video" && isQuickTimeVideo(file)) {
        setBusy(true);
        try {
          file = await convertMovToMp4ViaWebCodecs(file);
        } catch (err) {
          setBusy(false);
          toast.error(err instanceof Error ? err.message : t("unsupportedVideoType"));
          return;
        }
      }
      // Per-kind ceiling mirrors Meta's caps (image 5 MB, etc.) so we
      // reject before upload rather than orphaning an object that Meta
      // would then refuse at send.
      const max = MEDIA_MAX_BYTES_BY_KIND[kind];
      if (file.size > max) {
        // Was a hardcoded English string — silent to a non-English-reading
        // agent, who'd just see "attaching didn't work" with no clue it
        // was a size cap. Localized + explicit so a large document (a
        // common real-estate PDF catalog, easily >16 MB) reads as
        // "too big", not as a mystery failure.
        toast.error(
          t("fileTooLarge", {
            sizeMb: (file.size / 1024 / 1024).toFixed(1),
            // "image"'s label key is "photo", not "image" — the other two
            // kinds happen to share their key name with themselves.
            kind: t(kind === "image" ? "photo" : kind),
            limitMb: Math.round(max / 1024 / 1024),
          }),
        );
        return;
      }
      // Mirrors the chat-media bucket's allowed_mime_types (migration
      // 023). The picker's `accept` attribute is only a hint — iOS in
      // particular still lets the user pick a QuickTime/HEVC (.mov)
      // video through "Browse"/Files, which Storage then rejects with a
      // raw, untranslated error. Catching it here gives an actionable
      // message instead.
      const allowed = ALLOWED_MIME_TYPES_BY_KIND[kind] as readonly string[];
      if (!allowed.includes(file.type)) {
        toast.error(
          kind === "video" ? t("unsupportedVideoType") : t("unsupportedFileType"),
        );
        return;
      }
      setBusy(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
        // Replacing an existing draft? GC the previous object first.
        removeStaged(draftRef.current?.path);
        setDraft({ kind, mediaUrl: publicUrl, path, filename: file.name, caption: "" });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setBusy(false);
      }
    },
    [removeStaged, t],
  );

  const handlePicked = useCallback(
    (kind: "image" | "video" | "document", file: File | undefined) => {
      if (file) void stageUpload(kind, file);
    },
    [stageUpload],
  );

  // The encoded Ogg/Opus file from opus-recorder. WhatsApp renders Ogg/
  // Opus as a playable voice note. Uploads it, then resolves whatever the
  // agent already decided (discard/send) while the upload was in flight,
  // or — the common case — just parks the result and waits for a tap.
  const finalizeRecording = useCallback(
    async (bytes: Uint8Array) => {
      // Uint8Array is a valid BlobPart at runtime; the cast sidesteps the
      // lib.dom ArrayBufferLike-vs-ArrayBuffer generic mismatch.
      const file = new File([bytes as unknown as BlobPart], `voice-${Date.now()}.ogg`, {
        type: "audio/ogg",
      });
      if (file.size === 0) {
        // Cancelled / empty take — nothing to do.
        pendingActionRef.current = null;
        setMicPhase("idle");
        setLocked(false);
        return;
      }
      if (file.size > MEDIA_MAX_BYTES_BY_KIND.audio) {
        toast.error(t("recordingTooLong"));
        pendingActionRef.current = null;
        setMicPhase("idle");
        setLocked(false);
        return;
      }
      try {
        const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);

        if (pendingActionRef.current === "discard") {
          removeStaged(path);
          pendingActionRef.current = null;
          setMicPhase("idle");
          setLocked(false);
          return;
        }
        if (pendingActionRef.current === "send") {
          onSendMedia({ kind: "audio", mediaUrl: publicUrl, path, replyToId: replyTo?.id });
          pendingActionRef.current = null;
          onClearReply?.();
          setMicPhase("idle");
          setLocked(false);
          return;
        }

        // No decision yet — sit in "paused, ready" state; the trash/send
        // handlers below read this ref directly once tapped.
        uploadedAudioRef.current = { mediaUrl: publicUrl, path };
        setMicPhase("paused");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed.");
        pendingActionRef.current = null;
        setMicPhase("idle");
        setLocked(false);
      }
    },
    [onSendMedia, removeStaged, replyTo?.id, onClearReply, t],
  );

  // Actual mic/encoder setup — deliberately kept separate from the
  // pointerdown handler below, which flips the UI to "recording"
  // *before* awaiting any of this, so the bar appears instantly instead
  // of waiting on getUserMedia + the encoder worker load. On failure
  // this rolls the optimistic UI back.
  const beginCapture = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      toast.error(t("recordingNotSupported"));
      clearTimer();
      setMicPhase("idle");
      setLocked(false);
      return;
    }
    try {
      // Lazy-load the encoder (≈400 KB worker) only when the user records,
      // keeping it out of the main bundle.
      const { default: Recorder } = await import("opus-recorder");
      const recorder = new Recorder({
        encoderPath: OPUS_ENCODER_PATH,
        numberOfChannels: 1,
        encoderApplication: 2048, // VOIP — tuned for speech
        encoderSampleRate: 48000,
        streamPages: false, // one callback with the complete file on stop
      });
      cancelledRef.current = false;
      recorder.ondataavailable = (bytes) => {
        if (cancelledRef.current) return;
        void finalizeRecording(bytes);
      };
      recorderRef.current = recorder;
      await recorder.start();
    } catch {
      void recorderRef.current?.stop().catch(() => {});
      recorderRef.current = null;
      clearTimer();
      setMicPhase("idle");
      setLocked(false);
      toast.error(t("recordingPermissionDenied"));
    }
  }, [clearTimer, finalizeRecording, t]);

  // ---- Mic pointer gesture (press-and-hold, drag-up-to-lock) ---------
  //
  // Pointer Events (not separate touch/mouse handlers) so the exact same
  // code drives touch (iPhone/Android/PWA) and mouse (desktop) — a
  // mousedown-hold-drag-mouseup gesture works identically to a touch one.

  const handleMicPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (inputsDisabled || busy || micPhase !== "idle") return;
      e.preventDefault();
      micButtonRef.current?.setPointerCapture(e.pointerId);
      gestureRef.current = { startY: e.clientY };
      setLocked(false);
      setRecordSeconds(0);
      // Optimistic — the bar shows immediately; beginCapture (mic
      // permission + encoder init) runs in the background and rolls
      // this back on failure.
      setMicPhase("recording");
      clearTimer();
      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
      void beginCapture();
    },
    [inputsDisabled, busy, micPhase, clearTimer, beginCapture],
  );

  const handleMicPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || locked || micPhase !== "recording") return;
      const dy = gesture.startY - e.clientY; // positive = dragged up
      if (lockHintRef.current) {
        const progress = Math.min(1, Math.max(0, dy / LOCK_THRESHOLD_PX));
        // Ease-out (not a 1:1 linear follow): the hint travels faster
        // at the start of the drag and settles as it nears the top —
        // a natural deceleration, closer to how WhatsApp's own lock
        // indicator moves than a rigid ruler-straight mapping. Scale
        // and opacity build up alongside it, so the *whole* icon
        // visibly grows more confident as the gesture continues
        // instead of just sitting there until an abrupt flip.
        const eased = 1 - (1 - progress) * (1 - progress);
        lockHintRef.current.style.transform = `translateY(${-(eased * LOCK_THRESHOLD_PX)}px) scale(${0.85 + eased * 0.35})`;
        lockHintRef.current.style.opacity = String(0.55 + eased * 0.45);
      }
      if (dy > LOCK_THRESHOLD_PX) {
        setLocked(true);
      }
    },
    [locked, micPhase],
  );

  // Releasing (or the gesture getting cancelled by the platform, e.g. an
  // incoming call) stops the capture *unless* already locked — locking
  // is exactly what makes the finger-lift a no-op.
  const handleMicPointerEnd = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      micButtonRef.current?.releasePointerCapture(e.pointerId);
      gestureRef.current = null;
      if (locked || micPhase !== "recording") return;
      clearTimer();
      setMicPhase("paused");
      void recorderRef.current?.stop().catch(() => {});
    },
    [locked, micPhase, clearTimer],
  );

  const handleDiscardRecording = useCallback(() => {
    if (micPhase === "recording") {
      // Still actively capturing (held or locked) — full cancel, mirrors
      // the pre-existing cancel behaviour: mark cancelled so
      // finalizeRecording's ondataavailable callback skips the upload
      // entirely once the recorder actually stops.
      cancelledRef.current = true;
      clearTimer();
      setMicPhase("idle");
      setLocked(false);
      void recorderRef.current?.stop().catch(() => {});
      return;
    }
    if (micPhase === "paused") {
      if (uploadedAudioRef.current) {
        removeStaged(uploadedAudioRef.current.path);
        uploadedAudioRef.current = null;
        setMicPhase("idle");
      } else {
        // Upload still in flight — finalizeRecording will GC it once it lands.
        pendingActionRef.current = "discard";
        setMicPhase("idle");
      }
      setLocked(false);
    }
  }, [micPhase, clearTimer, removeStaged]);

  const handleSendRecording = useCallback(() => {
    if (micPhase === "recording") {
      // Only reachable while locked (send isn't shown unless the bar is
      // up, and the bar only stays up hands-free once locked). Stop the
      // recorder now; finalizeRecording sees pendingActionRef "send" and
      // sends the moment the upload resolves — no extra tap needed.
      clearTimer();
      pendingActionRef.current = "send";
      setMicPhase("sending");
      void recorderRef.current?.stop().catch(() => {});
      return;
    }
    if (micPhase === "paused") {
      if (uploadedAudioRef.current) {
        const { mediaUrl, path } = uploadedAudioRef.current;
        uploadedAudioRef.current = null;
        onSendMedia({ kind: "audio", mediaUrl, path, replyToId: replyTo?.id });
        onClearReply?.();
        setMicPhase("idle");
      } else {
        // Upload still in flight — finalizeRecording sends the moment it lands.
        pendingActionRef.current = "send";
        setMicPhase("sending");
      }
      setLocked(false);
    }
  }, [micPhase, clearTimer, onSendMedia, replyTo?.id, onClearReply]);

  // Auto-stop at the cap so a forgotten recording can't blow the upload
  // size limit — pauses exactly like an unlocked release (keeps what was
  // captured, doesn't discard or auto-send).
  useEffect(() => {
    if (micPhase === "recording" && recordSeconds >= MAX_RECORDING_SECONDS) {
      clearTimer();
      setMicPhase("paused");
      void recorderRef.current?.stop().catch(() => {});
    }
  }, [micPhase, recordSeconds, clearTimer]);

  // Tear down any live recording + timer on unmount so a mid-record
  // navigation doesn't leak the mic, and GC any staged-but-unsent
  // attachment (image/video/document draft, or an already-uploaded
  // voice note nobody acted on) so it doesn't orphan in the bucket.
  useEffect(() => {
    return () => {
      clearTimer();
      cancelledRef.current = true;
      // stop() releases the mic stream + audio context inside opus-recorder.
      void recorderRef.current?.stop().catch(() => {});
      removeStaged(draftRef.current?.path);
      removeStaged(uploadedAudioRef.current?.path);
    };
  }, [clearTimer, removeStaged]);

  // ---- Draft send / discard (image/video/document) --------------------

  const sendDraft = useCallback(() => {
    if (!draft || busy) return;
    onSendMedia({
      kind: draft.kind,
      mediaUrl: draft.mediaUrl,
      path: draft.path,
      caption: draft.caption.trim() || undefined,
      filename: draft.kind === "document" ? draft.filename : undefined,
      replyToId: replyTo?.id,
    });
    // The object is now owned by the sent message — clear without GC.
    setDraft(null);
    onClearReply?.();
  }, [draft, busy, onSendMedia, replyTo?.id, onClearReply]);

  // Discard GCs the staged object — it was uploaded but never sent.
  const discardDraft = useCallback(() => {
    removeStaged(draft?.path);
    setDraft(null);
  }, [draft?.path, removeStaged]);

  const setCaption = useCallback((caption: string) => {
    setDraft((d) => (d ? { ...d, caption } : d));
  }, []);

  // ---- Render --------------------------------------------------------

  const micActive = micPhase !== "idle";

  return (
    // `px-3 py-2` (not `p-3`) — the bar was a bit taller than it needed
    // to be, leaving more empty padding above the safe-area buffer than
    // the actual input row needed (2026-08-07, parte 15 fine-tune). The
    // bottom padding overrides just that side: the same 0.5rem as the
    // other three, plus the device's safe-area inset (home indicator /
    // gesture bar) on top of that — unchanged mechanism, just a smaller
    // base amount. `env()` resolves to 0 on devices without one (desktop,
    // older phones), so this is a no-op there. Requires `viewport-fit=cover`
    // (see app/layout.tsx), otherwise iOS never reports a nonzero inset.
    <div className="border-t border-border bg-card px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
      {replyTo && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}
      {sessionExpired && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-400">
            {t("sessionExpiredHint")}
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-amber-400 hover:text-amber-300"
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="mr-1 h-3 w-3" />
            {t("templates")}
          </Button>
        </div>
      )}

      {/* Hidden file inputs driven by the attach menu. */}
      <input
        ref={imageInputRef}
        type="file"
        accept={PICKER_ACCEPT.image}
        className="hidden"
        onChange={(e) => {
          handlePicked("image", e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept={PICKER_ACCEPT.video}
        className="hidden"
        onChange={(e) => {
          handlePicked("video", e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={documentInputRef}
        type="file"
        accept={PICKER_ACCEPT.document}
        className="hidden"
        onChange={(e) => {
          handlePicked("document", e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {draft ? (
        <MediaDraftPreview
          draft={draft}
          busy={busy}
          readOnly={readOnly}
          onCaptionChange={setCaption}
          onDiscard={discardDraft}
          onSend={sendDraft}
          t={t}
        />
      ) : (
        // `relative` wrapper keeps the mic button mounted (just made
        // invisible + taken out of flow) for the whole recording gesture
        // instead of unmounting it — removing an element mid-gesture
        // would drop its pointer capture and break drag-to-lock. The
        // recording bar overlays in its place, visually replacing the
        // whole row exactly as if it were a swap.
        <div className="relative">
          <div
            className={cn(
              "flex items-end gap-2",
              micActive && "invisible absolute inset-0",
            )}
          >
            {/* Left — attach media: photo / video / document. */}
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={inputsDisabled || busy}
                title={
                  readOnly
                    ? t("readOnlyTitle")
                    : inputsDisabled
                      ? undefined
                      : t("attachMedia")
                }
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Paperclip className="h-4 w-4" />
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="border-border bg-popover">
                <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                  <ImageIcon className="mr-2 h-4 w-4" />
                  {t("photo")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => videoInputRef.current?.click()}>
                  <Video className="mr-2 h-4 w-4" />
                  {t("video")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => documentInputRef.current?.click()}>
                  <FileText className="mr-2 h-4 w-4" />
                  {t("document")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Center — the text field takes all remaining width. Font
                size is 16px (text-base): below that, focusing an <input>/
                <textarea> on iOS Safari auto-zooms the viewport, which is
                exactly the "screen jumps around while typing" behavior
                WhatsApp/Telegram/iMessage don't have. */}
            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                // Losing focus without picking a suggestion (e.g. tapping
                // elsewhere) closes the dropdown. A suggestion click itself
                // uses onMouseDown+preventDefault below, so it never gets
                // here — the textarea never actually blurs in that case.
                onBlur={() => setSlashToken(null)}
                // Empty when there's nothing to type into — no placeholder
                // text sits in the field itself, matching WhatsApp/Telegram/
                // iMessage. The read-only/session-expired placeholders stay:
                // those aren't decorative, they're the only way the agent
                // learns *why* the field is disabled.
                placeholder={
                  readOnly
                    ? t("readOnlyPlaceholder")
                    : sessionExpired
                      ? t("sessionExpiredPlaceholder")
                      : undefined
                }
                disabled={sessionExpired || readOnly}
                rows={1}
                // Textarea keeps its own inline title — the GatedButton
                // wrapping pattern doesn't apply to non-button inputs.
                // The placeholder text also surfaces the read-only state.
                title={readOnly ? t("readOnlyTitle") : undefined}
                className={cn(
                  "w-full resize-none rounded-xl border border-border bg-muted px-4 py-2.5 text-base text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50",
                  (sessionExpired || readOnly) && "cursor-not-allowed opacity-50"
                )}
              />

              {/* "/shortcut" quick-reply suggestions — anchored above the
                  field so it never covers the messages above. */}
              {slashToken && suggestions.length > 0 && (
                <div className="absolute bottom-full left-0 z-20 mb-2 max-h-56 w-full max-w-sm overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
                  {suggestions.map((qr, index) => (
                    <button
                      key={qr.id}
                      type="button"
                      // mousedown (not click) + preventDefault so the tap
                      // never blurs the textarea first — the onBlur above
                      // would otherwise close this dropdown before the
                      // click even registers.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applySuggestion(qr);
                      }}
                      className={cn(
                        "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left",
                        index === activeSuggestion
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground hover:bg-muted"
                      )}
                    >
                      <span className="text-sm font-medium">{qr.title}</span>
                      <span className="line-clamp-1 text-xs text-muted-foreground">
                        {qr.content_text}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right — record audio. Press-and-hold (Pointer Events cover
                touch + mouse identically), drag up to lock. */}
            <button
              ref={micButtonRef}
              type="button"
              disabled={inputsDisabled || busy}
              title={readOnly ? undefined : t("voiceNote")}
              aria-label={t("voiceNote")}
              onPointerDown={handleMicPointerDown}
              onPointerMove={handleMicPointerMove}
              onPointerUp={handleMicPointerEnd}
              onPointerCancel={handleMicPointerEnd}
              className="flex h-9 w-9 shrink-0 touch-none select-none items-center justify-center rounded-md p-0 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Mic className="h-4 w-4" />
            </button>

            <GatedButton
              size="sm"
              canAct={!readOnly}
              gateReason="enviar mensagens"
              disabled={!text.trim() || sessionExpired || sending}
              onClick={handleSend}
              className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </GatedButton>
          </div>

          {micActive && (
            <div className="relative flex items-center gap-3 rounded-xl border border-border bg-muted px-3 py-2.5">
              {/* Drag-up-to-lock hint — only while still holding and not
                  yet locked. Position/scale/opacity are all written
                  live (via ref, not state) during the gesture in
                  handleMicPointerMove, eased rather than 1:1, so it
                  builds up progressively instead of just sitting there
                  until an abrupt flip — zero re-render overhead either way. */}
              {micPhase === "recording" && !locked && (
                <div
                  ref={lockHintRef}
                  // Resting classes match what handleMicPointerMove
                  // computes at progress=0 (scale 0.85, opacity 0.55) —
                  // so there's no flash-of-full-strength before the
                  // first pointermove event lands.
                  className="pointer-events-none absolute -top-12 right-2 flex scale-[0.85] flex-col items-center gap-1 rounded-full border border-border bg-popover px-2 py-1.5 text-muted-foreground opacity-55 shadow-md"
                >
                  <Lock className="h-3.5 w-3.5" />
                </div>
              )}

              <button
                type="button"
                onClick={handleDiscardRecording}
                aria-label={t("discardRecording")}
                disabled={micPhase === "sending"}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
              </button>

              <div className="flex flex-1 items-center justify-center gap-2.5">
                {locked && (
                  // The above-bar hint just disappears the instant this
                  // mounts (locked flips true) — this pop-in is what
                  // actually carries the "locked!" confirmation moment.
                  <Lock className="h-3.5 w-3.5 shrink-0 animate-in text-primary zoom-in-50 duration-200" />
                )}
                {micPhase !== "sending" ? (
                  <RecordingIndicator active={micPhase === "recording"} />
                ) : (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                )}
                <span className="text-sm font-medium tabular-nums text-foreground">
                  {formatDuration(recordSeconds)}
                </span>
              </div>

              <GatedButton
                size="sm"
                canAct={!readOnly}
                gateReason="enviar mensagens"
                disabled={micPhase === "sending"}
                onClick={handleSendRecording}
                aria-label={t("sendRecording")}
                className="h-8 w-8 shrink-0 bg-primary p-0 hover:bg-primary/90 disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </GatedButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Small "audio is capturing" cue — a pulsing dot plus a 3-bar equalizer
 * that bounces at staggered delays. Swaps to a plain static dot once the
 * capture has actually stopped (paused, waiting on a trash/send tap) so
 * it doesn't keep implying audio is still being recorded.
 */
function RecordingIndicator({ active }: { active: boolean }) {
  return (
    <span className="flex shrink-0 items-center gap-2">
      <span
        className={cn(
          "h-2.5 w-2.5 rounded-full bg-red-500",
          active && "animate-pulse",
        )}
      />
      {active && (
        // The waveform keyframe lives in globals.css, not a component-
        // scoped <style jsx> block — see the comment there for why.
        <span className="flex items-end gap-0.5" aria-hidden>
          <span className="h-2 w-0.5 animate-[waveform_1s_ease-in-out_infinite] rounded-full bg-red-500" />
          <span className="h-3 w-0.5 animate-[waveform_1s_ease-in-out_infinite_0.15s] rounded-full bg-red-500" />
          <span className="h-1.5 w-0.5 animate-[waveform_1s_ease-in-out_infinite_0.3s] rounded-full bg-red-500" />
        </span>
      )}
    </span>
  );
}

/**
 * Staged-attachment preview with caption + send/discard. Declared at
 * module scope (not nested in MessageComposer) so React keeps it mounted
 * across the parent's re-renders — a nested component would remount the
 * caption input on every keystroke and drop focus.
 */
function MediaDraftPreview({
  draft,
  busy,
  readOnly,
  onCaptionChange,
  onDiscard,
  onSend,
  t,
}: {
  draft: MediaDraft;
  busy: boolean;
  readOnly: boolean;
  onCaptionChange: (caption: string) => void;
  onDiscard: () => void;
  onSend: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {draft.kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={draft.mediaUrl}
              alt={draft.filename}
              className="max-h-40 rounded-lg object-cover"
            />
          )}
          {draft.kind === "video" && (
            <video src={draft.mediaUrl} controls className="max-h-40 rounded-lg" />
          )}
          {draft.kind === "document" && (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="truncate">{draft.filename}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDiscard}
          aria-label={t("removeAttachment")}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 flex items-end gap-2">
        <input
          value={draft.caption}
          maxLength={MEDIA_CAPTION_MAX}
          onChange={(e) => onCaptionChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={t("addCaption")}
          // text-base (16px), same reasoning as the main textarea —
          // keeps iOS Safari from auto-zooming the viewport on focus.
          className="flex-1 rounded-xl border border-border bg-muted px-4 py-2.5 text-base text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-primary/50"
        />
        <GatedButton
          size="sm"
          canAct={!readOnly}
          gateReason="enviar mensagens"
          disabled={busy}
          onClick={onSend}
          className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </GatedButton>
      </div>
    </div>
  );
}
