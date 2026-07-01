"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MessageTemplate } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Phone,
  User,
  LayoutTemplate,
  ChevronRight,
  ArrowLeft,
  Loader2,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NewChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the newly created (or existing) conversation id so the
   *  parent can open it in the thread pane immediately. */
  onConversationStarted: (conversationId: string) => void;
}

type Step = "contact" | "template" | "params";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Render a template body preview, filling in params where available. */
function renderBodyPreview(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw: string) => {
    const idx = Number(raw) - 1;
    const val = params[idx];
    return val && val.trim().length > 0 ? val : `{{${raw}}}`;
  });
}

/** Extract 1-based variable indices like {{1}}, {{2}} … from a template string. */
function extractVarIndices(text: string): number[] {
  const indices: number[] = [];
  const re = /\{\{(\d+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    if (!indices.includes(n)) indices.push(n);
  }
  return indices.sort((a, b) => a - b);
}

// ─── Component ───────────────────────────────────────────────────────────────

export function NewChatDialog({
  open,
  onOpenChange,
  onConversationStarted,
}: NewChatDialogProps) {
  // ── Step 1: Contact info ──
  const [phone, setPhone] = useState("");
  const [contactName, setContactName] = useState("");

  // ── Step 2: Template selection ──
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const [selectedTemplate, setSelectedTemplate] =
    useState<MessageTemplate | null>(null);

  // ── Step 3: Template variable params ──
  const [bodyParams, setBodyParams] = useState<string[]>([]);
  const [headerText, setHeaderText] = useState("");

  // ── Global ──
  const [step, setStep] = useState<Step>("contact");
  const [sending, setSending] = useState(false);

  // Reset all state when the dialog opens/closes
  useEffect(() => {
    if (!open) return;
    setPhone("");
    setContactName("");
    setTemplateSearch("");
    setSelectedTemplate(null);
    setBodyParams([]);
    setHeaderText("");
    setStep("contact");
  }, [open]);

  // Fetch approved templates when we reach the template step
  useEffect(() => {
    if (step !== "template") return;
    let cancelled = false;
    setTemplatesLoading(true);
    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase
        .from("message_templates")
        .select("*")
        .eq("status", "APPROVED")
        .order("name", { ascending: true });
      if (cancelled) return;
      if (error) {
        toast.error("Failed to load templates");
      } else {
        setTemplates(data ?? []);
      }
      setTemplatesLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [step]);

  // ── Navigation ─────────────────────────────────────────────────────────────

  const handleContactNext = useCallback(() => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7) {
      toast.error("Please enter a valid phone number.");
      return;
    }
    setStep("template");
  }, [phone]);

  const handleTemplateSelect = useCallback((t: MessageTemplate) => {
    setSelectedTemplate(t);
    // Initialise body params array from the template body variable count
    const indices = extractVarIndices(t.body_text ?? "");
    const maxIdx = indices.length > 0 ? Math.max(...indices) : 0;
    setBodyParams(Array(maxIdx).fill(""));
    // Initialise header text
    setHeaderText(
      t.header_type === "text" && t.header_content ? t.header_content : "",
    );
    const needsParams =
      indices.length > 0 ||
      (t.header_type === "text" &&
        extractVarIndices(t.header_content ?? "").length > 0);
    setStep(needsParams ? "params" : "template");
    if (!needsParams) {
      // No params needed — keep the template selected but stay on the
      // template step so the user can see the final preview before sending.
    }
  }, []);

  const handleBack = useCallback(() => {
    if (step === "template") setStep("contact");
    else if (step === "params") setStep("template");
  }, [step]);

  // ── Send ───────────────────────────────────────────────────────────────────

  const handleSend = useCallback(async () => {
    if (!selectedTemplate) return;
    setSending(true);
    try {
      const bodyIndices = extractVarIndices(selectedTemplate.body_text ?? "");
      const hasBodyVars = bodyIndices.length > 0;
      const hasHeaderVar =
        selectedTemplate.header_type === "text" &&
        extractVarIndices(selectedTemplate.header_content ?? "").length > 0;

      const needsParams = hasBodyVars || hasHeaderVar;
      if (needsParams && step !== "params") {
        // Should not happen, but guard anyway
        setStep("params");
        setSending(false);
        return;
      }

      // Build template_message_params in the structured format the send
      // route / template-send-builder understand.
      const messageParams: Record<string, unknown> = {};

      if (hasBodyVars) {
        messageParams.body = bodyParams.map((v) => ({ type: "text", text: v }));
      }

      if (hasHeaderVar) {
        messageParams.header = [{ type: "text", text: headerText }];
      }

      const res = await fetch("/api/conversations/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phone.trim(),
          contact_name: contactName.trim() || undefined,
          template_name: selectedTemplate.name,
          template_language: selectedTemplate.language || "en_US",
          template_message_params:
            Object.keys(messageParams).length > 0 ? messageParams : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data?.error ?? "Failed to start conversation.");
        return;
      }

      toast.success("Conversation started!");
      onOpenChange(false);
      onConversationStarted(data.conversation_id);
    } catch (err) {
      console.error("[NewChatDialog] send error:", err);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  }, [
    selectedTemplate,
    step,
    phone,
    contactName,
    bodyParams,
    headerText,
    onOpenChange,
    onConversationStarted,
  ]);

  // ── Filtered templates ─────────────────────────────────────────────────────

  const filteredTemplates =
    templateSearch.trim().length === 0
      ? templates
      : templates.filter(
          (t) =>
            t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
            t.body_text?.toLowerCase().includes(templateSearch.toLowerCase()),
        );

  // ── Render ─────────────────────────────────────────────────────────────────

  // Body var indices for the params step
  const bodyVarIndices = selectedTemplate
    ? extractVarIndices(selectedTemplate.body_text ?? "")
    : [];
  const headerVarIndices =
    selectedTemplate?.header_type === "text"
      ? extractVarIndices(selectedTemplate.header_content ?? "")
      : [];

  const previewText = selectedTemplate
    ? renderBodyPreview(selectedTemplate.body_text ?? "", bodyParams)
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden border-border bg-card p-0 sm:max-w-lg">
        {/* ── Header ── */}
        <DialogHeader className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            {step !== "contact" && (
              <button
                onClick={handleBack}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Go back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div>
              <DialogTitle className="text-sm font-semibold text-foreground">
                {step === "contact" && "New Chat"}
                {step === "template" && "Choose a Template"}
                {step === "params" && "Fill in Template Variables"}
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-muted-foreground">
                {step === "contact" &&
                  "Enter a phone number to start a conversation."}
                {step === "template" &&
                  "WhatsApp requires an approved template to initiate a conversation."}
                {step === "params" &&
                  "These values will be inserted into the template before sending."}
              </DialogDescription>
            </div>
          </div>

          {/* Progress pills */}
          <div className="mt-3 flex gap-1.5">
            {(["contact", "template", "params"] as Step[]).map((s, i) => (
              <div
                key={s}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors duration-300",
                  step === "contact" && i === 0
                    ? "bg-primary"
                    : step === "template" && i <= 1
                      ? "bg-primary"
                      : step === "params" && i <= 2
                        ? "bg-primary"
                        : "bg-muted",
                )}
              />
            ))}
          </div>
        </DialogHeader>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto">
          {/* STEP 1 — Contact */}
          {step === "contact" && (
            <div className="space-y-4 px-5 py-5">
              <div className="space-y-1.5">
                <Label
                  htmlFor="nc-phone"
                  className="text-xs font-medium text-foreground"
                >
                  Phone Number{" "}
                  <span className="text-destructive" aria-hidden>
                    *
                  </span>
                </Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="nc-phone"
                    type="tel"
                    placeholder="+1 555 000 1234"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleContactNext()}
                    className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
                    autoFocus
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Include the country code, e.g. +971 for UAE.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="nc-name"
                  className="text-xs font-medium text-foreground"
                >
                  Contact Name{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="nc-name"
                    type="text"
                    placeholder="e.g. Ahmed Ali"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleContactNext()}
                    className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
                  />
                </div>
              </div>

              {/* Info box */}
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                <div className="flex items-start gap-2">
                  <LayoutTemplate className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <p className="text-xs leading-relaxed text-amber-300/90">
                    WhatsApp only allows businesses to initiate a chat using an
                    approved message template. You will pick one in the next
                    step.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2 — Template picker */}
          {step === "template" && (
            <div className="flex flex-col">
              {/* Search */}
              <div className="border-b border-border px-4 py-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Search templates…"
                    value={templateSearch}
                    onChange={(e) => setTemplateSearch(e.target.value)}
                    className="border-border bg-muted pl-9 text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
                    autoFocus
                  />
                </div>
              </div>

              {/* List */}
              <div className="max-h-[340px] overflow-y-auto">
                {templatesLoading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredTemplates.length === 0 ? (
                  <div className="px-5 py-10 text-center">
                    <LayoutTemplate className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">
                      {templates.length === 0
                        ? "No approved templates found. Go to Settings → Templates to create one."
                        : "No templates match your search."}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {filteredTemplates.map((t) => (
                      <TemplateRow
                        key={t.id}
                        template={t}
                        isSelected={selectedTemplate?.id === t.id}
                        onClick={() => handleTemplateSelect(t)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 3 — Params */}
          {step === "params" && selectedTemplate && (
            <div className="space-y-5 px-5 py-5">
              {/* Preview */}
              <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Preview
                </p>
                {headerVarIndices.length > 0 && headerText && (
                  <p className="mb-1 text-xs font-semibold text-foreground">
                    {headerText}
                  </p>
                )}
                {selectedTemplate.header_type === "text" &&
                  selectedTemplate.header_content &&
                  headerVarIndices.length === 0 && (
                    <p className="mb-1 text-xs font-semibold text-foreground">
                      {selectedTemplate.header_content}
                    </p>
                  )}
                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {previewText}
                </p>
                {selectedTemplate.footer_text && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {selectedTemplate.footer_text}
                  </p>
                )}
              </div>

              {/* Header variable */}
              {headerVarIndices.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-foreground">
                    Header Text
                  </Label>
                  <Input
                    value={headerText}
                    onChange={(e) => setHeaderText(e.target.value)}
                    placeholder="Enter header text"
                    className="border-border bg-muted text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
                  />
                </div>
              )}

              {/* Body variables */}
              {bodyVarIndices.map((idx) => (
                <div key={idx} className="space-y-1.5">
                  <Label className="text-xs font-medium text-foreground">
                    Variable{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-[11px] text-primary">
                      {`{{${idx}}}`}
                    </code>
                  </Label>
                  <Input
                    value={bodyParams[idx - 1] ?? ""}
                    onChange={(e) => {
                      const next = [...bodyParams];
                      next[idx - 1] = e.target.value;
                      setBodyParams(next);
                    }}
                    placeholder={`Value for {{${idx}}}`}
                    className="border-border bg-muted text-sm text-foreground placeholder-muted-foreground focus:border-primary/50"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <DialogFooter className="border-t border-border px-5 py-4">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground"
            disabled={sending}
          >
            Cancel
          </Button>

          {step === "contact" && (
            <Button
              onClick={handleContactNext}
              className="gap-1.5"
              disabled={phone.replace(/\D/g, "").length < 7}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}

          {step === "template" && selectedTemplate && (
            <Button onClick={handleSend} disabled={sending} className="gap-1.5">
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Send Message
            </Button>
          )}

          {step === "params" && selectedTemplate && (
            <Button onClick={handleSend} disabled={sending} className="gap-1.5">
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Send Message
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── TemplateRow ─────────────────────────────────────────────────────────────

interface TemplateRowProps {
  template: MessageTemplate;
  isSelected: boolean;
  onClick: () => void;
}

function TemplateRow({ template, isSelected, onClick }: TemplateRowProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/50",
        isSelected && "border-l-2 border-primary bg-muted/70",
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          isSelected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        <LayoutTemplate className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {template.name}
          </span>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {template.language ?? "en_US"}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
          {template.body_text}
        </p>
      </div>

      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
