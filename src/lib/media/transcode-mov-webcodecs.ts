/**
 * iPhone-recorded video support (.MOV/HEVC) — WebCodecs path.
 *
 * Replaces the `ffmpeg.wasm` transcode (transcode-mov.ts) as the path
 * `message-composer.tsx` calls for HEVC/.mov attachments. ffmpeg.wasm
 * is a pure-software encoder running inside a WASM sandbox — on a real
 * iPhone PWA it either took minutes or hung indefinitely (`ffmpeg.exec`
 * has no timeout by default and nothing in that code set one). This
 * uses the browser's own native, hardware-accelerated `VideoEncoder`/
 * `VideoDecoder` (WebCodecs) via `mediabunny` (MPL-2.0, zero-cost,
 * 100% client-side, no server) instead — validated live on a real
 * iPhone 14 Pro Max: a 41s/116MB 4K HEVC clip converted in 24.9s
 * (ffmpeg.wasm never finished the same class of file).
 *
 * `mediabunny` is only ever imported from inside `convertMovToMp4ViaWebCodecs`
 * — never at this module's top level from anywhere else — so picking
 * an image, PDF, or an already-compatible MP4 never loads it. The old
 * `transcode-mov.ts`/`ffmpeg.wasm` path is left untouched and unused,
 * not deleted, pending a separate cleanup task once this is confirmed
 * in production.
 */

import { isQuickTimeVideo } from "./transcode-mov";

export { isQuickTimeVideo };

// No hard timeout was the actual root cause of the original hang (see
// module comment) — this wraps the whole conversion so the same class
// of bug can't recur here. 120s is generous: the slowest real test
// (41s of 4K footage) finished in 24.9s, so anything a chat attachment
// realistically sends should land well inside this.
const CONVERSION_TIMEOUT_MS = 120_000;

/**
 * True if this browser's WebCodecs implementation can actually decode
 * this specific file's video track — not just "does VideoEncoder
 * exist". Safari's WebCodecs support has been version-gated and
 * codec-specific (HEVC decode in particular had real gaps on older
 * Safari releases), so this must be checked per-file, not just
 * feature-detected once globally.
 */
export async function canTranscodeViaWebCodecs(file: File): Promise<boolean> {
  if (
    typeof globalThis.VideoEncoder === "undefined" ||
    typeof globalThis.VideoDecoder === "undefined"
  ) {
    return false;
  }
  try {
    const { Input, ALL_FORMATS, BlobSource } = await import("mediabunny");
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) return false;
    return await videoTrack.canDecode();
  } catch {
    return false;
  }
}

/**
 * Transcodes a QuickTime/HEVC .mov file to H.264/AAC .mp4 using the
 * browser's native WebCodecs (via mediabunny). Deliberately does NOT
 * pass `width`/`height`/`fit` — an earlier version capped resolution
 * that way and it broke display dimensions on rotated (portrait)
 * phone video: the file converted fine and even played, but every
 * player (this CRM, WhatsApp on both ends) rendered it tiny,
 * thumbnail-sized, because the resize math and the source's rotation
 * matrix didn't agree. The exact config below — no resize, source
 * resolution untouched — is what was validated live on a real iPhone
 * with correct orientation; only the bitrate is capped (not
 * resolution) to keep the result under the existing
 * MEDIA_MAX_BYTES_BY_KIND video cap (16MB) in message-composer.tsx,
 * which runs unmodified right after this. Throws with a user-facing
 * message on failure or timeout — callers surface it via a toast,
 * same convention as `uploadAccountMedia` and the previous ffmpeg.wasm
 * path.
 */
export async function convertMovToMp4ViaWebCodecs(
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<File> {
  const {
    Input,
    Output,
    Conversion,
    ALL_FORMATS,
    BlobSource,
    Mp4OutputFormat,
    BufferTarget,
    Quality,
  } = await import("mediabunny");

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });

  let conversion: Awaited<ReturnType<typeof Conversion.init>>;
  try {
    conversion = await Conversion.init({
      input,
      output,
      video: {
        codec: "avc",
        // 2 Mbps — a fixed bitrate rather than a named quality preset
        // (which scales with source resolution and produced ~18 Mbps,
        // 92.5 MB for a 41s clip in the earlier version) keeps output
        // size predictable and duration-proportional regardless of
        // source resolution, without touching width/height/rotation.
        quality: new Quality({ bitrate: 2_000_000 }),
        hardwareAcceleration: "prefer-hardware",
      },
      audio: { codec: "aac" },
    });
  } catch {
    throw new Error("Could not read this video file. Try a different one.");
  }

  if (!conversion.isValid) {
    throw new Error("This browser can't convert this video. Try a different device.");
  }
  if (onProgress) conversion.onProgress = onProgress;

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void conversion.cancel();
  }, CONVERSION_TIMEOUT_MS);

  try {
    await conversion.execute();
  } catch {
    throw new Error(
      timedOut
        ? "Video conversion took too long and was canceled."
        : "Could not convert this video. Try a different file.",
    );
  } finally {
    clearTimeout(timer);
  }

  const buffer = output.target.buffer;
  if (!buffer) throw new Error("Could not convert this video. Try a different file.");

  const mp4Name = file.name.replace(/\.mov$/i, ".mp4") || "video.mp4";
  return new File([buffer], mp4Name, { type: "video/mp4" });
}
