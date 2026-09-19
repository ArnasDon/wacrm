"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { MessageSquare, Pencil, Plus, Receipt, Search, Users } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, Field, PageHeader, inputCls, textareaCls, timeAgo } from "@/components/sales/kit";

interface Contact {
  _id: string;
  name: string | null;
  phone: string;
  email: string | null;
  notes: string | null;
  tags: string[];
  createdAt: string;
}

export default function ContactsPage() {
  const { canSendMessages } = useAuth();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", notes: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setContacts((await api<{ contacts: Contact[] }>(`/api/contacts?q=${encodeURIComponent(q)}`)).contacts);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [q]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const openEditor = (c: Contact | "new") => {
    setEditing(c);
    setForm(c === "new" ? { name: "", phone: "", email: "", notes: "" } : { name: c.name ?? "", phone: c.phone, email: c.email ?? "", notes: c.notes ?? "" });
  };

  const save = async () => {
    setSaving(true);
    try {
      if (editing === "new") await api("/api/contacts", { body: form });
      else if (editing) await api(`/api/contacts/${editing._id}`, { method: "PATCH", body: { name: form.name, email: form.email, notes: form.notes } });
      toast.success("Saved");
      setEditing(null);
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Customers"
        description="Everyone who has chatted or bought. Added automatically from WhatsApp."
        actions={canSendMessages ? <Button onClick={() => openEditor("new")}><Plus className="size-4" /> Add customer</Button> : null}
      />
      <div className="relative mb-3 w-full max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500" />
        <input className={`${inputCls} pl-9`} placeholder="Search name, number or email" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
        {contacts === null ? (
          <div className="h-48 animate-pulse" />
        ) : contacts.length === 0 ? (
          <EmptyState icon={<Users className="size-6" />} title="No customers yet" body="They appear as soon as someone messages your WhatsApp number." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">WhatsApp</th>
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Since</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {contacts.map((c) => (
                  <tr key={c._id} className="hover:bg-slate-800/30">
                    <td className="px-4 py-2.5 text-white">{c.name ?? <span className="text-slate-500">No name</span>}</td>
                    <td className="px-4 py-2.5 text-slate-300">+{c.phone}</td>
                    <td className="px-4 py-2.5 text-slate-400">{c.email ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{timeAgo(c.createdAt)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Link href={`/orders?q=${c.phone}`}><Button size="icon-sm" variant="ghost" aria-label="Orders" className="text-slate-400"><Receipt /></Button></Link>
                        <Link href={`/inbox?q=${c.phone}`}><Button size="icon-sm" variant="ghost" aria-label="Chat" className="text-slate-400"><MessageSquare /></Button></Link>
                        {canSendMessages && <Button size="icon-sm" variant="ghost" aria-label="Edit" className="text-slate-400" onClick={() => openEditor(c)}><Pencil /></Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="border border-slate-800 bg-slate-900 text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-white">{editing === "new" ? "Add customer" : "Edit customer"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="Name"><input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="WhatsApp number" hint={editing === "new" ? "e.g. 0803 123 4567 or +234 803 123 4567" : "Numbers can't be changed"}>
              <input className={inputCls} value={form.phone} disabled={editing !== "new"} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </Field>
            <Field label="Email" hint="Receipts are also emailed here"><input className={inputCls} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></Field>
            <Field label="Notes"><textarea className={textareaCls} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></Field>
          </div>
          <DialogFooter className="border-slate-800 bg-slate-900">
            <Button variant="ghost" className="text-slate-300" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving || (editing === "new" && !form.phone)}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
