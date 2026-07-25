"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  ArrowLeft,
  ImageIcon,
  Link2,
  Loader2,
  Plus,
  Upload,
  X,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TemplatePreview,
  type TemplatePreviewHeaderFormat,
} from "@/components/whatsapp/template-preview";
import type {
  MessageTemplate,
  TemplateButton,
  TemplateSampleValues,
} from "@/types";
import {
  collectTemplateValidationIssues,
  extractVariableIndices,
  normalizeTemplateButtons,
  sanitizeTemplateName,
  TEMPLATE_LIMITS,
  validateTemplatePayload,
} from "@/lib/whatsapp/template-validators";

const CREATE_CATEGORIES = ["Marketing", "Utility"] as const;
type HeaderFormat = TemplatePreviewHeaderFormat;
const HEADER_FORMATS: HeaderFormat[] = [
  "none",
  "text",
  "image",
  "video",
  "document",
];

const TEMPLATE_MEDIA_BUCKET = "flow-media";
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const MEDIA_MAX_BYTES = 16 * 1024 * 1024;

const MEDIA_ACCEPT: Record<"image" | "video" | "document", string> = {
  image: "image/jpeg,image/png,image/jpg",
  video: "video/mp4,video/3gpp",
  document: "application/pdf",
};

const COMMON_LANGUAGE_CODES = [
  "en_US",
  "en_GB",
  "en",
  "es",
  "es_ES",
  "es_MX",
  "fr",
  "fr_FR",
  "de",
  "it",
  "pt_BR",
  "pt_PT",
  "nl",
  "pl",
  "ru",
  "tr",
  "lt",
];

export interface TemplateFormData {
  name: string;
  category: MessageTemplate["category"];
  language: string;
  header_format: HeaderFormat;
  header_content: string;
  header_media_url: string;
  header_handle: string;
  header_sample: string;
  body_text: string;
  body_samples: string[];
  footer_text: string;
  buttons: TemplateButton[];
}

export const emptyTemplateForm: TemplateFormData = {
  name: "",
  category: "Marketing",
  language: "en_US",
  header_format: "none",
  header_content: "",
  header_media_url: "",
  header_handle: "",
  header_sample: "",
  body_text: "",
  body_samples: [],
  footer_text: "",
  buttons: [],
};

function emptyButton(type: TemplateButton["type"]): TemplateButton {
  switch (type) {
    case "QUICK_REPLY":
      return { type: "QUICK_REPLY", text: "" };
    case "URL":
      return { type: "URL", text: "", url: "" };
    case "PHONE_NUMBER":
      return { type: "PHONE_NUMBER", text: "", phone_number: "" };
    case "COPY_CODE":
      return { type: "COPY_CODE", text: "", example: "" };
  }
}

export function formFromTemplate(template: MessageTemplate): TemplateFormData {
  return {
    name: template.name,
    category: template.category,
    language: template.language || "en_US",
    header_format: (template.header_type ?? "none") as HeaderFormat,
    header_content: template.header_content ?? "",
    header_media_url: template.header_media_url ?? "",
    header_handle: template.header_handle ?? "",
    header_sample: template.sample_values?.header?.[0] ?? "",
    body_text: template.body_text,
    body_samples: template.sample_values?.body ?? [],
    footer_text: template.footer_text ?? "",
    buttons: template.buttons ?? [],
  };
}

interface TemplateEditorProps {
  /** Existing template id when editing / resubmitting. */
  templateId?: string | null;
  initialForm?: TemplateFormData;
  /** Wizard/create chrome — hides standalone page header links. */
  variant?: "page" | "wizard";
  onWizardBack?: () => void;
  wizardBackLabel?: string;
  /** Optional source label shown under the title (e.g. library pick). */
  sourceLabel?: string | null;
}

