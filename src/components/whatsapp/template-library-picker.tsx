"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  FileText,
  LayoutTemplate,
  Loader2,
  PencilLine,
  Search,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TemplatePreview } from "@/components/whatsapp/template-preview";
import { cn } from "@/lib/utils";
import type { WhatsAppStarterTemplate } from "@/lib/whatsapp/starter-templates";
import {
  starterToForm,
  type LibraryFormData,
} from "@/lib/whatsapp/library-to-form";

interface TemplateLibraryPickerProps {
  onChoose: (form: LibraryFormData, meta?: { label: string; id: string }) => void;
  onBlank: () => void;
  /** Filter library by Meta category. */
  category?: "Marketing" | "Utility" | null;
  /** Hide page chrome when embedded in the create wizard. */
  embedded?: boolean;
}

export function TemplateLibraryPicker({
  onChoose,
  onBlank,
  category = null,
  embedded = false,
}: TemplateLibraryPickerProps) {
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [topic, setTopic] = useState("all");
  const [starters, setStarters] = useState<WhatsAppStarterTemplate[]>([]);
  const [metaTemplates, setMetaTemplates] = useState<WhatsAppStarterTemplate[]>(
    [],
  );
  const [topics, setTopics] = useState<Record<string, string>>({ all: "All" });
  const [metaAvailable, setMetaAvailable] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const params = new URLSearchParams();
        if (q.trim()) params.set("q", q.trim());
        if (topic !== "all") params.set("topic", topic);
        if (category) params.set("category", category);
        const res = await fetch(
          `/api/whatsapp/templates/library?${params.toString()}`,
          { credentials: "include" },
        );
        let json: Record<string, unknown> = {};
        try {
          json = await res.json();
        } catch {
          throw new Error(`Server returned an invalid response (HTTP ${res.status})`);
        }
        if (!res.ok) {
          throw new Error(
            typeof json.error === "string"
              ? json.error
              : "Failed to load template library",
          );
        }
        if (cancelled) return;
        const data = (json.data ?? {}) as {
          starters?: WhatsAppStarterTemplate[];
          meta_templates?: WhatsAppStarterTemplate[];
          topics?: Record<string, string>;
          meta_available?: boolean;
          meta_error?: string | null;
        };
        setStarters(data.starters ?? []);
        setMetaTemplates(data.meta_templates ?? []);
        const nextTopics = data.topics ?? { all: "All" };
        setTopics(nextTopics);
        setMetaAvailable(Boolean(data.meta_available));
        setMetaError(data.meta_error ?? null);
        setHoverId(null);
        // Reset topic chip if it isn't available for this category.
        setTopic((prev) => (prev !== "all" && !(prev in nextTopics) ? "all" : prev));
      } catch (err) {
        if (!cancelled) {
          const msg =
            err instanceof Error ? err.message : "Failed to load library";
          setLoadError(msg);
          setStarters([]);
          setMetaTemplates([]);
          toast.error(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, q ? 250 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, topic, category]);

  const previewItem = useMemo(() => {
    const all = [...starters, ...metaTemplates];
    return all.find((t) => t.id === hoverId) ?? all[0] ?? null;
  }, [hoverId, starters, metaTemplates]);

  function choose(item: WhatsAppStarterTemplate) {
    onChoose(starterToForm(item), {
      label: item.label,
      id: item.id,
    });
  }

  const topicKeys = Object.keys(topics);
  const showMetaSection = !category || category === "Utility";

  return (
    <div className="space-y-5">
      {!embedded && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-foreground">
              Choose a template
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Pick a default, preview it, then customize — like Meta WhatsApp
              Manager.
            </p>
          </div>
          <button
            type="button"
            onClick={onBlank}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "inline-flex gap-1.5",
            )}
          >
            <PencilLine className="size-4" />
            Start from scratch
          </button>
        </div>
      )}

      {embedded && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {category
                ? `Browse ${category} templates`
                : "Browse templates"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Select a ready-made template or start blank. Preview updates on
              the right.
            </p>
          </div>
          <button
            type="button"
            onClick={onBlank}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "inline-flex gap-1.5",
            )}
          >
            <PencilLine className="size-4" />
            Start from scratch
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or message…"
            className="border-border bg-muted pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {topicKeys.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTopic(key)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                topic === key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {topics[key]}
            </button>
          ))}
        </div>
      </div>

      {loadError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Could not load the library: {loadError}. You can still{" "}
          <button
            type="button"
            onClick={onBlank}
            className="font-medium underline underline-offset-2"
          >
            start from scratch
          </button>
          .
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <LayoutTemplate className="size-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                Recommended
              </h3>
              <Badge variant="outline" className="text-[10px]">
                {starters.length}
              </Badge>
            </div>

            {loading && starters.length === 0 ? (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading templates…
              </div>
            ) : starters.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No matching templates. Try another topic or start from scratch.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {starters.map((item) => (
                  <LibraryCard
                    key={item.id}
                    item={item}
                    active={previewItem?.id === item.id}
                    onHover={() => setHoverId(item.id)}
                    onChoose={() => choose(item)}
                  />
                ))}
              </div>
            )}
          </section>

          {showMetaSection && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles className="size-4 text-emerald-600" />
                <h3 className="text-sm font-semibold text-foreground">
                  Meta Template Library
                </h3>
                <Badge variant="outline" className="text-[10px]">
                  Utility
                </Badge>
                {metaTemplates.length > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    {metaTemplates.length}
                  </Badge>
                )}
              </div>

              {!metaAvailable ? (
                <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
                  Connect WhatsApp under{" "}
                  <Link
                    href="/whatsapp/config"
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    WhatsApp → Connection
                  </Link>{" "}
                  to load Meta&apos;s official Utility library.
                </div>
              ) : metaError ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  Could not load Meta library: {metaError}. Use recommended
                  templates above instead.
                </div>
              ) : loading && metaTemplates.length === 0 ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Fetching Meta templates…
                </div>
              ) : metaTemplates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No Meta library matches for this search.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {metaTemplates.map((item) => (
                    <LibraryCard
                      key={item.id}
                      item={item}
                      active={previewItem?.id === item.id}
                      onHover={() => setHoverId(item.id)}
                      onChoose={() => choose(item)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-4">
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            {previewItem ? (
              <>
                <div className="mb-3 space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    {previewItem.label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {previewItem.description}
                  </p>
                </div>
                <TemplatePreview model={previewItem.form} />
                <button
                  type="button"
                  onClick={() => choose(previewItem)}
                  className={cn(
                    buttonVariants(),
                    "mt-4 w-full bg-primary text-primary-foreground hover:bg-primary/90",
                  )}
                >
                  Use this template
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-sm text-muted-foreground">
                <FileText className="size-8 opacity-40" />
                Select a template to preview
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function LibraryCard({
  item,
  active,
  onHover,
  onChoose,
}: {
  item: WhatsAppStarterTemplate;
  active: boolean;
  onHover: () => void;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onChoose}
      className={cn(
        "flex flex-col rounded-xl border bg-card p-3.5 text-left transition-colors",
        active
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{item.label}</p>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 text-[10px]",
            item.form.category === "Marketing"
              ? "border-purple-500/30 text-purple-600"
              : "border-blue-500/30 text-blue-600",
          )}
        >
          {item.form.category}
        </Badge>
      </div>
      <p className="line-clamp-2 text-xs text-muted-foreground">
        {item.description}
      </p>
      <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-foreground/70">
        {item.form.body_text}
      </p>
      <div className="mt-3 flex items-center gap-1.5">
        {item.source === "meta" ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700">
            <Sparkles className="size-3" />
            Meta library
          </span>
        ) : (
          <span className="text-[10px] font-medium text-muted-foreground">
            VedMint default
          </span>
        )}
      </div>
    </button>
  );
}
