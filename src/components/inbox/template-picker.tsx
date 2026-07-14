"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MessageTemplate } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  LayoutTemplate,
  Loader2,
  Paperclip,
  Upload,
  Video,
  X,
} from "lucide-react";
import { extractVariableIndices } from "@/lib/whatsapp/template-validators";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

// ─── Public interface ────────────────────────────────────────────────────────

export interface TemplateSendValues {
  body: string[];
  headerText?: string;
  headerMediaUrl?: string;
  buttonParams?: Record<number, string>;
}

interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: MessageTemplate, values: TemplateSendValues) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderBodyPreview(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    const value = params[idx];
    return value && value.trim().length > 0 ? value : `{{${raw}}}`;
  });
}

interface UrlButtonSlot {
  index: number;
  text: string;
  url: string;
}

function collectVariableSlots(template: MessageTemplate): {
  bodyVars: number[];
  headerVarCount: number;
  urlButtonSlots: UrlButtonSlot[];
  hasMediaHeader: boolean;
} {
  const bodyVars = extractVariableIndices(template.body_text);
  const headerVarCount =
    template.header_type === "text" && template.header_content
      ? extractVariableIndices(template.header_content).length
      : 0;
  const hasMediaHeader = ["image", "video", "document"].includes(
    template.header_type ?? ""
  );
  const urlButtonSlots: UrlButtonSlot[] = [];
  (template.buttons ?? []).forEach((b, i) => {
    if (b.type === "URL" && extractVariableIndices(b.url).length > 0) {
      urlButtonSlots.push({ index: i, text: b.text, url: b.url });
    }
  });
  return { bodyVars, headerVarCount, urlButtonSlots, hasMediaHeader };
}

type MediaSourceType = "static" | "upload";
type ActiveTab = "map" | "media" | "advance";

// ─── Main component ───────────────────────────────────────────────────────────

