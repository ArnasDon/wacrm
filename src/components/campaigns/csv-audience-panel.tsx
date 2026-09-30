'use client';

import { useRef, useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { MAX_ROWS, guessColumn, parseCsvTable } from '@/lib/campaigns/advanced';
import type { CsvData } from './wizard/state';

interface AudienceStats {
  valid: number;
  invalid: number;
  duplicates: number;
}

const PREVIEW_ROWS = 5;

export interface CsvSelection {
  csv: CsvData | null;
  phoneColumn: string | null;
  nameColumn: string | null;
}

/**
 * CSV audience upload shared by the standard and advanced campaign
 * wizards: drop / pick a file, choose the phone and name columns, see
 * how many rows will receive (valid / invalid / duplicate) and the
 * first rows of the file.
 */
export function CsvAudiencePanel({
  value,
  onChange,
  stats,
  hideStats = false,
}: {
  value: CsvSelection;
  onChange: (patch: Partial<CsvSelection>) => void;
  stats: AudienceStats;
  /** The caller shows its own audience-health counts. */
  hideStats?: boolean;
}) {
  const state = value;
  const t = useTranslations('Broadcasts.advanced.audience');
  const format = useFormatter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function load(file: File) {
    setError(null);
    if (!/\.(csv|txt)$/i.test(file.name) && file.type !== 'text/csv') {
      setError(t('errorType'));
      return;
    }
    try {
      const { headers, rows } = parseCsvTable(await file.text());
      if (headers.length === 0 || rows.length === 0) {
        setError(t('errorEmpty'));
        return;
      }
      if (rows.length > MAX_ROWS) {
        setError(t('errorTooMany', { max: format.number(MAX_ROWS) }));
        return;
      }
      const phoneColumn = guessColumn(headers, 'phone') ?? headers[0];
      onChange({
        csv: { fileName: file.name, headers, rows },
        phoneColumn,
        nameColumn: guessColumn(
          headers.filter((h) => h !== phoneColumn),
          'name'
        ),
      });
    } catch {
      setError(t('errorRead'));
    }
  }

  const csv = state.csv;
  const selectClass =
    'h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring';

  return (
    <div className="space-y-6">
      <section className="border-border bg-card rounded-xl border p-5">
        <h2 className="text-foreground text-base font-semibold">
          {t('title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('hint')}</p>

        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void load(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void load(f);
          }}
          className={cn(
            'mt-4 flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 text-center transition-colors',
            csv ? 'py-5' : 'py-12',
            dragging
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/60 hover:bg-muted/40'
          )}
        >
          {csv ? (
            <span className="flex flex-wrap items-center justify-center gap-3 text-sm">
              <FileSpreadsheet className="text-primary size-5" />
              <span className="text-foreground font-medium">
                {csv.fileName}
              </span>
              <span className="text-muted-foreground">
                {t('rows', { count: csv.rows.length })} ·{' '}
                {t('columns', { count: csv.headers.length })}
              </span>
              <span className="text-primary">{t('replace')}</span>
            </span>
          ) : (
            <>
              <Upload className="text-muted-foreground size-8" />
              <span className="text-foreground text-sm font-medium">
                {t('drop')}
              </span>
            </>
          )}
        </button>
        {error ? (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
      </section>

      {csv ? (
        <>
          <section className="border-border bg-card grid gap-4 rounded-xl border p-5 md:grid-cols-2">
            <label className="block">
              <span className="text-foreground mb-1.5 block text-sm font-medium">
                {t('phoneColumn')}
              </span>
              <select
                value={state.phoneColumn ?? ''}
                onChange={(e) => onChange({ phoneColumn: e.target.value })}
                className={selectClass}
              >
                {csv.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-foreground mb-1.5 block text-sm font-medium">
                {t('nameColumn')}
              </span>
              <select
                value={state.nameColumn ?? ''}
                onChange={(e) =>
                  onChange({ nameColumn: e.target.value || null })
                }
                className={selectClass}
              >
                <option value="">{t('none')}</option>
                {csv.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>

            <p className="text-muted-foreground -mt-2 text-xs md:col-span-2">
              {t('phoneHint')}
            </p>
            {hideStats ? null : (
              <div className="grid grid-cols-3 gap-3 md:col-span-2">
                {[
                  {
                    label: t('valid'),
                    value: stats.valid,
                    tone: 'text-emerald-600 dark:text-emerald-400',
                  },
                  {
                    label: t('invalid'),
                    value: stats.invalid,
                    tone: stats.invalid
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-foreground',
                  },
                  {
                    label: t('duplicates'),
                    value: stats.duplicates,
                    tone: stats.duplicates
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-foreground',
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="border-border bg-background rounded-lg border px-4 py-3"
                  >
                    <p className="text-muted-foreground font-mono text-[11px] tracking-[0.15em] uppercase">
                      {s.label}
                    </p>
                    <p
                      className={cn(
                        'mt-1 font-mono text-2xl tabular-nums',
                        s.tone
                      )}
                    >
                      {format.number(s.value)}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {stats.valid === 0 ? (
              <p className="text-sm text-red-600 md:col-span-2 dark:text-red-400">
                {t('errorNoValid')}
              </p>
            ) : null}
          </section>

          <section className="border-border bg-card overflow-hidden rounded-xl border">
            <p className="border-border text-muted-foreground border-b px-5 py-3 font-mono text-[11px] tracking-[0.15em] uppercase">
              {t('preview')}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    {csv.headers.map((h) => (
                      <th
                        key={h}
                        className={cn(
                          'px-4 py-2 text-left font-medium whitespace-nowrap',
                          h === state.phoneColumn
                            ? 'text-primary'
                            : h === state.nameColumn
                              ? 'text-violet-600 dark:text-violet-400'
                              : 'text-muted-foreground'
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {csv.rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                    <tr key={i}>
                      {csv.headers.map((h, j) => (
                        <td
                          key={h}
                          className="text-foreground max-w-56 truncate px-4 py-2 whitespace-nowrap"
                        >
                          {r[j] || (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
