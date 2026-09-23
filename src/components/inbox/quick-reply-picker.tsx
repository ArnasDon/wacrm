'use client';

import { useEffect, useState } from 'react';
import { Loader2, MessageSquare, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { QuickReply } from '@/types';
import { interactivePayloadPreviewText } from '@/lib/whatsapp/interactive';

interface QuickReplyPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (qr: QuickReply) => void;
}

/**
 * Lists the account's saved quick replies for insertion into the
 * composer. Text snippets fill the textarea; interactive snippets open
 * the builder pre-filled (handled by the caller's `onPick`).
 */
export function QuickReplyPicker({
  open,
  onOpenChange,
  onPick,
}: QuickReplyPickerProps) {
  const t = useTranslations('Inbox.composer');
  const [items, setItems] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch('/api/quick-replies', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setItems((data.quick_replies as QuickReply[]) ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('quickReplies')}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {t('quickRepliesEmpty')}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((qr) => (
                <li key={qr.id}>
                  <button
                    type="button"
                    onClick={() => onPick(qr)}
                    className="border-border bg-muted/40 hover:border-primary/50 hover:bg-muted flex w-full items-start gap-2 rounded-md border p-2.5 text-left"
                  >
                    {qr.kind === 'interactive' ? (
                      <Zap className="text-primary mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                      <MessageSquare className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground block truncate text-sm font-medium">
                        {qr.title}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {qr.kind === 'interactive' && qr.interactive_payload
                          ? interactivePayloadPreviewText(
                              qr.interactive_payload
                            )
                          : qr.content_text}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
