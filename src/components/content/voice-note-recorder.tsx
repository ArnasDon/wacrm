'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Mic, Square, Loader2, Upload } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  uploadAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';

// Client-side Ogg/Opus recording, reusing the exact capture path the
// inbox composer already ships (opus-recorder + the vendored encoder
// worker at /opus/, CSP already allows microphone=(self)) — per §10:
// "Reuse that capture path for BA-recorded voice notes." Trimmed down
// from the composer's version: no reply-quote context, no draft
// preview bubble, just record -> upload -> hand the caller the
// resulting storage path.

const CHAT_MEDIA_BUCKET = 'chat-media';
const OPUS_ENCODER_PATH = '/opus/encoderWorker.min.js';
const MAX_RECORDING_SECONDS = 5 * 60;

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export interface RecordedVoiceNote {
  storagePath: string;
  publicUrl: string;
  durationSeconds: number;
}

export function VoiceNoteRecorder({
  onRecorded,
  disabled,
}: {
  onRecorded: (note: RecordedVoiceNote) => void;
  disabled?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [seconds, setSeconds] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recorderRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  const startedAtRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearTimer();
      void recorderRef.current?.stop().catch(() => {});
    };
  }, [clearTimer]);

  const finalizeRecording = useCallback(
    async (bytes: Uint8Array) => {
      const durationSeconds = Math.max(
        1,
        Math.round((Date.now() - startedAtRef.current) / 1000)
      );
      const file = new File(
        [bytes as unknown as BlobPart],
        `voice-${Date.now()}.ogg`,
        {
          type: 'audio/ogg',
        }
      );
      if (file.size === 0) return;
      if (file.size > MEDIA_MAX_BYTES_BY_KIND.audio) {
        toast.error('Recording is too long (over 16 MB).');
        return;
      }
      setUploading(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(
          CHAT_MEDIA_BUCKET,
          file
        );
        onRecorded({ storagePath: path, publicUrl, durationSeconds });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Upload failed.');
      } finally {
        setUploading(false);
      }
    },
    [onRecorded]
  );

  const startRecording = useCallback(async () => {
    if (disabled || uploading || recording) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof AudioContext === 'undefined'
    ) {
      toast.error("Voice recording isn't supported in this browser.");
      return;
    }
    try {
      const { default: Recorder } = await import('opus-recorder');
      const recorder = new Recorder({
        encoderPath: OPUS_ENCODER_PATH,
        numberOfChannels: 1,
        encoderApplication: 2048,
        encoderSampleRate: 48000,
        streamPages: false,
      });
      cancelledRef.current = false;
      recorder.ondataavailable = (bytes: Uint8Array) => {
        if (cancelledRef.current) return;
        void finalizeRecording(bytes);
      };
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      await recorder.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      void recorderRef.current?.stop().catch(() => {});
      recorderRef.current = null;
      toast.error('Microphone access denied or unavailable.');
    }
  }, [disabled, uploading, recording, finalizeRecording]);

  const stopRecording = useCallback(() => {
    clearTimer();
    setRecording(false);
    void recorderRef.current?.stop().catch(() => {});
  }, [clearTimer]);

  useEffect(() => {
    if (recording && seconds >= MAX_RECORDING_SECONDS) stopRecording();
  }, [recording, seconds, stopRecording]);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.audio) {
      toast.error('File is too large (max 16 MB).');
      return;
    }
    setUploading(true);
    try {
      const { publicUrl, path } = await uploadAccountMedia(
        CHAT_MEDIA_BUCKET,
        file
      );
      onRecorded({ storagePath: path, publicUrl, durationSeconds: 0 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  if (recording) {
    return (
      <div className="border-border bg-muted/50 flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
        <span className="size-2 animate-pulse rounded-full bg-red-500" />
        <span className="text-foreground">
          Recording... {formatDuration(seconds)} /{' '}
          {formatDuration(MAX_RECORDING_SECONDS)}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={stopRecording}
          className="ml-auto"
        >
          <Square className="size-3.5" />
          Stop
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => void startRecording()}
        disabled={disabled || uploading}
      >
        {uploading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Mic className="size-3.5" />
        )}
        Record
      </Button>
      {/* label styled with buttonVariants, not <Button asChild> — see
          content/page.tsx's note on the same constraint. */}
      <label
        className={buttonVariants({
          size: 'sm',
          variant: 'ghost',
          className:
            disabled || uploading
              ? 'pointer-events-none opacity-50'
              : 'cursor-pointer',
        })}
      >
        <Upload className="size-3.5" />
        Upload audio
        <input
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={handleFileUpload}
          disabled={disabled || uploading}
        />
      </label>
    </div>
  );
}
