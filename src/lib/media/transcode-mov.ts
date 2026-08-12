/**
 * iPhone-recorded video support (.MOV/QuickTime).
 *
 * Neither the `chat-media` Storage bucket's MIME whitelist (migration
 * 023) nor Meta's outbound WhatsApp video message (H.264/AAC in
 * MP4/3GPP only) accept `video/quicktime` — and since iOS 11, the
 * default camera format is HEVC-in-.mov, so a container-only remux
 * (no re-encode) still leaves a codec Meta rejects. This does a real
 * client-side transcode to H.264/AAC MP4 via ffmpeg.wasm.
 *
 * `@ffmpeg/ffmpeg` + `@ffmpeg/util` and the core WASM binary
 * (`public/ffmpeg/ffmpeg-core.{js,wasm}`, vendored from `@ffmpeg/core`,
 * same pattern as the Opus encoder worker in `public/opus/`) are only
 * ever fetched from within `convertMovToMp4` — never imported at the
 * module's top level anywhere else — so picking an image, PDF, or an
 * already-compatible MP4 never loads any of this.
 */

import type { FFmpeg } from "@ffmpeg/ffmpeg";

const FFMPEG_CORE_BASE = "/ffmpeg";

let ffmpegPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
        import("@ffmpeg/ffmpeg"),
        import("@ffmpeg/util"),
      ]);
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: await toBlobURL(
          `${FFMPEG_CORE_BASE}/ffmpeg-core.js`,
          "text/javascript",
        ),
        wasmURL: await toBlobURL(
          `${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`,
          "application/wasm",
        ),
      });
      return ffmpeg;
    })().catch((err) => {
      // Don't cache a rejected load — a transient network hiccup
      // fetching the ~31 MB core shouldn't permanently break the next
      // attempt in the same tab.
      ffmpegPromise = null;
      throw err;
    });
  }
  return ffmpegPromise;
}

/** True for a QuickTime container by MIME type, or by extension when
 *  the browser reports no/an unhelpful type (seen on some desktop
 *  Chrome builds without a registered file association). */
export function isQuickTimeVideo(file: File): boolean {
  return file.type === "video/quicktime" || /\.mov$/i.test(file.name);
}

/**
 * Transcodes a QuickTime/HEVC (or any codec ffmpeg can decode) .mov
 * file to H.264/AAC .mp4 entirely in the browser. Throws with a
 * user-facing message on failure — callers surface it via a toast,
 * same convention as `uploadAccountMedia`.
 */
export async function convertMovToMp4(file: File): Promise<File> {
  let ffmpeg: FFmpeg;
  try {
    ffmpeg = await getFFmpeg();
  } catch {
    throw new Error(
      "Could not load the video converter. Check your connection and try again.",
    );
  }

  const { fetchFile } = await import("@ffmpeg/util");
  const inputName = "input.mov";
  const outputName = "output.mp4";

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    await ffmpeg.exec([
      "-i",
      inputName,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-c:a",
      "aac",
      outputName,
    ]);
    const data = await ffmpeg.readFile(outputName);
    // readFile's Uint8Array is typed over ArrayBufferLike (it could be
    // SharedArrayBuffer-backed); File/Blob require a real ArrayBuffer —
    // re-wrapping copies it into one.
    const bytes = data instanceof Uint8Array ? new Uint8Array(data) : data;
    const mp4Name = file.name.replace(/\.mov$/i, ".mp4") || "video.mp4";
    return new File([bytes], mp4Name, { type: "video/mp4" });
  } catch {
    throw new Error("Could not convert this video. Try a different file.");
  } finally {
    // Best-effort — the worker's virtual FS is thrown away with it
    // eventually, but a long-lived composer session could otherwise
    // accumulate files across several converted attachments.
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}
