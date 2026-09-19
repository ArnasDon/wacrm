"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Cloud, Database, ExternalLink, Loader2, Trash2, XCircle } from "lucide-react";
import { api } from "@/lib/client/api";
import { getS3Preset, S3_PRESETS } from "@/lib/media/presets";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import { Field, NativeSelect, Panel, inputCls } from "@/components/sales/kit";

interface State {
  active: "cloudinary" | "s3" | null;
  cloudinary: {
    cloudName: string;
    apiKey: string;
    apiSecretMasked: string | null;
    isActive: boolean;
    lastTestOk: boolean | null;
  } | null;
  s3: {
    preset: string;
    region: string;
    bucket: string;
    endpoint: string | null;
    accessKeyId: string;
    secretMasked: string | null;
    publicBaseUrl: string | null;
    forcePathStyle: boolean;
    isActive: boolean;
    lastTestOk: boolean | null;
  } | null;
}

type Tab = "cloudinary" | "s3";

function Status({ ok, active }: { ok: boolean | null; active: boolean }) {
  return (
    <span className="flex items-center gap-2 text-xs">
      {ok === true ? <CheckCircle2 className="size-3.5 text-emerald-400" /> : ok === false ? <XCircle className="size-3.5 text-red-400" /> : null}
      {active ? <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 text-[10px] text-primary">in use</span> : <span className="text-slate-500">saved</span>}
    </span>
  );
}

export function StorageSettings() {
  const [state, setState] = useState<State | null>(null);
  const [tab, setTab] = useState<Tab>("cloudinary");
  const [busy, setBusy] = useState<string | null>(null);

  const [cl, setCl] = useState({ cloudName: "", apiKey: "", apiSecret: "" });
  const [s3, setS3] = useState({
    preset: "aws",
    region: "eu-west-2",
    bucket: "",
    accountId: "",
    endpoint: "",
    accessKeyId: "",
    secretAccessKey: "",
    publicBaseUrl: "",
    forcePathStyle: false,
  });

  const apply = (d: State) => {
    setState(d);
    if (d.cloudinary) setCl((c) => ({ ...c, cloudName: d.cloudinary!.cloudName, apiKey: d.cloudinary!.apiKey, apiSecret: "" }));
    if (d.s3) {
      const endpoint = d.s3.endpoint ?? "";
      setS3((c) => ({
        ...c,
        preset: d.s3!.preset,
        region: d.s3!.region,
        bucket: d.s3!.bucket,
        endpoint: d.s3!.preset === "custom" ? endpoint : "",
        accountId: d.s3!.preset === "r2" ? (/^https:\/\/([a-f0-9]{32})\./i.exec(endpoint)?.[1] ?? "") : "",
        accessKeyId: d.s3!.accessKeyId,
        secretAccessKey: "",
        publicBaseUrl: d.s3!.publicBaseUrl ?? "",
        forcePathStyle: d.s3!.forcePathStyle,
      }));
    }
  };

  useEffect(() => {
    api<State>("/api/settings/storage")
      .then((d) => {
        apply(d);
        if (d.active) setTab(d.active);
      })
      .catch((e) => toast.error(e.message));
  }, []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = (provider: Tab) =>
    run(`save-${provider}`, async () => {
      const body =
        provider === "cloudinary"
          ? { provider, cloudName: cl.cloudName, apiKey: cl.apiKey, apiSecret: cl.apiSecret || undefined }
          : { provider, ...s3, secretAccessKey: s3.secretAccessKey || undefined, publicBaseUrl: s3.publicBaseUrl || null };
      apply(await api<State>("/api/settings/storage", { method: "PUT", body }));
      toast.success("Connected and tested — new product photos will be stored here");
    });

  const test = (provider: Tab) =>
    run(`test-${provider}`, async () => {
      const r = await api<State & { ok: boolean; message: string }>("/api/settings/storage", { body: { action: "test", provider } });
      apply(r);
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    });

  const activate = (provider: Tab) =>
    run(`activate-${provider}`, async () => {
      apply(await api<State>("/api/settings/storage", { body: { action: "activate", provider } }));
      toast.success("New photos will be stored here");
    });

  const remove = (provider: Tab) =>
    confirm("Remove these storage credentials?") &&
    run(`remove-${provider}`, async () => {
      apply(await api<State>(`/api/settings/storage?provider=${provider}`, { method: "DELETE" }));
      toast.success("Removed");
    });

  if (!state) return <div className="h-80 animate-pulse rounded-xl bg-slate-900/50" />;
  const preset = getS3Preset(s3.preset) ?? S3_PRESETS[0];

  return (
    <div className="space-y-4">
      <Panel
        title="Photo storage"
        description="Where your product photos are kept. The sales rep sends them to customers on WhatsApp. Use your own Cloudinary account or any S3-compatible bucket — keys are encrypted and never shown again."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              { id: "cloudinary", label: "Cloudinary", icon: Cloud, sub: "Easiest. Auto-resizes and converts photos for WhatsApp.", cfg: state.cloudinary },
              { id: "s3", label: "Amazon S3 & compatible", icon: Database, sub: "AWS S3, Cloudflare R2, DigitalOcean Spaces, Backblaze B2, Wasabi, MinIO.", cfg: state.s3 },
            ] as const
          ).map((o) => (
            <button
              key={o.id}
              onClick={() => setTab(o.id)}
              className={`rounded-lg border p-3 text-left transition-colors ${tab === o.id ? "border-primary bg-primary/5" : "border-slate-800 hover:border-slate-700"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-medium text-white"><o.icon className="size-4 text-slate-400" /> {o.label}</p>
                {o.cfg ? <Status ok={o.cfg.lastTestOk} active={o.cfg.isActive} /> : null}
              </div>
              <p className="mt-1 text-xs text-slate-400">{o.sub}</p>
            </button>
          ))}
        </div>
        {!state.active && (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
            No storage set up yet — product photos can&apos;t be uploaded until you connect one.
          </p>
        )}
      </Panel>

      {tab === "cloudinary" ? (
        <Panel
          title="Cloudinary"
          description={
            <a href="https://console.cloudinary.com/settings/api-keys" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              Find these in Cloudinary → Settings → API Keys <ExternalLink className="size-3" />
            </a>
          }
          actions={state.cloudinary ? <Status ok={state.cloudinary.lastTestOk} active={state.cloudinary.isActive} /> : null}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Cloud name"><input className={inputCls} value={cl.cloudName} onChange={(e) => setCl((c) => ({ ...c, cloudName: e.target.value.trim() }))} placeholder="my-shop" /></Field>
            <Field label="API key"><input className={inputCls} value={cl.apiKey} onChange={(e) => setCl((c) => ({ ...c, apiKey: e.target.value.trim() }))} /></Field>
            <Field label={state.cloudinary ? "API secret (leave blank to keep)" : "API secret"} hint={state.cloudinary?.apiSecretMasked ?? undefined}>
              <PasswordInput autoComplete="off" className={inputCls} value={cl.apiSecret} onChange={(e) => setCl((c) => ({ ...c, apiSecret: e.target.value.trim() }))} />
            </Field>
          </div>
          <Actions
            configured={!!state.cloudinary}
            active={!!state.cloudinary?.isActive}
            busy={busy}
            provider="cloudinary"
            canSave={!!cl.cloudName && !!cl.apiKey && (!!cl.apiSecret || !!state.cloudinary)}
            onSave={() => save("cloudinary")}
            onTest={() => test("cloudinary")}
            onActivate={() => activate("cloudinary")}
            onRemove={() => remove("cloudinary")}
          />
        </Panel>
      ) : (
        <Panel title={preset.label} description={preset.help} actions={state.s3 ? <Status ok={state.s3.lastTestOk} active={state.s3.isActive} /> : null}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Service">
              <NativeSelect
                value={s3.preset}
                onChange={(v) => {
                  const p = getS3Preset(v)!;
                  setS3((c) => ({ ...c, preset: v, region: p.defaultRegion, forcePathStyle: p.forcePathStyle }));
                }}
                options={S3_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
              />
            </Field>
            <Field label="Bucket name"><input className={inputCls} value={s3.bucket} onChange={(e) => setS3((c) => ({ ...c, bucket: e.target.value.trim().toLowerCase() }))} placeholder="my-shop-photos" /></Field>
            <Field label="Region" hint={preset.regionHint}>
              <input className={inputCls} value={s3.region} disabled={preset.id === "r2"} onChange={(e) => setS3((c) => ({ ...c, region: e.target.value.trim() }))} />
            </Field>
            {preset.needsAccountId && (
              <Field label="Cloudflare account ID" hint="32 characters, shown on the R2 overview page">
                <input className={inputCls} value={s3.accountId} onChange={(e) => setS3((c) => ({ ...c, accountId: e.target.value.trim() }))} />
              </Field>
            )}
            {preset.id === "custom" && (
              <Field label="Endpoint URL" hint="e.g. https://minio.example.com">
                <input className={inputCls} value={s3.endpoint} onChange={(e) => setS3((c) => ({ ...c, endpoint: e.target.value.trim() }))} />
              </Field>
            )}
            <Field label="Access key ID"><input className={inputCls} value={s3.accessKeyId} onChange={(e) => setS3((c) => ({ ...c, accessKeyId: e.target.value.trim() }))} /></Field>
            <Field label={state.s3 ? "Secret access key (leave blank to keep)" : "Secret access key"} hint={state.s3?.secretMasked ?? undefined}>
              <PasswordInput autoComplete="off" className={inputCls} value={s3.secretAccessKey} onChange={(e) => setS3((c) => ({ ...c, secretAccessKey: e.target.value.trim() }))} />
            </Field>
            <Field
              label="Public URL (optional)"
              className="sm:col-span-2"
              hint="If your bucket is public or behind a CDN (e.g. https://cdn.myshop.ng or an R2 public bucket URL), photos are served from there. Leave empty to keep the bucket private — the app then serves photos itself."
            >
              <input className={inputCls} value={s3.publicBaseUrl} onChange={(e) => setS3((c) => ({ ...c, publicBaseUrl: e.target.value.trim() }))} placeholder="https://" />
            </Field>
            {preset.id === "custom" && (
              <label className="flex items-center gap-2 text-xs text-slate-400 sm:col-span-2">
                <Switch checked={s3.forcePathStyle} onCheckedChange={(v) => setS3((c) => ({ ...c, forcePathStyle: v }))} /> Path-style URLs (needed by MinIO)
              </label>
            )}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">
            The key only needs PutObject, GetObject and DeleteObject on this bucket. Photos are written to <code className="rounded bg-slate-800 px-1">wacrm/&lt;your-account&gt;/products/</code>. Upload JPEG or PNG (WhatsApp can&apos;t show WebP from S3).
          </p>
          <Actions
            configured={!!state.s3}
            active={!!state.s3?.isActive}
            busy={busy}
            provider="s3"
            canSave={!!s3.bucket && !!s3.accessKeyId && (!!s3.secretAccessKey || !!state.s3)}
            onSave={() => save("s3")}
            onTest={() => test("s3")}
            onActivate={() => activate("s3")}
            onRemove={() => remove("s3")}
          />
        </Panel>
      )}
    </div>
  );
}

function Actions(p: {
  configured: boolean;
  active: boolean;
  busy: string | null;
  provider: Tab;
  canSave: boolean;
  onSave: () => void;
  onTest: () => void;
  onActivate: () => void;
  onRemove: () => void;
}) {
  const spin = (k: string) => (p.busy === `${k}-${p.provider}` ? <Loader2 className="size-4 animate-spin" /> : null);
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3">
      <div>
        {p.configured && (
          <Button variant="ghost" className="text-red-300" disabled={!!p.busy} onClick={p.onRemove}>
            <Trash2 className="size-4" /> Remove
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {p.configured && (
          <Button variant="outline" className="border-slate-700 bg-slate-900 text-slate-200" disabled={!!p.busy} onClick={p.onTest}>
            {spin("test")} Test connection
          </Button>
        )}
        {p.configured && !p.active && (
          <Button variant="outline" className="border-slate-700 bg-slate-900 text-slate-200" disabled={!!p.busy} onClick={p.onActivate}>
            {spin("activate")} Use for new photos
          </Button>
        )}
        <Button disabled={!!p.busy || !p.canSave} onClick={p.onSave}>
          {spin("save")} {p.configured ? "Save & test" : "Connect & test"}
        </Button>
      </div>
    </div>
  );
}
