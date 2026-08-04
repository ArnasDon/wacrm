'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Layers, Loader2, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslations } from 'next-intl';
import type { SegmentSummary, Tag } from '@/types';
import { groupTagsByCategory } from '@/lib/contacts/tag-categories';
import {
  createSegment,
  deleteSegment,
  listSegmentsWithCounts,
  updateSegment,
} from '@/lib/segments/queries';

interface SegmentsManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type View = 'list' | 'form';

/**
 * Segments are saved tag combinations that resolve to a live contact
 * list (AND — a contact must carry every selected tag). Opened from
 * the dashboard's quick actions; structured so a future Broadcasts/
 * Automations audience picker can reuse `listSegmentsWithCounts` +
 * a segment's `tag_ids` directly (same shape the AND-filter tag
 * pickers there already consume).
 */
export function SegmentsManagerDialog({ open, onOpenChange }: SegmentsManagerDialogProps) {
  const t = useTranslations('Segments');
  const supabase = createClient();
  const { user, accountId } = useAuth();

  const [view, setView] = useState<View>('list');
  const [loading, setLoading] = useState(true);
  const [segments, setSegments] = useState<SegmentSummary[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<SegmentSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [segs, tagsRes] = await Promise.all([
        listSegmentsWithCounts(supabase),
        supabase.from('tags').select('*').order('name'),
      ]);
      setSegments(segs);
      setAllTags((tagsRes.data ?? []) as Tag[]);
    } catch (err) {
      console.error('Failed to load segments:', err);
      toast.error(t('toastLoadFailed'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    setView('list');
    loadData();
  }, [open, loadData]);

  function openCreateForm() {
    setEditingId(null);
    setName('');
    setSelectedTagIds([]);
    setView('form');
  }

  function openEditForm(segment: SegmentSummary) {
    setEditingId(segment.id);
    setName(segment.name);
    setSelectedTagIds(segment.tag_ids);
    setView('form');
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error(t('nameRequired'));
      return;
    }
    if (selectedTagIds.length === 0) {
      toast.error(t('tagsRequired'));
      return;
    }
    if (!user || !accountId) {
      toast.error(t('notAuthenticated'));
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await updateSegment(supabase, editingId, { name: name.trim(), tagIds: selectedTagIds });
        toast.success(t('toastUpdated'));
      } else {
        await createSegment(supabase, {
          accountId,
          userId: user.id,
          name: name.trim(),
          tagIds: selectedTagIds,
        });
        toast.success(t('toastCreated'));
      }
      setView('list');
      await loadData();
    } catch (err) {
      console.error('Failed to save segment:', err);
      toast.error(t('toastSaveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteSegment(supabase, deleteTarget.id);
      toast.success(t('toastDeleted'));
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      console.error('Failed to delete segment:', err);
      toast.error(t('toastDeleteFailed'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="size-4 text-primary" />
              {view === 'form' ? (editingId ? t('editTitle') : t('newTitle')) : t('title')}
            </DialogTitle>
            <DialogDescription>
              {view === 'form' ? t('formDescription') : t('description')}
            </DialogDescription>
          </DialogHeader>

          {view === 'list' ? (
            <div className="space-y-4">
              <Button onClick={openCreateForm} className="w-full sm:w-auto">
                <Plus className="size-4" />
                {t('newSegment')}
              </Button>

              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-6 animate-spin text-primary" />
                </div>
              ) : segments.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t('noSegments')}</p>
              ) : (
                <ul className="space-y-2">
                  {segments.map((segment) => (
                    <li
                      key={segment.id}
                      className="flex items-center justify-between rounded-lg border border-border bg-card/50 px-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Users className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {segment.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t('contactCount', { count: segment.contact_count })}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditForm(segment)}
                          aria-label={t('editAria', { name: segment.name })}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(segment)}
                          aria-label={t('deleteAria', { name: segment.name })}
                        >
                          <Trash2 className="size-4 text-red-400" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-foreground">{t('segmentName')}</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('segmentNamePlaceholder')}
                  disabled={saving}
                  maxLength={60}
                />
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium text-foreground">{t('includedTags')}</label>
                {allTags.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('noTagsFound')}</p>
                ) : (
                  <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-border p-3">
                    {groupTagsByCategory(allTags).map(([category, group]) => (
                      <div key={category ?? '__none__'}>
                        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {category ?? t('noCategory')}
                        </p>
                        <div className="space-y-1">
                          {group.map((tag) => (
                            <label
                              key={tag.id}
                              className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-muted/50"
                            >
                              <Checkbox
                                checked={selectedTagIds.includes(tag.id)}
                                onCheckedChange={() => toggleTag(tag.id)}
                                aria-label={tag.name}
                              />
                              <span
                                className="size-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: tag.color }}
                              />
                              <span className="text-sm text-foreground">{tag.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            {view === 'form' ? (
              <>
                <Button variant="ghost" onClick={() => setView('list')} disabled={saving}>
                  <ArrowLeft className="size-4" />
                  {t('back')}
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  {t('save')}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('close')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('deleteTitle')}</DialogTitle>
            <DialogDescription>
              {deleteTarget ? t('deleteConfirm', { name: deleteTarget.name }) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t('deleteTitle')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
