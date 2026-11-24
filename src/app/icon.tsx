import { ImageResponse } from "next/og";

// Replaces the default Next.js favicon with the brand mark — an ink
// circle with a yellow "waves" glyph — matching the wordmark pill in
// `src/components/layout/header.tsx`. Next.js renders
// this at build time and auto-injects <link rel="icon"> into <head>.
//
// This route takes precedence over src/app/favicon.ico, which is the
// Next.js default and can stay on disk harmlessly (or be removed).

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
          background: "#2b2a27", // ink (Sunbeam primary)
          borderRadius: 16,
        }}
      >
        {/* lucide "waves" glyph in the Sunbeam highlight yellow */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#f5d34a"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
          <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
          <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
