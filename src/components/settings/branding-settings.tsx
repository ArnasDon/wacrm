'use client';

// ============================================================
// BrandingSettings — Settings → Branding
//
// Per-account branding: the workspace name + logo shown in the sidebar
// brand row (and anywhere else account branding surfaces later). Admin+
// only. Saves via PATCH /api/account (accounts.name + accounts.logo_url,
// migration 028) then calls refreshProfile() so the sidebar updates
// without a reload. Logo upload reuses the account-scoped storage helper
// (same bucket as avatars / the AI persona logo).
// ============================================================

import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { Loader2, Upload, Trash2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { uploadAccountMedia } from '@/lib/storage/upload-media';
import { RequireRole } from '@/components/auth/require-role';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

const LOGO_BUCKET = 'chat-media';
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_NAME_LEN = 80;

export function BrandingSettings() {
  return (
    <RequireRole
      min="admin"
      fallback={
        <section className="animate-in fade-in-50 duration-200">
          <SettingsPanelHead
            title="Branding"
            description="Your workspace name and logo, shown across the app."
          />
          <Card>
            <CardContent className="text-muted-foreground py-10 text-center text-sm">
              Only admins can change workspace branding.
            </CardContent>
          </Card>
        </section>
      }
    >
      <BrandingSettingsInner />
    </RequireRole>
  );
}

function BrandingSettingsInner() {
  const { account, refreshProfile } = useAuth();
  const [name, setName] = useState(account?.name ?? '');
  const [logoUrl, setLogoUrl] = useState<string | null>(
    account?.logo_url ?? null
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty =
    name.trim() !== (account?.name ?? '') ||
    (logoUrl ?? null) !== (account?.logo_url ?? null);

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!LOGO_ALLOWED_MIME.has(file.type)) {
      toast.error('Unsupported image type', {
        description: 'Use PNG, JPG, or WebP.',
      });
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      toast.error('Image is too large', { description: 'Maximum 2 MB.' });
      return;
    }
    setUploading(true);
    try {
      const { publicUrl } = await uploadAccountMedia(LOGO_BUCKET, file);
      setLogoUrl(publicUrl);
      toast.success('Logo uploaded. Save to apply.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Workspace name cannot be empty');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, logo_url: logoUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(data?.error || `Save failed (HTTP ${res.status})`);
      await refreshProfile(); // updates the sidebar brand live
      toast.success('Branding saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const initial = (name || 'A').charAt(0).toUpperCase();

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title="Branding"
        description="Your workspace name and logo, shown in the sidebar and across the app."
      />

      <Card>
        <CardContent className="space-y-6 py-6">
          <div className="flex flex-wrap items-center gap-5">
            <Avatar size="lg" className="size-16">
              {logoUrl ? (
                <AvatarImage src={logoUrl} alt={name || 'Logo'} />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-primary text-base">
                {initial}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={onPickLogo}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Upload className="size-4" />
                )}
                {logoUrl ? 'Change logo' : 'Upload logo'}
              </Button>
              {logoUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setLogoUrl(null)}
                  disabled={uploading}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Trash2 className="size-4" />
                  Remove
                </Button>
              )}
              <p className="text-muted-foreground w-full text-xs">
                PNG, JPG, or WebP. Up to 2 MB. Shown next to your workspace
                name.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="workspace-name" className="text-muted-foreground">
              Workspace name
            </Label>
            <Input
              id="workspace-name"
              value={name}
              maxLength={MAX_NAME_LEN}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Logistics"
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground max-w-md"
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving || uploading || !dirty}>
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Saving…
            </>
          ) : (
            'Save changes'
          )}
        </Button>
      </div>
    </section>
  );
}
