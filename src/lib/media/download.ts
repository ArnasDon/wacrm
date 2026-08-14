import type { Message } from "@/types";
import { loadMediaBlob, MediaResponseError } from "./blob-cache";
import { mediaFilename } from "./filename";

/**
 * Save a chat attachment to the agent's machine.
 *
 * The obvious `<a href={media_url} download>` doesn't work for either kind
 * of media we have: browsers ignore `download` on a cross-origin href (so
 * a `chat-media` bucket URL would just navigate), and inbound media lives
 * behind an auth-gated proxy with no filename in its path. Fetching the
 * bytes ourselves solves both — we get a real `Blob` (already cached by
 * `loadMediaBlob` if the thumbnail or lightbox pulled it) and full control
 * over the filename.
 *
 * Throws so the caller can toast; the only silent path is the new-tab
 * fallback below.
 */
export async function downloadMediaMessage(message: Message): Promise<void> {
  const url = message.media_url;
  if (!url) throw new Error("This message has no attachment.");

  let blob: Blob;
  try {
    blob = await loadMediaBlob(url);
  } catch (error) {
    // A refused *response* is a real failure — inbound media Meta has
    // expired 401s here, and quietly opening a tab onto that error would
    // hide it. Let the caller toast instead.
    if (error instanceof MediaResponseError) throw error;
    // A fetch that never completed is the other case: a bucket with a
    // stricter CORS policy than ours can block the XHR while the browser
    // is still perfectly able to navigate to the object. Handing the URL
    // to a new tab gets the agent to the file, visibly.
    if (openInNewTab(url)) return;
    throw error;
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    clickAnchor({
      href: objectUrl,
      download: mediaFilename(message, blob.type),
    });
  } finally {
    // Revoking in the same tick can cancel the download in Safari; a beat
    // later the browser has taken its own reference to the bytes.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

function openInNewTab(url: string): boolean {
  if (typeof document === "undefined") return false;
  clickAnchor({ href: url, target: "_blank" });
  return true;
}

/**
 * Programmatic anchor click. An anchor is used rather than `window.open`
 * because it isn't subject to the popup blocker, and because `download`
 * only exists on anchors.
 */
function clickAnchor(attrs: {
  href: string;
  download?: string;
  target?: string;
}): void {
  const a = document.createElement("a");
  a.href = attrs.href;
  if (attrs.download) a.download = attrs.download;
  if (attrs.target) {
    a.target = attrs.target;
    a.rel = "noopener noreferrer";
  }
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
