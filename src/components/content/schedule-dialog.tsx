'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const MEMBER_ROLES = ['Mechanic', 'Truck Driver', 'Truck Owner', 'BA', 'Other'];

// datetime-local wants "YYYY-MM-DDTHH:mm" in the browser's local time.
function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function ScheduleDialog({
  contentId,
  open,
  onOpenChange,
  availableLanguages,
  onScheduled,
}: {
  contentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableLanguages: string[];
  onScheduled: () => void;
}) {
  const [language, setLanguage] = useState<string>('source');
  const [roles, setRoles] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState(() =>
    toLocalInputValue(new Date(Date.now() + 5 * 60_000))
  );
  const [submitting, setSubmitting] = useState(false);

  function toggleRole(role: string) {
    setRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  async function handleSubmit(sendNow: boolean) {
    setSubmitting(true);
    try {
      const at = sendNow ? new Date() : new Date(scheduledAt);
      if (Number.isNaN(at.getTime())) {
        toast.error('Pick a valid date and time.');
        return;
      }
      const res = await fetch(`/api/content/${contentId}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: language === 'source' ? null : language,
          scheduled_at: at.toISOString(),
          audience: {
            roles: roles.length > 0 ? roles : undefined,
            markets: ['all'],
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to schedule this post.');
        return;
      }
      toast.success(
        sendNow
          ? `Queued for ${data.recipient_count} Members — the next cron run will send it.`
          : `Scheduled for ${data.recipient_count} Members.`
      );
      onOpenChange(false);
      onScheduled();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule this post</DialogTitle>
          <DialogDescription>
            Choose a language variant and audience. Every send — including
            &quot;now&quot; — goes out on the next scheduler run, not
            synchronously.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Language</Label>
            <Select value={language} onValueChange={(v) => v && setLanguage(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="source">
                  Original (source language)
                </SelectItem>
                {availableLanguages.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Audience — Member roles</Label>
            <div className="flex flex-wrap gap-3">
              {MEMBER_ROLES.map((role) => (
                <label key={role} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={roles.includes(role)}
                    onCheckedChange={() => toggleRole(role)}
                  />
                  {role}
                </label>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              Leave every role unchecked to reach all confirmed, opted-in
              Members.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="schedule-at">Send at</Label>
            <Input
              id="schedule-at"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => void handleSubmit(true)}
            disabled={submitting}
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Send now
          </Button>
          <Button
            onClick={() => void handleSubmit(false)}
            disabled={submitting}
          >
            {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
