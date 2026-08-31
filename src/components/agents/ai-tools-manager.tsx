"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Trash2,
  Pencil,
  MoreHorizontal,
  Wrench,
  GripVertical,
  PlayCircle,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ------------------------------------------------------------
// AI agent tools — a settings-style CRUD list + form, mirroring
// src/components/settings/quick-replies-manager.tsx: single-file
// manager, inline dialog, fetch/save/remove with sonner toasts. The
// parameter table reuses the @dnd-kit reorder pattern already used in
// src/components/pipelines/pipeline-settings.tsx.
// ------------------------------------------------------------

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type AuthType = "none" | "bearer" | "api_key" | "basic";
type ParamLocation = "query" | "body" | "path" | "header";
type ParamType = "string" | "number" | "boolean";

interface ParamDraft {
  key: string; // client-only, stable id for drag/reorder — not sent to the server
  name: string;
  in: ParamLocation;
  type: ParamType;
  description: string;
  required: boolean;
  enumText: string; // comma-separated; parsed to `enum` on save
}

interface HeaderRow {
  key: string;
  name: string;
  value: string;
}

interface ToolItem {
  id: string;
  name: string;
  description: string;
  method: Method;
  url: string;
  headers: Record<string, string>;
  auth_type: AuthType;
  auth_header_name: string | null;
  has_secret: boolean;
  parameters: (Omit<ParamDraft, "key" | "enumText"> & { enum?: string[] })[];
  timeout_ms: number;
  is_active: boolean;
}

interface Draft {
  id?: string;
  name: string;
  description: string;
  method: Method;
  url: string;
  headers: HeaderRow[];
  authType: AuthType;
  authHeaderName: string;
  authSecret: string;
  hasSecret: boolean;
  parameters: ParamDraft[];
  timeoutMs: number;
  isActive: boolean;
}

function newKey(): string {
  return Math.random().toString(36).slice(2);
}

function emptyDraft(): Draft {
  return {
    name: "",
    description: "",
    method: "GET",
    url: "",
    headers: [],
    authType: "none",
    authHeaderName: "",
    authSecret: "",
    hasSecret: false,
    parameters: [],
    timeoutMs: 8000,
    isActive: true,
  };
}

function toDraft(item: ToolItem): Draft {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    method: item.method,
    url: item.url,
    headers: Object.entries(item.headers ?? {}).map(([name, value]) => ({
      key: newKey(),
      name,
      value,
    })),
    authType: item.auth_type,
    authHeaderName: item.auth_header_name ?? "",
    authSecret: "",
    hasSecret: item.has_secret,
    parameters: (item.parameters ?? []).map((p) => ({
      key: newKey(),
      name: p.name,
      in: p.in,
      type: p.type,
      description: p.description ?? "",
      required: !!p.required,
      enumText: (p.enum ?? []).join(", "),
    })),
    timeoutMs: item.timeout_ms,
    isActive: item.is_active,
  };
}

