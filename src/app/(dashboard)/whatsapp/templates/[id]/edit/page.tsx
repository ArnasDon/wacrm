"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { buttonVariants } from "@/components/ui/button";
import {
  TemplateEditor,
  formFromTemplate,
  type TemplateFormData,
} from "@/components/whatsapp/template-editor";
import { cn } from "@/lib/utils";

export default function EditWhatsAppTemplatePage() {
  const params = useParams<{ id: string }>();
  const templateId = params?.id;
  const supabase = createClient();
  const { accountId, user, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialForm, setInitialForm] = useState<TemplateFormData | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!templateId || !user) {
      setLoading(false);
      setError("Template not found.");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        let query = supabase
          .from("message_templates")
          .select("*")
          .eq("id", templateId);
        if (accountId) {
          query = query.eq("account_id", accountId);
        } else {
          query = query.eq("user_id", user.id);
        }
        const { data, error: fetchError } = await query.maybeSingle();
        if (cancelled) return;
        if (fetchError) throw fetchError;
        if (!data) {
          setError("Template not found.");
          return;
        }
        if (data.category === "Authentication") {
          setError(
            "Authentication templates must be managed in Meta WhatsApp Manager.",
          );
          return;
        }
        setInitialForm(formFromTemplate(data));
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load template.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, templateId, accountId, user?.id]);

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading template…
      </div>
    );
  }

  if (error || !initialForm || !templateId) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-12 text-center">
        <h1 className="text-xl font-semibold text-foreground">
          Cannot edit template
        </h1>
        <p className="text-sm text-muted-foreground">
          {error || "Template not found."}
        </p>
        <Link
          href="/whatsapp/templates"
          className={cn(buttonVariants({ variant: "outline" }), "inline-flex")}
        >
          Back to templates
        </Link>
      </div>
    );
  }

  return (
    <TemplateEditor templateId={templateId} initialForm={initialForm} />
  );
}
