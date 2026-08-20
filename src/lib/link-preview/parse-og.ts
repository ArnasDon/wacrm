// Minimal, dependency-free <head> metadata extraction — regex-based on
// purpose rather than pulling in cheerio/jsdom: we only ever need a
// handful of <meta>/<title> tags out of a bounded chunk of HTML (see
// fetch-preview.ts's `readBoundedHtml`), and never execute any script on
// the fetched page, which a full DOM/JS-capable parser would risk.

export interface ParsedMetadata {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

const META_TAG_RE = /<meta\b[^>]*>/gi;
const TITLE_TAG_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

function getAttr(tag: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const m = tag.match(re);
  if (!m) return null;
  return decodeHtmlEntities(m[2] ?? m[3] ?? "");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function toAbsoluteUrl(value: string, baseUrl: string): string | undefined {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

/** Extracts og:title/og:description/og:image(+variants)/og:site_name and
 *  the plain <title>/<meta name="description"> fallbacks from a chunk of
 *  HTML. `baseUrl` (the page's final URL, post-redirects) resolves any
 *  relative og:image into an absolute one. Does not apply the hostname
 *  fallback for title/siteName — that's the caller's job (fetch-preview.ts),
 *  since it's what decides whether there was any *usable* metadata at all
 *  before unconditionally filling in a fallback. */
export function parseHtmlMetadata(html: string, baseUrl: string): ParsedMetadata {
  const props = new Map<string, string>();
  for (const tagMatch of html.matchAll(META_TAG_RE)) {
    const tag = tagMatch[0];
    const key = (getAttr(tag, "property") ?? getAttr(tag, "name"))?.toLowerCase();
    if (!key) continue;
    const content = getAttr(tag, "content");
    if (content === null) continue;
    // First occurrence wins — some pages repeat a tag (e.g. a fallback
    // og:image listed after the primary one).
    if (!props.has(key)) props.set(key, content);
  }

  const titleTagMatch = html.match(TITLE_TAG_RE);
  const plainTitle = titleTagMatch ? decodeHtmlEntities(titleTagMatch[1]) : undefined;

  const title = props.get("og:title") || plainTitle || undefined;
  const description = props.get("og:description") || props.get("description") || undefined;
  const siteName = props.get("og:site_name") || undefined;

  const rawImage =
    props.get("og:image") || props.get("og:image:url") || props.get("og:image:secure_url") || undefined;
  const image = rawImage ? toAbsoluteUrl(rawImage, baseUrl) : undefined;

  return { title, description, image, siteName };
}
