"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImagePlus, Loader2, Sparkles, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  BRAND_BUCKET,
  LOGO_ACCEPT,
  LOGO_MIME,
  MAX_BRAND_NAME_LEN,
  MAX_LOGO_BYTES,
  normalizeBrandName,
  parseBrandAssetPath,
} from "@/lib/branding/brand";
import {
  deleteAccountMedia,
  uploadAccountMedia,
} from "@/lib/storage/upload-media";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useTranslations } from "next-intl";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Brand settings — the account's own name and logo.
 *
 * This is what makes one deployment serve several client accounts
 * without each of them seeing the generic product mark: the name and
 * logo saved here replace the sidebar header and the browser tab
 * (title + favicon) for everyone in the account.
 *
 * One visible name field writes BOTH `accounts.name` and
 * `accounts.brand_name`. Splitting them into two inputs would show a
 * client two nearly identical "name" boxes with no way to tell which
 * one matters. `name` stays the identity used by invitations and the
 * members list; `brand_name` doubles as the "this account opted into
 * branding" flag that the server needs — it cannot run the client's
 * "is this name just the user's own name?" heuristic.
 *
 * Writes go straight to `accounts`; the `accounts_update` RLS policy
 * (017) already restricts that to admins+, so non-admins get a
 * disabled, read-only view. The storage policies (043) enforce the
 * same rule for the logo object itself.
 */
export function BrandSettings() {
  const supabase = createClient();
  const router = useRouter();
  const {
    accountId,
    account,
    canEditSettings,
    profileLoading,
    refreshProfile,
  } = useAuth();
  const t = useTranslations("Settings.brand");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [pendingLogo, setPendingLogo] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [saving, setSaving] = useState(false);

  const savedName = account?.brand_name ?? account?.name ?? "";
  const savedLogo = account?.logo_url ?? null;

  // Re-seed once the profile resolves, and after a save round-trips
  // through refreshProfile.
  useEffect(() => {
    setName(savedName);
    setPendingLogo(null);
    setPreviewUrl(null);
    setRemoveLogo(false);
  }, [savedName, savedLogo]);

  // Release object URLs so a few logo previews don't leak the files.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const shownLogo = previewUrl ?? (removeLogo ? null : savedLogo);
  const dirty =
    normalizeBrandName(name) !== normalizeBrandName(savedName) ||
    pendingLogo !== null ||
    removeLogo;

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so the same file can be re-picked
    if (!file) return;

    // Checked here, before the upload starts, because the bucket
    // rejects on the same rules — but only after the bytes are on the
    // wire and with an error the user cannot act on.
    if (!(LOGO_MIME as readonly string[]).includes(file.type)) {
      toast.error(t("unsupportedImage"));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(t("imageTooLarge"));
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingLogo(file);
    setPreviewUrl(URL.createObjectURL(file));
    setRemoveLogo(false);
  }

  function onRemoveLogo() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingLogo(null);
    setPreviewUrl(null);
    setRemoveLogo(true);
  }

  async function handleSave() {
    if (!accountId || !dirty) return;
    setSaving(true);

    try {
      // Upload first: if this fails we haven't touched the row yet, so
      // the account keeps the logo it already had.
      let nextLogoUrl = savedLogo;
      if (pendingLogo) {
        const { publicUrl } = await uploadAccountMedia(
          BRAND_BUCKET,
          pendingLogo,
        );
        nextLogoUrl = publicUrl;
      } else if (removeLogo) {
        nextLogoUrl = null;
      }

      const brandName = normalizeBrandName(name);
      const { error } = await supabase
        .from("accounts")
        .update({
          // Both columns, one field — see the note at the top.
          // `name` is NOT NULL, so an emptied field reverts it to
          // whatever it was rather than failing the write.
          name: brandName ?? savedName ?? "",
          brand_name: brandName,
          logo_url: nextLogoUrl,
        })
        .eq("id", accountId);

      if (error) {
        toast.error(t("saveFailed"));
        setSaving(false);
        return;
      }

      // Only now that the row points elsewhere is the old object safe
      // to delete. Doing it first would leave a dead URL behind if the
      // update failed. Best-effort: the bucket is public, so a
      // customer who removes their logo expects the file to stop being
      // reachable, but a missed delete is a storage nit, not something
      // to fail the save over.
      if (savedLogo && savedLogo !== nextLogoUrl) {
        const stalePath = parseBrandAssetPath(savedLogo);
        if (stalePath) {
          void deleteAccountMedia(BRAND_BUCKET, stalePath).catch(() => {});
        }
      }

      // refreshProfile updates the sidebar; router.refresh re-runs the
      // dashboard layout's generateMetadata so the tab title and
      // favicon change too, without a full reload.
      await refreshProfile();
      router.refresh();
      toast.success(t("saveSuccess"));
    } catch (err) {
      // uploadAccountMedia throws a user-facing message (not signed
      // in, account unresolved, storage rejected the object).
      toast.error(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Sparkles className="size-4 text-primary" />
            {t("identity")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("identityDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Logo */}
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("logo")}</Label>
            <div className="flex items-center gap-4">
              {shownLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={shownLogo}
                  alt=""
                  className="size-12 shrink-0 rounded-lg border border-border object-contain"
                />
              ) : (
                <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
                  <ImagePlus className="size-5" />
                </div>
              )}
              {canEditSettings && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={LOGO_ACCEPT}
                    onChange={onPickFile}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={saving}
                  >
                    {shownLogo ? t("changeLogo") : t("uploadLogo")}
                  </Button>
                  {shownLogo && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={onRemoveLogo}
                      disabled={saving}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Trash2 className="size-4" />
                      {t("remove")}
                    </Button>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("logoHint")}</p>
          </div>

          {/* Name */}
          <div className="grid gap-2 sm:max-w-sm">
            <Label className="text-muted-foreground" htmlFor="brand-name">
              {t("nameLabel")}
            </Label>
            <Input
              id="brand-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_BRAND_NAME_LEN}
              disabled={!canEditSettings || profileLoading || saving}
              placeholder={t("namePlaceholder")}
            />
            <p className="text-xs text-muted-foreground">{t("nameDesc")}</p>
            {!canEditSettings && (
              <p className="text-xs text-muted-foreground">
                {t("adminOnlyHint")}
              </p>
            )}
          </div>

          {canEditSettings && (
            <Button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("saving")}
                </>
              ) : (
                t("save")
              )}
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
