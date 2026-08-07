import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Copy text to the clipboard, working around the Clipboard API's
 * secure-context requirement — `navigator.clipboard` is undefined on
 * plain `http://` origins other than `localhost` (e.g. a bare
 * `http://192.168.x.x:port` deployment), which made every copy button
 * silently no-op with no error and no visible feedback. Falls back to
 * the legacy `execCommand('copy')` path, which still works over
 * plain HTTP. Returns whether the copy actually succeeded, so callers
 * can toast accordingly.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the legacy path below
    }
  }
  try {
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
