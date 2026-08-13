"use client";

import { useState, useEffect, useCallback } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Contact, Conversation, Tag } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  User,
  Tag as TagIcon,
  Kanban,
  ChevronRight,
  ShoppingBag,
  BrainCircuit,
  Megaphone,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ContactNotesPanel } from "./contact-notes-panel";
import { useLeadPipelineStage } from "@/hooks/use-lead-pipeline-stage";

interface ContactSidebarProps {
  contact: Contact | null;
  /** Carries `ctwa_referral` (migration 055) for the ad-origin section
   *  below — optional so existing callers keep compiling. */
  conversation?: Conversation | null;
}

export function ContactSidebar({ contact, conversation }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");

  const [copied, setCopied] = useState(false);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  // Same hook the header's "⋮ → Mover para" submenu uses (message-thread.tsx)
  // — one fetch/update implementation for both entry points.
  const { deal: pipelineDeal, stages: pipelineStages, moveToStage } =
    useLeadPipelineStage(contact?.id);
  // BLOCO 3/4 — discreet count of pending Central de IA suggestions for
  // this contact (any category — pipeline moves, follow-ups, etc.).
  // Keeps the Inbox itself free of AI clutter: just a small hint here
  // pointing back to the Central de IA, never the suggestions themselves.
  const [pendingSuggestionCount, setPendingSuggestionCount] = useState(0);
  const [savingHasPurchased, setSavingHasPurchased] = useState(false);

  // Optimistic override for the toggle below, reset on every contact
  // switch via the render-time "adjusting state when a prop changes"
  // pattern (no effect needed). Absent the override, the displayed
  // value comes straight from `contact.has_purchased` — the same
  // `contacts` row/column the Contacts-page detail panel reads and
  // writes, so a change made there shows up here next time this
  // contact is opened (and vice versa).
  const [purchasedContactId, setPurchasedContactId] = useState(contact?.id);
  const [optimisticHasPurchased, setOptimisticHasPurchased] = useState<
    boolean | null
  >(null);
  if (contact?.id !== purchasedContactId) {
    setPurchasedContactId(contact?.id);
    setOptimisticHasPurchased(null);
  }
  const hasPurchased = optimisticHasPurchased ?? contact?.has_purchased ?? false;

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch tags and the pending-AI-suggestions count in parallel. Notes
    // are fetched independently by `ContactNotesPanel` (shared with the
    // "Abrir notas" dialog off the conversation's ⋮ menu), and the
    // pipeline deal/stage by `useLeadPipelineStage`. The suggestions
    // query excludes snoozed-into-the-future rows so "Adiar" in the
    // Central de IA also quiets this hint, same rule as the suggestions
    // list route.
    const [tagsRes, suggestionsRes] = await Promise.all([
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      supabase
        .from("ai_suggestions")
        .select("id", { count: "exact", head: true })
        .eq("contact_id", contact.id)
        .eq("status", "pending")
        .or(`snoozed_until.is.null,snoozed_until.lte.${new Date().toISOString()}`),
    ]);

    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
    setPendingSuggestionCount(suggestionsRes.count ?? 0);
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleToggleHasPurchased = useCallback(
    async (value: boolean) => {
      if (!contact) return;
      const previous = hasPurchased;
      setOptimisticHasPurchased(value);
      setSavingHasPurchased(true);

      const supabase = createClient();
      const { error } = await supabase
        .from("contacts")
        .update({ has_purchased: value, updated_at: new Date().toISOString() })
        .eq("id", contact.id);

      if (error) {
        setOptimisticHasPurchased(previous);
      }
      setSavingHasPurchased(false);
    },
    [contact, hasPurchased],
  );

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  // Click-to-WhatsApp ad origin (migration 055). Priority per spec:
  // image_url, then thumbnail_url for a video ad (we don't embed the
  // video itself, just its still). Never the media the customer sent
  // during the conversation — that's `messages.media_url`, a completely
  // separate concept from this ad-origin metadata.
  const referral = conversation?.ctwa_referral;
  const adMediaUrl = referral?.image_url || referral?.thumbnail_url || null;
  const hasAdOrigin = !!referral && (
    adMediaUrl || referral.headline || referral.body || referral.source_url
  );

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
            {pendingSuggestionCount > 0 && (
              <Link
                href={`/agents?contact=${contact.id}`}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
              >
                <BrainCircuit className="h-3 w-3" />
                {tSidebar("pendingAiSuggestions", { count: pendingSuggestionCount })}
              </Link>
            )}
          </div>

          {/* Ad origin (Click-to-WhatsApp) — shown first, image-first,
              since knowing which ad/apartment brought the lead in is
              the whole point of this section (AGENTS task). */}
          {hasAdOrigin && (
            <>
              <div className="my-4 border-t border-border" />
              <div>
                <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Megaphone className="h-3 w-3" />
                  {tSidebar("adOrigin")}
                </div>
                <div className="mt-2 overflow-hidden rounded-lg bg-muted">
                  {adMediaUrl && (
                    <img
                      src={adMediaUrl}
                      alt={tSidebar("adOriginImageAlt")}
                      className="aspect-video w-full object-cover"
                    />
                  )}
                  {(referral?.headline || referral?.body) && (
                    <div className="space-y-0.5 px-3 py-2">
                      {referral?.headline && (
                        <p className="text-xs font-semibold text-foreground">
                          {referral.headline}
                        </p>
                      )}
                      {referral?.body && (
                        <p className="text-xs text-muted-foreground">
                          {referral.body}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">{contact.phone}</span>
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Has Purchased */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <ShoppingBag className="h-3 w-3" />
              {tSidebar("hasPurchased")}
            </div>
            <div className="mt-2 flex items-center justify-between rounded-lg bg-muted px-3 py-2">
              <span className="text-xs text-muted-foreground">
                {hasPurchased ? tSidebar("hasPurchasedYes") : tSidebar("hasPurchasedNo")}
              </span>
              <Switch
                checked={hasPurchased}
                onCheckedChange={handleToggleHasPurchased}
                disabled={savingHasPurchased}
              />
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              {tSidebar("tags")}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Etapa da Pipeline — same deal/stage this contact's Kanban
              card and the header's "⋮ → Mover para" submenu show; moving
              here calls the same `deals.stage_id` update via
              `useLeadPipelineStage`, so all three stay in sync. */}
          <div className="rounded-2xl border border-border bg-muted/50 p-4">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <Kanban className="h-3 w-3" />
              {tSidebar("pipelineStage")}
            </div>
            <div className="mt-3 flex items-center gap-2">
              {pipelineDeal?.stage && (
                <span
                  className="h-3 w-3 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: pipelineDeal.stage.color }}
                />
              )}
              <p
                className={cn(
                  "text-base font-bold",
                  pipelineDeal?.stage ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {pipelineDeal?.stage?.name ?? tSidebar("noPipelineStage")}
              </p>
            </div>
            {pipelineDeal && pipelineStages.length > 0 && (
              <DropdownMenu>
                {/* Border/text/icon color track the active stage's own
                    `color` (same field the dot above and the dropdown's
                    per-stage swatches already use) — generic to however
                    many stages/colors get added later, no per-color class
                    list to maintain. Border and hover-bg reuse the same
                    hex-plus-alpha-suffix trick the tag chips above use
                    (`${color}NN`), just as CSS custom properties so the
                    Tailwind arbitrary-value hover selector can reach them. */}
                <DropdownMenuTrigger
                  className="mt-3 flex w-full items-center justify-between rounded-full border bg-transparent px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--stage-hover-bg)]"
                  style={
                    {
                      borderColor: `${pipelineDeal.stage?.color}60`,
                      color: pipelineDeal.stage?.color,
                      "--stage-hover-bg": `${pipelineDeal.stage?.color}1A`,
                    } as CSSProperties
                  }
                >
                  <span>{tSidebar("changeStage")}</span>
                  <ChevronRight className="h-3 w-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48 border-border bg-popover">
                  {pipelineStages.map((stage) => (
                    <DropdownMenuItem
                      key={stage.id}
                      onClick={async () => {
                        const { error } = await moveToStage(stage.id);
                        if (error) toast.error("Failed to update pipeline stage");
                      }}
                      className={cn(
                        "text-sm",
                        stage.id === pipelineDeal.stage_id
                          ? "text-primary"
                          : "text-popover-foreground"
                      )}
                    >
                      <span
                        className="mr-2 h-2 w-2 rounded-full"
                        style={{ backgroundColor: stage.color }}
                      />
                      <span className="flex-1">{stage.name}</span>
                      {stage.id === pipelineDeal.stage_id && (
                        <Check className="ml-2 h-3 w-3" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes — same component the "⋮ → Abrir notas" dialog uses,
              so mobile (where this sidebar never renders) gets the exact
              same notes UI/data instead of a second implementation. */}
          <ContactNotesPanel contact={contact} />
        </div>
      </ScrollArea>
    </div>
  );
}
