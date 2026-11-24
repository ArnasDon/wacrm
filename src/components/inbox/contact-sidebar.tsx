"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { canSendMessages } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import type { Contact, Conversation, Deal, ContactNote, Tag } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  X,
  Flame,
  Sun,
  Snowflake,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { getDateLocale } from "@/i18n/date-locale";
import { contactHandle } from "@/lib/whatsapp/wa-identity";
import { addContactTag, deleteContactTag } from "@/lib/contacts/tag-api";

interface ContactSidebarProps {
  contact: Contact | null;
  conversation?: Conversation | null;
  onLeadScoreUpdated?: (score: 'hot' | 'warm' | 'cold') => void;
}

export function ContactSidebar({ contact, conversation, onLeadScoreUpdated }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const dateLocale = getDateLocale(useLocale());
  const tThread = useTranslations("Inbox.messageThread");

  const { accountId, accountRole } = useAuth();
  const canManageContactTags = accountRole ? canSendMessages(accountRole) : false;
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [savingTags, setSavingTags] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [qualifying, setQualifying] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, and tags in parallel
    const [dealsRes, notesRes, tagsRes, allTagsRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      supabase.from("tags").select("*").order("name"),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (allTagsRes.data) setAllTags(allTagsRes.data as Tag[]);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleToggleTag = useCallback(async (tagId: string) => {
    if (!contact || savingTags) return;
    const assignedTag = tags.find((tag) => tag.id === tagId);
    setSavingTags(true);
    try {
      if (assignedTag) await deleteContactTag(contact.id, tagId);
      else await addContactTag(contact.id, tagId);
      await fetchContactData();
    } catch (error) {
      console.error("Failed to update contact tags from inbox:", error);
      toast.error(
        error instanceof Error ? error.message : tSidebar("tagUpdateFailed"),
      );
    } finally {
      setSavingTags(false);
    }
  }, [contact, fetchContactData, savingTags, tags, tSidebar]);

  const handleCopyPhone = useCallback(async () => {
    // Copies whatever the row displays — a BSUID-only contact has no
    // phone number to copy, but its @username still identifies them.
    const handle = contact ? contactHandle(contact) : '';
    if (!handle) return;
    await navigator.clipboard.writeText(handle);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  const handleQualify = useCallback(async () => {
    if (!conversation?.id || qualifying) return;
    setQualifying(true);
    try {
      const res = await fetch("/api/ai/qualify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversation.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Could not qualify lead");
      } else if (data.score) {
        toast.success(`Lead qualified as ${data.score.toUpperCase()}`);
        onLeadScoreUpdated?.(data.score);
      }
    } catch {
      toast.error("Network error while qualifying lead");
    } finally {
      setQualifying(false);
    }
  }, [conversation?.id, qualifying, onLeadScoreUpdated]);

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center border-l border-border bg-card">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contactHandle(contact);
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex h-full w-70 flex-col border-l border-border bg-card">
      <ScrollArea className="min-h-0 flex-1">
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
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              style={{ cursor: "pointer" }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-left">
                {contactHandle(contact)}
              </span>
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

          {/* Lead Qualification */}
          {conversation && (
            <div>
              <div className="flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-primary" />
                  <span>Lead Qualification</span>
                </div>
                <button
                  type="button"
                  disabled={qualifying}
                  onClick={() => void handleQualify()}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80 disabled:opacity-50 cursor-pointer"
                  title="Analyze customer replies and qualify lead"
                >
                  <RefreshCw className={cn("h-3 w-3", qualifying && "animate-spin")} />
                  <span>{qualifying ? "Scoring..." : conversation.lead_score ? "Re-score" : "Qualify"}</span>
                </button>
              </div>

              <div className="mt-2 rounded-lg border border-border bg-muted/40 p-2.5">
                {conversation.lead_score === "hot" && (
                  <div className="flex items-start gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-500">
                      <Flame className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-red-500">🔥 Hot Lead</span>
                        <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[9px] font-medium text-red-500">High intent</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground leading-tight">
                        Clear purchase intent, asked for pricing/payment or ready to buy.
                      </p>
                    </div>
                  </div>
                )}
                {conversation.lead_score === "warm" && (
                  <div className="flex items-start gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-500">
                      <Sun className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-amber-500">🌤 Warm Lead</span>
                        <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-500">Interested</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground leading-tight">
                        Actively inquiring, asking questions about options/features.
                      </p>
                    </div>
                  </div>
                )}
                {conversation.lead_score === "cold" && (
                  <div className="flex items-start gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-400">
                      <Snowflake className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-blue-400">❄️ Cold Lead</span>
                        <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-medium text-blue-400">Low interest</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground leading-tight">
                        Unresponsive, gave minimal answers, or not interested.
                      </p>
                    </div>
                  </div>
                )}
                {!conversation.lead_score && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Not yet scored</span>
                    <button
                      type="button"
                      onClick={() => void handleQualify()}
                      disabled={qualifying}
                      className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
                    >
                      {qualifying ? "Analyzing..." : "Qualify now"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <TagIcon className="h-3 w-3" />
                {tSidebar("tags")}
              </div>
              {canManageContactTags && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={savingTags}
                    style={{ cursor: savingTags ? "not-allowed" : "pointer" }}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" />
                    {tSidebar("addTags")}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 border-border bg-popover">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        {tSidebar("availableTags")}
                      </DropdownMenuLabel>
                      {allTags.length === 0 ? (
                        <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                          {tSidebar("noAvailableTags")}
                        </DropdownMenuItem>
                      ) : (
                        allTags.map((tag) => (
                          <DropdownMenuCheckboxItem
                            key={tag.id}
                            checked={tags.some((assigned) => assigned.id === tag.id)}
                            onCheckedChange={() => void handleToggleTag(tag.id)}
                            disabled={savingTags}
                            style={{ cursor: savingTags ? "default" : "pointer" }}
                            className="text-sm text-popover-foreground"
                          >
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: tag.color }}
                            />
                            <span className="truncate">{tag.name}</span>
                          </DropdownMenuCheckboxItem>
                        ))
                      )}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noTags")}</p>
              ) : (
                tags.map((tag) => (
                  <span
                    key={tag.contact_tag_id}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tag.color,
                    }}
                  >
                    <span>{tag.name}</span>
                    {canManageContactTags && (
                      <button
                        type="button"
                        aria-label={tSidebar("removeTag", { tag: tag.name })}
                        title={tSidebar("removeTag", { tag: tag.name })}
                        onClick={() => void handleToggleTag(tag.id)}
                        disabled={savingTags}
                        style={{ cursor: savingTags ? "default" : "pointer" }}
                        className="rounded-full opacity-70 transition-opacity hover:opacity-100 disabled:opacity-40"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              {tSidebar("deals")}
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">{tSidebar("noDeals")}</p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {deal.stage && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: `${deal.stage.color}20`,
                            color: deal.stage.color,
                          }}
                        >
                          {deal.stage.name}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              {tSidebar("notes")}
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder={tSidebar("addNotePlaceholder")}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "PP HH:mm", { locale: dateLocale })}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
