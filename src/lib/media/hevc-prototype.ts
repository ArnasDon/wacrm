/**
 * ISOLATED PROTOTYPE — not wired into the composer/upload flow.
 *
 * Tests whether native WebCodecs (via `mediabunny`, MPL-2.0, zero-cost,
 * 100% client-side) can transcode an iPhone HEVC/.mov recording to
 * H.264/AAC .mp4 fast enough and reliably enough to replace the current
 * ffmpeg.wasm path (src/lib/media/transcode-mov.ts) — which is what
 * currently hangs on-device. Deliberately does not import from or
 * export into transcode-mov.ts, message-composer.tsx, or
 * upload-media.ts — see hevc-test/page.tsx for the standalone UI that
 * exercises this.
 */

import {
  Input,
  Output,
  Conversion,
  ALL_FORMATS,
  BlobSource,
  Mp4OutputFormat,
  BufferTarget,
  type InputVideoTrack,
} from "mediabunny";

export interface SourceInspection {
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  hasVideoTrack: boolean;
  videoCodec: string | null;
  canDecode: boolean | null;
  rotation: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  webCodecsPresent: boolean;
}

/** True for a QuickTime/HEVC container, mirroring the check the
 *  production `isQuickTimeVideo` uses — reimplemented standalone on
 *  purpose so this prototype never depends on production code. */
export function looksLikeHevcOrMov(file: File): boolean {
  return file.type === "video/quicktime" || /\.mov$/i.test(file.name);
}

/** Inspects the file without converting anything — codec, whether this
 *  browser's WebCodecs can actually decode it, rotation, dimensions. */
export async function inspectSource(file: File): Promise<SourceInspection> {
  const webCodecsPresent =
    typeof globalThis.VideoEncoder !== "undefined" &&
    typeof globalThis.VideoDecoder !== "undefined";

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const videoTrack: InputVideoTrack | null = await input.getPrimaryVideoTrack();

  if (!videoTrack) {
    return {
      fileName: file.name,
      fileType: file.type,
      fileSizeBytes: file.size,
      hasVideoTrack: false,
      videoCodec: null,
      canDecode: null,
      rotation: null,
      width: null,
      height: null,
      durationSeconds: null,
      webCodecsPresent,
    };
  }

  const [codec, canDecode, rotation, width, height, duration] = await Promise.all([
    videoTrack.getCodec(),
    videoTrack.canDecode(),
    videoTrack.getRotation(),
    videoTrack.getCodedWidth(),
    videoTrack.getCodedHeight(),
    input.computeDuration(),
  ]);

  return {
    fileName: file.name,
    fileType: file.type,
    fileSizeBytes: file.size,
    hasVideoTrack: true,
    videoCodec: codec,
    canDecode,
    rotation,
    width,
    height,
    durationSeconds: duration,
    webCodecsPresent,
  };
}

export interface ConversionResult {
  blob: Blob;
  ms: number;
  outputSizeBytes: number;
}

/**
 * Transcodes to H.264/AAC MP4 via native WebCodecs (through mediabunny).
 * Rejects (never hangs silently) if the browser can't do it — mediabunny
 * surfaces this via `conversion.isValid` / `discardedTracks`, or the
 * underlying WebCodecs promise rejecting.
 */
export async function convertViaWebCodecs(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<ConversionResult> {
  const t0 = performance.now();

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });

  const conversion = await Conversion.init({
    input,
    output,
    video: { codec: "avc" },
    audio: { codec: "aac" },
  });

  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks
      .map((t) => `${t.track.type}: ${t.reason}`)
      .join(", ");
    throw new Error(
      `Conversion not valid for this browser — discarded tracks: ${reasons || "unknown"}`,
    );
  }

  if (onProgress) {
    conversion.onProgress = (progress) => onProgress(progress);
  }

  await conversion.execute();

  const buffer = output.target.buffer;
  if (!buffer) throw new Error("Conversion produced no output buffer.");

  const blob = new Blob([buffer], { type: "video/mp4" });
  return { blob, ms: performance.now() - t0, outputSizeBytes: blob.size };
}
