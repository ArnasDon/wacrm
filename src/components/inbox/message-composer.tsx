'use client';

import { readResponseJson } from '@/lib/http/response-json';

import { useState, useRef, useCallback, useEffect, KeyboardEvent } from 'react';
import {
  Send,
  LayoutTemplate,
  Paperclip,
  Image as ImageIcon,
  Video,
  FileText,
  Mic,
  Square,
  X,
  Loader2,
  Sparkles,
  Plus,
  MessageSquareDashed,
  Zap,
  Lightbulb,
  BookOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GatedButton } from '@/components/ui/gated-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCan } from '@/hooks/use-can';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';
import { ReplyQuote } from './reply-quote';
import { useTranslations } from 'next-intl';
import {
  InteractiveBuilder,
  blankButtonsPayload,
} from '@/components/interactive/interactive-builder';
import { validateInteractivePayload } from '@/lib/whatsapp/interactive';
import type { InteractiveMessagePayload, QuickReply } from '@/types';
import { QuickReplyPicker } from './quick-reply-picker';

/** Media content types an agent can send from the composer. */
export type ComposerMediaKind = 'image' | 'video' | 'document' | 'audio';

/** Supabase Storage bucket holding agent-sent chat attachments (migration 023). */
export const CHAT_MEDIA_BUCKET = 'chat-media';

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

/** Mirrors the shape POST /api/ai/suggest-action returns — kept as a
 *  plain local type instead of importing from the server-only
 *  business-actions module. */
type SuggestedAction =
  | 'close_conversation'
  | 'mark_deal_won'
  | 'move_deal'
  | 'set_lead_temperature'
  | 'schedule_appointment';

interface ActionSuggestion {
  action: SuggestedAction | null;
  targetId: string | null;
  stageId: string | null;
  temperature: string | null;
  proposedStart: string | null;
  proposedEnd: string | null;
  attendeeEmail: string | null;
  reason: string;
}

/** `datetime-local` inputs need `YYYY-MM-DDTHH:mm` in the browser's own
 *  timezone (no trailing `Z`/offset) — this converts an ISO string
 *  from the AI's suggestion into that shape, and back. Falls back to
 *  now on an unparsable/missing value so the input never renders
 *  blank/invalid. */
