'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Loader2,
  RefreshCw,
  AlertCircle,
  X,
  Upload,
  FileText,
  Search,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  uploadAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';
import {
  MEDIA_HEADER_SPECS,
  isMediaHeaderKind,
  type MediaHeaderKind,
} from '@/lib/whatsapp/media-header-types';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  MessageTemplate,
  TemplateButton,
  TemplateSampleValues,
} from '@/types';
import { PageHero } from '@/components/layout/page-hero';
import { CloneTemplateDialog } from './clone-template-dialog';
import { TestTemplateDialog } from './test-template-dialog';
import { TemplateCard } from './template-card';
import { TemplatePreview, fillVariables } from './template-preview';
import { LanguagePicker } from './language-picker';
import {
  extractVariableIndices,
  TEMPLATE_LIMITS,
} from '@/lib/whatsapp/template-validators';

const CATEGORIES = ['Marketing', 'Utility', 'Authentication'] as const;
type HeaderFormat = 'none' | 'text' | 'image' | 'video' | 'document';
const HEADER_FORMATS: HeaderFormat[] = ['none', 'text', 'image', 'video', 'document'];

interface TemplateFormData {
  name: string;
  category: MessageTemplate['category'];
  language: string;
  header_format: HeaderFormat;
  header_content: string;
  header_media_url: string;
  header_sample: string;
  body_text: string;
  body_samples: string[];
  footer_text: string;
  buttons: TemplateButton[];
}

const emptyForm: TemplateFormData = {
  name: '',
  category: 'Marketing',
  language: 'en_US',
  header_format: 'none',
  header_content: '',
  header_media_url: '',
  header_sample: '',
  body_text: '',
  body_samples: [],
  footer_text: '',
  buttons: [],
};


