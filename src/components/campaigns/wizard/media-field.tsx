'use client';

import { useRef, useState } from 'react';
import { Loader2, Upload, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { MEDIA_HEADER_SPECS } from '@/lib/whatsapp/media-header-types';
import {
  MEDIA_MAX_BYTES_BY_KIND,
  uploadAccountMedia,
} from '@/lib/storage/upload-media';

/**
 * Media-header link for one template: paste a link or upload a new file
 * (to the account's chat-media bucket). Empty = the template's own media.
 */
export function MediaField({
  label,
  hint,
  kind,
  value,
  fallback,
  onChange,
}: {
  label: string;
  /** Extra line above the default hint. */
  hint?: string;
  kind: 'image' | 'video' | 'document';
  value: string;
  fallback?: string | null;
  onChange: (url: string) => void;
}) {
  const t = useTranslations('Broadcasts.advanced.variables');
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const spec = MEDIA_HEADER_SPECS[kind];

  async function upload(file: File) {
    if (!spec.mimeTypes.includes(file.type)) {
      toast.error(spec.formats);
      return;
    }
    const max = MEDIA_MAX_BYTES_BY_KIND[kind];
    if (file.size > max) {
      toast.error(t('tooLarge', { size: Math.round(max / 1024 / 1024) }));
      return;
    }
    setUploading(true);
    try {
      const { publicUrl } = await uploadAccountMedia('chat-media', file);
      onChange(publicUrl);
      toast.success(t('uploaded'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <span className="text-foreground mb-1.5 block text-sm font-medium">
        {label}
      </span>
      <div className="flex flex-col gap-2 sm:flex-row">
        {kind === 'image' && (value || fallback) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value || fallback || ''}
            alt=""
            className="border-border size-10 shrink-0 rounded-md border object-cover"
          />
        ) : null}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={fallback ?? 'https://'}
          className="border-border bg-background focus-visible:border-ring h-10 min-w-0 flex-1 rounded-md border px-3 text-sm outline-none"
        />
        <input
          ref={inputRef}
          type="file"
          accept={spec.mimeTypes.join(',')}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="border-border text-foreground hover:border-primary hover:text-primary inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium disabled:opacity-60"
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {uploading ? t('uploading') : t('upload')}
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            title={t('useTemplateMedia')}
            aria-label={t('useTemplateMedia')}
            className="text-muted-foreground hover:text-foreground inline-flex h-10 shrink-0 items-center justify-center rounded-md px-2"
          >
            <Undo2 className="size-4" />
          </button>
        ) : null}
      </div>
      <span className="text-muted-foreground mt-1 block text-xs">
        {hint ? `${hint} ` : ''}
        {t('mediaUrlHint')}
      </span>
    </div>
  );
}
