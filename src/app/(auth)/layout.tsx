import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Waves } from "lucide-react";

// Shared metadata for auth pages (login / signup / forgot-password).
// None of these should be indexed — they'd compete with the marketing
// landing in SERPs and offer nothing to a searcher who hasn't already
// signed up. Each page still gets its own <title> via its own
// metadata.title override below the route group layout.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

// Purely decorative bar heights for the mock "activity" chart in the
// brand panel (not real data).
const BARS = [38, 62, 48, 74, 56, 92, 44];

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const tNav = await getTranslations("Sidebar");
  const tMeta = await getTranslations("Metadata");

  return (
    <div className="min-h-screen bg-frame lg:p-3">
      <div className="app-canvas relative grid min-h-screen overflow-hidden lg:min-h-[calc(100vh-1.5rem)] lg:grid-cols-[1.05fr_1fr] lg:rounded-[2.25rem] lg:shadow-float lg:ring-1 lg:ring-white/40">
        {/* Brand panel — desktop only, decorative. */}
        <aside className="relative hidden flex-col justify-between overflow-hidden p-10 lg:flex xl:p-14">
          <div className="flex items-center gap-2 self-start rounded-full border border-foreground/20 px-4 py-2">
            <Waves className="size-4" aria-hidden />
            <span className="text-lg leading-none font-normal tracking-tight">{tNav("title")}</span>
          </div>

          <div className="relative z-10 max-w-xl">
            <h1 className="text-5xl leading-[1.02] font-light tracking-tight text-foreground xl:text-6xl">
              {tNav("title")}
              <span className="ml-2 inline-block size-3 rounded-full bg-highlight align-middle" aria-hidden />
            </h1>
            <p className="mt-5 max-w-md text-base text-muted-foreground">{tMeta("description")}</p>
          </div>

          {/* Mock dashboard fragments */}
          <div className="relative z-10 grid max-w-xl grid-cols-[1.2fr_1fr] gap-4" aria-hidden>
            <div className="rounded-3xl bg-card/80 p-5 shadow-soft ring-1 ring-foreground/[0.06] backdrop-blur">
              <div className="flex items-baseline justify-between">
                <span className="text-4xl font-extralight tracking-tighter">6.1k</span>
                <span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs">↗</span>
              </div>
              <div className="mt-4 flex h-24 items-end justify-between gap-2">
                {BARS.map((h, i) => (
                  <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                    <div
                      className={i === 5 ? "w-2 rounded-full bg-highlight" : "w-2 rounded-full bg-foreground/80"}
                      style={{ height: `${h}%` }}
                    />
                    <div className="size-1 rounded-full bg-foreground/30" />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex flex-1 flex-col justify-between rounded-3xl bg-ink p-5 text-ink-foreground shadow-float">
                <div className="flex -space-x-2">
                  {["bg-highlight", "bg-white/90", "bg-white/40"].map((c) => (
                    <span key={c} className={`size-8 rounded-full ring-2 ring-ink ${c}`} />
                  ))}
                </div>
                <span className="text-3xl font-extralight tracking-tighter">2/8</span>
              </div>
              <div className="flex gap-1.5">
                <span className="h-9 flex-[3] rounded-full bg-ink" />
                <span className="h-9 flex-[2] rounded-full bg-highlight" />
                <span className="hatch h-9 flex-[4] rounded-full ring-1 ring-foreground/15 ring-inset" />
              </div>
            </div>
          </div>

          {/* Soft glow behind the fragments */}
          <div className="pointer-events-none absolute -bottom-32 -left-24 size-[28rem] rounded-full bg-highlight/40 blur-3xl" aria-hidden />
        </aside>

        {/* Form column */}
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}