export function AiToolsManager({ canEdit = true }: { canEdit?: boolean }) {
  const [items, setItems] = useState<ToolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/tools", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setItems((data.tools as ToolItem[]) ?? []);
      else toast.error(data.error ?? "Couldn't load tools.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => setDraft(emptyDraft());
  const openEdit = (item: ToolItem) => setDraft(toDraft(item));

  const save = useCallback(async () => {
    if (!draft) return;
    if (!/^[a-z0-9_]{1,64}$/.test(draft.name)) {
      toast.error("Name must be lowercase letters, numbers, and underscores only.");
      return;
    }
    if (!draft.description.trim()) {
      toast.error("Description is required — it tells the agent when to use this tool.");
      return;
    }
    if (!draft.url.trim()) {
      toast.error("URL is required.");
      return;
    }
    if (draft.authType !== "none" && !draft.authSecret && !draft.hasSecret) {
      toast.error("A credential is required for this auth type.");
      return;
    }
    if (draft.authType === "api_key" && !draft.authHeaderName.trim()) {
      toast.error("Header name is required for API key auth.");
      return;
    }

    const payload = {
      name: draft.name,
      description: draft.description,
      method: draft.method,
      url: draft.url,
      headers: Object.fromEntries(
        draft.headers.filter((h) => h.name.trim()).map((h) => [h.name.trim(), h.value]),
      ),
      auth_type: draft.authType,
      auth_header_name: draft.authType === "api_key" ? draft.authHeaderName.trim() : null,
      ...(draft.authSecret ? { auth_secret: draft.authSecret } : {}),
      parameters: draft.parameters
        .filter((p) => p.name.trim())
        .map((p) => ({
          name: p.name.trim(),
          in: p.in,
          type: p.type,
          description: p.description.trim() || undefined,
          required: p.required,
          enum: p.enumText.trim()
            ? p.enumText.split(",").map((v) => v.trim()).filter(Boolean)
            : undefined,
        })),
      timeout_ms: draft.timeoutMs,
      is_active: draft.isActive,
    };

    setSaving(true);
    try {
      const res = await fetch(draft.id ? `/api/ai/tools/${draft.id}` : "/api/ai/tools", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't save the tool.");
        return;
      }
      toast.success(draft.id ? "Tool updated." : "Tool created.");
      setDraft(data.tool ? toDraft(data.tool as ToolItem) : null);
      await load();
    } finally {
      setSaving(false);
    }
  }, [draft, load]);

  const remove = useCallback(
    async (id: string) => {
      if (!window.confirm("Delete this tool? The agent will no longer be able to call it.")) {
        return;
      }
      setDeletingId(id);
      try {
        const res = await fetch(`/api/ai/tools/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error ?? "Couldn't delete the tool.");
          return;
        }
        setItems((prev) => prev.filter((i) => i.id !== id));
        if (draft?.id === id) setDraft(null);
      } finally {
        setDeletingId(null);
      }
    },
    [draft?.id],
  );

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Tools</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            HTTP calls the agent can make mid-conversation — check availability, place
            an order, look up a status. The agent decides when to use one based on its
            description.
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add tool
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        // Plain empty state — no dashed box (docs/DESIGN.md §5).
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-12 text-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
            <Wrench className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="mt-3 text-[13px] font-medium text-foreground">No tools yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add one to let the agent call your APIs mid-conversation.
          </p>
        </div>
      ) : (
        <div className="grid gap-2">
          {items.map((item) => (
            // `min-w-0` on the grid item is load-bearing: tool descriptions
            // can be long unbroken JSON blobs, and without it the grid
            // child's implicit min-width:auto forces the card past the
            // container edge → horizontal page scroll.
            <div
              key={item.id}
              className="group flex min-w-0 items-start gap-3 rounded-lg border border-border bg-card p-3.5 transition-colors hover:bg-muted/30"
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate font-mono text-[13px] font-medium text-foreground">
                    {item.name}
                  </span>
                  <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {item.method}
                  </span>
                  {!item.is_active && (
                    <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      Disabled
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </div>
              {canEdit && (
                // Standard 3-dot overflow menu — edit/delete live here
                // instead of loose icon buttons (docs/DESIGN.md §4).
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`Actions for ${item.name}`}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {deletingId === item.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <MoreHorizontal className="h-4 w-4" />
                    )}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-36 border-border bg-popover">
                    <DropdownMenuItem
                      onClick={() => openEdit(item)}
                      className="text-popover-foreground"
                    >
                      <Pencil className="mr-2 h-3.5 w-3.5" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-border" />
                    <DropdownMenuItem
                      onClick={() => remove(item.id)}
                      disabled={deletingId === item.id}
                      className="text-red-500 focus:bg-red-500/10 focus:text-red-600 dark:text-red-400"
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
          {draft && (
            <ToolForm
              draft={draft}
              setDraft={setDraft}
              saving={saving}
              onSave={save}
              onCancel={() => setDraft(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ToolForm({
  draft,
  setDraft,
  saving,
  onSave,
  onCancel,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const patch = (p: Partial<Draft>) => setDraft({ ...draft, ...p });

  const addParam = () =>
    patch({
      parameters: [
        ...draft.parameters,
        {
          key: newKey(),
          name: "",
          in: "query",
          type: "string",
          description: "",
          required: false,
          enumText: "",
        },
      ],
    });

  const updateParam = (key: string, p: Partial<ParamDraft>) =>
    patch({
      parameters: draft.parameters.map((row) => (row.key === key ? { ...row, ...p } : row)),
    });

  const removeParam = (key: string) =>
    patch({ parameters: draft.parameters.filter((row) => row.key !== key) });

  const handleReorder = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = draft.parameters.findIndex((p) => p.key === active.id);
    const newIndex = draft.parameters.findIndex((p) => p.key === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    patch({ parameters: arrayMove(draft.parameters, oldIndex, newIndex) });
  };

  const addHeader = () =>
    patch({ headers: [...draft.headers, { key: newKey(), name: "", value: "" }] });
  const updateHeader = (key: string, p: Partial<HeaderRow>) =>
    patch({ headers: draft.headers.map((h) => (h.key === key ? { ...h, ...p } : h)) });
  const removeHeader = (key: string) =>
    patch({ headers: draft.headers.filter((h) => h.key !== key) });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{draft.id ? "Edit tool" : "Add tool"}</DialogTitle>
      </DialogHeader>

      {/* Wider, calmer form: identity row → description → request row →
          auth row → headers/params. Helper copy stays under its field
          (docs/DESIGN.md §3). */}
      <div className="grid gap-5 py-1">
        {/* Identity: name + active toggle on one baseline. */}
        <div className="flex items-end gap-4">
          <div className="grid flex-1 gap-1.5">
            <Label>Name</Label>
            <Input
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value.toLowerCase() })}
              placeholder="check_stock"
              className="font-mono"
            />
            <p className="text-[11px] text-muted-foreground">
              lowercase, numbers, underscores — how the agent refers to it
            </p>
          </div>
          <label className="flex h-9 shrink-0 items-center gap-2 pb-5 text-[13px] font-medium text-foreground">
            <Switch
              checked={draft.isActive}
              onCheckedChange={(v) => patch({ isActive: v })}
            />
            Active
          </label>
        </div>

        <div className="grid gap-1.5">
          <Label>Description</Label>
          <Textarea
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
            placeholder={
              "Checks live stock for a product SKU. Call this before promising availability " +
              "or price. Do not use for order history — use get_order_status instead. " +
              "Returns JSON: {in_stock: boolean, quantity: number, price_usd: number}."
            }
            rows={4}
          />
          <p className="max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
            The only signal the agent gets — sent with every message. Cover briefly:
            what it does, when to call it, what NOT to use it for, and the response
            shape (there&apos;s no separate field for the format).
          </p>
        </div>

        {/* Request line: method + URL share one row. */}
        <div className="grid grid-cols-[140px_1fr] gap-3">
          <div className="grid gap-1.5">
            <Label>Method</Label>
            <Select
              value={draft.method}
              onValueChange={(v) => patch({ method: v as Method })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["GET", "POST", "PUT", "PATCH", "DELETE"] as Method[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>URL</Label>
            <Input
              value={draft.url}
              onChange={(e) => patch({ url: e.target.value })}
              placeholder="https://api.example.com/stock/{sku}"
              className="font-mono text-sm"
            />
          </div>
        </div>

        {draft.method !== "GET" && (
          <p className="-mt-3 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
            {draft.method} tools fire autonomously in auto-reply — the agent decides to call
            this with no human approval step. Write the description defensively and lean on
            your API&apos;s own business logic as the real backstop.
          </p>
        )}

        <AuthFields draft={draft} patch={patch} />

        {/* Static headers */}
        <div className="grid gap-1.5">
          <Label>Headers</Label>
          {draft.headers.map((h) => (
            <div key={h.key} className="flex items-center gap-2">
              <Input
                value={h.name}
                onChange={(e) => updateHeader(h.key, { name: e.target.value })}
                placeholder="Header-Name"
                className="font-mono text-xs"
              />
              <Input
                value={h.value}
                onChange={(e) => updateHeader(h.key, { value: e.target.value })}
                placeholder="value"
                className="font-mono text-xs"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeHeader(h.key)}
                className="h-8 w-8 shrink-0 p-0"
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addHeader} className="w-fit">
            <Plus className="mr-1 h-3 w-3" /> Add header
          </Button>
        </div>

        {/* Parameters — drag to reorder */}
        <div className="grid gap-1.5">
          <Label>Parameters</Label>
          <p className="text-[11px] text-muted-foreground">
            What the agent fills in when it calls this tool. Use {"{name}"} in the URL for
            path parameters.
          </p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleReorder}>
            <SortableContext
              items={draft.parameters.map((p) => p.key)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-1.5">
                {draft.parameters.map((p) => (
                  <SortableParamRow
                    key={p.key}
                    param={p}
                    onChange={(patch) => updateParam(p.key, patch)}
                    onRemove={() => removeParam(p.key)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          <Button variant="outline" size="sm" onClick={addParam} className="w-fit">
            <Plus className="mr-1 h-3 w-3" /> Add parameter
          </Button>
        </div>

        {draft.id && <TestPanel toolId={draft.id} parameters={draft.parameters} />}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          {draft.id ? "Save" : "Create"}
        </Button>
      </DialogFooter>
    </>
  );
}

function AuthFields({
  draft,
  patch,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
}) {
  return (
    // Inline auth row — select + conditional fields share one baseline
    // instead of stacking inside a bordered box.
    <div className="grid gap-3">
      <div className="grid grid-cols-[220px_1fr] items-start gap-3">
        <div className="grid gap-1.5">
          <Label>Authentication</Label>
          <Select
            value={draft.authType}
            onValueChange={(v) => patch({ authType: v as AuthType })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="bearer">Bearer token</SelectItem>
              <SelectItem value="api_key">API key header</SelectItem>
              <SelectItem value="basic">Basic auth</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {draft.authType === "api_key" && (
          <div className="grid gap-1.5">
            <Label>Header name</Label>
            <Input
              value={draft.authHeaderName}
              onChange={(e) => patch({ authHeaderName: e.target.value })}
              placeholder="X-API-Key"
              className="font-mono text-sm"
            />
          </div>
        )}

        {draft.authType !== "none" && (
          <div className="grid gap-1.5">
            <Label>
              {draft.authType === "basic" ? "Credential (user:pass)" : "Credential"}
            </Label>
            <Input
              type="password"
              value={draft.authSecret}
              onChange={(e) => patch({ authSecret: e.target.value })}
              placeholder={draft.hasSecret ? "•••••••••••••••• (saved — leave blank to keep)" : "Enter credential"}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function SortableParamRow({
  param,
  onChange,
  onRemove,
}: {
  param: ParamDraft;
  onChange: (p: Partial<ParamDraft>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: param.key });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/40 p-2"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-muted-foreground"
        aria-label="Reorder"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <Input
        value={param.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="sku"
        className="h-8 w-28 font-mono text-xs"
      />
      <Select value={param.in} onValueChange={(v) => onChange({ in: v as ParamLocation })}>
        <SelectTrigger className="h-8 w-24 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="query">query</SelectItem>
          <SelectItem value="path">path</SelectItem>
          <SelectItem value="body">body</SelectItem>
          <SelectItem value="header">header</SelectItem>
        </SelectContent>
      </Select>
      <Select value={param.type} onValueChange={(v) => onChange({ type: v as ParamType })}>
        <SelectTrigger className="h-8 w-24 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="string">string</SelectItem>
          <SelectItem value="number">number</SelectItem>
          <SelectItem value="boolean">boolean</SelectItem>
        </SelectContent>
      </Select>
      <Input
        value={param.description}
        onChange={(e) => onChange({ description: e.target.value })}
        placeholder="description for the agent"
        className="h-8 min-w-[10rem] flex-1 text-xs"
      />
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={param.required}
          onChange={(e) => onChange({ required: e.target.checked })}
        />
        required
      </label>
      <Button variant="ghost" size="sm" onClick={onRemove} className="h-8 w-8 p-0">
        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
      </Button>
    </div>
  );
}

/** Fires a real request via `/api/ai/tools/[id]/test` with sample values
 *  the admin types in — same "test it live" ethos as the agent
 *  Playground, scoped to one tool. Only shown once the tool has an id
 *  (saved at least once) — nothing to test against before that. */
function TestPanel({
  toolId,
  parameters,
}: {
  toolId: string;
  parameters: ParamDraft[];
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    status: number | null;
    body: string | null;
    error: string | null;
    durationMs: number;
  } | null>(null);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`/api/ai/tools/${toolId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: values }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Test failed.");
        return;
      }
      setResult({
        ok: data.result.ok,
        status: data.result.status,
        body: data.result.body,
        error: data.result.error,
        durationMs: data.result.durationMs,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="grid gap-2 rounded-lg border border-border p-3">
      <Label>Test tool</Label>
      {parameters.filter((p) => p.name.trim()).length > 0 && (
        <div className="grid gap-1.5">
          {parameters
            .filter((p) => p.name.trim())
            .map((p) => (
              <div key={p.key} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate font-mono text-xs text-muted-foreground">
                  {p.name}
                </span>
                <Input
                  value={values[p.name] ?? ""}
                  onChange={(e) => setValues({ ...values, [p.name]: e.target.value })}
                  placeholder={p.type}
                  className="h-8 text-xs"
                />
              </div>
            ))}
        </div>
      )}
      <Button variant="outline" size="sm" onClick={run} disabled={running} className="w-fit">
        {running ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
        )}
        Run test
      </Button>
      {result && (
        <div
          className={`rounded-md border p-2 font-mono text-xs ${
            result.ok ? "border-emerald-500/30 text-emerald-600" : "border-red-500/30 text-red-500"
          }`}
        >
          <div>
            {result.status ?? "—"} · {result.durationMs}ms
          </div>
          <div className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-all text-foreground/80">
            {result.error ?? result.body ?? "(empty response)"}
          </div>
        </div>
      )}
    </div>
  );
}
