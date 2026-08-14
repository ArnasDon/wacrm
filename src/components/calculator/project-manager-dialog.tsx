'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import {
  createCalcProject,
  deleteCalcProject,
  updateCalcProject,
  type CalcProjectWithComponents,
} from '@/lib/calculator/queries';
import { ComponentTemplateEditor } from './component-template-editor';
import type { FlowComponentTemplate } from '@/lib/calculator/types';

interface ProjectManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: CalcProjectWithComponents[];
  onProjectsChange: (projects: CalcProjectWithComponents[]) => void;
}

type EditingState =
  | { mode: 'list' }
  | { mode: 'create' }
  | { mode: 'edit'; project: CalcProjectWithComponents };

export function ProjectManagerDialog({
  open,
  onOpenChange,
  projects,
  onProjectsChange,
}: ProjectManagerDialogProps) {
  const t = useTranslations('Calculadora');
  const { accountId, user } = useAuth();
  const [state, setState] = useState<EditingState>({ mode: 'list' });
  const [name, setName] = useState('');
  const [components, setComponents] = useState<FlowComponentTemplate[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) setState({ mode: 'list' });
  }, [open]);

  const startCreate = () => {
    setName('');
    setComponents([]);
    setState({ mode: 'create' });
  };

  const startEdit = (project: CalcProjectWithComponents) => {
    setName(project.name);
    setComponents(project.components);
    setState({ mode: 'edit', project });
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t('projectNameRequired'));
      return;
    }
    if (!accountId || !user?.id) return;
    setSaving(true);
    try {
      const db = createClient();
      if (state.mode === 'create') {
        const created = await createCalcProject(db, {
          accountId,
          userId: user.id,
          name: trimmed,
          components,
        });
        onProjectsChange([...projects, created].sort((a, b) => a.name.localeCompare(b.name)));
        toast.success(t('projectSaved'));
      } else if (state.mode === 'edit') {
        const updated = await updateCalcProject(db, {
          id: state.project.id,
          name: trimmed,
          components,
        });
        onProjectsChange(
          projects
            .map((p) => (p.id === updated.id ? updated : p))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
        toast.success(t('projectSaved'));
      }
      setState({ mode: 'list' });
    } catch {
      toast.error(t('projectSaveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (project: CalcProjectWithComponents) => {
    try {
      const db = createClient();
      await deleteCalcProject(db, project.id);
      onProjectsChange(projects.filter((p) => p.id !== project.id));
      toast.success(t('projectDeleted'));
    } catch {
      toast.error(t('projectDeleteError'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {state.mode === 'list'
              ? t('manageProjects')
              : state.mode === 'create'
                ? t('newProject')
                : t('editProject')}
          </DialogTitle>
        </DialogHeader>

        {state.mode === 'list' ? (
          <div className="flex flex-col gap-3">
            {projects.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                {t('noProjectsYet')}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {projects.map((project) => (
                  <li
                    key={project.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2"
                  >
                    <span className="truncate text-sm font-medium text-foreground">
                      {project.name}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('editProject')}
                        onClick={() => startEdit(project)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('deleteProject')}
                        onClick={() => handleDelete(project)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Button type="button" variant="outline" onClick={startCreate}>
              <Plus className="size-4" />
              {t('newProject')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="calc-project-name">{t('projectName')}</Label>
              <Input
                id="calc-project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('projectNamePlaceholder')}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>{t('flowComponents')}</Label>
              <ComponentTemplateEditor
                components={components}
                onChange={setComponents}
                addLabel={t('addComponent')}
                labelPlaceholder={t('componentLabelPlaceholder')}
                singleKindLabel={t('kindSingle')}
                installmentsKindLabel={t('kindInstallments')}
                defaultLockedLabel={t('lockLabel')}
                defaultCountLabel={t('installmentsCountLabel')}
                defaultPercentLabel={t('percentLabel')}
                emptyStateLabel={t('noComponentsYet')}
                removeLabel={t('remove')}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {state.mode === 'list' ? (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('close')}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setState({ mode: 'list' })}>
                {t('cancel')}
              </Button>
              <Button type="button" onClick={handleSave} disabled={saving}>
                {t('save')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
