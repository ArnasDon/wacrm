"use client";

import { useTranslations } from "next-intl";
import { Megaphone, ExternalLink } from "lucide-react";
import type { CtwaReferral } from "@/types";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

/**
 * Which platform the ad ran on, derived from `source_url` — never
 * hardcoded. Meta's referral object has no explicit "instagram" /
 * "facebook" field (AGENTS task: "não assumir Instagram se o anúncio
 * veio do Facebook"), so this is the only real signal available. Falls
 * back to a generic label when the URL doesn't clearly say either way.
 */
function detectPlatform(sourceUrl?: string): "instagram" | "facebook" | null {
  if (!sourceUrl) return null;
  try {
    const host = new URL(sourceUrl).hostname;
    if (host.includes("instagram.com")) return "instagram";
    if (
      host.includes("facebook.com") ||
      host.includes("fb.me") ||
      host.includes("fb.watch")
    )
      return "facebook";
  } catch {
    // Malformed/relative URL — treat as undetectable, not an error.
  }
  return null;
}

interface CtwaOriginProps {
  referral: CtwaReferral | null | undefined;
}

/**
 * WhatsApp-style "this conversation came from an ad" affordance — a
 * compact, tappable banner in the thread (works on touch, no hover
 * dependency) that opens a bottom sheet with the ad's image/copy on tap.
 * Renders nothing when the conversation has no CTWA origin (AGENTS task
 * rule 10) or the referral carries no displayable content.
 *
 * Purely a read of `conversation.ctwa_referral`, already persisted by
 * the webhook (see src/lib/whatsapp/ctwa-referral.ts) — no network call,
 * no new data source. Rendered inside MessageThread so it's visible on
 * mobile/PWA, where ContactSidebar (desktop-only, `lg:block`) never
 * shows at all.
 */
export function CtwaOrigin({ referral }: CtwaOriginProps) {
  const t = useTranslations("Inbox.adOrigin");

  const adMediaUrl = referral?.image_url || referral?.thumbnail_url || null;
  const hasContent =
    !!referral &&
    (adMediaUrl || referral.headline || referral.body || referral.source_url);
  if (!hasContent) return null;

  const platform = detectPlatform(referral.source_url);
  const bannerLabel =
    platform === "instagram"
      ? t("bannerInstagram")
      : platform === "facebook"
        ? t("bannerFacebook")
        : t("bannerGeneric");
  const openLabel =
    platform === "instagram"
      ? t("openInstagram")
      : platform === "facebook"
        ? t("openFacebook")
        : t("viewAd");

  return (
    <Sheet>
      <SheetTrigger
        className="flex w-full items-center gap-2 border-b border-border bg-primary/5 px-4 py-2.5 text-left transition-colors hover:bg-primary/10 active:bg-primary/10"
      >
        <Megaphone className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-foreground">
            {bannerLabel}
          </span>
          <span className="block text-[11px] text-primary">
            {t("showDetails")}
          </span>
        </span>
      </SheetTrigger>

      {/* Bottom sheet on every breakpoint — comfortable one-handed/touch
          use is the priority (AGENTS task), and a bottom sheet reads
          fine on desktop too, so there's no separate desktop variant to
          keep in sync. Capped height + internal scroll so a long ad copy
          never pushes the footer buttons off a short phone screen; the
          footer's bottom padding respects the iOS home-indicator safe
          area, same convention as message-composer.tsx. */}
      <SheetContent
        side="bottom"
        className="mx-auto flex max-h-[85vh] w-full flex-col sm:max-w-md sm:rounded-t-2xl"
      >
        <SheetHeader className="shrink-0">
          <SheetTitle>{bannerLabel}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4">
          {adMediaUrl && (
            <img
              src={adMediaUrl}
              alt={t("imageAlt")}
              className="max-h-[45vh] w-full rounded-lg object-contain"
            />
          )}
          {(referral.headline || referral.body) && (
            <div className="mt-3 space-y-1">
              {referral.headline && (
                <p className="text-sm font-semibold text-foreground">
                  {referral.headline}
                </p>
              )}
              {referral.body && (
                <p className="text-sm text-muted-foreground">
                  {referral.body}
                </p>
              )}
            </div>
          )}
        </div>

        <SheetFooter className="shrink-0 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {referral.source_url && (
            <Button
              variant="outline"
              render={
                <a
                  href={referral.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <ExternalLink className="h-4 w-4" />
              {openLabel}
            </Button>
          )}
          <SheetClose
            render={<Button variant="ghost" className="text-muted-foreground" />}
          >
            {t("backToConversation")}
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
