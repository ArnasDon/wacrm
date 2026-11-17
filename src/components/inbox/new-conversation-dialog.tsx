"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertCircle, ChevronRight, Loader2, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { MessageTemplate } from "@/types";
import {
  findContactConversationId,
  searchNewConversationContacts,
  type NewConversationContact,
} from "@/lib/inbox/new-conversation";
import { CONTACT_PICKER_LIMIT } from "@/lib/contacts/contact-picker";
import { sendContactTemplate } from "@/lib/inbox/contact-template-send";
import { contactHandle } from "@/lib/whatsapp/wa-identity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  TemplatePicker,
  type TemplateSendValues,
} from "@/components/inbox/template-picker";

type ContactsStatus = "loading" | "error" | "ready";

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConversationReady: (conversationId: string) => void;
}

export function NewConversationDialog({
  open,
  onOpenChange,
  onConversationReady,
}: NewConversationDialogProps) {
  const t = useTranslations("Inbox.newConversation");
  const { accountId } = useAuth();

  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<NewConversationContact[]>([]);
  const [status, setStatus] = useState<ContactsStatus>("loading");
  const [reloadToken, setReloadToken] = useState(0);
  const [openingContactId, setOpeningContactId] = useState<string | null>(null);
  const [templateContact, setTemplateContact] =
    useState<NewConversationContact | null>(null);
  const searchSeq = useRef(0);
  const contactAwaitingTemplate = useRef<NewConversationContact | null>(null);

  useEffect(() => {
    if (!open || !accountId) return;
    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      setStatus("loading");
      try {
        const found = await searchNewConversationContacts(
          createClient(),
          accountId,
          search,
        );
        if (seq !== searchSeq.current) return;
        setContacts(found);
        setStatus("ready");
      } catch (error) {
        if (seq !== searchSeq.current) return;
        console.error("Failed to load contacts for new conversation:", error);
        setStatus("error");
      }
    }, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [open, accountId, search, reloadToken]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setSearch("");
      setOpeningContactId(null);
    }
    onOpenChange(next);
  }

  async function pickContact(contact: NewConversationContact) {
    if (!accountId || openingContactId) return;
    setOpeningContactId(contact.id);
    let existingId: string | null;
    try {
      existingId = await findContactConversationId(
        createClient(),
        accountId,
        contact.id,
      );
    } catch (error) {
      console.error("Failed to look up conversation for contact:", error);
      toast.error(t("lookupFailed"));
      setOpeningContactId(null);
      return;
    }
    if (existingId) {
      handleOpenChange(false);
      onConversationReady(existingId);
      return;
    }
    contactAwaitingTemplate.current = contact;
    handleOpenChange(false);
  }

  function handleOpenChangeComplete(isOpen: boolean) {
    if (isOpen) return;
    const contact = contactAwaitingTemplate.current;
    contactAwaitingTemplate.current = null;
    if (contact) setTemplateContact(contact);
  }

  async function sendTemplate(
    template: MessageTemplate,
    values: TemplateSendValues,
  ) {
    const contact = templateContact;
    if (!contact) return;
    const toastId = toast.loading(t("sending"));
    try {
      const result = await sendContactTemplate(contact.id, template, values);
      if (!result.ok) {
        toast.error(t("sendFailed", { reason: result.reason }), { id: toastId });
        return;
      }
      toast.success(t("sent", { name: template.name }), { id: toastId });
      if (result.conversationId) onConversationReady(result.conversationId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : t("networkError");
      toast.error(t("sendFailed", { reason }), { id: toastId });
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={handleOpenChange}
        onOpenChangeComplete={handleOpenChangeComplete}
      >
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t("title")}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t("description")}
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
              className="border-border bg-muted pl-9 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="max-h-[50vh] min-h-32 overflow-y-auto">
            {status === "loading" ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : status === "error" ? (
              <div
                role="alert"
                className="flex flex-col items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-6 text-center"
              >
                <AlertCircle className="h-5 w-5 text-destructive" />
                <div>
                  <p className="text-sm text-popover-foreground">
                    {t("loadFailed")}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("loadFailedHint")}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReloadToken((n) => n + 1)}
                >
                  {t("retry")}
                </Button>
              </div>
            ) : contacts.length === 0 ? (
              <div className="rounded-md border border-border bg-background/50 p-6 text-center">
                <p className="text-sm text-popover-foreground">
                  {search.trim() ? t("noMatches") : t("noContacts")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {search.trim() ? t("noMatchesHint") : t("noContactsHint")}
                </p>
              </div>
            ) : (
              <ul className="space-y-1">
                {contacts.map((contact) => (
                  <li key={contact.id}>
                    <ContactOption
                      contact={contact}
                      opening={openingContactId === contact.id}
                      disabled={openingContactId !== null}
                      unnamedLabel={t("unnamed")}
                      onPick={pickContact}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {status === "ready" && contacts.length >= CONTACT_PICKER_LIMIT && (
            <p className="text-xs text-muted-foreground">
              {t("limitHint", { limit: CONTACT_PICKER_LIMIT })}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="border-border text-popover-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TemplatePicker
        open={templateContact !== null}
        onOpenChange={(next) => {
          if (!next) setTemplateContact(null);
        }}
        onSelect={sendTemplate}
      />
    </>
  );
}

interface ContactOptionProps {
  contact: NewConversationContact;
  opening: boolean;
  disabled: boolean;
  unnamedLabel: string;
  onPick: (contact: NewConversationContact) => void;
}

function ContactOption({
  contact,
  opening,
  disabled,
  unnamedLabel,
  onPick,
}: ContactOptionProps) {
  const handle = contactHandle(contact);
  const displayName = contact.name?.trim() || handle || unnamedLabel;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(contact)}
      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Avatar>
        {contact.avatar_url && <AvatarImage src={contact.avatar_url} alt="" />}
        <AvatarFallback>{displayName.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-popover-foreground">{displayName}</p>
        {handle && handle !== displayName && (
          <p className="truncate text-xs text-muted-foreground">{handle}</p>
        )}
      </div>
      {opening ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
      ) : (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}
