import { ImageResponse } from "next/og";

// Larger PNG variant of the brand mark, served at /icon-192 and
// referenced by manifest.ts for the PWA home-screen icon (Android +
// desktop install prompts). Files directly under src/app/ only become
// routes via Next.js's recognized special filenames (icon.tsx,
// apple-icon.tsx, …) — a custom size needs a real route handler in
// its own folder, hence icon-192/route.tsx rather than icon-192.tsx.

export const runtime = "edge";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#7c3aed",
          borderRadius: 36,
        }}
      >
        <svg
          width="120"
          height="120"
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
    { width: 192, height: 192 },
  );
}
