"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field, Panel, inputCls, textareaCls } from "@/components/sales/kit";

interface Entry {
  id: string;
  question: string;
  answer: string;
  isActive: boolean;
}

// Starters worth having on day one — one tap fills the form, the
// merchant still writes the answer in their own words.
const SUGGESTIONS = [
  "How long does it take?",
  "Do you deliver? Where?",
  "What are your opening hours?",
  "Can I get a refund or change my order?",
  "Where are you located?",
  "How do I pay?",
];

export function KnowledgeSettings() {
  const { canEditSettings } = useAuth();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [draft, setDraft] = useState({ question: "", answer: "" });
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    api<{ entries: Entry[] }>("/api/settings/knowledge")
      .then((d) => setEntries(d.entries))
      .catch((e) => toast.error(e.message));

  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    setBusy("add");
    try {
      const d = await api<{ entry: Entry }>("/api/settings/knowledge", { body: draft });
      setEntries((cur) => [...(cur ?? []), d.entry]);
      setDraft({ question: "", answer: "" });
      toast.success("Added — the rep can answer this now");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const patch = async (entry: Entry, body: Partial<Entry>) => {
    setBusy(entry.id);
    try {
      const d = await api<{ entry: Entry }>(`/api/settings/knowledge/${entry.id}`, { method: "PATCH", body });
      setEntries((cur) => (cur ?? []).map((e) => (e.id === entry.id ? d.entry : e)));
    } catch (e) {
      toast.error((e as Error).message);
      void load();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (entry: Entry) => {
    if (!confirm(`Delete "${entry.question}"? The rep will stop answering it.`)) return;
    setBusy(entry.id);
    try {
      await api(`/api/settings/knowledge/${entry.id}`, { method: "DELETE" });
      setEntries((cur) => (cur ?? []).filter((e) => e.id !== entry.id));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title="Knowledge base"
      description="Questions customers ask that aren't about price: delivery, how long things take, opening hours, returns. The rep answers from these word for word, and hands the chat to a person when the answer isn't here."
    >
      {entries === null ? (
        <div className="h-20 animate-pulse rounded-lg bg-slate-800/50" />
      ) : entries.length === 0 ? (
        <p className="text-sm text-slate-400">
          Nothing saved yet — the rep will hand over every question it can&apos;t answer from your inventory.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <input
                    className={inputCls}
                    defaultValue={e.question}
                    maxLength={160}
                    disabled={!canEditSettings}
                    onBlur={(ev) => ev.target.value !== e.question && void patch(e, { question: ev.target.value })}
                  />
                  <textarea
                    className={`${textareaCls} min-h-[64px]`}
                    defaultValue={e.answer}
                    maxLength={1200}
                    disabled={!canEditSettings}
                    onBlur={(ev) => ev.target.value !== e.answer && void patch(e, { answer: ev.target.value })}
                  />
                </div>
                {canEditSettings && (
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <Switch
                      checked={e.isActive}
                      onCheckedChange={(v) => void patch(e, { isActive: v })}
                      aria-label="Use this answer"
                    />
                    <Button size="icon-sm" variant="ghost" className="text-slate-400" aria-label="Delete" onClick={() => void remove(e)}>
                      {busy === e.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canEditSettings && (
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <div className="grid gap-3">
            <Field label="Question" hint="In the customer's words.">
              <input
                className={inputCls}
                maxLength={160}
                placeholder="How long does a logo take?"
                value={draft.question}
                onChange={(ev) => setDraft((d) => ({ ...d, question: ev.target.value }))}
              />
            </Field>
            <Field label="Answer" hint="The rep repeats this as written — keep it factual.">
              <textarea
                className={`${textareaCls} min-h-[72px]`}
                maxLength={1200}
                placeholder="Three working days once you approve the brief."
                value={draft.answer}
                onChange={(ev) => setDraft((d) => ({ ...d, answer: ev.target.value }))}
              />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {SUGGESTIONS.filter((q) => !(entries ?? []).some((e) => e.question === q)).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, question: q }))}
                className="rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400 hover:border-slate-500 hover:text-slate-200"
              >
                {q}
              </button>
            ))}
            <Button className="ml-auto" disabled={busy === "add" || !draft.question.trim() || !draft.answer.trim()} onClick={() => void add()}>
              {busy === "add" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
