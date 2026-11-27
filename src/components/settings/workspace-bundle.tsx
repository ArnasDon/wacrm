'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Download, Loader2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

type Section = 'flows' | 'automations' | 'quick_replies' | 'templates' | 'ai';

const LABELS: Record<Section, { title: string; note?: string }> = {
  flows: { title: 'Flows', note: 'Created as drafts unless the file says to activate them.' },
  automations: { title: 'Automations', note: 'Created inactive unless the file says to activate them.' },
  quick_replies: { title: 'Quick replies', note: 'Existing titles are updated.' },
  templates: {
    title: 'Message templates',
    note: 'Each one is submitted to Meta for approval, exactly like the "New template" form.',
  },
  ai: {
    title: 'AI agent',
    note: 'Instructions, toggles and knowledge base. Your provider key is never imported.',
  },
};
const ORDER: Section[] = ['flows', 'automations', 'quick_replies', 'templates', 'ai'];

interface SectionResult {
  created: number;
  updated: number;
  skipped: number;
  warnings: string[];
}

export function WorkspaceBundle() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [bundle, setBundle] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');
  const [summary, setSummary] = useState<Record<Section, number> | null>(null);
  const [picked, setPicked] = useState<Set<Section>>(new Set());
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Partial<Record<Section, SectionResult>> | null>(null);

  const reset = () => {
    setBundle(null);
    setSummary(null);
    setResults(null);
    setFileName('');
    setPicked(new Set());
    if (fileRef.current) fileRef.current.value = '';
  };

  async function onFile(file: File | undefined) {
    if (!file) return;
    setResults(null);
    let doc: unknown;
    try {
      doc = JSON.parse(await file.text());
    } catch {
      toast.error("That file isn't valid JSON.");
      reset();
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/workspace/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundle: doc, dry_run: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = Array.isArray(data.details) ? ` ${data.details.slice(0, 3).join(' ')}` : '';
        toast.error((data.error ?? 'Could not read the bundle.') + detail);
        reset();
        return;
      }
      setBundle(doc);
      setFileName(file.name);
      setSummary(data.summary);
      setPicked(new Set(ORDER.filter((s) => (data.summary?.[s] ?? 0) > 0)));
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!bundle || picked.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch('/api/workspace/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundle, sections: [...picked] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? 'Import failed.');
        return;
      }
      setResults(data.results ?? {});
      toast.success('Import finished. See the result below.');
    } catch {
      toast.error('Import failed.');
    } finally {
      setBusy(false);
    }
  }

  const toggle = (s: Section) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title="Import / export"
        description="Move a whole setup (flows, automations, quick replies, templates and the AI agent) as one JSON file. Secrets such as API keys are never included."
      />

      <Card>
        <CardHeader>
          <CardTitle>Import a bundle</CardTitle>
          <CardDescription>
            Choose a <code className="text-xs">.json</code> bundle file. You can tick which parts to import before anything changes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy && !summary ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Choose bundle file
            </Button>
            {fileName ? <span className="text-sm text-muted-foreground">{fileName}</span> : null}
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </div>

          {summary ? (
            <div className="space-y-3">
              <ul className="space-y-2">
                {ORDER.filter((s) => summary[s] > 0).map((s) => (
                  <li key={s} className="flex items-start gap-3 rounded-md border border-border p-3">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={picked.has(s)}
                      onChange={() => toggle(s)}
                      id={`bundle-${s}`}
                    />
                    <label htmlFor={`bundle-${s}`} className="text-sm">
                      <span className="font-medium">
                        {LABELS[s].title} ({summary[s]})
                      </span>
                      {LABELS[s].note ? (
                        <span className="block text-muted-foreground">{LABELS[s].note}</span>
                      ) : null}
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button onClick={runImport} disabled={busy || picked.size === 0}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Import selected
                </Button>
                <Button variant="ghost" onClick={reset} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {results ? (
            <div className="space-y-2 rounded-md border border-border p-3 text-sm">
              <p className="font-medium">Result</p>
              {ORDER.filter((s) => results[s]).map((s) => {
                const r = results[s] as SectionResult;
                return (
                  <div key={s}>
                    <p>
                      <span className="font-medium">{LABELS[s].title}:</span> {r.created} created, {r.updated} updated, {r.skipped} skipped
                    </p>
                    {r.warnings.length > 0 ? (
                      <ul className="ml-4 list-disc text-muted-foreground">
                        {r.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Export</CardTitle>
          <CardDescription>
            Download your current setup. Use it as a backup or to copy a workspace to another account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" render={<a href="/api/workspace/export" download />}>
            <Download className="mr-2 h-4 w-4" />
            Download everything
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}
