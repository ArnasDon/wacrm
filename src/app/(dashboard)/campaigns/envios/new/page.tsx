'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Loader2, Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { splitIntoLotes, variantIndexForPosition, MAX_LOTES } from '@/lib/envios/lote-engine';
import { parseCampaignFile, type ParsedCampaignFile } from '@/lib/envios/parse-campaign-file';

/** Generous cap on the campaign JSON file — a few thousand leads is still tiny as text. */
const CAMPAIGN_FILE_MAX_BYTES = 5 * 1024 * 1024;

function variantLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

export default function NewEnvioPage() {
  const router = useRouter();
  const t = useTranslations('Envios.new');

  const [nome, setNome] = useState('');
  const [nomeTouched, setNomeTouched] = useState(false);
  const [campanhaJson, setCampanhaJson] = useState('');
  const [campaignFileName, setCampaignFileName] = useState<string | null>(null);
  const [readingCampaignFile, setReadingCampaignFile] = useState(false);
  const [numeroLotes, setNumeroLotes] = useState(2);
  const [submitting, setSubmitting] = useState(false);

  // Pure derivation (no setState-in-useMemo) — the parsed file and its
  // error are two facets of the same computation over campanhaJson.
  const { parsed, parseError } = useMemo<{
    parsed: ParsedCampaignFile | null;
    parseError: string | null;
  }>(() => {
    if (!campanhaJson.trim()) return { parsed: null, parseError: null };
    try {
      return { parsed: parseCampaignFile(campanhaJson), parseError: null };
    } catch (err) {
      return { parsed: null, parseError: err instanceof Error ? err.message : 'Arquivo inválido' };
    }
  }, [campanhaJson]);

  const leads = parsed?.leads ?? [];
  const variants = parsed?.variants ?? null;
  const loteSizes = useMemo(() => splitIntoLotes(leads.length, numeroLotes), [leads.length, numeroLotes]);
  // Position of each lead within its OWN lote (not the global leads
  // index) — variant rotation is per-lote (spec section 2), same
  // ranges the server computes in POST /api/envios.
  const positionsInLote = useMemo(() => {
    const positions: number[] = [];
    for (const size of loteSizes) {
      for (let p = 0; p < size; p++) positions.push(p);
    }
    return positions;
  }, [loteSizes]);

  async function handleCampaignFile(file: File) {
    const isJson = file.type === 'application/json' || file.name.toLowerCase().endsWith('.json');
    if (!isJson) {
      toast.error(t('invalidFileType'));
      return;
    }
    if (file.size > CAMPAIGN_FILE_MAX_BYTES) {
      toast.error(t('fileTooLarge'));
      return;
    }
    setReadingCampaignFile(true);
    try {
      const text = await file.text();
      setCampanhaJson(text);
      setCampaignFileName(file.name);
      if (!nomeTouched) {
        try {
          setNome(parseCampaignFile(text).nome);
        } catch {
          // Leave `nome` as-is — the error surfaces via `parseError` below.
        }
      }
    } catch {
      toast.error(t('fileReadFailed'));
    } finally {
      setReadingCampaignFile(false);
    }
  }

  function removeCampaignFile() {
    setCampanhaJson('');
    setCampaignFileName(null);
  }

  const canSubmit = nome.trim().length > 0 && leads.length > 0 && !parseError;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/envios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome,
          campanha_json: campanhaJson,
          numero_lotes: numeroLotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t('createFailed'));
      toast.success(t('createSuccess'));
      router.push(`/campaigns/envios/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('createFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="icon"
          onClick={() => router.push('/campaigns')}
          className="border-border"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </div>

      <Card className="border-border">
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="envio-nome">{t('fieldName')}</Label>
            <Input
              id="envio-nome"
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                setNomeTouched(true);
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t('fieldLeads')}</Label>
            {campaignFileName ? (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <span className="truncate text-sm text-foreground">{campaignFileName}</span>
                <button
                  onClick={removeCampaignFile}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={t('removeFile')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label className="flex h-24 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-muted/40">
                {readingCampaignFile ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Upload className="h-4 w-4" /> {t('uploadCampaignFile')}
                  </>
                )}
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  disabled={readingCampaignFile}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleCampaignFile(file);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
            {parseError && <p className="text-xs text-red-400">{parseError}</p>}
          </div>

          {parsed && leads.length > 0 && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="numero-lotes" className="text-xs">
                  {t('numeroLotes')}
                </Label>
                <Input
                  id="numero-lotes"
                  type="number"
                  min={1}
                  max={MAX_LOTES}
                  value={numeroLotes}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isNaN(v)) return;
                    setNumeroLotes(Math.min(Math.max(Math.trunc(v), 1), MAX_LOTES));
                  }}
                />
              </div>

              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-xs font-medium text-foreground">
                  {t('lotesPreview', { total: leads.length, lotes: loteSizes.length })}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {loteSizes.map((size, i) => (
                    <div key={i} className="rounded-md bg-background px-2.5 py-1.5 text-xs">
                      <span className="text-muted-foreground">{t('loteN', { numero: i + 1 })}: </span>
                      <span className="font-medium text-foreground">{t('leadsCount', { count: size })}</span>
                    </div>
                  ))}
                </div>
              </div>

              {variants && variants.length > 0 && (
                <div className="rounded-lg bg-muted/30 p-3">
                  <p className="text-xs font-medium text-foreground">
                    {t('variantsDetected', { count: variants.length })}
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {variants.map((v, i) => (
                      <div key={i} className="rounded-md bg-background px-2.5 py-1.5 text-xs">
                        <span className="font-medium text-foreground">{t('variantLabel', { letter: variantLetter(i) })}: </span>
                        <span className="text-muted-foreground">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">{t('leadsPreview')}</Label>
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border p-2">
                  {leads.map((lead, i) => (
                    <div key={i} className="rounded-md bg-muted/30 px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{lead.nome ?? lead.telefone}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{lead.telefone}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {variants && variants.length > 0
                          ? (() => {
                              const idx = variantIndexForPosition(positionsInLote[i] ?? 0, variants.length);
                              return `${t('variantLabel', { letter: variantLetter(idx) })}: ${variants[idx]}`;
                            })()
                          : lead.mensagem}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <Button
            disabled={!canSubmit || submitting}
            onClick={handleSubmit}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('create')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
