"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  Megaphone,
  PencilLine,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  TemplateEditor,
  emptyTemplateForm,
  type TemplateFormData,
} from "@/components/whatsapp/template-editor";
import { TemplateLibraryPicker } from "@/components/whatsapp/template-library-picker";
import type { LibraryFormData } from "@/lib/whatsapp/library-to-form";
import { cn } from "@/lib/utils";

type WizardStep = "category" | "library" | "edit";
type CategoryChoice = "Marketing" | "Utility";

const STEPS: { id: WizardStep; label: string; hint: string }[] = [
  { id: "category", label: "Category", hint: "What kind of message?" },
  { id: "library", label: "Template", hint: "Pick a starting point" },
  { id: "edit", label: "Edit & submit", hint: "Customize and send to Meta" },
];

export function TemplateCreateWizard() {
  const [step, setStep] = useState<WizardStep>("category");
  const [category, setCategory] = useState<CategoryChoice | null>(null);
  const [form, setForm] = useState<TemplateFormData>(emptyTemplateForm);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [editorKey, setEditorKey] = useState(0);

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  function goCategory(next: CategoryChoice) {
    setCategory(next);
    setForm((prev) => ({ ...prev, category: next }));
    setStep("library");
  }

  function openEditor(next: LibraryFormData, label?: string) {
    setForm({
      ...emptyTemplateForm,
      ...next,
      category: category ?? next.category,
      buttons: next.buttons ?? [],
      body_samples: next.body_samples ?? [],
    });
    setSourceLabel(label ?? null);
    setEditorKey((k) => k + 1);
    setStep("edit");
    if (label) toast.success(`Loaded “${label}”`);
  }

  function openBlank() {
    setForm({
      ...emptyTemplateForm,
      category: category ?? "Marketing",
    });
    setSourceLabel(null);
    setEditorKey((k) => k + 1);
    setStep("edit");
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link
            href="/whatsapp/templates"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back to templates
          </Link>
          <h1 className="text-2xl font-bold text-foreground">
            Create message template
          </h1>
          <p className="text-sm text-muted-foreground">
            Same flow as Meta WhatsApp Manager — pick a category, choose a
            template, customize with live preview, then submit for approval.
          </p>
        </div>
        {category && (
          <Badge
            variant="outline"
            className={cn(
              "text-xs",
              category === "Marketing"
                ? "border-purple-500/30 text-purple-600"
                : "border-blue-500/30 text-blue-600",
            )}
          >
            {category}
          </Badge>
        )}
      </div>

      {/* Stepper */}
      <ol className="grid gap-2 sm:grid-cols-3">
        {STEPS.map((s, i) => {
          const done = i < stepIndex;
          const active = i === stepIndex;
          return (
            <li
              key={s.id}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-3 py-2.5",
                active
                  ? "border-primary bg-primary/5"
                  : done
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-border bg-card",
              )}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  active
                    ? "bg-primary text-primary-foreground"
                    : done
                      ? "bg-emerald-600 text-white"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <div className="min-w-0">
                <p
                  className={cn(
                    "truncate text-sm font-medium",
                    active || done ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {s.label}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {s.hint}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Step bodies */}
      {step === "category" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Choose a category
            </h2>
            <p className="text-sm text-muted-foreground">
              Meta reviews templates by category. Pick the one that matches how
              you&apos;ll use the message.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <CategoryCard
              icon={Megaphone}
              title="Marketing"
              description="Promotions, offers, product launches, newsletters, and re-engagement."
              examples="Welcome offer · Seasonal promo · Coupon code"
              accent="purple"
              onClick={() => goCategory("Marketing")}
            />
            <CategoryCard
              icon={Wrench}
              title="Utility"
              description="Order updates, shipping, appointments, payments, and account alerts."
              examples="Order confirmation · Shipping update · Payment receipt"
              accent="blue"
              onClick={() => goCategory("Utility")}
            />
          </div>
          <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            <strong className="font-medium text-foreground">
              Authentication (OTP)
            </strong>{" "}
            templates use a fixed Meta shape. Create them in WhatsApp Manager,
            then use <em>Sync from Meta</em> on the templates list.
          </div>
        </div>
      )}

      {step === "library" && category && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setStep("category")}
              className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              ← Change category
            </button>
          </div>
          <TemplateLibraryPicker
            embedded
            category={category}
            onChoose={(picked, meta) => openEditor(picked, meta?.label)}
            onBlank={openBlank}
          />
        </div>
      )}

      {step === "edit" && (
        <TemplateEditor
          key={editorKey}
          variant="wizard"
          initialForm={form}
          sourceLabel={sourceLabel}
          onWizardBack={() => setStep("library")}
          wizardBackLabel="Back to template library"
        />
      )}

      {step === "category" && (
        <div className="flex justify-end">
          <Link
            href="/whatsapp/templates"
            className={cn(buttonVariants({ variant: "ghost" }), "text-muted-foreground")}
          >
            Cancel
          </Link>
        </div>
      )}
    </div>
  );
}

function CategoryCard({
  icon: Icon,
  title,
  description,
  examples,
  accent,
  onClick,
}: {
  icon: typeof Megaphone;
  title: string;
  description: string;
  examples: string;
  accent: "purple" | "blue";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col rounded-2xl border bg-card p-5 text-left transition-all hover:shadow-md",
        accent === "purple"
          ? "border-border hover:border-purple-400/50"
          : "border-border hover:border-blue-400/50",
      )}
    >
      <div
        className={cn(
          "mb-4 flex size-11 items-center justify-center rounded-xl",
          accent === "purple"
            ? "bg-purple-500/10 text-purple-600"
            : "bg-blue-500/10 text-blue-600",
        )}
      >
        <Icon className="size-5" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      <p className="mt-3 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground/70">Examples: </span>
        {examples}
      </p>
      <span
        className={cn(
          "mt-5 inline-flex items-center gap-1.5 text-sm font-medium",
          accent === "purple" ? "text-purple-600" : "text-blue-600",
        )}
      >
        <PencilLine className="size-3.5" />
        Continue with {title}
      </span>
    </button>
  );
}