export function TemplatePicker({
  open,
  onOpenChange,
  onSelect,
}: TemplatePickerProps) {
  const t = useTranslations("Inbox.templatePicker");
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Template list
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Selection
  const [selected, setSelected] = useState<MessageTemplate | null>(null);

  // Parameter values
  const [bodyParams, setBodyParams] = useState<string[]>([]);
  const [headerText, setHeaderText] = useState("");
  const [buttonParams, setButtonParams] = useState<Record<number, string>>({});

  // Media
  const [mediaSourceType, setMediaSourceType] = useState<MediaSourceType>("static");
  const [mediaLink, setMediaLink] = useState("");
  const [mediaUploadUrl, setMediaUploadUrl] = useState("");
  const [mediaFileName, setMediaFileName] = useState("");
  const [mediaUploading, setMediaUploading] = useState(false);

  // Tabs
  const [activeTab, setActiveTab] = useState<ActiveTab>("map");

  // ── Load templates on open ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) { setTemplates([]); setLoading(false); }
        return;
      }

      // Scope by RLS (message_templates_select → is_account_member), NOT by
      // user_id. Templates are account-owned, so filtering on the caller's
      // user_id hid templates that a teammate created — leaving them unable
      // to send approved templates in a shared account.
      const { data, error } = await supabase
        .from("message_templates")
        .select("*")
        .eq("status", "APPROVED")
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch templates:", error);
        setTemplates([]);
      } else {
        setTemplates((data as MessageTemplate[]) ?? []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reset helpers ──────────────────────────────────────────────────────────
  function resetAll() {
    setSelected(null);
    setBodyParams([]);
    setHeaderText("");
    setButtonParams({});
    setMediaSourceType("static");
    setMediaLink("");
    setMediaUploadUrl("");
    setMediaFileName("");
    setActiveTab("map");
    setSearch("");
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetAll();
    onOpenChange(next);
  }

  // ── Pick a template from the list ──────────────────────────────────────────
  function pickTemplate(template: MessageTemplate) {
    const slots = collectVariableSlots(template);
    setSelected(template);
    setBodyParams(new Array(slots.bodyVars.length).fill(""));
    setHeaderText("");
    setButtonParams({});
    setMediaSourceType("static");
    setMediaLink("");
    setMediaUploadUrl("");
    setMediaFileName("");
    setActiveTab("map");
  }

  // ── Media upload ────────────────────────────────────────────────────────────
  async function handleMediaUpload(file: File) {
    const headerType = selected?.header_type ?? "image";
    if (headerType === "image") {
      if (!["image/jpeg", "image/jpg", "image/png"].includes(file.type)) {
        toast.error("Unsupported image type. Use PNG, JPG, or JPEG.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) { toast.error("Image is too large. Maximum 5 MB."); return; }
    } else if (headerType === "video") {
      if (file.type !== "video/mp4") { toast.error("Unsupported video type. Use MP4."); return; }
      if (file.size > 10 * 1024 * 1024) { toast.error("Video is too large. Maximum 10 MB."); return; }
    } else if (headerType === "document") {
      if (file.type !== "application/pdf") { toast.error("Unsupported document type. Use PDF."); return; }
      if (file.size > 10 * 1024 * 1024) { toast.error("Document is too large. Maximum 10 MB."); return; }
    }

    setMediaUploading(true);
    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr || !user) throw new Error("Not signed in.");
      const { data: profile, error: profileErr } = await supabase
        .from("profiles").select("account_id").eq("user_id", user.id).maybeSingle();
      if (profileErr || !profile?.account_id) throw new Error("Could not resolve your account.");

      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const safeBase = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40) || "file";
      const path = `account-${profile.account_id}/${Date.now()}-${safeBase}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("flow-media")
        .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
      if (upErr) throw new Error(upErr.message);

      const { data: { publicUrl } } = supabase.storage.from("flow-media").getPublicUrl(path);
      setMediaUploadUrl(publicUrl);
      setMediaFileName(file.name);
      toast.success("File uploaded successfully.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setMediaUploading(false);
    }
  }

  // ── Confirm send ────────────────────────────────────────────────────────────
  function confirm() {
    if (!selected) return;
    const values: TemplateSendValues = { body: bodyParams };
    if (headerText.trim()) values.headerText = headerText.trim();

    // Resolve media URL
    const resolvedMediaUrl =
      mediaSourceType === "upload" ? mediaUploadUrl : mediaLink;
    if (resolvedMediaUrl?.trim()) values.headerMediaUrl = resolvedMediaUrl.trim();

    if (Object.keys(buttonParams).length > 0) {
      values.buttonParams = Object.fromEntries(
        Object.entries(buttonParams).map(([k, v]) => [Number(k), v.trim()])
      );
    }
    onSelect(selected, values);
    handleOpenChange(false);
  }

  // ── Derived state ───────────────────────────────────────────────────────────
  const slots = useMemo(
    () => (selected ? collectVariableSlots(selected) : null),
    [selected]
  );

  const hasMediaHeader = !!(selected && slots?.hasMediaHeader);
  const hasButtons = !!(selected?.buttons && selected.buttons.length > 0);

  // A media template can still be sent if the template row already has header_media_url / header_handle
  const templateHasDefaultMedia = !!(
    selected?.header_media_url ||
    (selected?.header_handle && selected.header_handle.startsWith("http")) ||
    (selected?.header_handle && /^\d+$/.test(selected.header_handle))
  );
  const mediaProvided =
    !hasMediaHeader ||
    templateHasDefaultMedia ||
    (mediaSourceType === "upload" && !!mediaUploadUrl) ||
    (mediaSourceType === "static" && !!mediaLink.trim());

  const canConfirm =
    !!selected &&
    !!slots &&
    slots.bodyVars.every((_, i) => (bodyParams[i] ?? "").trim().length > 0) &&
    (slots.headerVarCount === 0 || headerText.trim().length > 0) &&
    slots.urlButtonSlots.every((s) => (buttonParams[s.index] ?? "").trim().length > 0) &&
    mediaProvided;

  // Live preview helpers
  const previewBody = selected
    ? renderBodyPreview(selected.body_text, bodyParams)
    : "";

  const previewHeader = selected?.header_type === "text" && selected.header_content
    ? selected.header_content.replace(/\{\{1\}\}/g, headerText || "{{1}}")
    : "";

  // Determine preview image for image header
  const previewImageUrl = useMemo(() => {
    if (selected?.header_type !== "image") return "";
    if (mediaSourceType === "upload" && mediaUploadUrl) return mediaUploadUrl;
    if (mediaSourceType === "static" && mediaLink) return mediaLink;
    return selected.header_media_url ?? "";
  }, [selected, mediaSourceType, mediaUploadUrl, mediaLink]);

  const filteredTemplates = useMemo(
    () =>
      templates.filter(
        (t) =>
          !search ||
          t.name.toLowerCase().includes(search.toLowerCase()) ||
          t.body_text.toLowerCase().includes(search.toLowerCase())
      ),
    [templates, search]
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={`border-border bg-card p-0 gap-0 overflow-hidden flex flex-col ${
          selected ? "sm:max-w-5xl" : "sm:max-w-lg"
        }`}
        style={{ maxHeight: "90vh" }}
      >
        {/* Header */}
        <DialogHeader className="flex-shrink-0 flex flex-row items-center gap-3 px-5 py-4 border-b border-border bg-card">
          {selected && (
            <button
              type="button"
              onClick={() => { setSelected(null); setSearch(""); }}
              className="rounded-md text-muted-foreground hover:bg-muted hover:text-foreground p-1.5 flex items-center justify-center transition-colors flex-shrink-0"
              title={t("back")}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div className="flex items-center gap-2 min-w-0">
            <LayoutTemplate className="h-4 w-4 text-primary flex-shrink-0" />
            <DialogTitle className="text-foreground text-sm font-semibold truncate">
              {selected ? selected.name : t("sendTemplate")}
            </DialogTitle>
            {selected && (
              <Badge className="border border-primary/30 bg-primary/20 text-[10px] text-primary flex-shrink-0">
                {selected.category}
              </Badge>
            )}
          </div>
          <DialogDescription className="sr-only">
            {selected
              ? t("fillPlaceholders")
              : t("pickTemplate")}
          </DialogDescription>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-hidden">
          {/* ── Step 1: Template list ── */}
          {!selected ? (
            <div className="flex flex-col h-full">
              <div className="px-5 py-3 border-b border-border">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search templates…"
                  className="h-8 text-sm"
                />
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
                {loading ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : filteredTemplates.length === 0 ? (
                  <div className="rounded-md border border-border bg-muted/30 p-6 text-center">
                    <p className="text-sm text-foreground">
                      {search ? "No templates match your search" : t("noApprovedTemplates")}
                    </p>
                    {!search && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("noApprovedTemplatesHint")}
                      </p>
                    )}
                  </div>
                ) : (
                  filteredTemplates.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => pickTemplate(tpl)}
                      className="w-full rounded-md border border-border bg-card-2 p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted"
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium text-foreground">{tpl.name}</p>
                            <Badge className="border border-primary/30 bg-primary/20 text-[10px] text-primary">
                              {tpl.category}
                            </Badge>
                            {(tpl.header_type === "image" || tpl.header_type === "video" || tpl.header_type === "document") && (
                              <span className="text-[10px] text-muted-foreground uppercase flex items-center gap-0.5">
                                {tpl.header_type === "image" && <ImageIcon className="h-3 w-3" />}
                                {tpl.header_type === "video" && <Video className="h-3 w-3" />}
                                {tpl.header_type === "document" && <FileText className="h-3 w-3" />}
                                {tpl.header_type}
                              </span>
                            )}
                            {tpl.language && (
                              <span className="text-[10px] uppercase text-muted-foreground">{tpl.language}</span>
                            )}
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{tpl.body_text}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground mt-0.5" />
                      </div>
                    </button>
                  ))
                )}
              </div>
              <div className="flex-shrink-0 px-5 py-3 border-t border-border bg-card flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                  className=""
                >
                  {t("cancel")}
                </Button>
              </div>
            </div>
          ) : (
            /* ── Step 2: Two-column config ── */
            <div className="flex h-full overflow-hidden">
              {/* Left column: Live preview */}
              <div className="w-[280px] flex-shrink-0 border-r border-border bg-muted/30 flex flex-col overflow-y-auto">
                <div className="px-4 py-3 border-b border-border">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Live Preview
                  </span>
                </div>
                <div className="flex-1 p-4">
                  {/* WhatsApp-style chat bubble */}
                  <div className="rounded-xl bg-card border border-border overflow-hidden shadow-md">
                    {/* Chat header bar */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-muted border-b border-border">
                      <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-[9px] font-bold text-primary flex-shrink-0">
                        WA
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold text-foreground">Business</div>
                        <div className="text-[8px] text-muted-foreground">WhatsApp</div>
                      </div>
                    </div>
                    {/* Message bubble */}
                    <div className="p-3 space-y-2">
                      <div className="rounded-lg bg-muted border border-border overflow-hidden text-foreground shadow-sm">
                        {/* Media header preview */}
                        {selected.header_type === "image" && (
                          <div className="aspect-video bg-muted/50 flex items-center justify-center relative overflow-hidden">
                            {previewImageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={previewImageUrl} alt="Header" className="w-full h-full object-cover" />
                            ) : (
                              <div className="flex flex-col items-center gap-1 text-muted-foreground">
                                <ImageIcon className="h-5 w-5" />
                                <span className="text-[9px]">No image set</span>
                              </div>
                            )}
                          </div>
                        )}
                        {selected.header_type === "video" && (
                          <div className="aspect-video bg-muted/50 flex items-center justify-center">
                            {(mediaSourceType === "upload" && mediaUploadUrl) || (mediaSourceType === "static" && mediaLink) ? (
                              <div className="flex flex-col items-center gap-1 text-primary">
                                <Video className="h-5 w-5" />
                                <span className="text-[9px] text-foreground">
                                  {mediaFileName || "Video ready"}
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center gap-1 text-muted-foreground">
                                <Video className="h-5 w-5" />
                                <span className="text-[9px]">
                                  {templateHasDefaultMedia ? "Default video" : "No video set"}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                        {selected.header_type === "document" && (
                          <div className="px-3 py-2 bg-muted/50 flex items-center gap-2 border-b border-border">
                            <FileText className="h-4 w-4 text-red-400 flex-shrink-0" />
                            <span className="text-[10px] text-foreground truncate">
                              {mediaFileName ||
                                ((mediaSourceType === "static" && mediaLink) ? "Document ready" :
                                templateHasDefaultMedia ? "Default document" : "No document set")}
                            </span>
                          </div>
                        )}
                        {/* Text header */}
                        {selected.header_type === "text" && previewHeader && (
                          <div className="px-3 pt-2.5 text-[11px] font-bold text-foreground border-b border-border pb-2">
                            {previewHeader}
                          </div>
                        )}
                        {/* Body text */}
                        <div className="px-3 py-2.5 text-[11px] text-foreground leading-relaxed whitespace-pre-wrap">
                          {previewBody || <span className="text-muted-foreground italic">Body text preview</span>}
                        </div>
                        {/* Footer */}
                        {selected.footer_text && (
                          <div className="px-3 pb-2 text-[9px] text-muted-foreground italic">
                            {selected.footer_text}
                          </div>
                        )}
                        {/* Timestamp */}
                        <div className="px-3 pb-1.5 text-[8px] text-muted-foreground text-right font-mono">
                          {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                      {/* Buttons */}
                      {hasButtons && (
                        <div className="space-y-1">
                          {selected.buttons!.map((btn, idx) => (
                            <div
                              key={idx}
                              className="rounded-lg bg-muted border border-border px-3 py-1.5 text-center text-[11px] font-semibold text-primary/90"
                            >
                              {btn.text}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Template meta */}
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="font-mono">{selected.name}</span>
                      <span className="opacity-50">·</span>
                      <span className="uppercase">{selected.language}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right column: Input tabs */}
              <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                {/* Tab nav */}
                <div className="flex-shrink-0 flex border-b border-border bg-card">
                  <TabButton active={activeTab === "map"} onClick={() => setActiveTab("map")}>
                    Map Variables
                  </TabButton>
                  <TabButton
                    active={activeTab === "media"}
                    disabled={!hasMediaHeader}
                    onClick={() => hasMediaHeader && setActiveTab("media")}
                    title={!hasMediaHeader ? "This template has no media header" : "Configure media"}
                  >
                    Media {hasMediaHeader && (
                      <span className={`ml-1 text-[9px] px-1 py-0.5 rounded font-bold ${
                        mediaProvided ? "bg-primary/20 text-primary" : "bg-amber-500/20 text-amber-400"
                      }`}>
                        {mediaProvided ? "✓" : "!"}
                      </span>
                    )}
                  </TabButton>
                  <TabButton
                    active={activeTab === "advance"}
                    disabled={!hasButtons}
                    onClick={() => hasButtons && setActiveTab("advance")}
                    title={!hasButtons ? "This template has no buttons" : "Configure button params"}
                  >
                    Buttons {hasButtons && (
                      <span className="ml-1 text-[9px] text-slate-500">({selected!.buttons!.length})</span>
                    )}
                  </TabButton>
                </div>

                {/* Tab content */}
                <div className="flex-1 overflow-y-auto px-5 py-4">
                  {/* ── Map Tab ── */}
                  {activeTab === "map" && (
                    <div className="space-y-4">
                      {slots && slots.headerVarCount === 0 && slots.bodyVars.length === 0 && (
                        <div className="rounded-lg border border-border bg-muted/30 px-4 py-6 text-center">
                          <p className="text-sm text-muted-foreground">This template has no body variables.</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {hasMediaHeader
                              ? "Switch to the Media tab to set a header image/video/document."
                              : "You can send it directly."}
                          </p>
                        </div>
                      )}

                      {/* Header text var */}
                      {slots && slots.headerVarCount > 0 && (
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-foreground">
                            Header <span className="font-mono text-muted-foreground">{"{{1}}"}</span>
                          </Label>
                          <Input
                            value={headerText}
                            onChange={(e) => setHeaderText(e.target.value)}
                            placeholder={t("headerValuePlaceholder") || "Value for the header variable"}
                            className=""
                          />
                        </div>
                      )}

                      {/* Body vars */}
                      {slots?.bodyVars.map((v, i) => (
                        <div key={v} className="space-y-1.5">
                          <Label className="text-xs font-semibold text-foreground">
                            Body <span className="font-mono text-muted-foreground">{`{{${v}}}`}</span>
                          </Label>
                          <Input
                            value={bodyParams[i] ?? ""}
                            onChange={(e) => {
                              const next = [...bodyParams];
                              next[i] = e.target.value;
                              setBodyParams(next);
                            }}
                            placeholder={t("bodyValuePlaceholder", { val: `{{${v}}}` }) || `Value for {{${v}}}`}
                            className=""
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* ── Media Tab ── */}
                  {activeTab === "media" && hasMediaHeader && (
                    <div className="space-y-4">
                      <p className="text-xs text-muted-foreground leading-relaxed rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                        {templateHasDefaultMedia
                          ? "This template already has a default media file. You can optionally override it with a different file for this send."
                          : "This template requires a media file. Please provide one below."}
                      </p>

                      {/* Source type */}
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-foreground">Media Source</Label>
                        <div className="flex gap-2">
                          {(["static", "upload"] as const).map((type) => (
                            <button
                              key={type}
                              type="button"
                              onClick={() => setMediaSourceType(type)}
                              className={`flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                                mediaSourceType === type
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-muted text-muted-foreground hover:border-primary/40 hover:text-foreground"
                              }`}
                            >
                              {type === "static" ? "🔗 Paste URL" : "⬆ Upload File"}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Static URL */}
                      {mediaSourceType === "static" && (
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold text-foreground">Media URL</Label>
                          <Input
                            value={mediaLink}
                            onChange={(e) => setMediaLink(e.target.value)}
                            placeholder={
                              selected.header_type === "video"
                                ? "https://example.com/video.mp4"
                                : selected.header_type === "document"
                                ? "https://example.com/document.pdf"
                                : "https://example.com/image.jpg"
                            }
                            className=""
                          />
                          <p className="text-[10px] text-muted-foreground">
                            Must be a publicly accessible HTTPS URL.
                          </p>
                        </div>
                      )}

                      {/* Upload */}
                      {mediaSourceType === "upload" && (
                        <div className="space-y-2">
                          <Label className="text-xs font-semibold text-foreground">Upload File</Label>
                          {mediaUploadUrl ? (
                            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
                              <Paperclip className="h-3.5 w-3.5 shrink-0 text-primary" />
                              <a
                                href={mediaUploadUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="min-w-0 flex-1 truncate text-foreground hover:text-primary"
                              >
                                {mediaFileName || mediaUploadUrl}
                              </a>
                              <button
                                type="button"
                                onClick={() => { setMediaUploadUrl(""); setMediaFileName(""); }}
                                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={mediaUploading}
                              onClick={() => fileInputRef.current?.click()}
                              className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {mediaUploading ? (
                                <><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</>
                              ) : (
                                <><Upload className="h-4 w-4" /> Click to upload {selected.header_type}</>
                              )}
                            </button>
                          )}
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept={
                              selected.header_type === "video"
                                ? "video/mp4"
                                : selected.header_type === "document"
                                ? "application/pdf"
                                : "image/png,image/jpeg,image/jpg"
                            }
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void handleMediaUpload(f);
                              e.target.value = "";
                            }}
                          />
                          <p className="text-[10px] text-muted-foreground">
                            {selected.header_type === "video"
                              ? "Allowed: .mp4 · Max 10 MB"
                              : selected.header_type === "document"
                              ? "Allowed: .pdf · Max 10 MB"
                              : "Allowed: .jpeg, .jpg, .png · Max 5 MB"}
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Advance / Buttons Tab ── */}
                  {activeTab === "advance" && hasButtons && (
                    <div className="space-y-4">
                      <p className="text-xs text-muted-foreground leading-relaxed rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                        URL buttons with a <span className="font-mono text-foreground">{"{{1}}"}</span> variable
                        require a suffix value. Quick-reply and phone buttons don&apos;t need input.
                      </p>
                      {selected!.buttons!.map((btn, idx) => {
                        const needsParam =
                          btn.type === "URL" &&
                          extractVariableIndices(btn.url).length > 0;
                        return (
                          <div
                            key={idx}
                            className="rounded-lg border border-border bg-muted/20 p-3 space-y-2"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-foreground">
                                {`Button ${idx + 1}: "${btn.text}"`}
                              </span>
                              <Badge className="text-[9px] border-border text-muted-foreground bg-transparent">
                                {btn.type}
                              </Badge>
                            </div>
                            {needsParam ? (
                              <>
                                <p className="text-[10px] text-muted-foreground font-mono break-all">
                                  Base URL: {btn.url}
                                </p>
                                <Input
                                  value={buttonParams[idx] ?? ""}
                                  onChange={(e) =>
                                    setButtonParams((prev) => ({
                                      ...prev,
                                      [idx]: e.target.value,
                                    }))
                                  }
                                  placeholder={t("urlSuffixValuePlaceholder") || "URL suffix value for {{1}}"}
                                  className="text-xs h-8"
                                />
                                {buttonParams[idx] && (
                                  <p className="text-[10px] text-primary/80 font-mono break-all">
                                    Final: {btn.url.replace(/\{\{1\}\}/g, buttonParams[idx])}
                                  </p>
                                )}
                              </>
                            ) : (
                              <p className="text-[10px] text-muted-foreground">
                                No input required for this button type.
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="flex-shrink-0 flex items-center justify-between gap-3 border-t border-border bg-card px-5 py-3">
                  <div className="text-[10px] text-muted-foreground">
                    {!canConfirm && selected && (
                      <span className="text-amber-500/80">
                        {slots?.bodyVars.some((_, i) => !(bodyParams[i] ?? "").trim())
                          ? "Fill in all body variables to send."
                          : slots!.headerVarCount > 0 && !headerText.trim()
                          ? "Header variable required."
                          : !mediaProvided
                          ? "Media file required — go to the Media tab."
                          : slots!.urlButtonSlots.some((s) => !(buttonParams[s.index] ?? "").trim())
                          ? "Button URL suffix required — go to the Buttons tab."
                          : ""}
                      </span>
                    )}
                  </div>
                  <Button
                    disabled={!canConfirm}
                    onClick={confirm}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex-shrink-0"
                  >
                    {t("send")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function TabButton({
  active,
  disabled,
  onClick,
  children,
  title,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
        disabled
          ? "opacity-30 cursor-not-allowed text-muted-foreground border-transparent"
          : active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
