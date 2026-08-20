/** Structured link-preview result, mirrored 1:1 by the API response and
 *  the client hook's `success` state. */
export interface LinkPreviewData {
  url: string;
  hostname: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  /** Present (and `true`) when the page was reachable but had no usable
   *  metadata (or wasn't HTML, or the fetch was blocked/failed) — a
   *  legitimate, cacheable outcome, not an error. */
  unavailable?: true;
}
