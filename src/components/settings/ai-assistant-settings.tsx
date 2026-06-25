'use client';

// ============================================================
// AiAssistantSettings — Settings → AI Assistant (spec §9)
//
// Configures the WhatsApp AI assistant: a master enable toggle, the
// editable system prompt, the customer-facing handoff message, the
// escalation-keyword list, persona (business name + logo), the model
// dropdown, and the daily reply cap. The knowledge base lives in its
// own component (<KnowledgeBaseManager/>) rendered at the bottom.
//
// Loads GET /api/ai/config (which lazily seeds a default row, so the
// form always binds to something) and saves the editable fields via
// PUT. The server reports `apiKeyConfigured` as a plain boolean — the
// Anthropic key itself never reaches the client (spec §9.1 / §12) — so
// we surface a "key not configured" notice when it's false: the
// assistant can't reply without it.
//
// Admin+ only. The settings page slots this behind the rail item; we
// also guard locally with <RequireRole> so a non-admin who deep-links
// gets a clean message instead of failing API calls. Mirrors the save/
// load/toast conventions of whatsapp-config.tsx and the logo upload of
// profile-form.tsx (via the shared account-scoped storage helper).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Upload,
  Trash2,
  X,
  Plus,
  AlertTriangle,
  Bot,
  ShieldAlert,
} from 'lucide-react';

import { uploadAccountMedia } from '@/lib/storage/upload-media';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RequireRole } from '@/components/auth/require-role';
import { SettingsPanelHead } from './settings-panel-head';
import { KnowledgeBaseManager } from './knowledge-base-manager';
import type { AiAssistantConfig } from '@/types';

// The two models offered in the dropdown (spec §9.5 / §2). The stored
// `model` string may be something else (set via the API) — we render it
// as a fallback option so a custom value never silently disappears.
const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — best quality' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — cheaper & faster' },
];

// Logo upload: reuse the account-scoped storage helper + bucket the
// inbox/templates already use. The bucket accepts PNG/JPEG/WebP (see
// migration 023), so restrict to those — GIF is not accepted there.
const LOGO_BUCKET = 'chat-media';
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

// Bounds mirrored from the PUT /api/ai/config validator so the UI
// stops obvious over-length input before a round-trip.
const MAX_KEYWORDS = 100;
const MAX_KEYWORD_LEN = 80;
const MAX_DAILY_REPLY_CAP = 100_000;

export function AiAssistantSettings() {
  return (
    <RequireRole
      min="admin"
      fallback={
        <section className="animate-in fade-in-50 duration-200">
          <SettingsPanelHead
            title="AI Assistant"
            description="Auto-reply to WhatsApp messages from your knowledge base, with a clean hand-off to a human when unsure."
          />
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              <ShieldAlert className="text-muted-foreground size-6" />
              <p className="text-muted-foreground mt-2 text-sm">
                Only admins can configure the AI assistant.
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Ask an account admin if you need changes made here.
              </p>
            </CardContent>
          </Card>
        </section>
      }
    >
      <AiAssistantSettingsInner />
    </RequireRole>
  );
}

