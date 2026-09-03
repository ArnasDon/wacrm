'use client';

// ============================================================
// WorkspaceNameCard — rename the account (admin+).
//
// Why this exists
//   `handle_new_user` (migration 017) seeds `accounts.name` from
//   the owner's own `full_name`, and until now nothing in the UI
//   called `PATCH /api/account`. So every workspace kept a person's
//   name forever, and every invite link rendered "You're invited to
//   join <owner's personal name>" — the same string for every
//   invitee, which reads like the invite is addressed to that
//   person rather than sent by them.
//
//   The join page now prints per-invite context (who sent it, who
//   it was for). This is the other half: let admins put the real
//   business name on the workspace.
//
// The live preview under the input quotes the exact join-page
// headline, so the effect of the rename is visible before saving —
// the invite page is the one place this string is seen by people
// outside the workspace, and admins never see it themselves.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Building2, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';

// Mirrors MAX_NAME_LEN in src/app/api/account/route.ts. Checked here
// too so a paste that overshoots fails locally instead of round-
// tripping to a 400.
const MAX_NAME_LEN = 80;

export function WorkspaceNameCard() {
  const t = useTranslations('Settings.workspace');
  const { account, refreshProfile } = useAuth();

  const serverName = account?.name ?? '';
  const [name, setName] = useState(serverName);
  const [saving, setSaving] = useState(false);

  // Re-seed the field only when the *server* value changes — on first
  // load, and after our own save. A plain `useEffect(..., [account])`
  // would also fire on unrelated profile refreshes and wipe whatever
  // the admin was mid-way through typing.
  const syncedRef = useRef(serverName);
  useEffect(() => {
    if (syncedRef.current !== serverName) {
      syncedRef.current = serverName;
      setName(serverName);
    }
  }, [serverName]);

  const trimmed = name.trim();
  const dirty = trimmed !== serverName.trim();
  const canSave = dirty && trimmed.length > 0 && trimmed.length <= MAX_NAME_LEN;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(payload.error || t('failed'));
        return;
      }
      // Pull the new name back through AuthProvider so the header,
      // the transfer-ownership dialog and the invite dialog's
      // WhatsApp message all pick it up without a page reload.
      await refreshProfile();
      toast.success(t('saved', { name: trimmed }));
    } catch (err) {
      console.error('[WorkspaceNameCard] rename error:', err);
      toast.error(t('failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-2">
          <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t('title')}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('description')}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="workspace-name" className="text-muted-foreground">
            {t('nameLabel')}
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="workspace-name"
              value={name}
              maxLength={MAX_NAME_LEN}
              placeholder={t('placeholder')}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSave();
                }
              }}
              className="bg-muted border-border text-foreground"
            />
            <Button
              type="button"
              onClick={handleSave}
              disabled={!canSave || saving}
              className="shrink-0"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('saving')}
                </>
              ) : (
                t('save')
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('preview', { name: trimmed || t('previewFallback') })}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
