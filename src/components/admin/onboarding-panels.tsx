'use client';

import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { readResponseJson } from '@/lib/http/response-json';
import { FORM_LABELS, FORM_VERTICALS, type FormVertical } from '@/lib/onboarding/spec';
import type { ApplyResult } from '@/lib/onboarding/apply';

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    window.prompt('Copia el texto:', text);
  }
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' });
}

/** Platform-level: secret for the Apps Script + which forms exist. */
export function OnboardingSetupCard() {
  const [secret, setSecret] = useState<string | null>(null);
  const [forms, setForms] = useState<{ form_vertical: string; edit_url: string | null; updated_at: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch('/api/admin/onboarding', { cache: 'no-store' });
      const body = await readResponseJson<{ error?: string; secret: string | null; forms: typeof forms }>(response);
      if (!response.ok) return setError(body.error ?? 'No se pudo cargar');
      setSecret(body.secret);
      setForms(body.forms);
    })();
  }, []);

  return (
    <Card id="onboarding-forms" className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="size-5" /> Formularios de alta
        </CardTitle>
        <CardDescription>
          Google Forms que llena el dueño de cada empresa. Se crean con el script{' '}
          <code>scripts/onboarding/alta-formularios.gs</code> (instrucciones en su README).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error ? <p className="text-destructive">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          {FORM_VERTICALS.map((v) => {
            const f = forms.find((x) => x.form_vertical === v);
            return (
              <span key={v} className="rounded-md border px-2 py-1">
                {FORM_LABELS[v]}:{' '}
                {f ? (
                  f.edit_url ? (
                    <a className="text-primary underline" href={f.edit_url} target="_blank" rel="noreferrer">
                      registrado
                    </a>
                  ) : 'registrado'
                ) : (
                  <span className="text-muted-foreground">sin crear</span>
                )}
              </span>
            );
          })}
        </div>
        {secret ? (
          <div className="flex flex-wrap items-center gap-2">
            <span>Valor de <code>SANDIA_SECRET</code> para el script:</span>
            <Button size="sm" variant="outline" onClick={() => void copy(secret)}>
              <Copy className="size-4" /> Copiar
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface Intake {
  id: string;
  form_vertical: FormVertical;
  answers: Record<string, string> | null;
  received_at: string | null;
  applied_at: string | null;
  apply_result: ApplyResult | null;
  created_at: string;
  link: string | null;
}

const PROMPT_STATUS: Record<ApplyResult['prompt'], string> = {
  created: 'Prompt creado con las reglas del negocio.',
  replaced: 'Reglas del negocio actualizadas dentro del prompt.',
  suggested: 'El prompt ya estaba escrito a mano: no se tocó. Revisa y pega estas reglas donde correspondan.',
  no_ai_config: 'La empresa aún no tiene IA configurada: guarda la clave y vuelve a aplicar, o pega estas reglas.',
};

/** Per-company: send the link, see the answers, apply them. */
export function OnboardingCompanySection({ companyId, industryVertical }: { companyId: string; industryVertical: string }) {
  const defaultForm: FormVertical =
    industryVertical === 'hotel' ? 'hotel' : industryVertical === 'clinica' ? 'clinica' : 'comercio';
  const [formVertical, setFormVertical] = useState<FormVertical>(defaultForm);
  const [intakes, setIntakes] = useState<Intake[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/companies/${companyId}/onboarding`, { cache: 'no-store' });
      const body = await readResponseJson<{ error?: string; intakes: Intake[] }>(response);
      if (!response.ok) throw new Error(body.error ?? 'No se pudo cargar');
      setIntakes(body.intakes);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar');
    }
  }, [companyId]);

  // The parent keys this section by company, so state starts fresh per company.
  useEffect(() => {
    void load();
  }, [load]);

  const createLink = async () => {
    setBusy('link');
    setError(null);
    const response = await fetch(`/api/admin/companies/${companyId}/onboarding`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ form_vertical: formVertical }),
    });
    const body = await readResponseJson<{ error?: string; link?: string }>(response);
    setBusy(null);
    if (!response.ok || !body.link) return setError(body.error ?? 'No se pudo crear el enlace');
    await copy(body.link);
    await load();
  };

  const apply = async (intake: Intake) => {
    setBusy(intake.id);
    setError(null);
    const response = await fetch(`/api/admin/companies/${companyId}/onboarding/${intake.id}/apply`, { method: 'POST' });
    const body = await readResponseJson<{ error?: string }>(response);
    setBusy(null);
    if (!response.ok) return setError(body.error ?? 'No se pudo aplicar');
    await load();
  };

  return (
    <div className="border-border rounded-xl border p-4">
      <h3 className="flex items-center gap-2 font-semibold">
        <ClipboardList className="text-primary size-4" />
        Formulario de alta
      </h3>
      <p className="text-muted-foreground mt-1 text-xs">
        Manda el enlace al dueño. Cuando lo envíe te llega un correo; &quot;Aplicar&quot; crea la base de
        conocimiento, las reglas del prompt y el horario. Se puede volver a aplicar.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          id={`onboarding-form-${companyId}`}
          value={formVertical}
          onChange={(e) => setFormVertical(e.target.value as FormVertical)}
          className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
        >
          {FORM_VERTICALS.map((v) => (
            <option key={v} value={v}>
              {FORM_LABELS[v]}
            </option>
          ))}
        </select>
        <Button size="sm" disabled={busy === 'link'} onClick={() => void createLink()}>
          <Copy className="size-4" /> {busy === 'link' ? 'Creando...' : 'Copiar enlace para el dueño'}
        </Button>
      </div>
      {error ? <p className="text-destructive mt-2 text-sm">{error}</p> : null}

      <div className="mt-3 space-y-3">
        {intakes.map((intake) => (
          <div key={intake.id} className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">{FORM_LABELS[intake.form_vertical]}</span> ·{' '}
                {intake.applied_at
                  ? `aplicado ${fmt(intake.applied_at)}`
                  : intake.received_at
                    ? `recibido ${fmt(intake.received_at)}`
                    : `enlace creado ${fmt(intake.created_at)}, sin respuesta`}
              </span>
              <span className="flex gap-2">
                {intake.link ? (
                  <Button size="sm" variant="outline" onClick={() => void copy(intake.link!)}>
                    Copiar enlace
                  </Button>
                ) : null}
                {intake.answers ? (
                  <Button size="sm" disabled={busy === intake.id} onClick={() => void apply(intake)}>
                    {busy === intake.id ? 'Aplicando...' : intake.applied_at ? 'Volver a aplicar' : 'Aplicar'}
                  </Button>
                ) : null}
              </span>
            </div>

            {intake.answers ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs">Ver respuestas ({Object.keys(intake.answers).length})</summary>
                <dl className="mt-2 space-y-1 text-xs">
                  {Object.entries(intake.answers).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="whitespace-pre-wrap">{v}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ) : null}

            {intake.apply_result ? <ApplyReport result={intake.apply_result} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ApplyReport({ result }: { result: ApplyResult }) {
  return (
    <div className="mt-3 space-y-2 text-xs">
      <p>{PROMPT_STATUS[result.prompt]}</p>
      {result.suggested_prompt_block ? (
        <div className="space-y-1">
          <pre className="bg-muted max-h-48 overflow-auto rounded p-2 whitespace-pre-wrap">{result.suggested_prompt_block}</pre>
          <Button size="sm" variant="outline" onClick={() => void copy(result.suggested_prompt_block!)}>
            <Copy className="size-4" /> Copiar reglas
          </Button>
        </div>
      ) : null}
      {result.docs.length ? <p>Base de conocimiento: {result.docs.join(', ')}.</p> : null}
      {result.settings.length ? <p>Ajustes: {result.settings.join(' · ')}.</p> : null}
      {result.missing.length ? (
        <div>
          <p className="font-medium text-amber-600 dark:text-amber-400">Faltan respuestas obligatorias:</p>
          <ul className="list-disc pl-5">
            {result.missing.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </div>
      ) : null}
      <div>
        <p className="font-medium">Pendientes para ti:</p>
        <ul className="list-disc space-y-1 pl-5">
          {result.manual.map((m) => (
            <li key={m.title}>
              {m.title}
              <span className="text-muted-foreground block whitespace-pre-wrap">{m.detail}</span>
            </li>
          ))}
        </ul>
      </div>
      {result.warnings.length ? (
        <p className="text-destructive">Avisos: {result.warnings.join(' · ')}</p>
      ) : null}
    </div>
  );
}