function AiAssistantSettingsInner() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(true);

  // The persisted config (last-saved snapshot), used to compute the
  // dirty state. `null` until the first load resolves.
  const [config, setConfig] = useState<AiAssistantConfig | null>(null);

  // Editable form fields.
  const [enabled, setEnabled] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [handoffMessage, setHandoffMessage] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [dailyReplyCap, setDailyReplyCap] = useState('500');

  // Logo: existing URL + a staged (unsaved) replacement/removal.
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const seedFromConfig = useCallback((c: AiAssistantConfig) => {
    setConfig(c);
    setEnabled(c.enabled);
    setSystemPrompt(c.system_prompt ?? '');
    setHandoffMessage(c.handoff_message ?? '');
    setKeywords(c.escalation_keywords ?? []);
    setBusinessName(c.business_name ?? '');
    setModel(c.model ?? 'claude-sonnet-4-6');
    setDailyReplyCap(String(c.daily_reply_cap ?? 500));
    setLogoUrl(c.logo_url ?? null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config', { cache: 'no-store' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to load AI configuration');
        return;
      }
      const data = (await res.json()) as {
        config: AiAssistantConfig;
        apiKeyConfigured: boolean;
      };
      seedFromConfig(data.config);
      setApiKeyConfigured(data.apiKeyConfigured);
    } catch (err) {
      console.error('[AiAssistantSettings] load error:', err);
      toast.error('Could not reach the server');
    } finally {
      setLoading(false);
    }
  }, [seedFromConfig]);

  useEffect(() => {
    void load();
  }, [load]);

  function addKeyword(raw: string) {
    const kw = raw.trim().toLowerCase();
    if (!kw) return;
    if (kw.length > MAX_KEYWORD_LEN) {
      toast.error(`Keywords must be ${MAX_KEYWORD_LEN} characters or fewer`);
      return;
    }
    if (keywords.includes(kw)) {
      setKeywordDraft('');
      return;
    }
    if (keywords.length >= MAX_KEYWORDS) {
      toast.error(`At most ${MAX_KEYWORDS} keywords`);
      return;
    }
    setKeywords((prev) => [...prev, kw]);
    setKeywordDraft('');
  }

  function removeKeyword(kw: string) {
    setKeywords((prev) => prev.filter((k) => k !== kw));
  }

  function onKeywordKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Enter or comma commits the draft chip; Backspace on an empty
    // draft pops the last chip (familiar tag-input affordances).
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addKeyword(keywordDraft);
    } else if (
      e.key === 'Backspace' &&
      keywordDraft === '' &&
      keywords.length
    ) {
      e.preventDefault();
      setKeywords((prev) => prev.slice(0, -1));
    }
  }

  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so the same file can be re-picked
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
    setUploadingLogo(true);
    try {
      const { publicUrl } = await uploadAccountMedia(LOGO_BUCKET, file);
      setLogoUrl(publicUrl);
      toast.success('Logo uploaded. Save to apply.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingLogo(false);
    }
  }

  function removeLogo() {
    setLogoUrl(null);
  }

  async function handleSave() {
    const prompt = systemPrompt.trim();
    if (!prompt) {
      toast.error('The system prompt cannot be empty');
      return;
    }
    const cap = Number(dailyReplyCap);
    if (!Number.isInteger(cap) || cap < 1 || cap > MAX_DAILY_REPLY_CAP) {
      toast.error(
        `Daily reply cap must be a whole number between 1 and ${MAX_DAILY_REPLY_CAP}`
      );
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          system_prompt: prompt,
          handoff_message: handoffMessage.trim() || null,
          escalation_keywords: keywords,
          business_name: businessName.trim() || null,
          logo_url: logoUrl,
          model,
          daily_reply_cap: cap,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Save failed (HTTP ${res.status})`);
      }
      seedFromConfig(data.config as AiAssistantConfig);
      setApiKeyConfigured(Boolean(data.apiKeyConfigured));
      toast.success('AI assistant settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // Dirty check — enables the Save button only when something changed
  // from the last-saved snapshot. Keyword order is preserved on both
  // sides, so a JSON compare is exact.
  const dirty =
    !!config &&
    (enabled !== config.enabled ||
      systemPrompt.trim() !== (config.system_prompt ?? '') ||
      handoffMessage.trim() !== (config.handoff_message ?? '') ||
      JSON.stringify(keywords) !==
        JSON.stringify(config.escalation_keywords ?? []) ||
      businessName.trim() !== (config.business_name ?? '') ||
      (logoUrl ?? null) !== (config.logo_url ?? null) ||
      model !== (config.model ?? 'claude-sonnet-4-6') ||
      Number(dailyReplyCap) !== config.daily_reply_cap);

  // Render the stored model as an option even if it's outside the known
  // list, so a custom value set via the API isn't silently dropped.
  const modelOptions = MODEL_OPTIONS.some((m) => m.value === model)
    ? MODEL_OPTIONS
    : [...MODEL_OPTIONS, { value: model, label: model }];

  const initial = (businessName || 'A').charAt(0).toUpperCase();

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title="AI Assistant"
          description="Auto-reply to WhatsApp messages from your knowledge base, with a clean hand-off to a human when unsure."
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="text-primary size-6 animate-spin" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title="AI Assistant"
        description="Auto-reply to WhatsApp messages from your knowledge base, with a clean hand-off to a human when unsure."
      />

      {/* API key notice — the assistant can't reply without it. */}
      {!apiKeyConfigured && (
        <Alert className="border-amber-700/50 bg-amber-950/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-400" />
            <div className="flex-1">
              <AlertTitle className="mb-1 text-amber-200">
                Anthropic API key not configured
              </AlertTitle>
              <AlertDescription className="text-sm text-amber-100/80">
                The server has no{' '}
                <code className="text-xs">ANTHROPIC_API_KEY</code> set, so the
                assistant can&apos;t send replies — every message will be handed
                to a human. Set the key in the server environment to enable
                auto-replies. You can still configure everything else here.
              </AlertDescription>
            </div>
          </div>
        </Alert>
      )}

      {/* Status & enable */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div className="flex items-start gap-3">
            <span className="bg-primary-soft text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
              <Bot className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-foreground text-sm font-semibold">
                Auto-reply to inbound WhatsApp messages
              </p>
              <p className="text-muted-foreground mt-0.5 max-w-[62ch] text-xs">
                When on, the assistant answers confidently-grounded questions
                and escalates anything it&apos;s unsure about to a human. Off by
                default.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              className={
                enabled
                  ? 'border-emerald-700/50 bg-emerald-950/40 text-emerald-300'
                  : 'border-border bg-muted text-muted-foreground'
              }
            >
              {enabled ? 'Enabled' : 'Disabled'}
            </Badge>
            <Switch
              checked={enabled}
              onCheckedChange={(next) => setEnabled(next === true)}
              aria-label="Enable the AI assistant"
            />
          </div>
        </CardContent>
      </Card>

      {/* Prompt */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Prompt & behaviour</CardTitle>
          <CardDescription className="text-muted-foreground">
            The system prompt steers tone and the grounding rules. The default
            already instructs the assistant to answer only from your knowledge
            base and to escalate when unsure.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="ai-system-prompt" className="text-muted-foreground">
              System prompt
            </Label>
            <Textarea
              id="ai-system-prompt"
              value={systemPrompt}
              rows={9}
              maxLength={20_000}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are the customer-support assistant for…"
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground resize-y text-sm"
            />
            <p className="text-muted-foreground text-[11px]">
              Use <code className="text-[11px]">{'{business_name}'}</code> to
              insert the business name. The knowledge base is appended
              automatically — don&apos;t paste it here.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-handoff" className="text-muted-foreground">
              Handoff message
            </Label>
            <Textarea
              id="ai-handoff"
              value={handoffMessage}
              rows={3}
              maxLength={2_000}
              onChange={(e) => setHandoffMessage(e.target.value)}
              placeholder="Thanks! Let me connect you with a team member who can help."
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground resize-y text-sm"
            />
            <p className="text-muted-foreground text-[11px]">
              Sent to the customer when a conversation is escalated to a human.
              Leave blank to send nothing on hand-off.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">Escalation keywords</Label>
            <div className="border-border bg-muted flex flex-wrap gap-1.5 rounded-md border p-2">
              {keywords.map((kw) => (
                <Badge
                  key={kw}
                  className="border-border bg-card text-foreground gap-1 text-xs"
                >
                  {kw}
                  <button
                    type="button"
                    onClick={() => removeKeyword(kw)}
                    aria-label={`Remove ${kw}`}
                    className="text-muted-foreground transition-colors hover:text-red-400"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
              <div className="flex min-w-[8rem] flex-1 items-center gap-1">
                <Input
                  value={keywordDraft}
                  onChange={(e) => setKeywordDraft(e.target.value)}
                  onKeyDown={onKeywordKeyDown}
                  onBlur={() => keywordDraft.trim() && addKeyword(keywordDraft)}
                  placeholder={
                    keywords.length === 0
                      ? 'refund, cancel, complaint…'
                      : 'Add keyword'
                  }
                  className="h-7 flex-1 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
                />
                {keywordDraft.trim() && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => addKeyword(keywordDraft)}
                    aria-label="Add keyword"
                    className="text-muted-foreground hover:text-primary size-6"
                  >
                    <Plus className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
            <p className="text-muted-foreground text-[11px]">
              An inbound message containing any of these escalates straight to a
              human — no AI reply attempted. Press Enter or comma to add.
              Case-insensitive.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Persona */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Persona</CardTitle>
          <CardDescription className="text-muted-foreground">
            How the assistant introduces itself. In v1 the logo is stored as
            persona context only — there&apos;s no customer-facing surface yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-5">
            <Avatar size="lg" className="size-16">
              {logoUrl ? (
                <AvatarImage src={logoUrl} alt={businessName || 'Logo'} />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-primary text-base">
                {initial}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-wrap gap-2">
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={onPickLogo}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => logoInputRef.current?.click()}
                disabled={uploadingLogo}
              >
                {uploadingLogo ? (
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
                  onClick={removeLogo}
                  disabled={uploadingLogo}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Trash2 className="size-4" />
                  Remove
                </Button>
              )}
              <p className="text-muted-foreground w-full text-xs">
                PNG, JPG, or WebP. Up to 2 MB.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-business-name" className="text-muted-foreground">
              Business name
            </Label>
            <Input
              id="ai-business-name"
              value={businessName}
              maxLength={200}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Acme Logistics"
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
            />
            <p className="text-muted-foreground text-[11px]">
              Substituted into the prompt wherever{' '}
              <code className="text-[11px]">{'{business_name}'}</code> appears.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Model & limits */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Model & limits</CardTitle>
          <CardDescription className="text-muted-foreground">
            Pick the Claude model and bound daily spend. Hitting the cap
            escalates the rest of the day&apos;s messages to a human.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-muted-foreground">Model</Label>
            <Select
              value={model}
              onValueChange={(val) => {
                // @base-ui Select fires onValueChange(null) on deselect;
                // ignore it so the field never blanks (model is NOT NULL).
                if (!val) return;
                setModel(val);
              }}
            >
              <SelectTrigger className="border-border bg-muted text-foreground w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-border bg-popover">
                {modelOptions.map((m) => (
                  <SelectItem
                    key={m.value}
                    value={m.value}
                    className="text-popover-foreground focus:bg-muted focus:text-popover-foreground"
                  >
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-[11px]">
              Sonnet is the recommended balance; Haiku is cheaper and faster for
              simpler knowledge bases.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-daily-cap" className="text-muted-foreground">
              Daily reply cap
            </Label>
            <Input
              id="ai-daily-cap"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_DAILY_REPLY_CAP}
              value={dailyReplyCap}
              onChange={(e) =>
                setDailyReplyCap(e.target.value.replace(/[^\d]/g, ''))
              }
              className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
            />
            <p className="text-muted-foreground text-[11px]">
              Maximum AI replies per day for this account. Once reached, new
              messages escalate to a human until tomorrow.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Save bar */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving || !dirty}>
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

      {/* Knowledge base */}
      <Card>
        <CardContent className="py-6">
          <KnowledgeBaseManager />
        </CardContent>
      </Card>
    </section>
  );
}
