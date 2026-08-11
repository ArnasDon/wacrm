"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Contact, ContactNote } from "@/types";
import { StickyNote, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { useTranslations } from "next-intl";

interface ContactNotesPanelProps {
  contact: Contact;
  /** Hides the section heading/icon — the ⋮ menu's "Abrir notas" dialog
   *  already has its own DialogTitle, so the heading would be redundant
   *  there. `ContactSidebar` (which has no other heading above this
   *  section) keeps it. */
  hideHeading?: boolean;
}

/**
 * The contact_notes CRUD (fetch/add) — extracted from `ContactSidebar` so
 * it can be reused both there (desktop sidebar, unchanged) and in a
 * standalone dialog opened from the conversation's "⋮" menu ("Abrir
 * notas"), which is the only way to reach notes on mobile since
 * `ContactSidebar` itself never renders below the `lg` breakpoint. Same
 * `contact_notes` table (migration 001), same RLS, same query shape —
 * no new notes storage.
 */
export function ContactNotesPanel({ contact, hideHeading }: ContactNotesPanelProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const { accountId } = useAuth();
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const fetchNotes = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("contact_notes")
      .select("*")
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: false });
    if (data) setNotes(data);
  }, [contact.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchNotes();
  }, [fetchNotes]);

  const handleAddNote = useCallback(async () => {
    if (!newNote.trim() || !accountId) return;
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
  }, [contact.id, newNote, accountId]);

  return (
    <div>
      {!hideHeading && (
        <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <StickyNote className="h-3 w-3" />
          {tSidebar("notes")}
        </div>
      )}
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
          {notes.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">{tSidebar("noNotesYet")}</p>
          ) : (
            notes.map((note) => (
              <div key={note.id} className="rounded-lg bg-muted px-3 py-2">
                <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                  {note.note_text}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
