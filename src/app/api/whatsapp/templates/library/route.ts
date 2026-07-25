import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { decryptIfEncrypted } from "@/lib/whatsapp/encryption";
import { browseMessageTemplateLibrary } from "@/lib/whatsapp/meta-api";
import { metaLibraryItemToForm } from "@/lib/whatsapp/library-to-form";
import {
  STARTER_TOPIC_LABELS,
  WHATSAPP_STARTER_TEMPLATES,
  topicsForCategory,
  type StarterTopic,
  type WhatsAppStarterTemplate,
} from "@/lib/whatsapp/starter-templates";

export const runtime = "nodejs";

/**
 * GET /api/whatsapp/templates/library
 *
 * Returns curated VedMint starters (always) plus Meta Template Library
 * UTILITY templates when WhatsApp is connected.
 *
 * Query: ?q=search&topic=order
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim().toLowerCase();
    const topic = (searchParams.get("topic") || "all").toLowerCase();
    const categoryRaw = (searchParams.get("category") || "").trim();
    const categoryFilter =
      categoryRaw === "Marketing" || categoryRaw === "Utility"
        ? categoryRaw
        : null;

    let starters = WHATSAPP_STARTER_TEMPLATES.slice();
    if (categoryFilter) {
      starters = starters.filter((s) => s.form.category === categoryFilter);
    }
    if (topic !== "all" && topic in STARTER_TOPIC_LABELS) {
      starters = starters.filter((s) => s.topic === (topic as StarterTopic));
    }
    if (q) {
      starters = starters.filter(
        (s) =>
          s.label.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.form.name.includes(q) ||
          s.form.body_text.toLowerCase().includes(q),
      );
    }

    // Try Meta Template Library when the account has a connected token.
    let metaTemplates: WhatsAppStarterTemplate[] = [];
    let metaError: string | null = null;
    let metaAvailable = false;

    const { data: profile } = await supabase
      .from("profiles")
      .select("account_id")
      .eq("user_id", user.id)
      .maybeSingle();
    const accountId = profile?.account_id as string | undefined;

    if (accountId) {
      const { data: config, error: configError } = await supabase
        .from("whatsapp_config")
        .select("access_token")
        .eq("account_id", accountId)
        .order("is_default", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (configError) {
        metaError = `Could not read WhatsApp connection: ${configError.message}`;
      } else {
        const encrypted = config?.access_token as string | undefined;
        if (encrypted) {
          metaAvailable = true;
          try {
            const accessToken = decryptIfEncrypted(encrypted).plaintext;
            if (!accessToken?.trim()) {
              throw new Error("WhatsApp access token is empty.");
            }
            const rows = await browseMessageTemplateLibrary({
              accessToken,
              search: q || undefined,
              language: "en",
              limit: 40,
            });
            // Meta's public library is Utility-only.
            if (!categoryFilter || categoryFilter === "Utility") {
              metaTemplates = rows.map((row) => {
                const form = metaLibraryItemToForm(row);
                const topicGuess = guessTopic(row.topic, row.usecase, row.name);
                return {
                  id: `meta:${row.name}`,
                  label: humanizeName(row.name),
                  description:
                    [row.topic, row.usecase]
                      .filter(Boolean)
                      .map((s) => String(s).replace(/_/g, " "))
                      .join(" · ") || "Meta Template Library (Utility)",
                  topic: topicGuess,
                  source: "meta" as const,
                  library_template_name: row.name,
                  form,
                };
              });

              if (topic !== "all" && topic in STARTER_TOPIC_LABELS) {
                metaTemplates = metaTemplates.filter(
                  (s) => s.topic === (topic as StarterTopic),
                );
              }
            }
          } catch (err) {
            metaError =
              err instanceof Error
                ? err.message
                : "Could not load Meta Template Library.";
          }
        }
      }
    }

    // Only expose topic chips that have ≥1 starter for this category
    // (plus Meta library topics when present), so filters never look empty.
    const topicKeys = new Set<StarterTopic>(
      topicsForCategory(categoryFilter),
    );
    for (const t of metaTemplates) topicKeys.add(t.topic);

    const topics: Record<string, string> = { all: STARTER_TOPIC_LABELS.all };
    for (const key of Object.keys(STARTER_TOPIC_LABELS) as Array<
      StarterTopic | "all"
    >) {
      if (key !== "all" && topicKeys.has(key)) {
        topics[key] = STARTER_TOPIC_LABELS[key];
      }
    }

    // If the active topic filter has no results after category change, client
    // should reset — we still return the filtered list as-is.
    return NextResponse.json({
      data: {
        starters,
        meta_templates: metaTemplates,
        meta_available: metaAvailable,
        meta_error: metaError,
        topics,
      },
    });
  } catch (err) {
    console.error("[templates/library]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load library" },
      { status: 500 },
    );
  }
}

function humanizeName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+\d+$/, "");
}

function guessTopic(
  topic?: string,
  usecase?: string,
  name?: string,
): StarterTopic {
  const hay = `${topic || ""} ${usecase || ""} ${name || ""}`.toUpperCase();
  if (/ORDER|PURCHASE|CHECKOUT/.test(hay)) return "order";
  if (/SHIP|DELIVER|TRACK|PACKAGE/.test(hay)) return "shipping";
  if (/APPOINT|BOOK|SCHEDULE|EVENT/.test(hay)) return "appointment";
  if (/PAY|INVOICE|BILL|PAYMENT|REFUND/.test(hay)) return "payment";
  if (/ACCOUNT|PASSWORD|VERIFY|PROFILE/.test(hay)) return "account";
  if (/FEEDBACK|SURVEY|REVIEW|RATING/.test(hay)) return "feedback";
  if (/REMIND|RENEW|ALERT/.test(hay)) return "reminder";
  if (/WELCOME|ONBOARD/.test(hay)) return "welcome";
  if (/PROMO|OFFER|SALE|COUPON|DISCOUNT/.test(hay)) return "promo";
  return "reminder";
}
