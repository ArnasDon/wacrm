'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  AlertCircle,
  Pencil,
  RotateCcw,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { MessageTemplate } from '@/types';
import { templateStatusConfig } from '@/lib/template-status';
import { canSendMediaHeader } from '@/lib/whatsapp/template-validators';
import { cn } from '@/lib/utils';

const categoryColors: Record<string, string> = {
  Marketing: 'bg-purple-600/20 text-purple-400 border-purple-600/30',
  Utility: 'bg-blue-600/20 text-blue-400 border-blue-600/30',
  Authentication: 'bg-amber-600/20 text-amber-400 border-amber-600/30',
};

export function TemplateManager() {
  const supabase = createClient();
  const { user, accountId, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [templateToDelete, setTemplateToDelete] =
    useState<MessageTemplate | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    void fetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id, accountId]);

  async function fetchTemplates() {
    try {
      setLoading(true);
      let query = supabase
        .from('message_templates')
        .select('*')
        .order('created_at', { ascending: false });
      if (accountId) {
        query = query.eq('account_id', accountId);
      } else if (user?.id) {
        query = query.eq('user_id', user.id);
      } else {
        setTemplates([]);
        return;
      }
      const { data, error } = await query;
      if (error) throw error;
      setTemplates(data || []);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
      toast.error('Failed to load templates');
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncFromMeta() {
    if (!user) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/whatsapp/templates/sync', { method: 'POST' });
      let data: Record<string, unknown> = {};
      try {
        data = await res.json();
      } catch {
        throw new Error(`Server returned an invalid response (HTTP ${res.status})`);
      }
      if (!res.ok) {
        throw new Error(
          typeof data?.error === 'string'
            ? data.error
            : String(data?.error || `Sync failed (HTTP ${res.status})`),
        );
      }
      toast.success(
        `Synced ${data.total} template${data.total === 1 ? '' : 's'} from Meta` +
          (data.inserted || data.updated
            ? ` (${data.inserted} new, ${data.updated} updated)`
            : ''),
      );
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        const preview = data.errors.slice(0, 3).map(
          (e: { name: string; language: string; message: string }) =>
            `${e.name} (${e.language})`,
        );
        const suffix =
          data.errors.length > 3 ? `, +${data.errors.length - 3} more` : '';
        toast.error(`Failed to sync: ${preview.join(', ')}${suffix}`);
      }
      if (data.truncated) {
        toast.error(
          'Synced the first 2000 templates only — your account has more. Sync again to continue, or contact support if this persists.',
          { duration: 10000 },
        );
      }
      await fetchTemplates();
    } catch (err) {
      console.error('Template sync error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to sync templates');
    } finally {
      setSyncing(false);
    }
  }

  async function confirmDelete() {
    const target = templateToDelete;
    if (!target || deletingId) return;
    setDeletingId(target.id);
    try {
      const res = await fetch(`/api/whatsapp/templates/${target.id}`, {
        method: 'DELETE',
      });
      let data: Record<string, unknown> = {};
      try {
        data = await res.json();
      } catch {
        if (!res.ok) {
          throw new Error(`Server returned an invalid response (HTTP ${res.status})`);
        }
      }
      if (!res.ok) {
        throw new Error(
          typeof data?.error === 'string'
            ? data.error
            : String(data?.error || `Delete failed (HTTP ${res.status})`),
        );
      }
      toast.success('Template deleted');
      setTemplates((prev) => prev.filter((t) => t.id !== target.id));
      setTemplateToDelete(null);
    } catch (err) {
      console.error('Delete error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to delete template');
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Message Templates</h2>
          <p className="text-sm text-muted-foreground">
            Create templates with a Meta-style wizard: category → library →
            customize with live preview → submit. Sync from Meta for
            Authentication templates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleSyncFromMeta}
            disabled={syncing}
            className="border-border bg-transparent text-foreground/80 hover:bg-muted"
            title="Pull approved templates from your Meta WhatsApp Business Account"
          >
            <RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync from Meta'}
          </Button>
          <Link
            href="/whatsapp/templates/new"
            className={cn(
              buttonVariants(),
              'bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            <Plus className="size-4" />
            New Template
          </Link>
        </div>
      </div>

      {templates.length === 0 ? (
        <Card className="bg-card border-border ring-0 ring-transparent">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground text-sm">No templates yet.</p>
            <p className="text-muted-foreground text-xs mt-1">
              Create your first message template to get started.
            </p>
            <Link
              href="/whatsapp/templates/new"
              className={cn(buttonVariants(), 'mt-4')}
            >
              <Plus className="size-4" />
              Create template
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {templates.map((template) => {
            const statusKey = template.status || 'DRAFT';
            const status = templateStatusConfig[statusKey];
            const canEdit =
              template.category !== 'Authentication' &&
              (statusKey === 'APPROVED' ||
                statusKey === 'REJECTED' ||
                statusKey === 'PAUSED');
            const editHref = `/whatsapp/templates/${template.id}/edit`;

            return (
              <Card
                key={template.id}
                className="bg-card border-border ring-0 ring-transparent"
              >
                <CardContent className="flex items-start justify-between pt-4">
                  <div className="space-y-2 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-foreground">{template.name}</h3>
                      <Badge
                        className={`text-xs border ${categoryColors[template.category] || ''}`}
                      >
                        {template.category}
                      </Badge>
                      <Badge className={`text-xs border ${status.classes}`}>
                        {status.label}
                      </Badge>
                      {template.language && (
                        <span className="text-xs text-muted-foreground uppercase">
                          {template.language}
                        </span>
                      )}
                      {template.quality_score && (
                        <span
                          className={`text-[10px] uppercase font-medium ${
                            template.quality_score === 'GREEN'
                              ? 'text-emerald-600'
                              : template.quality_score === 'YELLOW'
                                ? 'text-yellow-400'
                                : 'text-red-400'
                          }`}
                          title="Meta quality score"
                        >
                          {template.quality_score}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {template.body_text}
                    </p>
                    {template.footer_text && (
                      <p className="text-xs text-muted-foreground italic">
                        {template.footer_text}
                      </p>
                    )}
                    {(template.rejection_reason || template.submission_error) && (
                      <div className="flex items-start gap-1.5 text-xs text-red-400 bg-red-950/20 border border-red-900/40 rounded px-2 py-1.5">
                        <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                        <span>
                          {template.rejection_reason || template.submission_error}
                        </span>
                      </div>
                    )}
                    {statusKey === 'APPROVED' && !canSendMediaHeader(template) && (
                      <div className="flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                        <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                        <span>
                          This template has a media header but no sendable media
                          source — open Edit to add a public URL, or run Sync from
                          Meta.
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {canEdit && statusKey === 'APPROVED' && (
                      <Link
                        href={editHref}
                        title="Editing triggers Meta re-review — status flips to PENDING."
                        aria-label="Edit template"
                        className={cn(
                          buttonVariants({ variant: 'ghost', size: 'sm' }),
                          'h-8 px-2 text-foreground/80 hover:bg-primary/10 hover:text-primary',
                        )}
                      >
                        <Pencil className="size-3.5" />
                        Edit
                      </Link>
                    )}
                    {canEdit &&
                      (statusKey === 'REJECTED' || statusKey === 'PAUSED') && (
                        <Link
                          href={editHref}
                          title="Edit the template and resubmit to Meta for review."
                          aria-label="Edit and resubmit template"
                          className={cn(
                            buttonVariants({ variant: 'ghost', size: 'sm' }),
                            'h-8 px-2 text-foreground/80 hover:bg-primary/10 hover:text-primary',
                          )}
                        >
                          <RotateCcw className="size-3.5" />
                          Resubmit
                        </Link>
                      )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setTemplateToDelete(template)}
                      disabled={deletingId === template.id}
                      aria-label={
                        template.meta_template_id
                          ? 'Delete template from Meta and locally'
                          : 'Delete template locally'
                      }
                      title={
                        template.meta_template_id
                          ? 'Delete from Meta and locally'
                          : 'Delete locally'
                      }
                      className="text-muted-foreground hover:text-red-400 hover:bg-red-950/30 h-8 w-8"
                    >
                      {deletingId === template.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={templateToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setTemplateToDelete(null);
        }}
      >
        <DialogContent className="bg-card border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground">Delete template?</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {templateToDelete?.meta_template_id
                ? `"${templateToDelete?.name}" will be deleted from Meta and from VedMint. Active broadcasts using this template will start failing on their next send. This can't be undone.`
                : `"${templateToDelete?.name}" will be deleted from VedMint. It was never submitted to Meta, so no remote cleanup is needed.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-card border-border">
            <Button
              variant="outline"
              onClick={() => setTemplateToDelete(null)}
              disabled={deletingId !== null}
              className="border-border text-foreground/80 hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmDelete}
              disabled={deletingId !== null}
              className="bg-red-600 hover:bg-red-700 text-foreground"
            >
              {deletingId !== null ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
