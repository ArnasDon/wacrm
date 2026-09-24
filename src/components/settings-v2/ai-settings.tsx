"use client";

import { PasswordInput } from "@/components/ui/password-input";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, Loader2, Plus, RefreshCw, Star, Trash2, XCircle, Zap } from "lucide-react";
import { api } from "@/lib/client/api";
import { AI_PRESETS, getPreset } from "@/lib/ai/presets";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, Field, NativeSelect, Panel, inputCls } from "@/components/sales/kit";

interface Provider {
  id: string;
  label: string;
  kind: string;
  preset: string;
  baseUrl: string | null;
  model: string;
  isDefault: boolean;
  apiKeyMasked: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
}

const CATEGORY_LABEL = { paid: "Paid APIs", open_source: "Open-source models (hosted)", local: "Self-hosted (free)" } as const;

function AddDialog({ open, onOpenChange, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; onAdded: () => void }) {
  const [presetId, setPresetId] = useState("anthropic");
  const preset = getPreset(presetId)!;
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(preset.defaultModel);
  const [baseUrl, setBaseUrl] = useState(preset.baseUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [liveModels, setLiveModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const loadLiveModels = async () => {
    setLoadingModels(true);
    setModelsError(null);
    try {
      const r = await api<{ models: string[] }>("/api/settings/ai-providers/models", {
        body: { preset: presetId, apiKey: apiKey || null, baseUrl: baseUrl || null },
      });
      setLiveModels(r.models);
      if (r.models.length && !r.models.includes(model)) setModel(r.models[0]);
    } catch (e) {
      setModelsError((e as Error).message);
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    setLiveModels(null);
    setModelsError(null);
    const p = getPreset(presetId)!;
    setModel(p.defaultModel);
    setBaseUrl(p.baseUrl ?? "");
    setApiKey("");
  }, [presetId]);

  const save = async () => {
    setSaving(true);
    try {
      await api("/api/settings/ai-providers", { body: { preset: presetId, apiKey: apiKey || null, model, baseUrl: baseUrl || null } });
      toast.success(`${preset.label} added — run a test to check it`);
      onOpenChange(false);
      onAdded();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const grouped = (["paid", "open_source", "local"] as const).map((cat) => ({ cat, items: AI_PRESETS.filter((p) => p.category === cat) }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border border-slate-800 bg-slate-900 text-slate-100 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">Add an AI provider</DialogTitle>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
          <Field label="Provider">
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)} className={inputCls}>
              {grouped.map((g) => (
                <optgroup key={g.cat} label={CATEGORY_LABEL[g.cat]} className="bg-slate-900">
                  {g.items.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          {preset.customBaseUrl && (
            <Field label="Server URL" hint={preset.category === "local" ? "Where your model server runs. On a shared/multi-tenant server local addresses are blocked for security." : "OpenAI-compatible /v1 endpoint."}>
              <input className={inputCls} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" />
            </Field>
          )}
          {(preset.requiresKey || preset.id === "custom") && (
            <Field
              label={preset.requiresKey ? "API key" : "API key (if your server needs one)"}
              hint={preset.keyHelpUrl ? <a href={preset.keyHelpUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Get a key <ExternalLink className="size-3" /></a> : undefined}
            >
              <PasswordInput autoComplete="off" className={inputCls} value={apiKey} onChange={(e) => setApiKey(e.target.value.trim())} />
            </Field>
          )}
          <Field label="Model" hint={liveModels ? `${liveModels.length} models listed — type to search, then Test: a catalogue can list models your key cannot call.` : "Type any model id, or load the provider's current list."}>
            <div className="flex gap-2">
              <input className={inputCls} list={`models-${preset.id}`} value={model} onChange={(e) => setModel(e.target.value.trim())} />
              <Button type="button" variant="outline" className="h-9 shrink-0 border-slate-700 bg-slate-900 text-slate-200" disabled={loadingModels || (preset.requiresKey && !apiKey)} onClick={loadLiveModels}>
                {loadingModels ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Load models
              </Button>
            </div>
            <datalist id={`models-${preset.id}`}>
              {(liveModels ?? preset.suggestedModels).map((m) => <option key={m} value={m} />)}
            </datalist>
          </Field>
          {modelsError ? <p className="rounded-md border border-red-500/30 bg-red-500/5 px-2.5 py-1.5 text-[11px] break-words text-red-300">{modelsError}</p> : null}
          {preset.suggestedModels.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {preset.suggestedModels.map((m) => (
                <button key={m} onClick={() => setModel(m)} className={`rounded-full border px-2 py-0.5 text-[11px] ${model === m ? "border-primary text-primary" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>{m}</button>
              ))}
            </div>
          )}
        </div>
        <DialogFooter className="border-slate-800 bg-slate-900">
          <Button variant="ghost" className="text-slate-300" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || !model || (preset.requiresKey && !apiKey)}>{saving ? "Saving…" : "Add provider"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AISettings() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [liveModels, setLiveModels] = useState<Record<string, string[]>>({});
  const [loadingModels, setLoadingModels] = useState<string | null>(null);

  const loadModelsFor = async (p: Provider) => {
    setLoadingModels(p.id);
    try {
      const r = await api<{ models: string[] }>("/api/settings/ai-providers/models", { body: { providerId: p.id } });
      setLiveModels((cur) => ({ ...cur, [p.id]: r.models }));
      toast.success(`${r.models.length} models listed — press Test to confirm the one you pick works`);
      if (!r.models.includes(p.model)) toast.warning(`"${p.model}" is not in the list — pick a current model`);
    } catch (e) {
      setResults((cur) => ({ ...cur, [p.id]: (e as Error).message }));
      toast.error((e as Error).message);
    } finally {
      setLoadingModels(null);
    }
  };

  const load = () => api<{ providers: Provider[] }>("/api/settings/ai-providers").then((d) => setProviders(d.providers)).catch((e) => toast.error(e.message));
  useEffect(() => {
    void load();
  }, []);

  const test = async (p: Provider) => {
    setTesting(p.id);
    try {
      const r = await api<{ ok: boolean; message: string; latencyMs: number }>(`/api/settings/ai-providers/${p.id}`, { body: {} });
      setResults((cur) => ({ ...cur, [p.id]: `${r.message} (${(r.latencyMs / 1000).toFixed(1)}s)` }));
      if (r.ok) toast.success(`${p.label} works`);
      else toast.error(r.message);
      void load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(null);
    }
  };

  const makeDefault = async (p: Provider) => {
    await api(`/api/settings/ai-providers/${p.id}`, { method: "PATCH", body: { isDefault: true } }).catch((e) => toast.error(e.message));
    void load();
  };
  const remove = async (p: Provider) => {
    if (!confirm(`Remove ${p.label}? Its key is deleted.`)) return;
    await api(`/api/settings/ai-providers/${p.id}`, { method: "DELETE" }).catch((e) => toast.error(e.message));
    void load();
  };
  const changeModel = async (p: Provider, model: string) => {
    await api(`/api/settings/ai-providers/${p.id}`, { method: "PATCH", body: { model } }).then(() => toast.success("Model updated")).catch((e) => toast.error(e.message));
    void load();
  };

  const counts = useMemo(() => ({ total: providers?.length ?? 0 }), [providers]);

  return (
    <div className="space-y-4">
      <Panel
        title="AI providers"
        description="Bring your own keys. Paid APIs (Claude, OpenAI, Gemini, DeepSeek, Mistral), hosted open-source models (Kimi, NVIDIA NIM, Groq, OpenRouter, Together) or free self-hosted ones (Ollama, LM Studio). Keys are encrypted at rest and never displayed again."
        actions={<Button onClick={() => setAdding(true)}><Plus className="size-4" /> Add provider</Button>}
      >
        {providers === null ? (
          <div className="h-24 animate-pulse rounded bg-slate-800/40" />
        ) : counts.total === 0 ? (
          <EmptyState icon={<Zap className="size-6" />} title="No AI providers yet" body="The sales rep works in Rules mode without one. Add a key to let it chat naturally." action={<Button onClick={() => setAdding(true)}>Add your first provider</Button>} />
        ) : (
          <ul className="divide-y divide-slate-800">
            {providers.map((p) => {
              const preset = getPreset(p.preset);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm text-white">
                      {p.label}
                      {p.isDefault ? <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 text-[10px] text-primary">default</span> : null}
                      {p.lastTestOk === true ? <CheckCircle2 className="size-3.5 text-emerald-400" /> : p.lastTestOk === false ? <XCircle className="size-3.5 text-red-400" /> : null}
                    </p>
                    <p className="text-xs text-slate-500">
                      {p.apiKeyMasked ?? "no key"}{p.baseUrl ? ` · ${p.baseUrl}` : ""}
                    </p>
                    {results[p.id] || (p.lastTestOk === false && p.lastTestError) ? (
                      <p className={`mt-1 rounded-md border px-2 py-1 text-[11px] break-words ${p.lastTestOk === false ? "border-red-500/30 bg-red-500/5 text-red-300" : "border-slate-800 text-slate-400"}`}>
                        {results[p.id] ?? p.lastTestError}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex w-full items-center gap-1 sm:w-72">
                    {(liveModels[p.id] ?? preset?.suggestedModels ?? []).length > 0 ? (
                      <NativeSelect
                        value={p.model}
                        onChange={(v) => changeModel(p, v)}
                        options={[...new Set([p.model, ...(liveModels[p.id] ?? preset?.suggestedModels ?? [])])].map((m) => ({
                          value: m,
                          label: liveModels[p.id] && !liveModels[p.id].includes(m) ? `${m} (not available)` : m,
                        }))}
                      />
                    ) : (
                      <span className="flex-1 truncate text-xs text-slate-300">{p.model}</span>
                    )}
                    <Button size="icon-sm" variant="ghost" aria-label="Load current models" title="Load the models this key can use" className="shrink-0 text-slate-400" disabled={loadingModels === p.id} onClick={() => loadModelsFor(p)}>
                      {loadingModels === p.id ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    </Button>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="border-slate-700 bg-slate-900 text-slate-200" onClick={() => test(p)} disabled={testing === p.id}>
                      {testing === p.id ? <Loader2 className="size-3.5 animate-spin" /> : null} Test
                    </Button>
                    {!p.isDefault && <Button size="icon-sm" variant="ghost" aria-label="Make default" className="text-slate-400" onClick={() => makeDefault(p)}><Star /></Button>}
                    <Button size="icon-sm" variant="ghost" aria-label="Remove" className="text-slate-400" onClick={() => remove(p)}><Trash2 /></Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <p className="text-xs text-slate-500">Choose which provider the sales rep uses on the AI Sales Rep page. If the AI call fails, the rep falls back to rules so customers still get price lists and orders.</p>
      <AddDialog open={adding} onOpenChange={setAdding} onAdded={load} />
    </div>
  );
}