export function TemplateEditor({
  templateId = null,
  initialForm = emptyTemplateForm,
  variant = "page",
  onWizardBack,
  wizardBackLabel = "Back",
  sourceLabel = null,
}: TemplateEditorProps) {
  const router = useRouter();
  const supabase = createClient();
  const { user, accountId, profileLoading } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadFormatRef = useRef<HeaderFormat | null>(null);
  const isEdit = Boolean(templateId);
  const isWizard = variant === "wizard";

  const [form, setForm] = useState<TemplateFormData>(() => ({
    ...initialForm,
    buttons: normalizeTemplateButtons(initialForm.buttons),
  }));
  const [submitting, setSubmitting] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaSourceTab, setMediaSourceTab] = useState<"upload" | "link">(
    initialForm.header_media_url ? "link" : "upload",
  );

  const bodyVarCount = useMemo(
    () => extractVariableIndices(form.body_text).length,
    [form.body_text],
  );
  const headerVarCount = useMemo(
    () =>
      form.header_format === "text"
        ? extractVariableIndices(form.header_content).length
        : 0,
    [form.header_format, form.header_content],
  );

  useEffect(() => {
    setForm((prev) => {
      if (prev.body_samples.length === bodyVarCount) return prev;
      const next = prev.body_samples.slice(0, bodyVarCount);
      while (next.length < bodyVarCount) next.push("");
      return { ...prev, body_samples: next };
    });
  }, [bodyVarCount]);

  const headerNeedsMedia =
    form.header_format !== "none" && form.header_format !== "text";

  function buildSubmitPayload() {
    const sample_values: TemplateSampleValues = {};
    if (bodyVarCount > 0) {
      sample_values.body = form.body_samples.map((v) => v.trim());
    }
    if (form.header_format === "text" && headerVarCount > 0) {
      sample_values.header = [form.header_sample.trim()];
    }

    const buttons = normalizeTemplateButtons(form.buttons);

    const safeName = sanitizeTemplateName(form.name.trim()).replace(
      /^_+|_+$/g,
      "",
    );
    return {
      name: safeName,
      category: form.category,
      language: form.language.trim() || "en_US",
      header_type:
        form.header_format === "none" ? undefined : form.header_format,
      header_content:
        form.header_format === "text" ? form.header_content.trim() : undefined,
      header_media_url:
        form.header_format !== "none" && form.header_format !== "text"
          ? form.header_media_url.trim() || undefined
          : undefined,
      header_handle:
        form.header_format !== "none" && form.header_format !== "text"
          ? form.header_handle.trim() || undefined
          : undefined,
      body_text: form.body_text.trim(),
      footer_text: form.footer_text.trim() || undefined,
      buttons: buttons.length > 0 ? buttons : undefined,
      sample_values:
        Object.keys(sample_values).length > 0 ? sample_values : undefined,
    };
  }

  async function handleHeaderMediaUpload(file: File) {
    const format = form.header_format;
    if (format !== "image" && format !== "video" && format !== "document") {
      return;
    }
    if (profileLoading || !accountId) {
      toast.error("Still loading your account — try again in a moment.");
      return;
    }

    const maxBytes = format === "image" ? IMAGE_MAX_BYTES : MEDIA_MAX_BYTES;
    const maxLabel = format === "image" ? "2 MB" : "16 MB";
    if (file.size > maxBytes) {
      toast.error(
        `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — limit is ${maxLabel}.`,
      );
      return;
    }

    const acceptList = MEDIA_ACCEPT[format].split(",");
    const mimeOk =
      acceptList.includes(file.type) ||
      (format === "image" &&
        (file.type === "image/jpeg" ||
          file.type === "image/jpg" ||
          file.type === "image/png"));
    if (!mimeOk) {
      toast.error(
        format === "image"
          ? "Images must be JPEG or PNG."
          : format === "video"
            ? "Videos must be MP4 or 3GPP."
            : "Documents must be PDF.",
      );
      return;
    }

    uploadFormatRef.current = format;
    setUploadingMedia(true);
    try {
      if (!user) throw new Error("Not signed in.");

      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const safeBase =
        file.name
          .replace(/\.[^.]+$/, "")
          .replace(/[^a-zA-Z0-9_-]+/g, "_")
          .slice(0, 40) || "template-header";
      const path = `account-${accountId}/templates/${Date.now()}-${safeBase}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(TEMPLATE_MEDIA_BUCKET)
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });
      if (upErr) {
        throw new Error(
          upErr.message.includes("Bucket") || upErr.message.includes("not found")
            ? "Media storage is not available. Paste a public HTTPS image link instead."
            : upErr.message,
        );
      }

      const publicUrl = supabase.storage
        .from(TEMPLATE_MEDIA_BUCKET)
        .getPublicUrl(path).data.publicUrl;

      // Ignore result if the user switched header type mid-upload.
      if (uploadFormatRef.current !== format) return;

      setForm((prev) => {
        if (prev.header_format !== format) return prev;
        return {
          ...prev,
          header_media_url: publicUrl,
          header_handle: "",
        };
      });
      toast.success("Header media uploaded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploadingMedia(false);
      uploadFormatRef.current = null;
    }
  }

  async function handleSubmit() {
    if (form.category === "Authentication") {
      toast.error(
        "Authentication templates must be created in Meta WhatsApp Manager, then synced.",
      );
      return;
    }

    const payload = buildSubmitPayload();
    try {
      validateTemplatePayload(payload);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Validation failed");
      return;
    }

    try {
      setSubmitting(true);
      const url = isEdit
        ? `/api/whatsapp/templates/${templateId}`
        : "/api/whatsapp/templates/submit";
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let data: Record<string, unknown> = {};
      try {
        data = await res.json();
      } catch {
        throw new Error(
          `Server returned an invalid response (HTTP ${res.status})`,
        );
      }
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : String(
                data?.error ||
                  `${isEdit ? "Edit" : "Submit"} failed (HTTP ${res.status})`,
              ),
        );
      }
      toast.success(
        data.dry_run
          ? isEdit
            ? "Template updated (dry-run — no Meta call)"
            : "Template saved (dry-run — no Meta call)"
          : isEdit
            ? "Edit submitted — Meta typically reviews within 24 hours."
            : "Submitted to Meta — typical review time is 24 hours. Status updates automatically.",
      );
      router.push("/whatsapp/templates");
      router.refresh();
    } catch (err) {
      console.error("Submit error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  type ButtonPatch = {
    text?: string;
    url?: string;
    phone_number?: string;
    example?: string;
  };

  function updateButton(index: number, patch: ButtonPatch) {
    setForm((prev) => {
      const current = prev.buttons[index];
      if (!current) return prev;
      const next = [...prev.buttons];
      switch (current.type) {
        case "QUICK_REPLY":
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
          };
          break;
        case "URL":
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.url !== undefined && { url: patch.url }),
            ...(patch.example !== undefined && { example: patch.example }),
          };
          break;
        case "PHONE_NUMBER":
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.phone_number !== undefined && {
              phone_number: patch.phone_number,
            }),
          };
          break;
        case "COPY_CODE":
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.example !== undefined && { example: patch.example }),
          };
          break;
      }
      return { ...prev, buttons: next };
    });
  }

  function changeButtonType(index: number, type: TemplateButton["type"]) {
    setForm((prev) => {
      const next = [...prev.buttons];
      next[index] = emptyButton(type);
      return { ...prev, buttons: normalizeTemplateButtons(next) };
    });
  }

  function removeButton(index: number) {
    setForm((prev) => ({
      ...prev,
      buttons: prev.buttons.filter((_, i) => i !== index),
    }));
  }

  function addButton() {
    if (form.buttons.length >= TEMPLATE_LIMITS.maxButtonsTotal) return;
    setForm((prev) => ({
      ...prev,
      buttons: normalizeTemplateButtons([
        ...prev.buttons,
        emptyButton("QUICK_REPLY"),
      ]),
    }));
  }

  const validationIssues = useMemo(
    () => collectTemplateValidationIssues(buildSubmitPayload()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, bodyVarCount, headerVarCount],
  );

  const checklist = useMemo(() => {
    const issueText = validationIssues.join(" ").toLowerCase();
    const has = (re: RegExp) => validationIssues.some((m) => re.test(m));
    return [
      {
        id: "name",
        label: "Valid template name",
        ok: !has(/template name|lowercase/i),
      },
      {
        id: "body",
        label: "Body text & variables",
        ok: !has(/body/i),
      },
      {
        id: "samples",
        label: "Sample values for variables",
        ok: !has(/sample/i),
      },
      {
        id: "header",
        label: "Header configured",
        ok: !has(/header/i),
      },
      {
        id: "buttons",
        label: "Buttons valid (if any)",
        ok: !has(/button/i),
      },
      {
        id: "other",
        label: "Language, footer & category",
        ok: !has(/language|footer|category/i) && !issueText.includes("https"),
      },
    ];
  }, [validationIssues]);

  const checklistReady = validationIssues.length === 0;
  const canSubmit =
    checklistReady &&
    !submitting &&
    !uploadingMedia &&
    form.category !== "Authentication";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          {isWizard && onWizardBack ? (
            <button
              type="button"
              onClick={onWizardBack}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              {wizardBackLabel}
            </button>
          ) : (
            <Link
              href="/whatsapp/templates"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              Back to templates
            </Link>
          )}
          <h1 className="text-2xl font-bold text-foreground">
            {isEdit
              ? "Edit template"
              : isWizard
                ? "Customize & submit"
                : "Create template"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isEdit
              ? "Save changes to resubmit to Meta. Status will return to PENDING during review."
              : sourceLabel
                ? `Based on “${sourceLabel}”. Edit anything — preview updates live.`
                : "Build your template on the left — the phone preview updates live like Meta WhatsApp Manager."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isWizard && (
            <Link
              href="/whatsapp/templates"
              className={cn(
                buttonVariants({ variant: "outline" }),
                "border-border",
              )}
            >
              Cancel
            </Link>
          )}
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {isEdit ? "Saving…" : "Submitting…"}
              </>
            ) : isEdit ? (
              "Save & Resubmit"
            ) : (
              "Submit to Meta for approval"
            )}
          </Button>
        </div>
      </div>

      {form.category === "Authentication" && (
        <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>
            AUTHENTICATION templates have a fixed OTP shape. Manage them in Meta
            WhatsApp Manager and use <strong>Sync from Meta</strong> — VedMint
            does not resubmit this category.
          </p>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Form column */}
        <div className="space-y-5 rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="space-y-2">
            <Label className="text-foreground/80">Template Name</Label>
            <Input
              placeholder="e.g. order_confirmation"
              value={form.name}
              onChange={(e) =>
                setForm({
                  ...form,
                  name: isEdit
                    ? e.target.value
                    : sanitizeTemplateName(e.target.value),
                })
              }
              disabled={isEdit}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p className="text-[11px] text-muted-foreground">
              {isEdit
                ? "Name is fixed once a template exists on Meta — create a new template to change it."
                : "Auto-formatted to lowercase letters, digits, and underscores."}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-foreground/80">Category</Label>
              <Select
                value={form.category}
                disabled={form.category === "Authentication"}
                onValueChange={(val) => {
                  if (!val || val === "Authentication") return;
                  setForm({
                    ...form,
                    category: val as MessageTemplate["category"],
                  });
                }}
              >
                <SelectTrigger className="w-full border-border bg-muted text-foreground disabled:opacity-60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-border bg-muted">
                  {(form.category === "Authentication"
                    ? (["Authentication"] as const)
                    : CREATE_CATEGORIES
                  ).map((cat) => (
                    <SelectItem
                      key={cat}
                      value={cat}
                      className="text-foreground focus:bg-muted focus:text-foreground"
                    >
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-foreground/80">Language</Label>
              <Input
                list="template-language-codes"
                placeholder="en_US"
                value={form.language}
                onChange={(e) =>
                  setForm({ ...form, language: e.target.value })
                }
                disabled={isEdit}
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
              />
              <datalist id="template-language-codes">
                {COMMON_LANGUAGE_CODES.map((code) => (
                  <option key={code} value={code} />
                ))}
              </datalist>
              <p className="text-[11px] text-muted-foreground">
                {isEdit ? (
                  "Language is fixed once a template exists on Meta."
                ) : (
                  <>
                    Must match the exact code on Meta — <code>en_US</code> and{" "}
                    <code>en</code> are distinct.
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-foreground/80">Header</Label>
            <Select
              value={form.header_format}
              onValueChange={(val) => {
                const next = (val || "none") as HeaderFormat;
                const wasMedia =
                  form.header_format !== "none" &&
                  form.header_format !== "text";
                const willMedia = next !== "none" && next !== "text";
                setForm({
                  ...form,
                  header_format: next,
                  // Clear media when leaving media headers or switching type.
                  ...(wasMedia && (!willMedia || next !== form.header_format)
                    ? { header_media_url: "", header_handle: "" }
                    : {}),
                });
              }}
            >
              <SelectTrigger className="w-full border-border bg-muted text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-border bg-muted">
                {HEADER_FORMATS.map((type) => (
                  <SelectItem
                    key={type}
                    value={type}
                    className="text-foreground focus:bg-muted focus:text-foreground"
                  >
                    {type === "none"
                      ? "None"
                      : type.charAt(0).toUpperCase() + type.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {form.header_format === "text" && (
              <div className="mt-2 space-y-2">
                <Input
                  aria-label="Header text"
                  placeholder="Header text (max 60 chars, optional {{1}})"
                  value={form.header_content}
                  onChange={(e) =>
                    setForm({ ...form, header_content: e.target.value })
                  }
                  maxLength={TEMPLATE_LIMITS.headerTextMaxLength}
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                />
                {headerVarCount > 0 && (
                  <Input
                    aria-label="Sample value for header variable"
                    placeholder="Sample value for {{1}} (required for Meta review)"
                    value={form.header_sample}
                    onChange={(e) =>
                      setForm({ ...form, header_sample: e.target.value })
                    }
                    className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                  />
                )}
              </div>
            )}

            {headerNeedsMedia && (
              <div className="mt-2 space-y-3">
                <Label className="text-sm text-foreground/80">
                  Header media (required)
                </Label>
                <Tabs
                  value={mediaSourceTab}
                  onValueChange={(v) => {
                    if (v === "upload" || v === "link") setMediaSourceTab(v);
                  }}
                  className="gap-3"
                >
                  <TabsList className="bg-muted">
                    <TabsTrigger
                      value="upload"
                      className="gap-1.5 data-active:bg-background"
                    >
                      <Upload className="size-3.5" />
                      Upload
                    </TabsTrigger>
                    <TabsTrigger
                      value="link"
                      className="gap-1.5 data-active:bg-background"
                    >
                      <Link2 className="size-3.5" />
                      Media link
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="upload" className="space-y-2">
                    {form.header_media_url.trim() ? (
                      <div className="space-y-2 rounded-md border border-border bg-muted/50 p-3">
                        {form.header_format === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={form.header_media_url}
                            alt="Header"
                            className="max-h-40 w-full rounded object-contain bg-background"
                          />
                        ) : (
                          <div className="flex items-center gap-2 text-xs text-foreground">
                            <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
                            <a
                              href={form.header_media_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="min-w-0 truncate underline-offset-2 hover:underline"
                            >
                              {form.header_media_url}
                            </a>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={
                                uploadingMedia || profileLoading || !accountId
                              }
                              onClick={() => fileInputRef.current?.click()}
                              className="h-8 border-border bg-transparent text-xs"
                            >
                            {uploadingMedia ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Upload className="size-3.5" />
                            )}
                            Replace file
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={uploadingMedia}
                            onClick={() =>
                              setForm((prev) => ({
                                ...prev,
                                header_media_url: "",
                                header_handle: "",
                              }))
                            }
                            className="h-8 text-xs text-muted-foreground hover:text-red-400"
                          >
                            <X className="size-3.5" />
                            Clear
                          </Button>
                        </div>
                      </div>
                    ) : (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={
                            uploadingMedia || profileLoading || !accountId
                          }
                          className="flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-card px-3 py-6 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                        >
                        {uploadingMedia ? (
                          <>
                            <Loader2 className="size-4 animate-spin" />
                            Uploading…
                          </>
                        ) : (
                          <>
                            <Upload className="size-4" />
                            <span>
                              Click to upload sample {form.header_format}
                              {form.header_format === "image"
                                ? " (max 2 MB)"
                                : " (max 16 MB)"}
                            </span>
                          </>
                        )}
                      </button>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={
                        MEDIA_ACCEPT[
                          form.header_format as "image" | "video" | "document"
                        ]
                      }
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleHeaderMediaUpload(f);
                        e.target.value = "";
                      }}
                    />
                  </TabsContent>

                  <TabsContent value="link" className="space-y-2">
                    <Input
                      placeholder={`https://… (public HTTPS link to a sample ${form.header_format})`}
                      value={form.header_media_url}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          header_media_url: e.target.value,
                          header_handle: "",
                        })
                      }
                      className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                    />
                  </TabsContent>
                </Tabs>

                {!form.header_media_url.trim() && (
                  <p className="text-[11px] leading-relaxed text-amber-600">
                    Upload a file or paste a public HTTPS URL. VedMint uploads
                    the sample to Meta when you submit for review.
                  </p>
                )}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Must stay publicly reachable over HTTPS.
                  {form.header_format === "image" &&
                    " JPEG or PNG, recommended ≥800×418 px, max 2 MB upload."}
                  {form.header_format === "video" &&
                    " MP4 / 3GPP, ≤16 MB, ≤60 seconds."}
                  {form.header_format === "document" &&
                    " PDF, ≤16 MB upload."}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-foreground/80">Body Text</Label>
            <Textarea
              placeholder="Hello {{1}}, your order {{2}} is confirmed."
              value={form.body_text}
              onChange={(e) =>
                setForm({ ...form, body_text: e.target.value })
              }
              rows={5}
              maxLength={TEMPLATE_LIMITS.bodyMaxLength}
              className="resize-none border-border bg-muted text-foreground placeholder:text-muted-foreground"
            />
            <p className="text-[11px] text-muted-foreground">
              Use {"{{1}}"}, {"{{2}}"} for variables (must be contiguous
              starting at {"{{1}}"}).
            </p>

            {bodyVarCount > 0 && (
              <div className="space-y-1.5 pt-1">
                <Label className="text-[11px] text-muted-foreground">
                  Sample values (used in preview + Meta review)
                </Label>
                {form.body_samples.map((val, i) => (
                  <Input
                    key={i}
                    aria-label={`Sample value for body variable {{${i + 1}}}`}
                    placeholder={`Sample for {{${i + 1}}}`}
                    value={val}
                    onChange={(e) => {
                      const next = [...form.body_samples];
                      next[i] = e.target.value;
                      setForm({ ...form, body_samples: next });
                    }}
                    className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                  />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-foreground/80">Footer (optional)</Label>
            <Input
              placeholder="Optional footer text (max 60 chars)"
              value={form.footer_text}
              onChange={(e) =>
                setForm({ ...form, footer_text: e.target.value })
              }
              maxLength={TEMPLATE_LIMITS.footerMaxLength}
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-foreground/80">Buttons (optional)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addButton}
                disabled={
                  form.buttons.length >= TEMPLATE_LIMITS.maxButtonsTotal
                }
                className="h-7 border-border bg-transparent text-xs text-foreground/80 hover:bg-muted"
              >
                <Plus className="size-3" />
                Add Button
              </Button>
            </div>
            {form.buttons.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Up to {TEMPLATE_LIMITS.maxButtonsTotal} buttons. QUICK_REPLY
                buttons must come before URL / phone / copy-code buttons.
              </p>
            ) : (
              <div className="space-y-2">
                {form.buttons.map((btn, i) => (
                  <div
                    key={i}
                    className="space-y-2 rounded border border-border bg-muted/50 p-2"
                  >
                    <div className="flex items-center gap-2">
                      <Select
                        value={btn.type}
                        onValueChange={(val) => {
                          if (!val) return;
                          changeButtonType(i, val as TemplateButton["type"]);
                        }}
                      >
                        <SelectTrigger className="h-8 w-40 border-border bg-muted text-xs text-foreground">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-border bg-muted">
                          <SelectItem value="QUICK_REPLY">
                            Quick Reply
                          </SelectItem>
                          <SelectItem value="URL">URL</SelectItem>
                          <SelectItem value="PHONE_NUMBER">Phone</SelectItem>
                          <SelectItem value="COPY_CODE">Copy Code</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Button label"
                        value={btn.text}
                        maxLength={TEMPLATE_LIMITS.buttonTextMaxLength}
                        onChange={(e) =>
                          updateButton(i, { text: e.target.value })
                        }
                        className="h-8 flex-1 border-border bg-muted text-xs text-foreground placeholder:text-muted-foreground"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeButton(i)}
                        className="size-7 text-muted-foreground hover:bg-red-950/30 hover:text-red-400"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                    {btn.type === "URL" && (
                      <div className="space-y-1 pl-1">
                        <Input
                          placeholder="https://example.com/path or with {{1}} suffix"
                          value={btn.url}
                          onChange={(e) =>
                            updateButton(i, { url: e.target.value })
                          }
                          className="h-8 border-border bg-muted text-xs text-foreground placeholder:text-muted-foreground"
                        />
                        {extractVariableIndices(btn.url).length > 0 && (
                          <Input
                            placeholder="Example value for {{1}}"
                            value={btn.example ?? ""}
                            onChange={(e) =>
                              updateButton(i, { example: e.target.value })
                            }
                            className="h-8 border-border bg-muted text-xs text-foreground placeholder:text-muted-foreground"
                          />
                        )}
                      </div>
                    )}
                    {btn.type === "PHONE_NUMBER" && (
                      <Input
                        placeholder="+15551234567"
                        value={btn.phone_number}
                        onChange={(e) =>
                          updateButton(i, { phone_number: e.target.value })
                        }
                        className="h-8 border-border bg-muted text-xs text-foreground placeholder:text-muted-foreground"
                      />
                    )}
                    {btn.type === "COPY_CODE" && (
                      <Input
                        placeholder="Example code (e.g. SUMMER20)"
                        value={btn.example}
                        onChange={(e) =>
                          updateButton(i, { example: e.target.value })
                        }
                        className="h-8 border-border bg-muted text-xs text-foreground placeholder:text-muted-foreground"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Live Meta-style preview + readiness checklist */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <TemplatePreview model={form} />
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ready for Meta?
            </p>
            <ul className="mt-3 space-y-2">
              {checklist.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-2 text-xs text-foreground"
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                      item.ok
                        ? "bg-emerald-500/15 text-emerald-700"
                        : "bg-amber-500/15 text-amber-700",
                    )}
                  >
                    {item.ok ? "✓" : "!"}
                  </span>
                  <span
                    className={
                      item.ok ? "text-foreground" : "text-muted-foreground"
                    }
                  >
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>
            {!checklistReady && validationIssues[0] && (
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900">
                {validationIssues[0]}
                {validationIssues.length > 1
                  ? ` (+${validationIssues.length - 1} more)`
                  : ""}
              </p>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              {checklistReady
                ? "Looking good — submit for Meta review (usually within 24 hours)."
                : "Fix the issue above before submitting — this matches Meta’s rules."}
            </p>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="mt-3 w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Submitting…
                </>
              ) : isEdit ? (
                "Save & Resubmit"
              ) : (
                "Submit to Meta"
              )}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
