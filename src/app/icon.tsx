import { ImageResponse } from "next/og";

// Replaces the default Next.js favicon with the brand mark — Rimula
// Red rounded square + white chat-square glyph — matching the sidebar
// logo mark in `src/components/layout/sidebar.tsx` (which uses the
// `bg-primary` token directly and so re-themes automatically; this
// file can't, see below). Next.js renders this at build time and
// auto-injects <link rel="icon"> into <head>.
//
// This route takes precedence over src/app/favicon.ico, which is the
// Next.js default and can stay on disk harmlessly (or be removed).
//
// Why a literal hex here and not `var(--primary)`: `ImageResponse`
// (Satori) renders in an isolated edge runtime with no DOM/CSSOM, so
// it can't resolve CSS custom properties or Tailwind classes — only
// literal inline-style color values. `#d40c1a` is not an arbitrary
// pick: it's the sRGB conversion of the Rimula theme's actual
// `--primary: oklch(0.55 0.22 27)` (globals.css) — if that token ever
// changes, recompute this the same way (OKLCH → linear sRGB → gamma)
// rather than eyeballing a new hex.

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#d40c1a", // primary (Rimula Red — see file header)
          borderRadius: 6,
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
