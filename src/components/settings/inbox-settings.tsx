"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Timer } from "lucide-react";
import { useTranslations } from "next-intl";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { parseReplyTarget } from "@/lib/settings/reply-target";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SettingsPanelHead } from "./settings-panel-head";

export function InboxSettings() {
  const { accountId, canEditSettings, profileLoading } = useAuth();
  const t = useTranslations("Settings.inbox");
  const [saved, setSaved] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    createClient()
      .from("accounts")
      .select("reply_target_minutes")
      .eq("id", accountId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          toast.error(t("loadFailed"));
          return;
        }
        setSaved(data.reply_target_minutes);
        setDraft(String(data.reply_target_minutes));
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, t]);

  const parsed = parseReplyTarget(draft);
  const dirty = parsed !== null && parsed !== saved;

  async function handleSave() {
    if (!accountId || parsed === null || !dirty) return;
    setSaving(true);
    const { error } = await createClient()
      .from("accounts")
      .update({ reply_target_minutes: parsed })
      .eq("id", accountId);
    setSaving(false);
    if (error) {
      toast.error(t("saveFailed"));
      return;
    }
    setSaved(parsed);
    toast.success(t("saveSuccess"));
  }

  const disabled = !canEditSettings || profileLoading || saved === null;

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Timer className="size-4 text-primary" />
            {t("replyTarget")}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t("replyTargetDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-xs">
            <Label htmlFor="reply-target" className="text-muted-foreground">
              {t("minutesLabel")}
            </Label>
            <Input
              id="reply-target"
              type="number"
              inputMode="numeric"
              min={1}
              max={1440}
              step={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={disabled}
              aria-invalid={draft !== "" && parsed === null}
              aria-describedby="reply-target-hint"
            />
            <p id="reply-target-hint" className="text-xs text-muted-foreground">
              {draft !== "" && parsed === null
                ? t("invalid")
                : canEditSettings
                  ? t("hint")
                  : t("adminOnlyHint")}
            </p>
          </div>

          {canEditSettings && (
            <Button onClick={handleSave} disabled={saving || !dirty}>
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
