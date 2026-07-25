"use client";

/**
 * Meta WhatsApp Manager–style phone preview for message templates.
 * Substitutes sample values into {{N}} placeholders so the bubble
 * matches what reviewers see during template approval.
 */

import {
  Copy,
  ExternalLink,
  FileText,
  ImageIcon,
  Phone,
  Reply,
  Video,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { TemplateButton } from "@/types";

export type TemplatePreviewHeaderFormat =
  | "none"
  | "text"
  | "image"
  | "video"
  | "document";

export interface TemplatePreviewModel {
  header_format: TemplatePreviewHeaderFormat;
  header_content: string;
  header_media_url: string;
  header_sample: string;
  body_text: string;
  body_samples: string[];
  footer_text: string;
  buttons: TemplateButton[];
}

function substituteVars(text: string, samples: string[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (_, raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return `{{${raw}}}`;
    const sample = samples[n - 1]?.trim();
    return sample || `{{${n}}}`;
  });
}

interface TemplatePreviewProps {
  model: TemplatePreviewModel;
  businessName?: string;
  className?: string;
}

export function TemplatePreview({
  model,
  businessName = "Your business",
  className,
}: TemplatePreviewProps) {
  const bodySamples = model.body_samples ?? [];
  const buttons = model.buttons ?? [];
  const footer = model.footer_text ?? "";

  const body = substituteVars(
    model.body_text || "Your message body will appear here…",
    bodySamples,
  );
  const headerText =
    model.header_format === "text"
      ? substituteVars(model.header_content ?? "", [
          model.header_sample || bodySamples[0] || "",
        ])
      : "";

  const quickReplies = buttons.filter((b) => b.type === "QUICK_REPLY");
  const ctaButtons = buttons.filter((b) => b.type !== "QUICK_REPLY");

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Template preview
      </p>

      {/* Phone shell — Meta Manager vibe */}
      <div className="w-full max-w-[300px] overflow-hidden rounded-[1.75rem] border-[6px] border-slate-800 bg-slate-800 shadow-xl">
        {/* Status bar */}
        <div className="flex items-center justify-between bg-slate-800 px-4 pb-1 pt-2 text-[10px] font-medium text-white/90">
          <span>9:41</span>
          <div className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm bg-white/80" />
            <span className="inline-block h-2.5 w-4 rounded-sm border border-white/80">
              <span className="ml-px mt-px block h-1.5 w-2.5 rounded-[1px] bg-emerald-400" />
            </span>
          </div>
        </div>

        {/* Chat header */}
        <div className="flex items-center gap-2.5 bg-[#075E54] px-3 py-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-semibold text-white">
            {businessName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">
              {businessName}
            </p>
            <p className="text-[10px] text-white/70">Business account</p>
          </div>
        </div>

        {/* Chat wallpaper */}
        <div
          className="flex min-h-[420px] flex-col gap-2 px-2.5 py-3"
          style={{
            backgroundColor: "#E5DDD5",
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23cbbba8' fill-opacity='0.25'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
          }}
        >
          <div className="mx-auto mb-1 max-w-[90%] rounded bg-[#FFF5C4]/95 px-2 py-1 text-center text-[10px] text-slate-700 shadow-sm">
            This is how your template looks to customers
          </div>

          <div className="mr-auto w-[92%] overflow-hidden rounded-lg rounded-tl-none bg-white shadow-sm">
            {/* Media / text header */}
            {model.header_format === "image" && (
              <HeaderMedia
                kind="image"
                url={model.header_media_url}
              />
            )}
            {model.header_format === "video" && (
              <HeaderMedia kind="video" url={model.header_media_url} />
            )}
            {model.header_format === "document" && (
              <HeaderMedia kind="document" url={model.header_media_url} />
            )}

            <div className="space-y-1 px-2.5 pb-1.5 pt-2">
              {model.header_format === "text" && headerText && (
                <p className="text-[13px] font-semibold leading-snug text-slate-900">
                  {headerText}
                </p>
              )}
              <p className="whitespace-pre-wrap text-[13px] leading-snug text-slate-800">
                {body}
              </p>
              {footer.trim() && (
                <p className="text-[11px] leading-snug text-slate-500">
                  {footer}
                </p>
              )}
              <p className="text-right text-[10px] text-slate-400">12:00</p>
            </div>

            {/* CTA buttons attached to bubble (Meta style) */}
            {ctaButtons.length > 0 && (
              <div className="border-t border-slate-100">
                {ctaButtons.map((btn, i) => (
                  <CtaRow key={i} button={btn} />
                ))}
              </div>
            )}
          </div>

          {/* Quick reply chips below bubble */}
          {quickReplies.length > 0 && (
            <div className="mr-auto flex w-[92%] flex-col gap-1.5">
              {quickReplies.map((btn, i) => (
                <button
                  key={i}
                  type="button"
                  className="flex items-center justify-center gap-1.5 rounded-full border border-[#25D366]/40 bg-white px-3 py-2 text-[12px] font-medium text-[#128C7E] shadow-sm"
                >
                  <Reply className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {btn.text.trim() || `Quick reply ${i + 1}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HeaderMedia({
  kind,
  url,
}: {
  kind: "image" | "video" | "document";
  url: string;
}) {
  if (kind === "image" && url.trim()) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt="Header"
        className="max-h-40 w-full object-cover"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }

  const Icon = kind === "video" ? Video : kind === "document" ? FileText : ImageIcon;
  const label =
    kind === "image"
      ? url.trim()
        ? "Image"
        : "Add sample image"
      : kind === "video"
        ? url.trim()
          ? "Video"
          : "Add sample video"
        : url.trim()
          ? "Document"
          : "Add sample PDF";

  return (
    <div className="flex h-28 flex-col items-center justify-center gap-1.5 bg-slate-100 text-slate-500">
      <Icon className="size-7" />
      <span className="px-2 text-center text-[11px]">{label}</span>
    </div>
  );
}

function CtaRow({ button }: { button: TemplateButton }) {
  const Icon =
    button.type === "URL"
      ? ExternalLink
      : button.type === "PHONE_NUMBER"
        ? Phone
        : Copy;
  return (
    <button
      type="button"
      className="flex w-full items-center justify-center gap-1.5 border-t border-slate-100 px-2 py-2.5 text-[12px] font-medium text-[#00A5F4] first:border-t-0"
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{button.text.trim() || button.type}</span>
    </button>
  );
}
