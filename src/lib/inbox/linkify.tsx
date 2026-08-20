import type { ReactNode } from "react";

/**
 * http(s) URL matcher shared by `extractUrls` and `linkifyText` — the one
 * URL parser for the inbox, so a message body and its link-preview
 * candidate are always found the same way (no second regex to drift out
 * of sync with this one).
 */
const URL_REGEX = /https?:\/\/[^\s<>"']+/gi;

const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

/** Trims a regex match down to the URL a human actually meant: drops
 *  sentence-trailing punctuation ("confira https://a.com.") and balances
 *  a trailing ")" against an unmatched "(" inside the match (parenthetical
 *  mentions, "(https://a.com)"), without rejecting URLs that legitimately
 *  contain balanced parens. */
function cleanMatch(raw: string): string {
  let url = raw;
  while (
    url.endsWith(")") &&
    (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)
  ) {
    url = url.slice(0, -1);
  }
  return url.replace(TRAILING_PUNCTUATION, "");
}

/** Every http(s) URL found in `text`, in order, cleaned of trailing
 *  punctuation. Used both to linkify and to pick the link-preview
 *  candidate (its first element). */
export function extractUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  return matches.map(cleanMatch).filter(Boolean);
}

/** Renders `text` as an array of plain-text runs and `<a>` elements for
 *  every http(s) URL found — a drop-in replacement for `{text}` as JSX
 *  children. Preserves the original text (including whitespace, which the
 *  caller's `whitespace-pre-wrap` still handles) and never wraps anything
 *  in an extra element when there's no URL, so a message without a link
 *  renders exactly as before. */
export function linkifyText(text: string | null | undefined): ReactNode[] {
  const value = text ?? "";
  if (!value) return [value];

  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of value.matchAll(URL_REGEX)) {
    const start = match.index ?? 0;
    const url = cleanMatch(match[0]);
    if (start > cursor) nodes.push(value.slice(cursor, start));
    nodes.push(
      <a
        key={`link-${key++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 break-all"
      >
        {url}
      </a>,
    );
    cursor = start + url.length;
  }

  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}
