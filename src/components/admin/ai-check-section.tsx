'use client';

import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { readResponseJson } from '@/lib/http/response-json';
import {
  checkVerticalFor,
  evaluate,
  scenariosFor,
  type Scenario,
  type ScenarioStatus,
  type TurnResult,
} from '@/lib/onboarding/ai-check';

interface Run {
  status: ScenarioStatus | 'running' | 'error';
  note: string | null;
  transcript: { role: 'user' | 'assistant'; content: string }[];
}

const BADGE: Record<Run['status'], string> = {
  running: '⏳ Corriendo',
  pass: '✅ Pasó',
  fail: '❌ Falló',
  review: '👀 Léela',
  error: '⚠️ Error',
};

const CONCURRENCY = 3;

/** Per-company scripted check of the AI before it goes live. */
export function AiCheckSection({ companyId, industryVertical }: { companyId: string; industryVertical: string }) {
  const scenarios = scenariosFor(checkVerticalFor(industryVertical));
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const [running, setRunning] = useState(false);

  const runOne = async (s: Scenario) => {
    const transcript: Run['transcript'] = [];
    let last: TurnResult | null = null;
    const update = (patch: Partial<Run>) =>
      setRuns((prev) => ({ ...prev, [s.id]: { status: 'running', note: null, transcript: [...transcript], ...patch } }));
    try {
      for (const turn of s.turns) {
        transcript.push({ role: 'user', content: turn });
        update({});
        const response = await fetch(`/api/admin/companies/${companyId}/ai-check`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages: transcript }),
        });
        const body = await readResponseJson<TurnResult & { error?: string }>(response);
        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
        last = body;
        transcript.push({
          role: 'assistant',
          content: (body.reply || '(sin texto)') + (body.handoff ? '\n[pasa al equipo]' : ''),
        });
      }
      update(evaluate(s, last!));
    } catch (err) {
      update({ status: 'error', note: err instanceof Error ? err.message : String(err) });
    }
  };

  const runAll = async () => {
    setRunning(true);
    setRuns({});
    const queue = [...scenarios];
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let s = queue.shift(); s; s = queue.shift()) await runOne(s);
      }),
    );
    setRunning(false);
  };

  const done = Object.values(runs).filter((r) => r.status !== 'running');
  const count = (st: ScenarioStatus) => done.filter((r) => r.status === st).length;

  return (
    <div className="border-border rounded-xl border p-4">
      <h3 className="flex items-center gap-2 font-semibold">
        <FlaskConical className="text-primary size-4" />
        Prueba de la IA
      </h3>
      <p className="text-muted-foreground mt-1 text-xs">
        {scenarios.length} conversaciones de prueba con la configuración actual (prompt, conocimiento y
        catálogo). No envía nada por WhatsApp; usa la clave de IA de la empresa. Con modelos lentos tarda
        varios minutos.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={running} onClick={() => void runAll()}>
          {running ? 'Corriendo...' : 'Correr pruebas'}
        </Button>
        {done.length ? (
          <span className="text-sm">
            {count('pass')} pasaron · {count('fail')} fallaron · {count('review')} para leer
            {done.some((r) => r.status === 'error') ? ' · hubo errores' : ''}
          </span>
        ) : null}
      </div>

      {Object.keys(runs).length ? (
        <ul className="mt-3 space-y-2">
          {scenarios
            .filter((s) => runs[s.id])
            .map((s) => {
              const run = runs[s.id];
              return (
                <li key={s.id} className="rounded-lg border px-3 py-2 text-sm">
                  <details>
                    <summary className="cursor-pointer">
                      <span className="mr-2 whitespace-nowrap">{BADGE[run.status]}</span>
                      {s.title}
                      {run.note ? <span className="text-muted-foreground"> · {run.note}</span> : null}
                    </summary>
                    <ol className="mt-2 space-y-2">
                      {run.transcript.map((m, i) => (
                        <li key={i} className={m.role === 'assistant' ? 'pl-6' : ''}>
                          <span className="text-muted-foreground text-xs">{m.role === 'user' ? 'Cliente' : 'IA'}</span>
                          <p className="whitespace-pre-wrap">{m.content}</p>
                        </li>
                      ))}
                    </ol>
                  </details>
                </li>
              );
            })}
        </ul>
      ) : null}
    </div>
  );
}
