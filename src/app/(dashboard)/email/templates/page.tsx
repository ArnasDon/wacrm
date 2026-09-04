'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, Plus, LayoutTemplate, Zap, Newspaper } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { EmailNav } from '@/components/email/email-nav';
import { ListmonkGate } from '@/components/email/listmonk-status';
import type { ListmonkTemplate } from '@/lib/listmonk/types';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

export default function EmailTemplatesPage() {
  const t = useTranslations('Email.templates');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-foreground text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>
      <EmailNav />
      <ListmonkGate>{() => <TemplatesTable />}</ListmonkGate>
    </div>
  );
}

function TemplatesTable() {
  const router = useRouter();
  const t = useTranslations('Email.templates');
  const canEdit = useCan('edit-settings');
  const [templates, setTemplates] = useState<ListmonkTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/email/templates?type=all');
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Failed');
      setTemplates(d.templates ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  const tx = templates.filter((x) => x.type === 'tx');
  const campaign = templates.filter((x) => x.type !== 'tx');

  return (
    <div className="space-y-6">
      <div className="flex justify-end gap-2">
        <GatedButton
          canAct={canEdit}
          gateReason="create email templates"
          variant="outline"
          onClick={() => router.push('/email/templates/new?type=campaign')}
        >
          <Newspaper className="h-4 w-4" />
          {t('newCampaignTemplate')}
        </GatedButton>
        <GatedButton
          canAct={canEdit}
          gateReason="create email templates"
          onClick={() => router.push('/email/templates/new?type=tx')}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t('newAutomationTemplate')}
        </GatedButton>
      </div>

      <Section
        icon={Zap}
        title={t('txHeading')}
        help={t('txHelp')}
        rows={tx}
        emptyText={t('txEmpty')}
        onOpen={(id) => router.push(`/email/templates/${id}`)}
        t={t}
      />
      <Section
        icon={Newspaper}
        title={t('campaignHeading')}
        help={t('campaignHelp')}
        rows={campaign}
        emptyText={t('campaignEmpty')}
        onOpen={(id) => router.push(`/email/templates/${id}`)}
        t={t}
      />
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  help,
  rows,
  emptyText,
  onOpen,
  t,
}: {
  icon: typeof LayoutTemplate;
  title: string;
  help: string;
  rows: ListmonkTemplate[];
  emptyText: string;
  onOpen: (id: number) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="text-primary h-4 w-4" />
        <h2 className="text-foreground text-sm font-semibold">{title}</h2>
      </div>
      <p className="text-muted-foreground text-xs">{help}</p>
      {rows.length === 0 ? (
        <div className="border-border bg-card text-muted-foreground flex h-24 items-center justify-center rounded-xl border border-dashed text-xs">
          {emptyText}
        </div>
      ) : (
        <div className="border-border bg-card overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">
                  {t('table.name')}
                </TableHead>
                <TableHead className="text-muted-foreground">
                  {t('table.kind')}
                </TableHead>
                <TableHead className="text-muted-foreground text-right">
                  {t('table.default')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((tpl) => (
                <TableRow
                  key={tpl.id}
                  className="border-border hover:bg-muted/50 cursor-pointer"
                  onClick={() => onOpen(tpl.id)}
                >
                  <TableCell className="text-foreground font-medium">
                    {tpl.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {tpl.type === 'tx'
                      ? t('kindTx')
                      : tpl.type === 'campaign_visual'
                        ? t('kindVisual')
                        : t('kindCampaign')}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right text-xs">
                    {tpl.is_default ? '✓' : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
