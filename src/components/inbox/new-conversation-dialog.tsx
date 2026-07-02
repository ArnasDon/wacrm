'use client';

// ============================================================
// NewConversationDialog
//
// Lets an agent start a thread with a phone number that has no
// history yet — the inbox equivalent of resolveConversationByPhone
// (the same helper the public API's phone-based send uses). Submits
// through /api/whatsapp/send with a `phone` (instead of
// conversation_id/contact_id), which finds-or-creates the contact +
// conversation and sends the first message in one round trip.
//
// Provider selection only shows up when the account has BOTH Meta and
// Uazapi connected — with a single provider there's nothing to choose.
// ============================================================

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, MessageSquarePlus } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new/matched conversation's id after a successful send. */
  onCreated: (conversationId: string) => void;
}

type ProviderOption = 'meta' | 'uazapi';

export function NewConversationDialog({
  open,
  onOpenChange,
  onCreated,
}: NewConversationDialogProps) {
  const t = useTranslations('inbox.newConversationDialog');
  const tCommon = useTranslations('common');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [provider, setProvider] = useState<ProviderOption | ''>('');
  const [availableProviders, setAvailableProviders] = useState<ProviderOption[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Only offer a provider choice when the account has more than one
  // connected — otherwise it's a pointless extra field.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;
      if (!userId) return;
      const { data: acct } = await supabase
        .from('profiles')
        .select('account_id')
        .eq('user_id', userId)
        .maybeSingle();
      const accountId = acct?.account_id as string | undefined;
      if (!accountId) return;
      const { data: configs } = await supabase
        .from('whatsapp_config')
        .select('provider, is_default, status')
        .eq('account_id', accountId)
        .eq('status', 'connected');
      if (cancelled || !configs) return;
      const providers = configs.map((c) => c.provider as ProviderOption);
      setAvailableProviders(providers);
      const defaultProvider = configs.find((c) => c.is_default)?.provider as
        | ProviderOption
        | undefined;
      setProvider(defaultProvider || providers[0] || '');
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  function reset() {
    setPhone('');
    setName('');
    setText('');
    setProvider('');
    setAvailableProviders([]);
    setSubmitting(false);
  }

  async function handleSubmit() {
    const sanitized = sanitizePhoneForMeta(phone);
    if (!isValidE164(sanitized)) {
      toast.error(t('toasts.invalidPhone'));
      return;
    }
    if (!text.trim()) {
      toast.error(t('toasts.emptyMessage'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: sanitized,
          contact_name: name.trim() || undefined,
          provider: provider || undefined,
          message_type: 'text',
          content_text: text.trim(),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || t('toasts.sendFailed'));
        return;
      }

      toast.success(t('toasts.sent'));
      onCreated(data.conversation_id);
      onOpenChange(false);
    } catch (err) {
      console.error('[NewConversationDialog] send failed:', err);
      toast.error(t('toasts.networkError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="bg-popover border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <MessageSquarePlus className="size-4 text-primary" />
            {t('title')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('phoneLabel')}</Label>
            <Input
              placeholder={t('phonePlaceholder')}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">
              {t('nameLabel')} <span className="text-muted-foreground">{t('optional')}</span>
            </Label>
            <Input
              placeholder={t('namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          {availableProviders.length > 1 && (
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('sendVia')}</Label>
              <Select
                value={provider}
                onValueChange={(v) => v && setProvider(v as ProviderOption)}
              >
                <SelectTrigger className="w-full bg-muted border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableProviders.includes('meta') && (
                    <SelectItem value="meta">{t('providerMeta')}</SelectItem>
                  )}
                  {availableProviders.includes('uazapi') && (
                    <SelectItem value="uazapi">{t('providerUazapi')}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('messageLabel')}</Label>
            <Textarea
              placeholder={t('messagePlaceholder')}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground min-h-24"
            />
          </div>
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {tCommon('actions.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t('sending')}
              </>
            ) : (
              t('sendButton')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
