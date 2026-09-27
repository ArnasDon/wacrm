'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Phone, Calendar, MapPin, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import type { SiteVisit, Contact, Property } from '@/types';
import { ScheduleVisitSheet } from '@/components/site-visits/schedule-visit-sheet';
import { PullToRefresh } from '@/components/layout/pull-to-refresh';

import { format, isToday, isPast, isFuture } from 'date-fns';

type VisitWithDetails = SiteVisit & {
  contact: Contact | null;
  property: Property | null;
};

export default function SiteVisitsPage() {
  const t = useTranslations('SiteVisits.page');
  const supabase = createClient();
  const canEdit = useCan('send-messages');

  const [visits, setVisits] = useState<VisitWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [search, setSearch] = useState('');

  const fetchVisits = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('site_visits')
      .select('*, contact:contacts(*), property:properties(*)')
      .order('scheduled_at', { ascending: true });

    if (error) {
      toast.error(t('errorLoad'));
    } else {
      setVisits(data as VisitWithDetails[]);
    }
    setLoading(false);
  }, [supabase, t]);

  useEffect(() => {
    setTimeout(fetchVisits, 0);
  }, [fetchVisits]);

  async function updateStatus(id: string, newStatus: string) {
    const { error } = await supabase
      .from('site_visits')
      .update({ status: newStatus })
      .eq('id', id);

    if (error) {
      toast.error(t('toastStatusError'));
    } else {
      toast.success(t('toastStatusUpdated'));
      fetchVisits();
    }
  }

  const filteredVisits = visits.filter((v) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return (
      v.contact?.name?.toLowerCase().includes(term) ||
      v.contact?.phone?.toLowerCase().includes(term) ||
      v.property?.title?.toLowerCase().includes(term)
    );
  });

  const todayVisits = filteredVisits.filter(
    (v) => v.scheduled_at && isToday(new Date(v.scheduled_at))
  );
  const upcomingVisits = filteredVisits.filter(
    (v) =>
      v.scheduled_at &&
      isFuture(new Date(v.scheduled_at)) &&
      !isToday(new Date(v.scheduled_at))
  );
  const pastVisits = filteredVisits
    .filter(
      (v) =>
        v.scheduled_at &&
        isPast(new Date(v.scheduled_at)) &&
        !isToday(new Date(v.scheduled_at))
    )
    .reverse();

  function VisitCard({ visit }: { visit: VisitWithDetails }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statusVariant = `visit-${visit.status}` as any;

    const statusLabelKey = `status${visit.status
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('')}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const statusLabel = t(statusLabelKey as any) || visit.status;

    return (
      <div className="border-border bg-card overflow-hidden rounded-lg border p-4 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-foreground truncate font-medium">
              {visit.contact?.name || visit.contact?.phone || 'Unknown Contact'}
            </h3>
            {visit.property && (
              <p className="text-muted-foreground mt-0.5 truncate text-sm">
                <MapPin className="mr-1 inline-block size-3" />
                {visit.property.title}
              </p>
            )}
            <p className="text-muted-foreground mt-1 text-xs">
              <Calendar className="mr-1 inline-block size-3" />
              {visit.scheduled_at
                ? format(new Date(visit.scheduled_at), 'h:mm a')
                : 'Unscheduled'}
            </p>
          </div>
          <Badge variant={statusVariant}>{statusLabel}</Badge>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <a href={`tel:${visit.contact?.phone}`} className="flex-1">
            <Button variant="outline" size="sm" className="w-full">
              <Phone className="mr-1.5 size-3.5" />
              {t('call')}
            </Button>
          </a>
          <a
            href={`https://wa.me/${visit.contact?.phone?.replace(/[^0-9]/g, '')}`}
            target="_blank"
            rel="noreferrer"
            className="flex-1"
          >
            <Button variant="outline" size="sm" className="w-full">
              <span className="mr-1.5 font-bold">W</span>
              {t('whatsapp')}
            </Button>
          </a>
        </div>

        {visit.status === 'pending' && canEdit && (
          <div className="mt-2 flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={() => updateStatus(visit.id, 'confirmed')}
            >
              {t('confirm')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground flex-1"
              onClick={() => updateStatus(visit.id, 'rescheduled')}
            >
              {t('reschedule')}
            </Button>
          </div>
        )}

        {visit.status === 'confirmed' && canEdit && (
          <div className="mt-2 flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={() => updateStatus(visit.id, 'completed')}
            >
              {t('markCompleted')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="flex-1"
              onClick={() => updateStatus(visit.id, 'no_show')}
            >
              {t('markNoShow')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <PullToRefresh onRefresh={fetchVisits}>
      <div className="space-y-6 pb-20">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-foreground text-2xl font-bold">{t('title')}</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('subtitle')}
            </p>
          </div>
          <GatedButton
            canAct={canEdit}
            gateReason="schedule visits"
            onClick={() => setScheduleOpen(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="mr-1 size-4" />
            {t('scheduleBtn')}
          </GatedButton>
        </div>

        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search visits..."
            className="bg-card border-border text-foreground placeholder:text-muted-foreground pl-8"
          />
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="text-primary size-6 animate-spin" />
            <p className="text-muted-foreground mt-2 text-sm">{t('loading')}</p>
          </div>
        ) : visits.length === 0 ? (
          <div className="flex flex-col items-center py-12">
            <Calendar className="text-muted-foreground size-8" />
            <p className="text-muted-foreground mt-2 text-sm">
              {t('noVisits')}
            </p>
            <GatedButton
              canAct={canEdit}
              gateReason="schedule visits"
              variant="outline"
              size="sm"
              onClick={() => setScheduleOpen(true)}
              className="mt-4"
            >
              {t('scheduleBtn')}
            </GatedButton>
          </div>
        ) : (
          <div className="space-y-6">
            {todayVisits.length > 0 && (
              <div>
                <h2 className="text-foreground mb-3 text-lg font-semibold">
                  {t('today')}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {todayVisits.map((v) => (
                    <VisitCard key={v.id} visit={v} />
                  ))}
                </div>
              </div>
            )}
            {upcomingVisits.length > 0 && (
              <div>
                <h2 className="text-foreground mb-3 text-lg font-semibold">
                  {t('upcoming')}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {upcomingVisits.map((v) => (
                    <VisitCard key={v.id} visit={v} />
                  ))}
                </div>
              </div>
            )}
            {pastVisits.length > 0 && (
              <div>
                <h2 className="text-foreground mb-3 text-lg font-semibold">
                  {t('past')}
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {pastVisits.map((v) => (
                    <VisitCard key={v.id} visit={v} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <ScheduleVisitSheet
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          onSuccess={fetchVisits}
        />
      </div>
    </PullToRefresh>
  );
}
