"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Building2, Upload, Loader2, Image as ImageIcon, Check } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";

interface AccountBranding {
  id: string;
  name: string;
  business_name: string | null;
  logo_url: string | null;
}

export function BusinessProfileForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [account, setAccount] = useState<AccountBranding | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function loadAccount() {
      setLoading(true);
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from("profiles")
          .select("account_id")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!profile?.account_id) return;

        const { data: acc, error } = await supabase
          .from("accounts")
          .select("id, name, business_name, logo_url")
          .eq("id", profile.account_id)
          .maybeSingle();

        if (error) throw error;

        if (acc) {
          setAccount(acc);
          setBusinessName(acc.business_name ?? acc.name);
          setLogoUrl(acc.logo_url);
        }
      } catch (err) {
        console.error("Failed to load business profile:", err);
        toast.error("Could not load business profile");
      } finally {
        setLoading(false);
      }
    }

    loadAccount();
  }, []);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !account) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo file size must be less than 2MB");
      return;
    }

    const allowedMimeTypes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    if (!allowedMimeTypes.includes(file.type)) {
      toast.error("Invalid image format. Allowed formats: PNG, JPEG, WebP, SVG");
      return;
    }

    setUploadingLogo(true);
    try {
      const supabase = createClient();
      const fileExt = file.name.split(".").pop();
      const filePath = `${account.id}/logo-${Date.now()}.${fileExt}`;

      const { error: uploadErr } = await supabase.storage
        .from("account-logos")
        .upload(filePath, file, { upsert: true });

      if (uploadErr) throw uploadErr;

      const { data: publicUrlData } = supabase.storage
        .from("account-logos")
        .getPublicUrl(filePath);

      const newLogoUrl = publicUrlData.publicUrl;
      setLogoUrl(newLogoUrl);

      // Save updated logo_url immediately to accounts table
      const { error: updateErr } = await supabase
        .from("accounts")
        .update({ logo_url: newLogoUrl })
        .eq("id", account.id);

      if (updateErr) throw updateErr;

      toast.success("Business logo updated successfully");
    } catch (err) {
      console.error("Failed to upload logo:", err);
      toast.error("Failed to upload logo");
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) return;

    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("accounts")
        .update({
          business_name: businessName.trim() || account.name,
          logo_url: logoUrl,
        })
        .eq("id", account.id);

      if (error) throw error;

      toast.success("Business profile saved");
    } catch (err) {
      console.error("Failed to save business profile:", err);
      toast.error("Could not save business profile");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-xl">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">Business Branding</h3>
        <p className="text-xs text-muted-foreground">
          Customize your business name and logo displayed across your team workspace header and sidebar.
        </p>
      </div>

      {/* Logo Upload Section */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-foreground block">Business Logo</label>
        <div className="flex items-center gap-4">
          <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-border bg-muted overflow-hidden">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Logo" className="h-full w-full object-contain p-1" />
            ) : (
              <Building2 className="h-8 w-8 text-muted-foreground" />
            )}
          </div>

          <div className="space-y-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={handleLogoUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingLogo}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              {uploadingLogo ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              Upload Logo
            </button>
            <p className="text-[11px] text-muted-foreground">
              PNG, JPG, WebP or SVG up to 2MB. Recommended resolution: 256x256.
            </p>
          </div>
        </div>
      </div>

      {/* Business Name Section */}
      <div className="space-y-2">
        <label htmlFor="businessName" className="text-xs font-medium text-foreground block">
          Business Name
        </label>
        <Input
          id="businessName"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          placeholder="e.g. Acme Corporation"
          className="text-sm"
          required
        />
        <p className="text-[11px] text-muted-foreground">
          This is the primary display name shown to your team members in WACRM.
        </p>
      </div>

      {/* Save Button */}
      <button
        type="submit"
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        Save Changes
      </button>
    </form>
  );
}
