import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  buildMediaPath,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';
import { extensionForMimeType } from '@/lib/media/voice-recording';

// The server side of the inbox voice-note flow. Browsers record with
// native MediaRecorder in whatever container they're good at (WebM/Opus
// on Chrome, MP4/AAC on Safari) — but Meta's Cloud API only renders
// Ogg/Opus as a playable voice note and rejects WebM outright. This
// route normalizes any recording to mono Ogg/Opus via FFmpeg, uploads
// it to the `chat-media` bucket under the caller's account folder, and
// returns the same `{ publicUrl, path }` shape as the client-side
// upload helper so the composer's draft/GC logic works unchanged.
//
// FFmpeg is provisioned in the deploy images (Dockerfile / nixpacks.toml).
// When it's missing we fail with code `transcoder_unavailable` rather
// than a generic 500 so the UI can point at the deployment, not the user.

/** Same bucket as the composer's direct uploads (migration 023). */
const CHAT_MEDIA_BUCKET = 'chat-media';

/**
 * Input containers we accept for conversion. Matches what MediaRecorder
 * can plausibly hand us (`audio/*`) plus WebM tagged as video — some
 * engines report video/webm even for audio-only streams.
 */
function isConvertibleInput(mimeType: string): boolean {
  return mimeType.startsWith('audio/') || mimeType.startsWith('video/webm');
}

/**
 * Thrown when the ffmpeg binary isn't installed on the host. Mapped to
 * a 503 with a machine-readable `code` so the client can show an ops-
 * facing message instead of blaming the microphone.
 */
class TranscoderUnavailableError extends Error {
  readonly status = 503 as const;
  constructor() {
    super('FFmpeg is not available on this deployment');
    this.name = 'TranscoderUnavailableError';
  }
}

/**
 * Run one ffmpeg conversion to WhatsApp-voice-note spec: mono, 48 kHz,
 * Opus VOIP at 24 kbps in an Ogg container. Mono matters — WhatsApp
 * clients refuse stereo voice notes; 24 kbps keeps a 5-minute take
 * (~0.9 MB) well under the bucket's 16 MB cap.
 *
 * Resolves when output is written; rejects with
 * TranscoderUnavailableError (ENOENT), a timeout error, or an Error
 * carrying the tail of ffmpeg's stderr for diagnosability.
 */
function runFfmpeg(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y', // overwrite — outputPath is inside our private temp dir
        '-i',
        inputPath,
        '-vn', // drop cover-art/video streams Safari may embed in MP4
        '-map',
        '0:a:0',
        '-ac',
        '1', // voice notes must be mono
        '-ar',
        '48000',
        '-c:a',
        'libopus',
        '-b:a',
        '24k',
        '-application',
        'voip', // speech tuning — better intelligibility than "audio"
        '-f',
        'ogg',
        outputPath,
      ],
      { windowsHide: true }
    );

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      // Keep only the tail — ffmpeg errors are at the end of its log.
      stderr = `${stderr}${chunk.toString()}`.slice(-2000);
    });

    const killTimer = setTimeout(() => child.kill('SIGKILL'), 30_000);

    child.on('error', (err) => {
      clearTimeout(killTimer);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new TranscoderUnavailableError());
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(stderr || `ffmpeg exited with code ${code ?? 'signal'}`)
        );
      }
    });
  });
}

export async function POST(request: Request) {
  try {
    // 'agent' minimum — mirrors the send gate. Viewers can't reach the
    // record button anyway (composer disables inputs for read-only),
    // so this is defense in depth against crafted requests.
    const { supabase, accountId, userId } = await requireRole('agent');

    // Each hit spawns an FFmpeg process — bound CPU abuse from a
    // scripted session while staying far above organic agent use.
    const limit = checkRateLimit(`voice-note:${userId}`, RATE_LIMITS.voiceNote);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const form = await request.formData();
    const audio = form.get('audio');
    if (!(audio instanceof File) || audio.size === 0) {
      return NextResponse.json(
        { error: 'No audio recording was received.' },
        { status: 400 }
      );
    }
    if (audio.size > MEDIA_MAX_BYTES_BY_KIND.audio) {
      return NextResponse.json(
        { error: 'Recording exceeds the 16 MB limit.' },
        { status: 413 }
      );
    }
    const inputMime = audio.type || 'audio/webm';
    if (!isConvertibleInput(inputMime)) {
      return NextResponse.json(
        { error: `Unsupported recording format: ${inputMime}` },
        { status: 415 }
      );
    }

    const dir = await mkdtemp(path.join(tmpdir(), 'wacrm-voice-'));
    try {
      const inputPath = path.join(
        dir,
        `input.${extensionForMimeType(inputMime)}`
      );
      const outputPath = path.join(dir, 'voice.ogg');
      await writeFile(inputPath, Buffer.from(await audio.arrayBuffer()));

      await runFfmpeg(inputPath, outputPath);
      const ogg = await readFile(outputPath);
      if (ogg.length === 0) {
        return NextResponse.json(
          { error: 'The recording came back empty — please try again.' },
          { status: 422 }
        );
      }

      // buildMediaPath scopes to account-<id>/… which is exactly what
      // the chat-media RLS write policy matches on (migration 023); the
      // SSR client carries the caller's session, so non-members can't
      // land objects in someone else's folder.
      const objectPath = buildMediaPath(accountId, 'voice-note.ogg');
      const { error: upErr } = await supabase.storage
        .from(CHAT_MEDIA_BUCKET)
        .upload(objectPath, ogg, {
          cacheControl: '3600',
          upsert: false,
          contentType: 'audio/ogg',
        });
      if (upErr) throw new Error(upErr.message);

      const {
        data: { publicUrl },
      } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(objectPath);

      return NextResponse.json({ publicUrl, path: objectPath });
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (error) {
    if (error instanceof TranscoderUnavailableError) {
      // Logged, not silent: this branch returns before the console.error
      // below, so a deployment missing the binary produced a 503 the user
      // saw as a toast and the server never mentioned — leaving the logs
      // looking healthy while every voice note failed.
      console.error(
        '[media/voice-note] ffmpeg not found on PATH — voice notes cannot ' +
          'be transcoded. Check the runtime image (Dockerfile installs it ' +
          'in the runner stage; nixpacks.toml lists it under nixPkgs).'
      );
      return NextResponse.json(
        {
          code: 'transcoder_unavailable',
          error:
            'Voice notes need FFmpeg on the server, but it is missing from ' +
            'this deployment. Install it in your Docker/Railway image and retry.',
        },
        { status: 503 }
      );
    }
    console.error('[media/voice-note] transcode failed:', error);
    return toErrorResponse(error);
  }
}
