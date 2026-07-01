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
      toast.error('Enter a valid phone number, e.g. +14155550123');
      return;
    }
    if (!text.trim()) {
      toast.error('Write a message to send.');
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
        toast.error(data.error || 'Failed to send message');
        return;
      }

      toast.success('Message sent.');
      onCreated(data.conversation_id);
      onOpenChange(false);
    } catch (err) {
      console.error('[NewConversationDialog] send failed:', err);
      toast.error('Could not reach the server. Try again?');
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
            New conversation
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Message a phone number that isn&apos;t in your contacts yet. It&apos;ll
            appear in the conversation list right after you send.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-muted-foreground">Phone number</Label>
            <Input
              placeholder="+14155550123"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">
              Name <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              placeholder="For your contacts list"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          {availableProviders.length > 1 && (
            <div className="space-y-2">
              <Label className="text-muted-foreground">Send via</Label>
              <Select
                value={provider}
                onValueChange={(v) => v && setProvider(v as ProviderOption)}
              >
                <SelectTrigger className="w-full bg-muted border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableProviders.includes('meta') && (
                    <SelectItem value="meta">Meta (official)</SelectItem>
                  )}
                  {availableProviders.includes('uazapi') && (
                    <SelectItem value="uazapi">Uazapi</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-muted-foreground">Message</Label>
            <Textarea
              placeholder="Type the first message…"
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
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Sending…
              </>
            ) : (
              'Send'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
