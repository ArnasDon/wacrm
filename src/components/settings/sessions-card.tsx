'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, LogOut } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export function SessionsCard() {
  const t = useTranslations('settings.sessions');
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const onConfirm = async () => {
    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: 'global' });
      if (error) {
        toast.error(`Sign-out failed: ${error.message}`);
        return;
      }
      window.location.href = '/login';
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(msg);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <LogOut className="size-4 text-primary" />
            {t('title')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(true)}
          >
            <LogOut className="size-4" />
            {t('signOutAll')}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('confirmDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={signingOut}
            >
              {t('cancel')}
            </Button>
            <Button type="button" onClick={onConfirm} disabled={signingOut}>
              {signingOut ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('signingOut')}
                </>
              ) : (
                t('signOut')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