const STATUS_FILTERS = ['all', 'approved', 'pending', 'rejected'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

/** Which status chip a template counts under (drafts etc. only in "All"). */
function statusFilterOf(t: MessageTemplate): Exclude<StatusFilter, 'all'> | null {
  switch (t.status) {
    case 'APPROVED':
      return 'approved';
    case 'PENDING':
    case 'IN_APPEAL':
      return 'pending';
    case 'REJECTED':
    case 'PAUSED':
    case 'DISABLED':
      return 'rejected';
    default:
      return null;
  }
}

/**
 * Meta rejects a body with too many variables for its length
 * ("Parameters words ratio exceeds limit", subcode 2388293). The exact
 * ratio isn't published; flag bodies with fewer plain words than
 * variables + 2 so the author can pad them before submitting.
 */
function tooManyVariablesForLength(body: string, varCount: number): boolean {
  if (varCount === 0) return false;
  const words = body
    .replace(/\{\{\d+\}\}/g, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return words < varCount + 2;
}

function emptyButton(type: TemplateButton['type']): TemplateButton {
  switch (type) {
    case 'QUICK_REPLY':
      return { type: 'QUICK_REPLY', text: '' };
    case 'URL':
      return { type: 'URL', text: '', url: '' };
    case 'PHONE_NUMBER':
      return { type: 'PHONE_NUMBER', text: '', phone_number: '' };
    case 'COPY_CODE':
      return { type: 'COPY_CODE', text: '', example: '' };
  }
}

/** The channel fields the Templates page needs (GET /api/whatsapp/channels). */
interface TemplateChannel {
  id: string;
  name: string | null;
  color: string;
  is_default: boolean;
  waba_id: string | null;
  display_phone_number: string | null;
  verified_name: string | null;
}

function channelLabel(c: TemplateChannel): string {
  const name = c.name || c.verified_name || c.display_phone_number || c.id;
  return c.display_phone_number && c.display_phone_number !== name
    ? `${name} · ${c.display_phone_number}`
    : name;
}

export function TemplateManager() {
  const t = useTranslations('Settings.templates');
  const supabase = createClient();
  const { user, accountId, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  // Templates live per WABA (migration 047); the page shows the selected
  // channel's WABA. Channels sharing a WABA share its templates.
  const [channels, setChannels] = useState<TemplateChannel[]>([]);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  // The template open in the clone dialog (null = closed).
  const [cloneSource, setCloneSource] = useState<MessageTemplate | null>(null);
  // The approved template open in the test-send dialog (null = closed).
  const [testTemplate, setTestTemplate] = useState<MessageTemplate | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState<TemplateFormData>(emptyForm);
  // Non-null when the dialog is editing an existing row — switches the
  // submit handler from POST /submit to PATCH /[id] and changes the
  // dialog title + CTA. Set to the template id to pre-fill from a row.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Template selected for the confirm-delete dialog. The destructive
  // action goes through this two-step so a slip on the trash icon
  // doesn't take the template off Meta as well as locally.
  const [templateToDelete, setTemplateToDelete] =
    useState<MessageTemplate | null>(null);
  // Why the last delete attempt failed — shown in the confirm dialog.
  const [deleteError, setDeleteError] = useState<{
    message: string;
    canRemoveLocally: boolean;
  } | null>(null);
  // Header-media upload (image #230; video/document #562). Uploads to the
  // account-scoped chat-media bucket and stores the public URL in
  // header_media_url; the submit route turns that into a Meta
  // Resumable-Upload handle.
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const headerFileRef = useRef<HTMLInputElement>(null);

  // Body variable indices — `[1, 2, 3]` for "{{1}} {{2}} {{3}}". We
  // re-run the extractor on every render to keep the sample-value rows
  // in sync with what the user typed.
  const bodyVarCount = useMemo(
    () => extractVariableIndices(form.body_text).length,
    [form.body_text],
  );
  const headerVarCount = useMemo(
    () =>
      form.header_format === 'text'
        ? extractVariableIndices(form.header_content).length
        : 0,
    [form.header_format, form.header_content],
  );

  // Resize body_samples so it always has exactly bodyVarCount entries.
  // (We mutate via setForm in an effect so React owns the state.)
  useEffect(() => {
    setForm((prev) => {
      if (prev.body_samples.length === bodyVarCount) return prev;
      const next = prev.body_samples.slice(0, bodyVarCount);
      while (next.length < bodyVarCount) next.push('');
      return { ...prev, body_samples: next };
    });
  }, [bodyVarCount]);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !accountId) {
      setLoading(false);
      return;
    }
    void Promise.all([fetchTemplates(accountId), fetchChannels()]).finally(() =>
      setLoading(false),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id, accountId]);

  // Account-wide, so every teammate sees the same catalogue — not only
  // the templates they personally created.
  async function fetchTemplates(acctId: string) {
    try {
      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .eq('account_id', acctId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setTemplates(data || []);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
      toast.error(t('toastLoadFailed'));
    }
  }

  async function fetchChannels() {
    try {
      const res = await fetch('/api/whatsapp/channels', { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      const list = (body.channels ?? []) as TemplateChannel[];
      setChannels(list);
      setChannelId((current) =>
        current && list.some((c) => c.id === current)
          ? current
          : (list.find((c) => c.is_default) ?? list[0])?.id ?? null,
      );
    } catch (err) {
      console.error('Failed to fetch channels:', err);
      toast.error(t('toastChannelsFailed'));
    }
  }

  const selectedChannel = channels.find((c) => c.id === channelId) ?? null;

  // Templates per WABA, for the channel selector's counts.
  const countByWaba = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tpl of templates) {
      const key = tpl.waba_id ?? '';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [templates]);

  // No channel connected yet: show everything (e.g. dry-run templates).
  const visibleTemplates = selectedChannel
    ? templates.filter((tpl) => (tpl.waba_id ?? null) === selectedChannel.waba_id)
    : templates;

  // Status chips + search over the selected channel's templates.
  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = { all: visibleTemplates.length, approved: 0, pending: 0, rejected: 0 };
    for (const tpl of visibleTemplates) {
      const f = statusFilterOf(tpl);
      if (f) counts[f]++;
    }
    return counts;
  }, [visibleTemplates]);
  const listTemplates = visibleTemplates.filter((tpl) => {
    if (statusFilter !== 'all' && statusFilterOf(tpl) !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    return !q || tpl.name.toLowerCase().includes(q) || (tpl.body_text ?? '').toLowerCase().includes(q);
  });


  function buildSubmitPayload() {
    const sample_values: TemplateSampleValues = {};
    if (form.body_samples.some((v) => v.trim())) {
      sample_values.body = form.body_samples.map((v) => v.trim());
    }
    if (form.header_format === 'text' && form.header_sample.trim()) {
      sample_values.header = [form.header_sample.trim()];
    }

    return {
      name: form.name.trim(),
      category: form.category,
      language: form.language.trim() || 'en_US',
      header_type: form.header_format === 'none' ? undefined : form.header_format,
      header_content:
        form.header_format === 'text' ? form.header_content.trim() : undefined,
      header_media_url:
        form.header_format !== 'none' && form.header_format !== 'text'
          ? form.header_media_url.trim() || undefined
          : undefined,
      body_text: form.body_text.trim(),
      footer_text: form.footer_text.trim() || undefined,
      buttons: form.buttons.length > 0 ? form.buttons : undefined,
      sample_values:
        Object.keys(sample_values).length > 0 ? sample_values : undefined,
    };
  }

  function openEdit(template: MessageTemplate) {
    setEditingId(template.id);
    setForm({
      name: template.name,
      category: template.category,
      language: template.language || 'en_US',
      header_format: (template.header_type ?? 'none') as HeaderFormat,
      header_content: template.header_content ?? '',
      header_media_url: template.header_media_url ?? '',
      header_sample: template.sample_values?.header?.[0] ?? '',
      body_text: template.body_text,
      body_samples: template.sample_values?.body ?? [],
      footer_text: template.footer_text ?? '',
      buttons: template.buttons ?? [],
    });
    setDialogOpen(true);
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  async function handleSubmit() {
    // AUTHENTICATION is blocked by the persistent banner + disabled
    // submit button; this is a defensive second line of defense.
    if (form.category === 'Authentication') return;
    try {
      setSubmitting(true);
      const isEdit = editingId !== null;
      const url = isEdit
        ? `/api/whatsapp/templates/${editingId}`
        : '/api/whatsapp/templates/submit';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        // New templates are created in the selected channel's WABA; an
        // edit stays in the template's own WABA.
        body: JSON.stringify(
          isEdit
            ? buildSubmitPayload()
            : { ...buildSubmitPayload(), channel_id: channelId ?? undefined },
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.error || t(isEdit ? 'editFailedHttp' : 'submitFailedHttp', { status: res.status }),
        );
      }
      // Refresh first, then close — re-opening the dialog
      // immediately should not show a stale list.
      if (accountId) await fetchTemplates(accountId);
      toast.success(
        data.dry_run
          ? isEdit
            ? t('toastSaveEditDry')
            : t('toastSaveNewDry')
          : isEdit
            ? t('toastSubmitEditSuccess')
            : t('toastSubmitNewSuccess'),
      );
      setDialogOpen(false);
      setForm(emptyForm);
      setEditingId(null);
    } catch (err) {
      console.error('Submit error:', err);
      toast.error(err instanceof Error ? err.message : t('toastSubmitFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSyncFromMeta() {
    if (!user) return;
    setSyncing(true);
    try {
      const query = channelId ? `?channel_id=${encodeURIComponent(channelId)}` : '';
      const res = await fetch(`/api/whatsapp/templates/sync${query}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Sync failed (HTTP ${res.status})`);
      }
      toast.success(
        t('toastSyncCount', { total: data.total }) +
          (data.inserted || data.updated
            ? t('toastSyncDetails', { inserted: data.inserted, updated: data.updated })
            : ''),
      );
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        const preview = data.errors.slice(0, 3).map(
          (e: { name: string; language: string; message: string }) =>
            `${e.name} (${e.language})`,
        );
        const suffix =
          data.errors.length > 3 ? `, +${data.errors.length - 3} more` : '';
        toast.error(t('toastSyncFailed', { preview: preview.join(', ') + suffix }));
      }
      if (data.truncated) {
        // Use error (not warning) so the message survives long
        // enough to read — sonner's `warning` auto-dismisses on
        // the same short timer as `success`.
        toast.error(
          t('toastSyncTruncated'),
          { duration: 10000 },
        );
      }
      if (accountId) await fetchTemplates(accountId);
    } catch (err) {
      console.error('Template sync error:', err);
      toast.error(err instanceof Error ? err.message : t('toastSyncError'));
    } finally {
      setSyncing(false);
    }
  }

  async function confirmDelete(localOnly = false) {
    const target = templateToDelete;
    if (!target || deletingId) return;
    setDeletingId(target.id);
    setDeleteError(null);
    try {
      // Route handler scopes the Meta delete via hsm_id (so sibling
      // language variants survive) and falls through to remove the
      // local row. Local-only rows skip the Meta call, as does
      // `local_only` — offered when Meta refuses the delete.
      const res = await fetch(
        `/api/whatsapp/templates/${target.id}${localOnly ? '?local_only=true' : ''}`,
        { method: 'DELETE' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Shown inside the dialog, with "Remove from app only" when the
        // failure is on Meta's side.
        setDeleteError({
          message: data?.error || t('deleteFailedHttp', { status: res.status }),
          canRemoveLocally: !!data?.can_remove_locally,
        });
        return;
      }
      toast.success(localOnly ? t('toastDeleteLocalSuccess') : t('toastDeleteSuccess'));
      setTemplates((prev) => prev.filter((t) => t.id !== target.id));
      setTemplateToDelete(null);
    } catch (err) {
      setDeleteError({
        message: err instanceof Error ? err.message : t('toastDeleteError'),
        canRemoveLocally: false,
      });
    } finally {
      setDeletingId(null);
    }
  }

  // The patch type unions every field across button variants. The
  // conditional rendering below ensures only fields valid for the
  // current button's `type` reach this function, so the runtime
  // assertion + per-type spread preserves discriminated-union
  // invariants without forcing every call site to thread the type
  // through generics (which TS can't infer from a partial literal).
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
      // Per-variant spread keeps the discriminant pinned. Switch
      // exhaustiveness is enforced by TypeScript.
      switch (current.type) {
        case 'QUICK_REPLY':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
          };
          break;
        case 'URL':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.url !== undefined && { url: patch.url }),
            ...(patch.example !== undefined && { example: patch.example }),
          };
          break;
        case 'PHONE_NUMBER':
          next[index] = {
            ...current,
            ...(patch.text !== undefined && { text: patch.text }),
            ...(patch.phone_number !== undefined && {
              phone_number: patch.phone_number,
            }),
          };
          break;
        case 'COPY_CODE':
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

  function changeButtonType(index: number, type: TemplateButton['type']) {
    setForm((prev) => {
      const next = [...prev.buttons];
      next[index] = emptyButton(type);
      return { ...prev, buttons: next };
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
      buttons: [...prev.buttons, emptyButton('QUICK_REPLY')],
    }));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const headerNeedsMedia =
    form.header_format !== 'none' && form.header_format !== 'text';
  // The side preview opens for any header type as soon as there is
  // something to show — header text, body text or an uploaded file — so a
  // blank form never shows an empty preview column.
  const showPreview =
    form.body_text.trim() !== '' ||
    (form.header_format === 'text' && form.header_content.trim() !== '') ||
    (headerNeedsMedia && form.header_media_url.trim() !== '');
  const headerMediaKind: MediaHeaderKind | null = isMediaHeaderKind(
    form.header_format,
  )
    ? form.header_format
    : null;

  // Per-kind copy for the file picker. Kept as explicit key maps (not
  // `t(\`upload${kind}\`)`) so the catalogue scanner can see every key.
  const uploadLabelKey = {
    image: 'uploadImage',
    video: 'uploadVideo',
    document: 'uploadDocument',
  } as const;
  const uploadHintKey = {
    image: 'uploadHint',
    video: 'uploadHintVideo',
    document: 'uploadHintDocument',
  } as const;
  const invalidTypeKey = {
    image: 'toastInvalidImage',
    video: 'toastInvalidVideo',
    document: 'toastInvalidDocument',
  } as const;

  async function handleHeaderMediaFile(file: File, kind: MediaHeaderKind) {
    if (!MEDIA_HEADER_SPECS[kind].mimeTypes.includes(file.type)) {
      toast.error(t(invalidTypeKey[kind]));
      return;
    }
    // The upload lands in the chat-media bucket, whose 16 MB ceiling is
    // below Meta's 100 MB document cap — so this is the bucket-side
    // limit, not Meta's. A larger document can still be pasted as a link.
    const maxBytes = MEDIA_MAX_BYTES_BY_KIND[kind];
    if (file.size > maxBytes) {
      toast.error(
        t('toastMediaTooLarge', {
          size: (file.size / 1024 / 1024).toFixed(1),
          max: Math.round(maxBytes / 1024 / 1024),
        }),
      );
      return;
    }
    setUploadingHeader(true);
    try {
      const { publicUrl } = await uploadAccountMedia('chat-media', file);
      setForm((f) => ({ ...f, header_media_url: publicUrl }));
      toast.success(t('toastUploadSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('toastUploadFailed'));
    } finally {
      setUploadingHeader(false);
    }
  }

  return (
    <section className="animate-in fade-in-50 space-y-4 duration-200">
      <PageHero
        icon={FileText}
        iconClassName="bg-violet-500/15 text-violet-500"
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleSyncFromMeta}
              disabled={syncing}
              title={t('syncTitle')}
            >
              <RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? t('syncing') : t('syncFromMeta')}
            </Button>
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              {t('newTemplate')}
            </Button>
          </>
        }
      >
        {channels.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background/60 p-3 backdrop-blur-sm">
            <Label htmlFor="template-channel" className="text-sm text-muted-foreground">
              {t('channel')}
            </Label>
            <select
              id="template-channel"
              value={channelId ?? ''}
              onChange={(e) => setChannelId(e.target.value || null)}
              className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:max-w-md dark:bg-input/30"
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {t('channelOption', {
                    channel: channelLabel(c),
                    count: countByWaba.get(c.waba_id ?? '') ?? 0,
                  })}
                </option>
              ))}
            </select>
            {selectedChannel ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: selectedChannel.color }}
                  aria-hidden
                />
                {t('templatesInChannel', {
                  count: countByWaba.get(selectedChannel.waba_id ?? '') ?? 0,
                })}
              </span>
            ) : null}
          </div>
        ) : null}
      </PageHero>

      {visibleTemplates.length > 0 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="h-9 bg-card pl-8"
            />
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('statusFilter')}>
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setStatusFilter(f)}
                aria-pressed={statusFilter === f}
                className={
                  statusFilter === f
                    ? 'rounded-full border border-primary bg-primary px-3 py-1 text-xs font-medium text-primary-foreground'
                    : 'rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted'
                }
              >
                {t(`filter.${f}`)}
                <span className="ml-1.5 opacity-70">{statusCounts[f]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {listTemplates.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-violet-500/15 text-violet-500">
            <FileText className="size-6" />
          </div>
          <p className="text-sm font-medium text-foreground">
            {visibleTemplates.length === 0 ? t('noTemplates') : t('noMatches')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {visibleTemplates.length === 0 ? t('createFirst') : t('noMatchesHint')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {listTemplates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              deleting={deletingId === template.id}
              onTest={() => setTestTemplate(template)}
              onEdit={() => openEdit(template)}
              onClone={() => setCloneSource(template)}
              onDelete={() => {
                setDeleteError(null);
                setTemplateToDelete(template);
              }}
            />
          ))}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingId(null);
            setForm(emptyForm);
          }
        }}
      >
        <DialogContent
          className={`bg-popover border-border ${showPreview ? 'sm:max-w-5xl' : 'sm:max-w-2xl'} max-h-[92vh] overflow-y-auto`}
        >
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {editingId ? t('dialogEditTitle') : t('dialogNewTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {editingId
                ? t('dialogEditDesc')
                : t('dialogNewDesc')}
            </DialogDescription>
          </DialogHeader>

          {form.category === 'Authentication' && (
            <div className="flex items-start gap-2 rounded border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <p>{t.rich('authWarning', { bold: (chunks) => <strong>{chunks}</strong> })}</p>
            </div>
          )}

          <div
            className={
              showPreview ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]' : 'grid gap-6'
            }
          >
          <div className="min-w-0 space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('templateName')}</Label>
              <Input
                placeholder={t('namePlaceholder')}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={editingId !== null}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <p className="text-[11px] text-muted-foreground">
                {editingId
                  ? t('nameFixed')
                  : t('nameHint')}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('category')}</Label>
                <Select
                  value={form.category}
                  onValueChange={(val) =>
                    setForm({
                      ...form,
                      category: val as MessageTemplate['category'],
                    })
                  }
                >
                  <SelectTrigger className="w-full bg-muted border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {CATEGORIES.map((cat) => (
                      <SelectItem
                        key={cat}
                        value={cat}
                        className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                      >
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">{t('language')}</Label>
                <LanguagePicker
                  value={form.language}
                  onChange={(code) => setForm({ ...form, language: code })}
                  disabled={editingId !== null}
                  ariaLabel={t('language')}
                  searchPlaceholder={t('languageSearch')}
                  noResults={t('languageNoResults')}
                />
                <p className="text-[11px] text-muted-foreground">
                  {editingId ? (
                    t('langFixed')
                  ) : (
                    <span>{t.rich('langHint', { code: (chunks) => <code>{chunks}</code> })}</span>
                  )}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('header')}</Label>
              <Select
                value={form.header_format}
                onValueChange={(val) =>
                  // Preserve header_content, header_media_url, and
                  // header_sample across format switches. The submit
                  // payload builder only reads the field that matches
                  // the active format, so an orphan value on a hidden
                  // field is harmless — and keeping it lets the user
                  // switch formats to compare without losing typing.
                  setForm({
                    ...form,
                    header_format: (val || 'none') as HeaderFormat,
                  })
                }
              >
                <SelectTrigger className="w-full bg-muted border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {HEADER_FORMATS.map((type) => (
                    <SelectItem
                      key={type}
                      value={type}
                      className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                    >
                      {type === 'none'
                        ? t('headerNone')
                        : type === 'text'
                          ? t('headerText')
                          : type === 'image'
                            ? t('headerImage')
                            : type === 'video'
                              ? t('headerVideo')
                              : t('headerDocument')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {form.header_format === 'text' && (
                <div className="space-y-2 mt-2">
                  <Input
                    id="template-header-text"
                    aria-label={t('headerTextLabel')}
                    placeholder={t.raw('headerTextPlaceholder')}
                    value={form.header_content}
                    onChange={(e) =>
                      setForm({ ...form, header_content: e.target.value })
                    }
                    maxLength={TEMPLATE_LIMITS.headerTextMaxLength}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                  {headerVarCount > 0 && (
                    <Input
                      id="template-header-sample"
                      aria-label={t('headerSampleAria')}
                      placeholder={t.raw('headerSamplePlaceholder')}
                      value={form.header_sample}
                      onChange={(e) =>
                        setForm({ ...form, header_sample: e.target.value })
                      }
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                    />
                  )}
                </div>
              )}

              {headerNeedsMedia && (
                // For a media header the sample IS the file: Meta's reviewers
                // look at it to approve the template. Each real send can use
                // a different file.
                <div className="mt-2 space-y-3 rounded-lg border border-sky-600/30 bg-sky-500/5 p-3">
                  <div>
                    <p className="text-xs font-medium text-foreground">
                      {t('headerSampleTitle', { format: form.header_format })}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {t('headerSampleHelp')}
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    {/* Thumbnail of the sample, right beside the controls. */}
                    <button
                      type="button"
                      onClick={() => headerFileRef.current?.click()}
                      disabled={uploadingHeader || !headerMediaKind}
                      className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                      aria-label={headerMediaKind ? t(uploadLabelKey[headerMediaKind]) : undefined}
                    >
                      {uploadingHeader ? (
                        <Loader2 className="size-5 animate-spin" />
                      ) : form.header_media_url && form.header_format === 'image' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={form.header_media_url} alt="" className="size-full object-cover" />
                      ) : form.header_media_url && form.header_format === 'video' ? (
                        <video src={form.header_media_url} className="size-full object-cover" muted />
                      ) : form.header_media_url ? (
                        <FileText className="size-8 text-red-500" />
                      ) : (
                        <Upload className="size-5" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1 space-y-2">
                      {headerMediaKind && (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            ref={headerFileRef}
                            type="file"
                            accept={MEDIA_HEADER_SPECS[headerMediaKind].mimeTypes.join(',')}
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) void handleHeaderMediaFile(f, headerMediaKind);
                              e.target.value = '';
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploadingHeader}
                            onClick={() => headerFileRef.current?.click()}
                          >
                            {uploadingHeader ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Upload className="h-3.5 w-3.5" />
                            )}
                            {form.header_media_url
                              ? t('replaceSample')
                              : t(uploadLabelKey[headerMediaKind])}
                          </Button>
                          {form.header_media_url ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setForm({ ...form, header_media_url: '' })}
                              className="text-muted-foreground hover:text-red-400"
                            >
                              <X className="h-3.5 w-3.5" />
                              {t('removeSample')}
                            </Button>
                          ) : null}
                          <span className="text-[11px] text-muted-foreground">
                            {t(uploadHintKey[headerMediaKind])}
                          </span>
                        </div>
                      )}
                      <Input
                        aria-label={t('mediaUrlLabel')}
                        placeholder={t('mediaUrlPlaceholder', { format: form.header_format })}
                        value={form.header_media_url}
                        onChange={(e) =>
                          setForm({ ...form, header_media_url: e.target.value })
                        }
                        className="h-8 bg-background border-border text-foreground placeholder:text-muted-foreground"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {form.header_format === 'image'
                      ? t('imageHint')
                      : t('mediaHint')}
                    {form.header_format === 'video' &&
                      t('videoHint')}
                    {form.header_format === 'document' &&
                      t('documentHint')}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('bodyText')}</Label>
              <Textarea
                placeholder={t.raw('bodyPlaceholder')}
                value={form.body_text}
                onChange={(e) =>
                  setForm({ ...form, body_text: e.target.value })
                }
                rows={4}
                maxLength={TEMPLATE_LIMITS.bodyMaxLength}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground resize-none"
              />
              <p className="text-[11px] text-muted-foreground">
                {t.raw('bodyHint')}
              </p>
              {tooManyVariablesForLength(form.body_text, bodyVarCount) && (
                <div className="flex items-start gap-1.5 rounded border border-amber-700/40 bg-amber-950/30 px-2 py-1.5 text-xs text-amber-300">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{t('ratioWarning')}</span>
                </div>
              )}

              {/* Always visible: the sample rows appear once the body has
                  {{1}}, {{2}}, … — "Add variable" inserts the next one. */}
              <div className="space-y-2 rounded-lg border border-sky-600/30 bg-sky-500/5 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Label className="text-xs font-medium text-foreground">
                        {t('sampleValues')}
                      </Label>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {bodyVarCount > 0 ? t('sampleValuesHelp') : t.raw('sampleValuesEmpty')}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={bodyVarCount >= 20}
                      onClick={() =>
                        setForm((prev) => {
                          const next = `{{${extractVariableIndices(prev.body_text).length + 1}}}`;
                          const sep = prev.body_text && !/\s$/.test(prev.body_text) ? ' ' : '';
                          return { ...prev, body_text: `${prev.body_text}${sep}${next}` };
                        })
                      }
                    >
                      <Plus className="size-3.5" />
                      {t('addVariable')}
                    </Button>
                  </div>
                  {form.body_samples.map((val, i) => {
                    const inputId = `template-body-sample-${i}`;
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <label
                          htmlFor={inputId}
                          className="w-12 shrink-0 rounded bg-muted px-1.5 py-1 text-center font-mono text-xs text-muted-foreground"
                        >
                          {`{{${i + 1}}}`}
                        </label>
                        <Input
                          id={inputId}
                          aria-label={t('sampleAria', { var: `{{${i + 1}}}` })}
                          placeholder={t('samplePlaceholder', { var: `{{${i + 1}}}` })}
                          value={val}
                          onChange={(e) => {
                            const next = [...form.body_samples];
                            next[i] = e.target.value;
                            setForm({ ...form, body_samples: next });
                          }}
                          className="h-8 bg-background border-border text-foreground placeholder:text-muted-foreground"
                        />
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('footer')}</Label>
              <Input
                placeholder={t('footerPlaceholder')}
                value={form.footer_text}
                onChange={(e) =>
                  setForm({ ...form, footer_text: e.target.value })
                }
                maxLength={TEMPLATE_LIMITS.footerMaxLength}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-muted-foreground">{t('buttons')}</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addButton}
                  disabled={form.buttons.length >= TEMPLATE_LIMITS.maxButtonsTotal}
                  className="border-border bg-transparent text-muted-foreground hover:bg-muted h-7 text-xs"
                >
                  <Plus className="size-3" />
                  {t('addButton')}
                </Button>
              </div>
              {form.buttons.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {t('buttonsLimit', { max: TEMPLATE_LIMITS.maxButtonsTotal })}
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
                            // Same null guard as the Header Select
                            // (per PR 148): @base-ui Select fires
                            // onValueChange(null) on deselect.
                            if (!val) return;
                            changeButtonType(i, val as TemplateButton['type']);
                          }}
                        >
                          <SelectTrigger className="w-40 bg-muted border-border text-foreground h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-popover border-border">
                            <SelectItem
                              value="QUICK_REPLY"
                              className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                            >
                              {t('btnQuickReply')}
                            </SelectItem>
                            <SelectItem
                              value="URL"
                              className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                            >
                              {t('btnUrl')}
                            </SelectItem>
                            <SelectItem
                              value="PHONE_NUMBER"
                              className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                            >
                              {t('btnPhone')}
                            </SelectItem>
                            <SelectItem
                              value="COPY_CODE"
                              className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                            >
                              {t('btnCopyCode')}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          placeholder={t('btnLabelPlaceholder')}
                          value={btn.text}
                          maxLength={TEMPLATE_LIMITS.buttonTextMaxLength}
                          onChange={(e) =>
                            updateButton(i, { text: e.target.value })
                          }
                          className="flex-1 bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeButton(i)}
                          className="text-muted-foreground hover:text-red-400 hover:bg-red-950/30 size-7"
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                      {btn.type === 'URL' && (
                        <div className="space-y-1 pl-1">
                          <Input
                            placeholder={t.raw('urlPlaceholder')}
                            value={btn.url}
                            onChange={(e) =>
                              updateButton(i, { url: e.target.value })
                            }
                            className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                          />
                          {extractVariableIndices(btn.url).length > 0 && (
                            <Input
                              placeholder={t.raw('urlSamplePlaceholder')}
                              value={btn.example ?? ''}
                              onChange={(e) =>
                                updateButton(i, { example: e.target.value })
                              }
                              className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                            />
                          )}
                        </div>
                      )}
                      {btn.type === 'PHONE_NUMBER' && (
                        <Input
                          placeholder={t('phonePlaceholder')}
                          value={btn.phone_number}
                          onChange={(e) =>
                            updateButton(i, { phone_number: e.target.value })
                          }
                          className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                        />
                      )}
                      {btn.type === 'COPY_CODE' && (
                        <Input
                          placeholder={t('codePlaceholder')}
                          value={btn.example}
                          onChange={(e) =>
                            updateButton(i, { example: e.target.value })
                          }
                          className="bg-muted border-border text-foreground placeholder:text-muted-foreground h-8 text-xs"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {/* Live preview for every header type, once there is content
              (see showPreview); until then the form uses the full width. Sticky,
              but never taller than the dialog: it scrolls on its own, so
              the body, footer and buttons under a tall image stay reachable. */}
          {showPreview ? (
            <aside className="lg:sticky lg:top-0 lg:self-start lg:max-h-[calc(92vh-9rem)] lg:overflow-y-auto lg:pr-1">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('previewTitle')}
              </p>
              <TemplatePreview
                headerType={form.header_format === 'none' ? null : form.header_format}
                headerText={fillVariables(form.header_content, [form.header_sample])}
                mediaUrl={form.header_media_url.trim() || null}
                body={fillVariables(form.body_text, form.body_samples)}
                footer={form.footer_text}
                buttons={form.buttons}
              />
              <p className="mt-2 text-[11px] text-muted-foreground">{t('previewHint')}</p>
            </aside>
          ) : null}
          </div>

          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || form.category === 'Authentication'}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {editingId ? t('saving') : t('submitting')}
                </>
              ) : editingId ? (
                t('saveResubmit')
              ) : (
                t('submitApproval')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm-delete dialog. Surfacing the meta_template_id case
          separately so users understand a real Meta delete is happening,
          not just a local cleanup. */}
      <Dialog
        open={templateToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTemplateToDelete(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('deleteDialogTitle')}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {templateToDelete?.meta_template_id
                ? t('deleteMetaDesc', { name: templateToDelete.name })
                : t('deleteLocalDesc', { name: templateToDelete?.name || '' })}
            </DialogDescription>
          </DialogHeader>
          {deleteError ? (
            <div
              role="alert"
              className="flex items-start gap-1.5 rounded border border-red-900/40 bg-red-950/20 px-2 py-1.5 text-xs text-red-400"
            >
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>{deleteError.message}</span>
            </div>
          ) : null}
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => {
                setTemplateToDelete(null);
                setDeleteError(null);
              }}
              disabled={deletingId !== null}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            {deleteError?.canRemoveLocally ? (
              <Button
                variant="outline"
                onClick={() => confirmDelete(true)}
                disabled={deletingId !== null}
                title={t('removeLocalTitle')}
              >
                {t('removeLocal')}
              </Button>
            ) : null}
            <Button
              onClick={() => confirmDelete()}
              disabled={deletingId !== null}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deletingId !== null ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('deleting')}
                </>
              ) : deleteError ? (
                t('deleteRetry')
              ) : (
                t('delete')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TestTemplateDialog
        template={testTemplate}
        channels={channels}
        onClose={() => setTestTemplate(null)}
      />

      <CloneTemplateDialog
        source={cloneSource}
        channels={channels}
        defaultChannelId={channelId}
        templates={templates}
        onClose={() => setCloneSource(null)}
        onCreated={(target) => {
          if (accountId) void fetchTemplates(accountId);
          // Show the copies where they landed.
          if (target) setChannelId(target);
        }}
      />
    </section>
  );
}
