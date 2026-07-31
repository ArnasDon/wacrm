'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, MessageSquare, Trash2, Upload } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { resizeImageToWebp } from '@/lib/images/resize-to-webp';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useTranslations } from 'next-intl';

const MAX_LOGO_BYTES = 1_000_000;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/**
 * Instance-wide branding (migration 043) — replaces the default
 * "CRM Template for WhatsApp" logo/name shown in the sidebar. A
 * global setting (no account_id), so only admin+ can change it —
 * unlike the theme controls elsewhere on this page, this affects
 * every account on the instance.
 */
export function BrandingCard() {
  const t = useTranslations('Settings.appearance');
  const router = useRouter();
  const supabase = createClient();
  const { user, accountRole } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [brandName, setBrandName] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [pendingLogo, setPendingLogo] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('app_branding')
        .select('logo_url, brand_name')
        .eq('id', true)
        .maybeSingle();
      if (data) {
        setLogoUrl(data.logo_url ?? null);
        setBrandName(data.brand_name ?? '');
      }
      setLoading(false);
    })();
    // Load once on mount — `supabase` is a stable client factory result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const currentLogo = previewUrl ?? (!removeLogo ? logoUrl : null);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!ALLOWED_MIME.has(file.type)) {
      toast.error(t('unsupportedImage'), { description: t('unsupportedImageDesc') });
      return;
    }

    setResizing(true);
    try {
      const blob = await resizeImageToWebp(file, { maxDim: 256, maxBytes: MAX_LOGO_BYTES });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPendingLogo(blob);
      setPreviewUrl(URL.createObjectURL(blob));
      setRemoveLogo(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('resizeFailed'));
    } finally {
      setResizing(false);
    }
  };

  const onRemoveLogo = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingLogo(null);
    setPreviewUrl(null);
    setRemoveLogo(true);
  };

  const onSave = async () => {
    if (!user) return;
    const trimmedName = brandName.trim();
    if (!trimmedName) {
      toast.error(t('nameRequired'));
      return;
    }

    setSaving(true);
    try {
      let nextLogoUrl = logoUrl;

      if (pendingLogo) {
        const { error: uploadError } = await supabase.storage
          .from('branding')
          .upload('logo.webp', pendingLogo, {
            cacheControl: '3600',
            upsert: true,
            contentType: 'image/webp',
          });
        if (uploadError) {
          throw new Error(t('uploadFailed', { message: uploadError.message }));
        }
        const {
          data: { publicUrl },
        } = supabase.storage.from('branding').getPublicUrl('logo.webp');
        // Cache-bust — the path is fixed (upsert), so without this every
        // browser/CDN keeps serving the previous logo after a change.
        nextLogoUrl = `${publicUrl}?v=${Date.now()}`;
      } else if (removeLogo) {
        nextLogoUrl = null;
      }

      const { error: updateError } = await supabase
        .from('app_branding')
        .update({ logo_url: nextLogoUrl, brand_name: trimmedName, updated_by: user.id })
        .eq('id', true);
      if (updateError) throw new Error(updateError.message);

      setLogoUrl(nextLogoUrl);
      setPendingLogo(null);
      setRemoveLogo(false);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      toast.success(t('brandingSaved'));
      // Sidebar reads branding server-side (dashboard layout) — refresh
      // so it picks up the change without a full page reload.
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle className="text-base">{t('brandingTitle')}</CardTitle>
        <CardDescription>{t('brandingDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center py-4 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loading')}
          </div>
        ) : (
          <>
            {!canEdit && (
              <p className="text-xs text-muted-foreground">{t('brandingAdminOnly')}</p>
            )}

            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
                {currentLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local blob preview / Supabase Storage URL
                  <img src={currentLogo} alt="" className="h-full w-full object-contain" />
                ) : (
                  <MessageSquare className="h-6 w-6 text-primary" />
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={onPickFile}
                  disabled={!canEdit || resizing || saving}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!canEdit || resizing || saving}
                >
                  {resizing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  {t('uploadLogo')}
                </Button>
                {currentLogo && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onRemoveLogo}
                    disabled={!canEdit || saving}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t('removeLogo')}
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t('logoHint')}</p>

            <div className="max-w-sm space-y-2">
              <Label htmlFor="brand-name">{t('brandName')}</Label>
              <Input
                id="brand-name"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                disabled={!canEdit || saving}
              />
            </div>

            {canEdit && (
              <Button onClick={onSave} disabled={saving || resizing}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('saveBranding')}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
