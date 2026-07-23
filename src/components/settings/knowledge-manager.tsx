'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface KnowledgeDocument {
  id: string;
  title: string;
  content?: string | null;
  source_type: string;
  updated_at: string;
}

interface Draft {
  id: string | null;
  title: string;
  content: string;
}

const EMPTY_DRAFT: Draft = { id: null, title: '', content: '' };

export function KnowledgeManager() {
  const t = useTranslations('Settings.agent.knowledge');
  const tAgent = useTranslations('Settings.agent');
  const { canEditSettings, profileLoading } = useAuth();
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/knowledge', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? tAgent('saveError'));
        return;
      }
      setDocuments((data.documents as KnowledgeDocument[]) ?? []);
    } catch {
      toast.error(tAgent('saveError'));
    } finally {
      setLoading(false);
    }
  }, [tAgent]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(
        draft.id ? `/api/ai/knowledge/${draft.id}` : '/api/ai/knowledge',
        {
          method: draft.id ? 'PUT' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: draft.title, content: draft.content }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? tAgent('saveError'));
        return;
      }
      toast.success(t('saved'));
      setDraft(EMPTY_DRAFT);
      await loadDocuments();
    } catch {
      toast.error(tAgent('saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/ai/knowledge/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? tAgent('saveError'));
        return;
      }
      if (draft.id === id) setDraft(EMPTY_DRAFT);
      toast.success(t('deleted'));
      await loadDocuments();
    } catch {
      toast.error(tAgent('saveError'));
    } finally {
      setDeletingId(null);
    }
  };

  const disabled = !canEditSettings || profileLoading;

  return (
    <section className="space-y-4" aria-labelledby="knowledge-title">
      <div>
        <h2
          id="knowledge-title"
          className="text-foreground text-base font-semibold"
        >
          {t('title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('description')}</p>
      </div>

      <div className="border-border space-y-3 border-y py-4">
        <div className="space-y-1.5">
          <Label htmlFor="knowledge-title-input">{t('documentTitle')}</Label>
          <Input
            id="knowledge-title-input"
            value={draft.title}
            onChange={(event) =>
              setDraft((current) => ({ ...current, title: event.target.value }))
            }
            disabled={disabled || saving}
            className="bg-muted text-foreground"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="knowledge-content-input">
            {t('documentContent')}
          </Label>
          <Textarea
            id="knowledge-content-input"
            value={draft.content}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                content: event.target.value,
              }))
            }
            disabled={disabled || saving}
            className="bg-muted text-foreground min-h-32"
          />
        </div>
        {!canEditSettings && !profileLoading ? (
          <p className="text-muted-foreground text-xs">
            {tAgent('adminOnlyHint')}
          </p>
        ) : null}
        <Button
          onClick={handleSave}
          disabled={
            disabled || saving || !draft.title.trim() || !draft.content.trim()
          }
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {saving ? t('saving') : t('save')}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
        </div>
      ) : documents.length === 0 ? (
        <p className="text-muted-foreground py-2 text-sm">{t('empty')}</p>
      ) : (
        <ul className="divide-border border-border divide-y border-y">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex min-w-0 items-center gap-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-sm font-medium">
                  {document.title}
                </p>
                <p className="text-muted-foreground text-xs">
                  {document.source_type}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() =>
                    setDraft({
                      id: document.id,
                      title: document.title,
                      content: document.content ?? '',
                    })
                  }
                  disabled={disabled || saving || deletingId === document.id}
                  aria-label={t('edit')}
                  title={t('edit')}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void handleDelete(document.id)}
                  disabled={disabled || saving || deletingId === document.id}
                  aria-label={t('delete')}
                  title={t('delete')}
                  className="text-destructive hover:text-destructive"
                >
                  {deletingId === document.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
