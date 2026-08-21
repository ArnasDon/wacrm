'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Loader2, Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  uploadAccountMedia,
  deleteAccountMedia,
  ALLOWED_MIME_TYPES_BY_KIND,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';
import { splitIntoLotes } from '@/lib/envios/lote-engine';

const CHAT_MEDIA_BUCKET = 'chat-media';

/** Generous cap on the leads JSON file — a few thousand leads is still tiny as text. */
const CAMPAIGN_FILE_MAX_BYTES = 5 * 1024 * 1024;

interface ParsedLead {
  nome: string | null;
  telefone: string;
}

/**
 * Lenient parser for the leads JSON — accepts a bare array or
 * `{ leads: [...] }`, and either `nome`/`telefone` or `name`/`phone`
 * per entry (the exact upstream shape the user's existing workflow
 * produces isn't part of this codebase, so both are accepted).
 */
function parseLeadsJson(raw: string): ParsedLead[] {
  const data = JSON.parse(raw);
  const arr = Array.isArray(data) ? data : Array.isArray(data?.leads) ? data.leads : null;
  if (!arr) throw new Error('Esperado um array de leads (ou { "leads": [...] })');
  return arr
    .map((item: Record<string, unknown>) => ({
      nome: (item.nome ?? item.name ?? null) as string | null,
      telefone: String(item.telefone ?? item.phone ?? '').trim(),
    }))
    .filter((l: ParsedLead) => l.telefone.length > 0);
}

export default function NewEnvioPage() {
  const router = useRouter();
  const t = useTranslations('Envios.new');

  const [nome, setNome] = useState('');
  const [mensagemTexto, setMensagemTexto] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [leadsRaw, setLeadsRaw] = useState('');
  const [campaignFileName, setCampaignFileName] = useState<string | null>(null);
  const [readingCampaignFile, setReadingCampaignFile] = useState(false);
  const [lote1SizeOverride, setLote1SizeOverride] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Pure derivation (no setState-in-useMemo) — leads and the parse
  // error are two facets of the same computation over leadsRaw.
  const { leads, leadsError } = useMemo<{ leads: ParsedLead[]; leadsError: string | null }>(() => {
    if (!leadsRaw.trim()) return { leads: [], leadsError: null };
    try {
      return { leads: parseLeadsJson(leadsRaw), leadsError: null };
    } catch (err) {
      return { leads: [], leadsError: err instanceof Error ? err.message : 'JSON inválido' };
    }
  }, [leadsRaw]);

  const [defaultLote1] = useMemo(() => splitIntoLotes(leads.length), [leads.length]);
  const lote1Size = lote1SizeOverride ?? defaultLote1;
  const lote2Size = leads.length - lote1Size;

  async function handleImageFile(file: File) {
    const allowed = ALLOWED_MIME_TYPES_BY_KIND.image as readonly string[];
    if (!allowed.includes(file.type)) {
      toast.error(t('invalidImageType'));
      return;
    }
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error(t('imageTooLarge'));
      return;
    }
    setUploading(true);
    try {
      const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
      const previousPath = imagePath;
      setImagePath(path);
      setImageUrl(publicUrl);
      if (previousPath) void deleteAccountMedia(CHAT_MEDIA_BUCKET, previousPath).catch(() => {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  function removeImage() {
    if (imagePath) void deleteAccountMedia(CHAT_MEDIA_BUCKET, imagePath).catch(() => {});
    setImageUrl('');
    setImagePath(null);
  }

  /**
   * Reads the uploaded leads file client-side and hands its raw text to
   * `leadsRaw` — `parseLeadsJson` (unchanged) still does the actual
   * format validation via the `leads`/`leadsError` memo below. Only the
   * *source* of that text changed (file instead of a pasted textarea).
   */
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
      setLeadsRaw(text);
      setCampaignFileName(file.name);
    } catch {
      toast.error(t('fileReadFailed'));
    } finally {
      setReadingCampaignFile(false);
    }
  }

  function removeCampaignFile() {
    setLeadsRaw('');
    setCampaignFileName(null);
  }

  const canSubmit =
    nome.trim().length > 0 && mensagemTexto.trim().length > 0 && leads.length > 0 && !leadsError;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/envios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome,
          mensagem_texto: mensagemTexto,
          mensagem_imagem_url: imageUrl || null,
          leads,
          lote1_size: lote1Size,
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
            <Input id="envio-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="envio-mensagem">{t('fieldMessage')}</Label>
            <Textarea
              id="envio-mensagem"
              rows={5}
              value={mensagemTexto}
              onChange={(e) => setMensagemTexto(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t('fieldImage')}</Label>
            {imageUrl ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt=""
                  className="max-h-40 rounded-lg border border-border object-contain"
                />
                <button
                  onClick={removeImage}
                  className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <label className="flex h-24 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-muted/40">
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Upload className="h-4 w-4" /> {t('uploadImage')}
                  </>
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleImageFile(file);
                  }}
                />
              </label>
            )}
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
            {leadsError && <p className="text-xs text-red-400">{leadsError}</p>}
          </div>

          {leads.length > 0 && (
            <div className="rounded-lg bg-muted/30 p-3">
              <p className="text-xs font-medium text-foreground">
                {t('lotesPreview', { total: leads.length })}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="lote1-size" className="text-xs">
                    {t('lote1Size')}
                  </Label>
                  <Input
                    id="lote1-size"
                    type="number"
                    min={0}
                    max={leads.length}
                    value={lote1Size}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isNaN(v)) return;
                      setLote1SizeOverride(Math.min(Math.max(v, 0), leads.length));
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t('lote2Size')}</Label>
                  <Input value={lote2Size} disabled />
                </div>
              </div>
            </div>
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
