'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, LogOut } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';

export function LeaveAccountCard({ memberCount }: { memberCount: number }) {
  const t = useTranslations('Settings.members');
  const router = useRouter();
  const { account, accountRole, isOwner, refreshProfile } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  if (!accountRole) return null;
  if (isOwner && memberCount <= 1) return null;

  const accountName = account?.name || t('thisAccount');

  async function handleLeave() {
    setLeaving(true);
    try {
      const res = await fetch('/api/account/leave', { method: 'POST' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('leaveFailed'));
        setLeaving(false);
        return;
      }
      toast.success(t('leftToast', { account: accountName }));
      await refreshProfile();
      router.replace('/dashboard');
      router.refresh();
    } catch (err) {
      console.error('[LeaveAccountCard] leave error:', err);
      toast.error(t('networkError'));
      setLeaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            {t('leaveTitle')}
          </h3>
          <p className="mt-1 max-w-[62ch] text-xs text-muted-foreground">
            {isOwner ? t('ownerCannotLeave') : t('leaveDescription')}
          </p>
        </div>
        <Button
          variant="destructive"
          className="shrink-0"
          disabled={isOwner || leaving}
          onClick={() => setConfirmOpen(true)}
        >
          <LogOut className="size-4" />
          {t('leaveBtn')}
        </Button>
      </CardContent>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!leaving) setConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('leaveDialogTitle', { account: accountName })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('leaveDialogDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaving}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleLeave} disabled={leaving}>
              {leaving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('leaving')}
                </>
              ) : (
                t('leaveBtn')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