function isoToLocalInput(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const valid = Number.isNaN(d.getTime()) ? new Date() : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${valid.getFullYear()}-${pad(valid.getMonth() + 1)}-${pad(valid.getDate())}T${pad(valid.getHours())}:${pad(valid.getMinutes())}`;
}

function localInputToIso(local: string): string {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// Mirrors the chat-media bucket's allowed_mime_types (migration 023) for
// the file picker so unsupported files are rejected before upload rather
// than failing with a confusing Storage error. Audio has no picker — it's
// captured via the recorder.
const PICKER_ACCEPT: Record<'image' | 'video' | 'document', string> = {
  image: 'image/png,image/jpeg,image/webp',
  video: 'video/mp4,video/3gpp',
  document:
    'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain',
};

interface MediaDraft {
  kind: ComposerMediaKind;
  mediaUrl: string;
  /** Storage path — used to GC the object if the draft is discarded. */
  path: string;
  filename: string;
  caption: string;
}

interface MessageComposerProps {
  conversationId: string;
  sessionExpired: boolean;
  onSend: (text: string, replyToId?: string) => void;
  onSendMedia: (payload: SendMediaPayload) => void;
  onSendInteractive: (
    payload: InteractiveMessagePayload,
    replyToId?: string
  ) => void;
  onOpenTemplates: () => void;
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
  /**
   * Which channel this conversation is on. Templates and the
   * WhatsApp-shaped interactive-message builder are WhatsApp-only
   * concepts — Instagram has no template system and its quick-reply
   * analogue isn't wired into the composer yet (see
   * docs/instagram-integration/PROGRESS.md), and Facebook's send layer
   * (`validateFacebookSendParams`) rejects both message types outright
   * — both affordances are hidden for Instagram and Facebook
   * conversations. Defaults to 'whatsapp' so every existing caller keeps
   * its current behavior unchanged.
   */
  channel?: 'whatsapp' | 'instagram' | 'facebook';
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Worker that encodes mic input to Ogg/Opus entirely in the browser
 *  (vendored from opus-recorder into /public). Recording client-side in a
 *  Meta-accepted format means no server ffmpeg / transcode step. */
const OPUS_ENCODER_PATH = '/opus/encoderWorker.min.js';

export function MessageComposer({
  conversationId,
  sessionExpired,
  onSend,
  onSendMedia,
  onSendInteractive,
  onOpenTemplates,
  replyTo,
  onClearReply,
  channel = 'whatsapp',
}: MessageComposerProps) {
  const t = useTranslations('Inbox.composer');
  // Templates and the interactive-message builder are WhatsApp-only —
  // both Instagram and Facebook lack them (Facebook's send layer rejects
  // both message types server-side).
  const hidesWhatsappOnlyFeatures =
    channel === 'instagram' || channel === 'facebook';
  // WhatsApp has no way around an expired 24h window without a
  // Meta-approved template — genuinely blocked here. Instagram/Facebook
  // instead have Meta's HUMAN_AGENT message tag (7-day extension,
  // human-support-only) — send-message.ts applies it automatically
  // whenever a human sends here with the window actually expired, so
  // the composer stays open rather than hard-blocking like WhatsApp.
  const hardWindowBlock = sessionExpired && channel === 'whatsapp';

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [sendingCatalog, setSendingCatalog] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<ActionSuggestion | null>(null);
  const [confirmingSuggestion, setConfirmingSuggestion] = useState(false);
  // schedule_appointment only — editable copies of the AI's proposed
  // slot/email, seeded from the suggestion but never sent verbatim:
  // the agent reviews and can correct either before confirming (see
  // plan: appointments always need a human-picked/verified email).
  const [appointmentStart, setAppointmentStart] = useState('');
  const [appointmentEnd, setAppointmentEnd] = useState('');
  const [appointmentEmail, setAppointmentEmail] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Interactive-message builder dialog + quick-reply picker.
  const [interactiveOpen, setInteractiveOpen] = useState(false);
  const [interactivePayload, setInteractivePayload] =
    useState<InteractiveMessagePayload>(blankButtonsPayload);
  const [savingQuickReply, setSavingQuickReply] = useState(false);
  const [quickReplyOpen, setQuickReplyOpen] = useState(false);

  // Media attachment state. `draft` holds an uploaded-but-not-yet-sent
  // attachment; `busy` covers the upload/transcode window.
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

  // Voice recording state. The recorder encodes Ogg/Opus in-browser
  // (opus-recorder) so there's no server-side transcode.
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorderRef = useRef<import('opus-recorder').default | null>(null);
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Viewers (read-only role) can browse the inbox but never send.
  // For solo users this is always true — single-owner accounts pass
  // every capability — so the disabled branch is a no-op there.
  const canSend = useCan('send-messages');
  const readOnly = !canSend;
  // Media (like free-form text) follows the same window rule as text.
  const inputsDisabled = readOnly || hardWindowBlock;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Tear down any live recording + timer on unmount so a mid-record
  // navigation doesn't leak the mic, and GC a staged-but-unsent
  // attachment so it doesn't orphan in the bucket.
  useEffect(() => {
    return () => {
      clearTimer();
      cancelledRef.current = true;
      // stop() releases the mic stream + audio context inside opus-recorder.
      void recorderRef.current?.stop().catch(() => {});
      removeStaged(draftRef.current?.path);
    };
  }, [clearTimer, removeStaged]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // Max 4 lines (~96px)
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || hardWindowBlock) return;

    setSending(true);
    try {
      onSend(trimmed, replyTo?.id);
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    } finally {
      setSending(false);
    }
  }, [text, sending, hardWindowBlock, onSend, replyTo?.id]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      adjustHeight();
    },
    [adjustHeight]
  );

  // Ask the AI assistant for a suggested reply and drop it into the
  // composer for the agent to edit + send. Read-only server-side —
  // nothing is sent until the agent hits Send.
  const handleDraft = useCallback(async () => {
    if (drafting) return;
    setDrafting(true);
    try {
      const res = await fetch('/api/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = await readResponseJson(res).catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error(
            "AI isn't set up yet — enable it in Settings → AI Assistant."
          );
        } else {
          toast.error(data.error ?? "Couldn't draft a reply.");
        }
        return;
      }
      const draftText = typeof data.draft === 'string' ? data.draft.trim() : '';
      if (!draftText) {
        toast.error("The assistant didn't return a reply.");
        return;
      }
      setText(draftText);
      // Let the textarea grow to fit and drop the cursor at the end so
      // the agent can tweak immediately.
      requestAnimationFrame(() => {
        adjustHeight();
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    } catch {
      toast.error("Couldn't reach the AI assistant.");
    } finally {
      setDrafting(false);
    }
  }, [drafting, conversationId, adjustHeight]);

  // Sends a PDF of the account's active product catalog to this
  // conversation, generated on demand server-side.
  const handleSendCatalog = useCallback(async () => {
    if (sendingCatalog) return;
    setSendingCatalog(true);
    try {
      const res = await fetch('/api/products/send-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = await readResponseJson(res).catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('sendCatalogFailed'));
        return;
      }
      toast.success(t('sendCatalogSuccess'));
    } catch {
      toast.error(t('sendCatalogFailed'));
    } finally {
      setSendingCatalog(false);
    }
  }, [sendingCatalog, conversationId, t]);

  // Ask the AI to suggest one of the four business actions (close the
  // conversation, mark a deal won, move a deal, update lead temperature)
  // based on the conversation so far. Purely advisory — nothing is
  // executed until the agent confirms the card below.
  const handleSuggestAction = useCallback(async () => {
    if (suggesting) return;
    setSuggesting(true);
    setSuggestion(null);
    try {
      const res = await fetch('/api/ai/suggest-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      });
      const data = await readResponseJson(res).catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error(
            "AI isn't set up yet — enable it in Settings → AI Assistant."
          );
        } else {
          toast.error(data.error ?? t('suggestionFetchFailed'));
        }
        return;
      }
      const result = data.suggestion as ActionSuggestion | undefined;
      if (!result?.action) {
        toast.info(result?.reason || t('suggestionNoneApplies'));
        return;
      }
      setSuggestion(result);
      if (result.action === 'schedule_appointment') {
        const start = result.proposedStart
          ? new Date(result.proposedStart)
          : new Date(Date.now() + 60 * 60 * 1000);
        const end = result.proposedEnd
          ? new Date(result.proposedEnd)
          : new Date(start.getTime() + 60 * 60 * 1000);
        setAppointmentStart(isoToLocalInput(start.toISOString()));
        setAppointmentEnd(isoToLocalInput(end.toISOString()));
        setAppointmentEmail(result.attendeeEmail ?? '');
      }
    } catch {
      toast.error(t('suggestionFetchFailed'));
    } finally {
      setSuggesting(false);
    }
  }, [suggesting, conversationId, t]);

  // Confirm the suggestion card — chains the two POST /api/ai/actions
  // calls the existing confirmation flow requires (first without
  // `confirmation` to get the exact phrase back in a 409, then again
  // with it) so the agent only has to click once.
  const handleConfirmSuggestion = useCallback(async () => {
    if (!suggestion?.action || !suggestion.targetId || confirmingSuggestion)
      return;
    if (
      suggestion.action === 'schedule_appointment' &&
      !appointmentEmail.trim()
    ) {
      toast.error(t('suggestionAppointmentEmailRequired'));
      return;
    }
    setConfirmingSuggestion(true);
    try {
      const isAppointment = suggestion.action === 'schedule_appointment';
      const payload = {
        action: suggestion.action,
        targetId: suggestion.targetId,
        stageId: suggestion.stageId ?? undefined,
        temperature: suggestion.temperature ?? undefined,
        startTime: isAppointment
          ? localInputToIso(appointmentStart)
          : undefined,
        endTime: isAppointment ? localInputToIso(appointmentEnd) : undefined,
        attendeeEmail: isAppointment ? appointmentEmail.trim() : undefined,
      };
      const first = await fetch('/api/ai/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const firstData = await readResponseJson(first).catch(() => ({}));
      if (first.status !== 409 || !firstData.confirmation) {
        toast.error(firstData.error ?? t('suggestionConfirmFailed'));
        return;
      }
      const second = await fetch('/api/ai/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          confirmation: firstData.confirmation,
        }),
      });
      const secondData = await readResponseJson(second).catch(() => ({}));
      if (!second.ok) {
        toast.error(secondData.error ?? t('suggestionConfirmFailed'));
        return;
      }
      toast.success(t('suggestionConfirmSuccess'));
      setSuggestion(null);
    } catch {
      toast.error(t('suggestionConfirmFailed'));
    } finally {
      setConfirmingSuggestion(false);
    }
  }, [
    suggestion,
    confirmingSuggestion,
    appointmentStart,
    appointmentEnd,
    appointmentEmail,
    t,
  ]);

  const suggestionActionLabel = useCallback(
    (action: SuggestedAction) => {
      switch (action) {
        case 'close_conversation':
          return t('suggestionActionCloseConversation');
        case 'mark_deal_won':
          return t('suggestionActionMarkDealWon');
        case 'move_deal':
          return t('suggestionActionMoveDeal');
        case 'set_lead_temperature':
          return t('suggestionActionSetLeadTemperature');
        case 'schedule_appointment':
          return t('suggestionActionScheduleAppointment');
      }
    },
    [t]
  );

  // ---- Interactive message + quick replies --------------------------

  const openInteractiveBuilder = useCallback(
    (seed?: InteractiveMessagePayload) => {
      setInteractivePayload(seed ?? blankButtonsPayload());
      setInteractiveOpen(true);
    },
    []
  );

  const sendInteractive = useCallback(() => {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    onSendInteractive(interactivePayload, replyTo?.id);
    setInteractiveOpen(false);
    onClearReply?.();
  }, [interactivePayload, onSendInteractive, replyTo?.id, onClearReply]);

  // Persist the current builder payload as a reusable interactive snippet.
  const saveAsQuickReply = useCallback(async () => {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const title = window.prompt(t('quickReplyNamePrompt'))?.trim();
    if (!title) return;
    setSavingQuickReply(true);
    try {
      const res = await fetch('/api/quick-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          kind: 'interactive',
          interactive_payload: interactivePayload,
        }),
      });
      const data = await readResponseJson(res).catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? t('quickReplySaveError'));
        return;
      }
      toast.success(t('quickReplySaved'));
    } catch {
      toast.error(t('quickReplySaveError'));
    } finally {
      setSavingQuickReply(false);
    }
  }, [interactivePayload, t]);

  // A picked quick reply: text fills the composer; interactive opens the
  // builder pre-filled so the agent can tweak before sending.
  const handlePickQuickReply = useCallback(
    (qr: QuickReply) => {
      setQuickReplyOpen(false);
      if (qr.kind === 'interactive' && qr.interactive_payload) {
        openInteractiveBuilder(qr.interactive_payload);
        return;
      }
      const body = qr.content_text ?? '';
      // Separate the snippet from any existing draft with a newline so the
      // words don't run together ("Thanks" + "we'll…" → "Thankswe'll…").
      setText((prev) =>
        prev && !/\s$/.test(prev) ? `${prev}\n${body}` : `${prev}${body}`
      );
      requestAnimationFrame(() => {
        adjustHeight();
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    },
    [openInteractiveBuilder, adjustHeight]
  );

  // Upload a captured file to chat-media and stage it as a draft.
  const stageUpload = useCallback(
    async (kind: ComposerMediaKind, file: File) => {
      // Per-kind ceiling mirrors Meta's caps (image 5 MB, etc.) so we
      // reject before upload rather than orphaning an object that Meta
      // would then refuse at send.
      const max = MEDIA_MAX_BYTES_BY_KIND[kind];
      if (file.size > max) {
        toast.error(
          `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — ${kind} limit is ${Math.round(
            max / 1024 / 1024
          )} MB.`
        );
        return;
      }
      setBusy(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(
          CHAT_MEDIA_BUCKET,
          file
        );
        // Replacing an existing draft? GC the previous object first.
        removeStaged(draftRef.current?.path);
        setDraft({
          kind,
          mediaUrl: publicUrl,
          path,
          filename: file.name,
          caption: '',
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Upload failed.');
      } finally {
        setBusy(false);
      }
    },
    [removeStaged]
  );

  const handlePicked = useCallback(
    (kind: 'image' | 'video' | 'document', file: File | undefined) => {
      if (file) void stageUpload(kind, file);
    },
    [stageUpload]
  );

  // ---- Voice recording (client-side Ogg/Opus, no server transcode) ---

  // The encoded Ogg/Opus file from opus-recorder → upload as an audio
  // draft. WhatsApp renders Ogg/Opus as a playable voice note.
  const finalizeRecording = useCallback(
    async (bytes: Uint8Array) => {
      // Uint8Array is a valid BlobPart at runtime; the cast sidesteps the
      // lib.dom ArrayBufferLike-vs-ArrayBuffer generic mismatch.
      const file = new File(
        [bytes as unknown as BlobPart],
        `voice-${Date.now()}.ogg`,
        {
          type: 'audio/ogg',
        }
      );
      if (file.size === 0) return; // cancelled / empty take
      if (file.size > MEDIA_MAX_BYTES_BY_KIND.audio) {
        toast.error('Recording is too long (over 16 MB).');
        return;
      }
      setBusy(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(
          CHAT_MEDIA_BUCKET,
          file
        );
        removeStaged(draftRef.current?.path);
        setDraft({
          kind: 'audio',
          mediaUrl: publicUrl,
          path,
          filename: file.name,
          caption: '',
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Upload failed.');
      } finally {
        setBusy(false);
      }
    },
    [removeStaged]
  );

  const startRecording = useCallback(async () => {
    if (inputsDisabled || busy || recording) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === 'undefined'
    ) {
      toast.error("Voice recording isn't supported in this browser.");
      return;
    }
    try {
      // Lazy-load the encoder (≈400 KB worker) only when the user records,
      // keeping it out of the main bundle.
      const { default: Recorder } = await import('opus-recorder');
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
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(
        () => setRecordSeconds((s) => s + 1),
        1000
      );
    } catch {
      void recorderRef.current?.stop().catch(() => {});
      recorderRef.current = null;
      toast.error('Microphone access denied or unavailable.');
    }
  }, [inputsDisabled, busy, recording, finalizeRecording]);

  const stopRecording = useCallback(() => {
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  // Auto-stop at the cap so a forgotten recording can't blow the
  // upload size limit.
  useEffect(() => {
    if (recording && recordSeconds >= MAX_RECORDING_SECONDS) {
      stopRecording();
    }
  }, [recording, recordSeconds, stopRecording]);

  // ---- Draft send / discard -----------------------------------------

  const sendDraft = useCallback(() => {
    if (!draft || busy) return;
    onSendMedia({
      kind: draft.kind,
      mediaUrl: draft.mediaUrl,
      path: draft.path,
      // Audio takes no caption (Meta rejects it). Everything else: the
      // trimmed caption, or undefined when blank.
      caption:
        draft.kind === 'audio' ? undefined : draft.caption.trim() || undefined,
      filename: draft.kind === 'document' ? draft.filename : undefined,
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

  return (
    <div className="border-border bg-card border-t p-3">
      {replyTo && (
        <div className="mb-2">
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        </div>
      )}
      {sessionExpired && channel === 'whatsapp' && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-400">{t('sessionExpiredHint')}</p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-amber-400 hover:text-amber-300"
            onClick={onOpenTemplates}
          >
            <LayoutTemplate className="mr-1 h-3 w-3" />
            {t('templates')}
          </Button>
        </div>
      )}
      {sessionExpired && hidesWhatsappOnlyFeatures && (
        <div className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2">
          <p className="text-xs text-amber-400">{t('humanAgentTagHint')}</p>
        </div>
      )}

      {suggestion?.action && (
        <div className="border-primary/30 bg-primary/5 mb-2 rounded-lg border px-3 py-2">
          <div className="flex items-start gap-2">
            <Lightbulb className="text-primary mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p className="text-foreground text-xs font-medium">
                {t('suggestionTitle')}:{' '}
                {suggestionActionLabel(suggestion.action)}
              </p>
              {suggestion.reason && (
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {suggestion.reason}
                </p>
              )}
              {suggestion.action === 'schedule_appointment' && (
                <div className="mt-2 grid gap-1.5">
                  <label className="text-muted-foreground flex items-center gap-2 text-xs">
                    <span className="w-10 shrink-0">
                      {t('suggestionAppointmentStart')}
                    </span>
                    <input
                      type="datetime-local"
                      value={appointmentStart}
                      onChange={(e) => setAppointmentStart(e.target.value)}
                      className="border-border bg-muted text-foreground focus:border-primary/50 flex-1 rounded-md border px-2 py-1 text-xs outline-none"
                    />
                  </label>
                  <label className="text-muted-foreground flex items-center gap-2 text-xs">
                    <span className="w-10 shrink-0">
                      {t('suggestionAppointmentEnd')}
                    </span>
                    <input
                      type="datetime-local"
                      value={appointmentEnd}
                      onChange={(e) => setAppointmentEnd(e.target.value)}
                      className="border-border bg-muted text-foreground focus:border-primary/50 flex-1 rounded-md border px-2 py-1 text-xs outline-none"
                    />
                  </label>
                  <label className="text-muted-foreground flex items-center gap-2 text-xs">
                    <span className="w-10 shrink-0">
                      {t('suggestionAppointmentEmail')}
                    </span>
                    <input
                      type="email"
                      value={appointmentEmail}
                      onChange={(e) => setAppointmentEmail(e.target.value)}
                      placeholder={t('suggestionAppointmentEmailPlaceholder')}
                      className="border-border bg-muted text-foreground focus:border-primary/50 flex-1 rounded-md border px-2 py-1 text-xs outline-none"
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setSuggestion(null)}
              disabled={confirmingSuggestion}
              className="text-muted-foreground hover:bg-muted hover:text-foreground rounded-md px-2 py-1 text-xs disabled:opacity-50"
            >
              {t('suggestionDiscard')}
            </button>
            <Button
              size="sm"
              onClick={handleConfirmSuggestion}
              disabled={confirmingSuggestion}
              className="bg-primary hover:bg-primary/90 h-7 px-2 text-xs"
            >
              {confirmingSuggestion ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              {t('suggestionConfirm')}
            </Button>
          </div>
        </div>
      )}

      {/* Hidden file inputs driven by the attach menu. */}
      <input
        ref={imageInputRef}
        type="file"
        accept={PICKER_ACCEPT.image}
        className="hidden"
        onChange={(e) => {
          handlePicked('image', e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept={PICKER_ACCEPT.video}
        className="hidden"
        onChange={(e) => {
          handlePicked('video', e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={documentInputRef}
        type="file"
        accept={PICKER_ACCEPT.document}
        className="hidden"
        onChange={(e) => {
          handlePicked('document', e.target.files?.[0]);
          e.target.value = '';
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
      ) : recording ? (
        // Recording bar — replaces the composer while the mic is live.
        <div className="border-border bg-muted flex items-center gap-3 rounded-xl border px-4 py-2.5">
          <span className="flex h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
          <span className="text-foreground flex-1 text-sm">
            {t('recording', {
              current: formatDuration(recordSeconds),
              max: formatDuration(MAX_RECORDING_SECONDS),
            })}
          </span>
          <button
            type="button"
            onClick={cancelRecording}
            className="text-muted-foreground hover:bg-card hover:text-foreground rounded-md px-2 py-1 text-xs"
          >
            {t('cancel')}
          </button>
          <Button
            size="sm"
            onClick={stopRecording}
            className="bg-primary hover:bg-primary/90 h-9 w-9 shrink-0 p-0"
            title={t('stopAndAttach')}
          >
            <Square className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          {/* Attach menu — photo / video / document / voice. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={inputsDisabled || busy}
              title={
                readOnly
                  ? t('readOnlyTitle')
                  : inputsDisabled
                    ? undefined
                    : t('attachMedia')
              }
              className="text-muted-foreground hover:text-foreground inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md p-0 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Paperclip className="h-4 w-4" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover"
            >
              <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                <ImageIcon className="mr-2 h-4 w-4" />
                {t('photo')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => videoInputRef.current?.click()}>
                <Video className="mr-2 h-4 w-4" />
                {t('video')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => documentInputRef.current?.click()}
              >
                <FileText className="mr-2 h-4 w-4" />
                {t('document')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void startRecording()}>
                <Mic className="mr-2 h-4 w-4" />
                {t('voiceNote')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* + menu — interactive messages + quick replies. Gated on the
              24h window like free-form text (interactive requires it). */}
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={inputsDisabled}
              title={
                readOnly
                  ? t('readOnlyTitle')
                  : inputsDisabled
                    ? undefined
                    : t('moreActions')
              }
              className="text-muted-foreground hover:text-foreground inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md p-0 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="border-border bg-popover"
            >
              {!hidesWhatsappOnlyFeatures && (
                <DropdownMenuItem onClick={() => openInteractiveBuilder()}>
                  <MessageSquareDashed className="mr-2 h-4 w-4" />
                  {t('interactiveMessage')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setQuickReplyOpen(true)}>
                <Zap className="mr-2 h-4 w-4" />
                {t('quickReplies')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={sendingCatalog}
                onClick={() => void handleSendCatalog()}
              >
                {sendingCatalog ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <BookOpen className="mr-2 h-4 w-4" />
                )}
                {t('sendCatalog')}
              </DropdownMenuItem>

              {/* On mobile the composer keeps only attach + input + send
                  (WhatsApp-style), so the template / draft / suggest
                  actions live here instead of as their own buttons.
                  Hidden on lg+, where those buttons are shown inline. */}
              {!hidesWhatsappOnlyFeatures && (
                <DropdownMenuItem
                  className="lg:hidden"
                  disabled={readOnly}
                  onClick={onOpenTemplates}
                >
                  <LayoutTemplate className="mr-2 h-4 w-4" />
                  {t('sendTemplate')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="lg:hidden"
                disabled={readOnly || drafting}
                onClick={handleDraft}
              >
                {drafting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                {t('draftWithAI')}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="lg:hidden"
                disabled={readOnly || suggesting}
                onClick={handleSuggestAction}
              >
                {suggesting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Lightbulb className="mr-2 h-4 w-4" />
                )}
                {t('suggestAction')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {!hidesWhatsappOnlyFeatures && (
            <GatedButton
              variant="ghost"
              size="sm"
              canAct={!readOnly}
              gateReason="send messages"
              title={readOnly ? undefined : t('sendTemplate')}
              className="text-muted-foreground hover:text-foreground hidden h-9 w-9 shrink-0 p-0 lg:inline-flex"
              onClick={onOpenTemplates}
            >
              <LayoutTemplate className="h-4 w-4" />
            </GatedButton>
          )}

          <GatedButton
            variant="ghost"
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            disabled={drafting}
            title={readOnly ? undefined : t('draftWithAI')}
            className="text-muted-foreground hover:text-primary hidden h-9 w-9 shrink-0 p-0 lg:inline-flex"
            onClick={handleDraft}
          >
            {drafting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </GatedButton>

          <GatedButton
            variant="ghost"
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            disabled={suggesting}
            title={readOnly ? undefined : t('suggestAction')}
            className="text-muted-foreground hover:text-primary hidden h-9 w-9 shrink-0 p-0 lg:inline-flex"
            onClick={handleSuggestAction}
          >
            {suggesting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Lightbulb className="h-4 w-4" />
            )}
          </GatedButton>

          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={
              readOnly
                ? t('readOnlyPlaceholder')
                : hardWindowBlock
                  ? t('sessionExpiredPlaceholder')
                  : t('typeMessagePlaceholder')
            }
            disabled={hardWindowBlock || readOnly}
            rows={1}
            // Textarea keeps its own inline title — the GatedButton
            // wrapping pattern doesn't apply to non-button inputs.
            // The placeholder text also surfaces the read-only state.
            title={readOnly ? t('readOnlyTitle') : undefined}
            className={cn(
              'border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 flex-1 resize-none rounded-[1.25rem] border px-4 py-2.5 text-sm transition-colors outline-none lg:rounded-xl',
              (hardWindowBlock || readOnly) && 'cursor-not-allowed opacity-50'
            )}
          />

          {/* Send — always shown on desktop; on mobile it appears only
              once there's text to send (WhatsApp swaps it for the mic
              below when the field is empty). */}
          <GatedButton
            size="sm"
            canAct={!readOnly}
            gateReason="send messages"
            disabled={!text.trim() || hardWindowBlock || sending}
            onClick={handleSend}
            className={cn(
              'bg-primary hover:bg-primary/90 h-9 w-9 shrink-0 rounded-full p-0 disabled:opacity-40 lg:rounded-md',
              !text.trim() && 'hidden lg:inline-flex'
            )}
          >
            <Send className="h-4 w-4" />
          </GatedButton>

          {/* Mic — mobile only, and only while the field is empty. Taps
              straight into the existing voice-note recorder. */}
          {!text.trim() && (
            <GatedButton
              size="sm"
              canAct={!readOnly}
              gateReason="send messages"
              disabled={inputsDisabled || busy}
              title={readOnly ? undefined : t('voiceNote')}
              onClick={() => void startRecording()}
              className="bg-primary hover:bg-primary/90 h-9 w-9 shrink-0 rounded-full p-0 disabled:opacity-40 lg:hidden"
            >
              <Mic className="h-4 w-4" />
            </GatedButton>
          )}
        </div>
      )}

      {/* Hint sits outside the flex row so its height doesn't push
          `items-end` buttons below the textarea. Desktop-only — it
          points at buttons the mobile composer folds into the + menu. */}
      {!draft && !recording && (
        <p className="text-muted-foreground mt-1 hidden pl-[5.5rem] text-[10px] lg:block">
          {t('draftHint')}
        </p>
      )}

      {/* Interactive-message builder dialog. */}
      <Dialog open={interactiveOpen} onOpenChange={setInteractiveOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('interactiveMessage')}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto">
            <InteractiveBuilder
              value={interactivePayload}
              onChange={setInteractivePayload}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={savingQuickReply}
              onClick={saveAsQuickReply}
            >
              {savingQuickReply ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="mr-1 h-4 w-4" />
              )}
              {t('saveAsQuickReply')}
            </Button>
            <Button onClick={sendInteractive}>
              <Send className="mr-1 h-4 w-4" />
              {t('send')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick-reply picker. */}
      <QuickReplyPicker
        open={quickReplyOpen}
        onOpenChange={setQuickReplyOpen}
        onPick={handlePickQuickReply}
      />
    </div>
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
    <div className="border-border bg-muted/40 rounded-xl border p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {draft.kind === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={draft.mediaUrl}
              alt={draft.filename}
              className="max-h-40 rounded-lg object-cover"
            />
          )}
          {draft.kind === 'video' && (
            <video
              src={draft.mediaUrl}
              controls
              className="max-h-40 rounded-lg"
            />
          )}
          {draft.kind === 'audio' && (
            <audio src={draft.mediaUrl} controls className="w-full" />
          )}
          {draft.kind === 'document' && (
            <div className="text-foreground flex items-center gap-2 text-sm">
              <FileText className="text-muted-foreground h-5 w-5 shrink-0" />
              <span className="truncate">{draft.filename}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDiscard}
          aria-label={t('removeAttachment')}
          className="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-2 flex items-end gap-2">
        {draft.kind !== 'audio' && (
          <input
            value={draft.caption}
            maxLength={MEDIA_CAPTION_MAX}
            onChange={(e) => onCaptionChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder={t('addCaption')}
            className="border-border bg-muted text-foreground placeholder-muted-foreground focus:border-primary/50 flex-1 rounded-xl border px-4 py-2.5 text-sm transition-colors outline-none"
          />
        )}
        <GatedButton
          size="sm"
          canAct={!readOnly}
          gateReason="send messages"
          disabled={busy}
          onClick={onSend}
          className={cn(
            'bg-primary hover:bg-primary/90 h-9 w-9 shrink-0 p-0 disabled:opacity-40',
            draft.kind === 'audio' && 'ml-auto'
          )}
        >
          <Send className="h-4 w-4" />
        </GatedButton>
      </div>
    </div>
  );
}
