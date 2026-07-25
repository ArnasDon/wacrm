"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DocsShell,
  DocLinkButton,
  SectionHeading,
} from "@/components/docs/docs-shared";
import { COMPANY_NAME } from "@/lib/brand";
import { META_WEBHOOK_FIELDS } from "@/lib/docs/content";

export function WhatsAppSetupPage() {
  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/whatsapp/webhook`
      : "/api/whatsapp/webhook";

  return (
    <DocsShell
      title="WhatsApp Setup"
      description="Connect Meta WhatsApp Business API — credentials, webhooks, app secret, and templates."
    >
      <div className="flex flex-wrap gap-2">
        <DocLinkButton href="/whatsapp/config" label="WhatsApp Config" />
        <DocLinkButton href="/whatsapp/app-secret" label="App Secret" />
        <DocLinkButton href="/whatsapp/templates" label="Templates" />
      </div>

      <section className="space-y-4">
        <SectionHeading
          id="meta-app"
          title="Create a Meta Business App"
          description={`Set up your app in Meta for Developers before entering credentials in ${COMPANY_NAME}.`}
        />
        <Card className="border-slate-200 bg-white shadow-sm ring-slate-200">
          <CardContent className="space-y-3 pt-4 text-sm text-slate-700">
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Go to Meta for Developers → My Apps → Create App → choose{" "}
                <strong>Business</strong> type.
              </li>
              <li>Add the <strong>WhatsApp</strong> product and link your WhatsApp Business Account.</li>
              <li>
                From WhatsApp → API Setup, copy <strong>Phone Number ID</strong> and{" "}
                <strong>WABA ID</strong>.
              </li>
              <li>
                Generate a permanent <strong>System User access token</strong> in Business
                Settings → System Users.
              </li>
            </ol>
            <DocLinkButton
              href="https://developers.facebook.com"
              label="Meta for Developers"
              external
            />
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionHeading
          id="credentials"
          title={`Save credentials in ${COMPANY_NAME}`}
          description="Settings → WhatsApp Config — all fields and what they do."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-slate-200 bg-white shadow-sm ring-slate-200">
            <CardHeader>
              <CardTitle className="text-slate-900">Required fields</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-700">
              {[
                "Phone Number ID (required)",
                "WhatsApp Business Account ID / WABA ID (recommended)",
                "Permanent System User access token (required)",
                "Webhook verify token — your custom string",
                "Two-step verification PIN — 6 digits",
                "Meta App Secret (Settings → App Secret)",
              ].map((item) => (
                <p key={item} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                  {item}
                </p>
              ))}
              <div className="pt-2">
                <DocLinkButton
                  href="/whatsapp/config"
                  label="Open WhatsApp Config"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-sm ring-slate-200">
            <CardHeader>
              <CardTitle className="text-slate-900">What happens on Save</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-700">
              {[
                "Verifies token with Meta API",
                "Encrypts and stores credentials securely",
                "Registers the phone number with Meta (PIN required)",
                "Subscribes WABA to your app when WABA ID is provided",
              ].map((item) => (
                <p key={item} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                  {item}
                </p>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeading
          id="webhooks"
          title="Configure Meta webhooks"
          description="Paste this callback URL in Meta → WhatsApp → Configuration → Webhook."
        />
        <Card className="border-slate-200 bg-white shadow-sm ring-slate-200">
          <CardContent className="space-y-3 pt-4 text-sm">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-teal-800 break-all">
              {webhookUrl}
            </div>
            <ul className="space-y-2 text-slate-700">
              {META_WEBHOOK_FIELDS.map((field) => (
                <li key={field} className="flex items-start gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  {field}
                </li>
              ))}
            </ul>
            <DocLinkButton
              href="/whatsapp/app-secret"
              label="Configure App Secret"
            />
          </CardContent>
        </Card>

        <Card className="border-amber-500/30 bg-amber-500/5 ring-amber-500/20">
          <CardContent className="flex gap-3 pt-4 text-sm text-amber-100/90">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <p>
              After saving credentials, confirm <strong>registered_at</strong> is set
              via <strong>Verify with Meta</strong>. Without number registration Meta
              silently drops all inbound webhook events.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionHeading
          id="templates"
          title="Message templates"
          description="Templates must be Meta-approved before broadcasts and template automations can use them."
        />
        <Card className="border-slate-200 bg-white shadow-sm ring-slate-200">
          <CardContent className="space-y-3 pt-4 text-sm text-slate-700">
            <ol className="list-decimal space-y-2 pl-5">
              <li>Create templates in Settings → Templates (Marketing or Utility).</li>
              <li>Submit to Meta for review — approval typically takes ~24 hours.</li>
              <li>Use Sync from Meta to pull existing approved templates.</li>
              <li>Edit and resubmit rejected or paused templates.</li>
            </ol>
            <DocLinkButton href="/whatsapp/templates" label="Open Templates" />
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <SectionHeading
          id="verify"
          title="Verify the connection"
          description="Confirm everything is working before going live."
        />
        <Card className="border-slate-200 bg-white shadow-sm ring-slate-200">
          <CardContent className="space-y-2 pt-4 text-sm text-slate-700">
            {[
              "Click Test API Connection in WhatsApp Config",
              "Click Verify with Meta and check all diagnostics pass",
              "Send a test message to your WhatsApp number and confirm it appears in Inbox",
            ].map((item) => (
              <p key={item} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                {item}
              </p>
            ))}
            <div className="flex flex-wrap gap-2 pt-2">
              <DocLinkButton href="/whatsapp/config" label="WhatsApp Config" />
              <DocLinkButton href="/inbox" label="Open Inbox" />
              <DocLinkButton href="/docs/troubleshooting" label="Troubleshooting" />
            </div>
          </CardContent>
        </Card>
      </section>
    </DocsShell>
  );
}
