'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  ArrowLeft,
  Loader2,
  Upload,
  X,
  MessageSquare,
  FileJson,
  ImagePlus,
  CheckCircle2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { splitIntoLotes, variantIndexForPosition, MAX_LOTES } from '@/lib/envios/lote-engine';
import { parseCampaignFile, type ParsedCampaignFile } from '@/lib/envios/parse-campaign-file';
import { parseManualRecipients } from '@/lib/envios/parse-manual-recipients';
import {
  uploadAccountMedia,
  deleteAccountMedia,
  CHAT_MEDIA_BUCKET,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';

/** Generous cap on the campaign JSON file — a few thousand leads is still tiny as text. */
const CAMPAIGN_FILE_MAX_BYTES = 5 * 1024 * 1024;

function variantLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

export default function NewEnvioPage() {
  const router = useRouter();
  const t = useTranslations('Envios.new');

  // Mode: 'manual' (direct typing / paste numbers) vs 'json' (import campaign JSON file)
  const [mode, setMode] = useState<'manual' | 'json'>('manual');

  // Common fields
  const [nome, setNome] = useState('');
  const [nomeTouched, setNomeTouched] = useState(false);
  const [numeroLotes, setNumeroLotes] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  // Manual creation fields
  const [mensagem, setMensagem] = useState('');
  const [recipientsText, setRecipientsText] = useState('');
  const [manualImageUrl, setManualImageUrl] = useState<string>('');
  const [manualImagePath, setManualImagePath] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // JSON import fields
  const [campanhaJson, setCampanhaJson] = useState('');
  const [campaignFileName, setCampaignFileName] = useState<string | null>(null);
  const [readingCampaignFile, setReadingCampaignFile] = useState(false);

  // Parse manual recipients in real-time
  const manualLeads = useMemo(() => parseManualRecipients(recipientsText), [recipientsText]);

  // Parse JSON file when provided
  const { parsedJson, parseError } = useMemo<{
    parsedJson: ParsedCampaignFile | null;
    parseError: string | null;
  }>(() => {
    if (!campanhaJson.trim()) return { parsedJson: null, parseError: null };
    try {
      return { parsedJson: parseCampaignFile(campanhaJson), parseError: null };
    } catch (err) {
      return { parsedJson: null, parseError: err instanceof Error ? err.message : 'Arquivo inválido' };
    }
  }, [campanhaJson]);

  // Active leads, variants, and image depending on mode
  const leads = useMemo(() => {
    if (mode === 'manual') {
      return manualLeads.map((lead) => ({
        nome: lead.nome,
        telefone: lead.telefone,
        mensagem: mensagem.trim(),
      }));
    }
    return parsedJson?.leads ?? [];
  }, [mode, manualLeads, mensagem, parsedJson]);

  const variants = useMemo(() => {
    if (mode === 'manual') {
      return null;
    }
    return parsedJson?.variants ?? null;
  }, [mode, parsedJson]);

  const activeImageUrl = useMemo(() => {
    if (mode === 'manual') {
      return manualImageUrl || null;
    }
    return parsedJson?.imagemUrl ?? null;
  }, [mode, manualImageUrl, parsedJson]);

  // Adjust default lotes if leads grow
  const loteSizes = useMemo(() => splitIntoLotes(leads.length, numeroLotes), [leads.length, numeroLotes]);

  const positionsInLote = useMemo(() => {
    const positions: number[] = [];
    for (const size of loteSizes) {
      for (let p = 0; p < size; p++) positions.push(p);
    }
    return positions;
  }, [loteSizes]);

  // Handle image upload in manual mode
  async function handleImageFile(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error(t('invalidImageType'));
      return;
    }
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error(t('imageTooLarge'));
      return;
    }
    setUploadingImage(true);
    try {
      const { publicUrl, path } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
      const prevPath = manualImagePath;
      setManualImagePath(path);
      setManualImageUrl(publicUrl);
      if (prevPath) {
        void deleteAccountMedia(CHAT_MEDIA_BUCKET, prevPath).catch(() => {});
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('uploadFailed'));
    } finally {
      setUploadingImage(false);
    }
  }

  function removeManualImage() {
    if (manualImagePath) {
      void deleteAccountMedia(CHAT_MEDIA_BUCKET, manualImagePath).catch(() => {});
    }
    setManualImagePath(null);
    setManualImageUrl('');
    if (imageInputRef.current) imageInputRef.current.value = '';
  }

  // Handle JSON file upload
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

  const canSubmit = useMemo(() => {
    if (!nome.trim()) return false;
    if (mode === 'manual') {
      return mensagem.trim().length > 0 && manualLeads.length > 0;
    }
    return (parsedJson?.leads.length ?? 0) > 0 && !parseError;
  }, [nome, mode, mensagem, manualLeads, parsedJson, parseError]);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const payload =
        mode === 'manual'
          ? {
              nome: nome.trim(),
              mensagem: mensagem.trim(),
              imagem_url: manualImageUrl || null,
              leads: manualLeads,
              numero_lotes: numeroLotes,
            }
          : {
              nome: nome.trim(),
              campanha_json: campanhaJson,
              numero_lotes: numeroLotes,
            };

      const res = await fetch('/api/envios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
        <CardContent className="space-y-6 pt-6">
          {/* Tabs: Criar diretamente vs Importar arquivo JSON */}
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-1">
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === 'manual'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <MessageSquare className="h-4 w-4" />
              {t('tabManual')}
            </button>
            <button
              type="button"
              onClick={() => setMode('json')}
              className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                mode === 'json'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <FileJson className="h-4 w-4" />
              {t('tabJson')}
            </button>
          </div>

          {/* Nome do envio */}
          <div className="space-y-1.5">
            <Label htmlFor="envio-nome">{t('fieldName')}</Label>
            <Input
              id="envio-nome"
              placeholder={mode === 'manual' ? 'Ex: Envio Teste WhatsApp, Oferta Altiplano' : ''}
              value={nome}
              onChange={(e) => {
                setNome(e.target.value);
                setNomeTouched(true);
              }}
            />
          </div>

          {/* Modo Manual: Mensagem, Imagem opcional, Destinatários */}
          {mode === 'manual' && (
            <>
              {/* Mensagem de texto */}
              <div className="space-y-1.5">
                <Label htmlFor="envio-mensagem">{t('fieldMessage')}</Label>
                <Textarea
                  id="envio-mensagem"
                  rows={4}
                  placeholder={t('messagePlaceholder')}
                  value={mensagem}
                  onChange={(e) => setMensagem(e.target.value)}
                />
              </div>

              {/* Imagem opcional */}
              <div className="space-y-1.5">
                <Label>{t('fieldImage')}</Label>
                {manualImageUrl ? (
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-2.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={manualImageUrl}
                      alt="Preview"
                      className="h-16 w-16 rounded object-cover border border-border"
                    />
                    <div className="flex-1 truncate text-xs text-muted-foreground">
                      Imagem anexada com sucesso
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={removeManualImage}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div>
                    <label className="flex h-16 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:bg-muted/30">
                      {uploadingImage ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <ImagePlus className="h-4 w-4" />
                          {t('uploadImage')}
                        </>
                      )}
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploadingImage}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleImageFile(file);
                        }}
                      />
                    </label>
                  </div>
                )}
              </div>

              {/* Destinatários manuais (um ou vários telefones) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="envio-recipients">{t('fieldRecipients')}</Label>
                  {manualLeads.length > 0 && (
                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-500">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t('recipientsCount', { count: manualLeads.length })}
                    </span>
                  )}
                </div>
                <Textarea
                  id="envio-recipients"
                  rows={4}
                  placeholder={t('recipientsPlaceholder')}
                  value={recipientsText}
                  onChange={(e) => setRecipientsText(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {recipientsText.trim() && manualLeads.length === 0
                    ? t('noRecipientsEntered')
                    : t('recipientsHelp')}
                </p>
              </div>
            </>
          )}

          {/* Modo JSON: Upload do arquivo de campanha */}
          {mode === 'json' && (
            <div className="space-y-1.5">
              <Label>{t('fieldLeads')}</Label>
              {campaignFileName ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <span className="truncate text-sm text-foreground">{campaignFileName}</span>
                  <button
                    type="button"
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
          )}

          {/* Prévia dos lotes e leads para ambos os modos */}
          {leads.length > 0 && (
            <>
              {activeImageUrl && (
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-xs font-medium text-foreground mb-2">Imagem anexada ao envio:</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={activeImageUrl}
                    alt=""
                    className="h-24 rounded object-cover border border-border"
                  />
                </div>
              )}

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
                        <span className="font-medium text-foreground">
                          {t('variantLabel', { letter: variantLetter(i) })}:{' '}
                        </span>
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
                        <span className="font-medium text-foreground">
                          {lead.nome || lead.telefone}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {lead.telefone}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {variants && variants.length > 0
                          ? (() => {
                              const idx = variantIndexForPosition(
                                positionsInLote[i] ?? 0,
                                variants.length,
                              );
                              return `${t('variantLabel', { letter: variantLetter(idx) })}: ${variants[idx]}`;
                            })()
                          : lead.mensagem || mensagem}
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
