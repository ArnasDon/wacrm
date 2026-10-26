import { isProxiedMediaUrl } from "./blob-cache";

export interface DocumentClickInput {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

export function shouldDownloadDocumentClick(
  mediaUrl: string | undefined,
  click: DocumentClickInput,
): boolean {
  if (!mediaUrl || !isProxiedMediaUrl(mediaUrl)) return false;
  if (click.defaultPrevented || click.button !== 0) return false;
  return !(click.metaKey || click.ctrlKey || click.shiftKey || click.altKey);
}
