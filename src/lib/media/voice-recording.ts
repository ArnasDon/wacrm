/**
 * Pure decision helpers for the inbox voice-note flow (`message-composer`)
 * and its server counterpart, POST /api/media/voice-note.
 *
 * Recording uses the browser's native MediaRecorder. Each engine emits a
 * different container, and only one of them is what WhatsApp wants:
 *
 *   Chrome / Edge / Android Chrome → audio/webm;codecs=opus
 *   Firefox                        → audio/ogg;codecs=opus
 *   Safari                         → audio/mp4 (AAC)
 *
 * Meta's Cloud API renders a message as a playable voice note only for
 * .ogg files with the Opus codec (mono) — WebM is rejected outright and
 * MP4/AAC degrades to a plain audio attachment. So the client picks the
 * best type it can record with `pickRecorderMimeType`, and anything that
 * isn't already Ogg/Opus is transcoded server-side (FFmpeg) before
 * upload. These helpers are pure so both sides stay unit-testable.
 */

/**
 * Ordered best→worst recording candidates. Ogg/Opus first so Firefox
 * recordings can skip the server transcode entirely; WebM/Opus next as
 * the Chrome-family default; MP4/AAC last as Safari's fallback (it gets
 * re-encoded to Opus server-side).
 */
export const RECORDER_MIME_CANDIDATES = [
  'audio/ogg;codecs=opus',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
] as const;

/**
 * Pick the first container this browser's MediaRecorder can actually
 * produce, or null when none match (the recorder is then constructed
 * without an explicit mimeType and the browser default is used).
 * `isSupported` is injected so tests don't need a MediaRecorder global.
 */
export function pickRecorderMimeType(
  isSupported: (mimeType: string) => boolean
): string | null {
  return RECORDER_MIME_CANDIDATES.find((mime) => isSupported(mime)) ?? null;
}

/** File extension for a recorded blob's MIME type (used for temp names
 *  and FormData filenames so FFmpeg's demuxer gets a hint). */
export function extensionForMimeType(mimeType: string): string {
  const mime = mimeType.toLowerCase();
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4') || mime.includes('aac')) return 'm4a';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('amr')) return 'amr';
  return 'bin';
}

/**
 * True when a recorded blob can be uploaded to chat-media as-is because
 * it's already an Ogg container (Firefox). Matches any `audio/ogg*`
 * variant — codec parameters are irrelevant here since we normalize the
 * stored content type to bare `audio/ogg` either way (that exact string
 * is what the bucket's allowed_mime_types pins, migration 023).
 */
export function isWhatsAppReadyOgg(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('audio/ogg');
}

/**
 * Map a getUserMedia / MediaRecorder failure to an actionable,
 * user-facing message. The old opus-recorder flow collapsed every
 * failure into "Microphone access denied or unavailable", which made
 * permission problems indistinguishable from encoder-worker failures —
 * exactly the debugging hole this replaces.
 *
 * Duck-types `error.name` rather than requiring DOMException so the
 * function stays testable in Node and resilient across realms.
 */
export function describeMicError(error: unknown): string {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';

  switch (name) {
    // Permission denied by the browser site-settings or OS privacy toggle.
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return (
        'Microphone permission was denied. Allow mic access for this site ' +
        '(padlock icon in the address bar), check your OS privacy settings, ' +
        'and try again.'
      );
    // No input device present / disabled at the OS level.
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found. Check that one is connected and enabled.';
    // Device held exclusively by another app (Zoom/Teams/Discord) or a
    // driver-level lock — the most common "it says unavailable" case.
    case 'NotReadableError':
    case 'TrackStartError':
      return (
        "Your microphone is busy or can't be started. Close other apps " +
        'using it (calls, Discord, OBS) and try again.'
      );
    case 'OverconstrainedError':
      return "Your microphone doesn't support the requested recording mode.";
    case 'AbortError':
      return 'Microphone access was interrupted. Please try again.';
    // getUserMedia is only exposed in secure contexts (HTTPS or localhost).
    case 'SecurityError':
      return (
        "Microphone access is blocked because this page isn't served over " +
        'HTTPS. Open waCRM on a secure origin to record voice notes.'
      );
    default:
      break;
  }

  if (error instanceof Error && error.message) {
    return `Recording failed: ${error.message}`;
  }
  return 'Voice recording failed. Check the browser console for details.';
}
