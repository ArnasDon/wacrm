"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Workflow,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  MessageSquare,
  PlayCircle,
  PauseCircle,
  Archive,
  HelpCircle,
  UserPlus,
  FileText,
} from "lucide-react";

import { useCan } from "@/hooks/use-can";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Flows list page.
 *
 * Open to every authenticated user. Flows is in soft-GA — the "Beta"
 * chip in the header is the only remaining signal that the surface
 * is new. The previous per-account beta gate was removed in PR #134.
 */

interface FlowRow {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "archived";
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: { keywords?: string[] } | Record<string, unknown>;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_LABELS: Record<FlowRow["status"], string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

const STATUS_COLORS: Record<FlowRow["status"], string> = {
  draft: "border-border bg-muted text-muted-foreground",
  active: "border-emerald-600/40 bg-emerald-500/10 text-emerald-300",
  archived: "border-border bg-muted/50 text-muted-foreground",
};

interface TemplateSummary {
  slug: string;
  name: string;
  description: string;
  icon: "MessageSquare" | "HelpCircle" | "UserPlus";
  trigger_type: string;
  node_count: number;
}

const TEMPLATE_ICONS = {
  MessageSquare,
  HelpCircle,
  UserPlus,
} as const;

export default function FlowsPage() {
  const router = useRouter();
  const canCreate = useCan("send-messages");
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [flowsRes, tmplRes] = await Promise.all([
          fetch("/api/flows"),
          fetch("/api/flows/templates"),
        ]);
        if (!flowsRes.ok) {
          throw new Error(`Failed to load flows: ${flowsRes.status}`);
        }
        const flowsJson = (await flowsRes.json()) as { flows: FlowRow[] };
        if (!cancelled) setFlows(flowsJson.flows ?? []);
        // Templates endpoint is forward-looking — if it 404s on an
        // older deployment, gracefully fall through.
        if (tmplRes.ok) {
          const tmplJson = (await tmplRes.json()) as {
            templates: TemplateSummary[];
          };
          if (!cancelled) setTemplates(tmplJson.templates ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          toast.error("Couldn't load flows.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          trigger_type: "keyword",
          trigger_config: { keywords: [] },
        }),
      });
      if (!res.ok) throw new Error(`Create failed: ${res.status}`);
      const json = (await res.json()) as { flow: FlowRow };
      setCreateOpen(false);
      setNewName("");
      router.push(`/flows/${json.flow.id}`);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't create flow.");
    } finally {
      setCreating(false);
    }
  }

  async function handleUseTemplate(slug: string) {
    setCreating(true);
    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_slug: slug }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `Clone failed: ${res.status}`);
      }
      const json = (await res.json()) as { flow: FlowRow };
      setCreateOpen(false);
      router.push(`/flows/${json.flow.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Clone failed";
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(flow: FlowRow) {
    const yes = window.confirm(
      `Delete "${flow.name}"? Any active runs will end immediately.`,
    );
    if (!yes) return;
    try {
      const res = await fetch(`/api/flows/${flow.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setFlows((prev) => prev.filter((f) => f.id !== flow.id));
      toast.success("Flow deleted.");
    } catch (err) {
      console.error(err);
      toast.error("Couldn't delete flow.");
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-foreground">Flows</h1>
            <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
              Beta
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Build branching, button-driven WhatsApp conversations. Useful for
            menus, FAQs, and triage before a human steps in.
          </p>
        </div>
        <GatedButton
          canAct={canCreate}
          gateReason="create flows"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" />
          New flow
        </GatedButton>
      </header>

      {flows.length === 0 ? (
        <EmptyState
          onCreate={() => setCreateOpen(true)}
          canCreate={canCreate}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {flows.map((flow) => (
            <FlowCard
              key={flow.id}
              flow={flow}
              onEdit={() => router.push(`/flows/${flow.id}`)}
              onDelete={() => handleDelete(flow)}
            />
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        {/* `sm:max-w-4xl` not `max-w-4xl` — shadcn's DialogContent has
            `sm:max-w-sm` baked into its default classes. Without the
            sm: prefix our override applies at base only and the
            sm-scoped 384px wins at every real desktop breakpoint. */}
        <DialogContent className="sm:max-w-4xl bg-popover text-popover-foreground">
          <DialogHeader>
            <DialogTitle>Create a new flow</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Start from a template or build from scratch.
            </DialogDescription>
          </DialogHeader>

          {templates.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Start from a template
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {templates.map((t) => {
                  const Icon = TEMPLATE_ICONS[t.icon] ?? FileText;
                  return (
                    <button
                      key={t.slug}
                      type="button"
                      onClick={() => handleUseTemplate(t.slug)}
                      disabled={creating}
                      className="flex flex-col gap-2.5 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted disabled:opacity-50"
                    >
                      <Icon className="h-5 w-5 text-primary" />
                      <span className="text-sm font-semibold text-popover-foreground">
                        {t.name}
                      </span>
                      <span className="text-xs leading-relaxed text-muted-foreground">
                        {t.description}
                      </span>
                      <span className="mt-auto border-t border-border pt-2 text-[11px] text-muted-foreground">
                        <span>{t.node_count} {t.node_count === 1 ? "node" : "nodes"}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Or start blank
            </p>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Welcome menu"
              className="bg-muted"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating}>
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              Create blank flow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({
  onCreate,
  canCreate,
}: {
  onCreate: () => void;
  canCreate: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Workflow className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="mt-4 text-base font-medium text-foreground">
        No flows yet
      </h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Build your first conversation — a welcome menu, an order lookup, an FAQ
        bot. Customers tap buttons; the bot routes them to the right answer (or
        the right agent).
      </p>
      <GatedButton
        canAct={canCreate}
        gateReason="create flows"
        onClick={onCreate}
        className="mt-5"
      >
        <Plus className="h-4 w-4" />
        Create your first flow
      </GatedButton>
    </div>
  );
}

function FlowCard({
  flow,
  onEdit,
  onDelete,
}: {
  flow: FlowRow;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const triggerSummary = describeTrigger(flow);
  const StatusIcon =
    flow.status === "active"
      ? PlayCircle
      : flow.status === "archived"
        ? Archive
        : PauseCircle;
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-border">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Workflow className="h-4 w-4 shrink-0 text-primary" />
          <h3 className="truncate text-sm font-semibold text-foreground">
            {flow.name}
          </h3>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 gap-1 text-[10px]",
            STATUS_COLORS[flow.status],
          )}
        >
          <StatusIcon className="h-3 w-3" />
          {STATUS_LABELS[flow.status]}
        </Badge>
      </div>

      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {flow.description || triggerSummary}
      </p>

      <div className="mt-4 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-3 w-3" />
          <span>{flow.execution_count} {flow.execution_count === 1 ? "run" : "runs"}</span>
        </span>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>
    </div>
  );
}

function describeTrigger(flow: FlowRow): string {
  if (flow.trigger_type === "keyword") {
    const keywords = Array.isArray(flow.trigger_config.keywords)
      ? (flow.trigger_config.keywords as string[])
      : [];
    if (keywords.length === 0) return "Triggers on keyword (none set)";
    return `Triggers on: ${keywords.join(", ")}`;
  }
  if (flow.trigger_type === "first_inbound_message") {
    return "Triggers on a contact's first-ever inbound message";
  }
  return "Manual trigger";
}
