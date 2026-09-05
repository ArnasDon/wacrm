'use client';

// ============================================================
// AssistantLauncher — the owner-only entry point to the AI assistant
// from anywhere in the dashboard (not just the /agents page's own
// tab). Self-contained: reads its own auth state and renders nothing
// for non-owners, so `<Header>` doesn't need to know or care about
// roles.
// ============================================================

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

// Code-split: `<Header>` mounts this launcher on every dashboard page
// for every signed-in user, but the assistant chat itself is owner-
// only and only ever needed once someone actually opens the dialog.
// A static import would ship its whole bundle (chat state, business-
// action rendering, etc.) to agents/viewers who can never open it.
const AiAssistant = dynamic(
  () => import('./ai-assistant').then((m) => m.AiAssistant),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-12">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    ),
  }
);

export function AssistantLauncher() {
  const { isOwner } = useAuth();
  const [open, setOpen] = useState(false);

  if (!isOwner) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 rounded-full border-border bg-muted px-3 text-foreground hover:bg-muted/70"
          />
        }
      >
        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
        <span className="hidden sm:inline">Assistant</span>
      </DialogTrigger>
      <DialogContent className="border-border bg-popover sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Assistant</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Owner-only. Ask about your business or ask it to do something —
            any change is proposed first, nothing runs until you confirm it.
          </DialogDescription>
        </DialogHeader>
        <AiAssistant />
      </DialogContent>
    </Dialog>
  );
}
