'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { SearchProfileTag } from '@/components/contacts/search-profile-tag';
import { MetaCapiQualifyButton } from '@/components/contacts/meta-capi-qualify-button';
import { toast } from 'sonner';
import {
  User,
  Phone,
  Gauge,
  Flame,
  CheckCircle2,
  AlertCircle,
  PauseCircle,
  Archive,
  Trash2,
  PlayCircle,
  Building2,
  ExternalLink,
  Loader2,
  Calendar,
  Sparkles,
  ShoppingBag,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface LeadCommercialDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string | null;
  onLeadUpdated?: () => void;
}

interface LeadDetailsData {
  lead: {
    id: string;
    name: string;
    phone: string;
    aiScore: number;
    isPaused: boolean;
    isArchived: boolean;
    hasPurchased?: boolean;
  };
  searchProfile: {
    operation: string;
    purpose: string[];
    propertyTypes: string[];
    propertyTypeStrict: boolean;
    locations: string[];
    locationStrict: boolean;
    priceMin: number | null;
    priceMax: number | null;
    priceStrictMax: boolean;
    priceFlexMax: number | null;
    bedrooms: number[];
    bedroomsStrict: boolean;
    deliveryStatus: string[];
    deliveryStrict: boolean;
    requiredFeatures: string[];
    preferredFeatures: string[];
    provenance: Record<string, string>;
  };
  maturity: {
    maturity: number;
    meetsThreshold: boolean;
    dimensions: Record<string, {
      baseWeight: number;
      normalizedWeight: number;
      earnedPoints: number;
      provenance: string;
      hasValue: boolean;
    }>;
  };
  tags: Array<{
    id: string;
    name: string;
    color: string;
    category?: string;
    source: string;
    originallyFromCtwa: boolean;
  }>;
  sentProperties: Array<{
    id: string;
    propertyId: string;
    propertyTitle: string;
    propertyNeighborhood: string;
    propertyCoverUrl?: string | null;
    sentAt: string;
    firstOpenedAt?: string | null;
    lastOpenedAt?: string | null;
    openCount: number;
    isInterested: boolean;
    interestedAt?: string | null;
  }>;
}

export function LeadCommercialDrawer({
  open,
  onOpenChange,
  leadId,
  onLeadUpdated,
}: LeadCommercialDrawerProps) {
  const [data, setData] = useState<LeadDetailsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchLeadDetails = useCallback(async () => {
    if (!leadId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/match/lead/${leadId}`);
      if (!res.ok) throw new Error('Falha ao carregar perfil do lead');
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao carregar perfil comercial do lead');
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    if (open && leadId) {
      fetchLeadDetails();
    } else {
      setData(null);
    }
  }, [open, leadId, fetchLeadDetails]);

  async function handleCycleAction(action: 'pause' | 'resume' | 'archive' | 'unarchive') {
    if (!leadId) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/match/lead/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error('Falha ao atualizar status');
      toast.success('Status do lead atualizado!');
      await fetchLeadDetails();
      if (onLeadUpdated) onLeadUpdated();
    } catch (err) {
      toast.error((err as Error).message || 'Erro ao atualizar');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteLead() {
    if (!leadId) return;
    if (!window.confirm(`Tem certeza que deseja excluir o lead ${data?.lead.name || 'este lead'}? Esta ação é definitiva.`)) {
      return;
    }
    setActionLoading(true);
    try {
      const res = await fetch(`/api/match/lead/${leadId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || 'Falha ao excluir lead');
      }
      toast.success('Lead excluído com sucesso!');
      onOpenChange(false);
      if (onLeadUpdated) onLeadUpdated();
    } catch (err) {
      toast.error((err as Error).message || 'Erro ao excluir lead');
    } finally {
      setActionLoading(false);
    }
  }

  const initials = (data?.lead.name || 'Lead')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const totalSent = data?.sentProperties.length || 0;
  const lastSent = data?.sentProperties[0]?.sentAt
    ? format(new Date(data.sentProperties[0].sentAt), "dd/MM 'às' HH:mm", { locale: ptBR })
    : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 overflow-y-auto">
        <SheetHeader className="border-b border-border p-4 bg-muted/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 border border-primary/20 text-sm font-bold text-primary">
                {initials}
              </div>
              <div>
                <SheetTitle className="text-base font-semibold text-foreground">
                  {data?.lead.name || 'Carregando...'}
                </SheetTitle>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Phone className="size-3" />
                  <span>{data?.lead.phone || '—'}</span>
                  {data?.lead.isPaused && (
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.2 text-[10px] font-medium text-amber-400">
                      Pausado
                    </span>
                  )}
                  {data?.lead.isArchived && (
                    <span className="rounded-full bg-muted px-2 py-0.2 text-[10px] font-medium text-muted-foreground">
                      Arquivado
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
          <SheetDescription className="sr-only">Perfil comercial e histórico de Match do lead</SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : !data ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Perfil não disponível
          </div>
        ) : (
          <div className="space-y-5 p-5">
            {/* Ação Contextual: Cliente que já comprou (FASE 20) */}
            {data.lead.hasPurchased && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5 text-xs">
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <ShoppingBag className="size-4 text-primary" />
                  Cliente já comprou com você anteriormente!
                </div>
                <p className="mt-1 text-muted-foreground">
                  Deseja encerrar ou pausar o ciclo atual de recomendações automáticas para este lead?
                </p>
                <div className="mt-2.5 flex items-center gap-2">
                  {!data.lead.isPaused && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => handleCycleAction('pause')}
                      disabled={actionLoading}
                      className="gap-1 text-[11px]"
                    >
                      <PauseCircle className="size-3" />
                      Pausar Matches
                    </Button>
                  )}
                  {!data.lead.isArchived && (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => handleCycleAction('archive')}
                      disabled={actionLoading}
                      className="gap-1 text-[11px] text-muted-foreground"
                    >
                      <Archive className="size-3" />
                      Arquivar Lead
                    </Button>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={handleDeleteLead}
                    disabled={actionLoading}
                    className="gap-1 text-[11px] text-rose-500 hover:text-rose-600 hover:bg-rose-500/10"
                  >
                    <Trash2 className="size-3" />
                    Excluir
                  </Button>
                </div>
              </div>
            )}

            {/* Painel de Indicadores: Temperatura vs Maturidade */}
            <div className="grid grid-cols-2 gap-3">
              {/* Temperatura Comercial (contacts.ai_score) */}
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1 font-medium">
                    <Flame className="size-3.5 text-amber-500" />
                    Temperatura
                  </span>
                  <span className="font-bold text-foreground">{data.lead.aiScore} / 10</span>
                </div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-rose-500 rounded-full transition-all"
                    style={{ width: `${(data.lead.aiScore / 10) * 100}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Aquecimento comercial avaliado pela IA da conversa.
                </p>
              </div>

              {/* Maturidade do Perfil (0 a 100%) */}
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1 font-medium">
                    <Gauge className="size-3.5 text-blue-500" />
                    Maturidade
                  </span>
                  <span className="font-bold text-foreground">{data.maturity.maturity}%</span>
                </div>
                <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      data.maturity.meetsThreshold ? 'bg-emerald-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${data.maturity.maturity}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  {data.maturity.meetsThreshold
                    ? '🎯 Apto para Match automático (≥ 70%)'
                    : '⏳ Em amadurecimento (< 70%)'}
                </p>
              </div>
            </div>

            {/* Conversão Meta (Lead Qualificado CAPI) */}
            <div className="rounded-xl border border-border bg-card p-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Conversão Meta Ads</span>
                <span className="text-[10px] text-muted-foreground">Conversions API (CAPI)</span>
              </div>
              <MetaCapiQualifyButton contactId={data.lead.id} />
            </div>

            {/* Tags e Origem Visual Azul / Verde (FASE 2) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                <span>Perfil de Busca & Tags</span>
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="inline-flex items-center gap-1 text-blue-400">
                    <span className="size-1.5 rounded-full bg-blue-400" />
                    Anúncio (CTWA)
                  </span>
                  <span className="inline-flex items-center gap-1 text-emerald-400">
                    <span className="size-1.5 rounded-full bg-emerald-400" />
                    Conversa / Confirmado
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-card p-3">
                {data.tags.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhuma tag registrada ainda.</p>
                ) : (
                  data.tags.map((t) => (
                    <SearchProfileTag
                      key={t.id}
                      name={t.name}
                      category={t.category}
                      color={t.color}
                      source={t.source}
                      originallyFromCtwa={t.originallyFromCtwa}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Requisitos Obrigatórios vs Preferências (FASE 4) */}
            <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-xs">
              <h4 className="font-semibold text-foreground">Requisitos vs Preferências</h4>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Obrigatórios */}
                <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-2.5">
                  <div className="flex items-center gap-1 font-medium text-rose-400">
                    <AlertCircle className="size-3" />
                    Requisitos Obrigatórios (Eliminam)
                  </div>
                  <ul className="space-y-1 text-[11px] text-foreground">
                    <li>• Operação: <strong>{data.searchProfile.operation === 'venda' ? 'Compra' : 'Locação'}</strong></li>
                    {data.searchProfile.propertyTypeStrict && data.searchProfile.propertyTypes.length > 0 && (
                      <li>• Tipologia estrita: <strong>{data.searchProfile.propertyTypes.join(', ')}</strong></li>
                    )}
                    {data.searchProfile.locationStrict && data.searchProfile.locations.length > 0 && (
                      <li>• Bairro estrito: <strong>{data.searchProfile.locations.join(', ')}</strong></li>
                    )}
                    {data.searchProfile.priceStrictMax && data.searchProfile.priceMax && (
                      <li>• Teto absoluto: <strong>R$ {data.searchProfile.priceMax.toLocaleString('pt-BR')}</strong></li>
                    )}
                    {data.searchProfile.bedroomsStrict && data.searchProfile.bedrooms.length > 0 && (
                      <li>• Quartos mínimos: <strong>{Math.min(...data.searchProfile.bedrooms)} quarto(s)</strong></li>
                    )}
                    {data.searchProfile.deliveryStrict && data.searchProfile.deliveryStatus.length > 0 && (
                      <li>• Entrega: <strong>{data.searchProfile.deliveryStatus.join(', ')}</strong></li>
                    )}
                    {data.searchProfile.requiredFeatures.map((f, i) => (
                      <li key={i}>• Obrigatório: <strong>{f}</strong></li>
                    ))}
                    {!data.searchProfile.propertyTypeStrict &&
                     !data.searchProfile.locationStrict &&
                     !data.searchProfile.priceStrictMax &&
                     !data.searchProfile.bedroomsStrict &&
                     data.searchProfile.requiredFeatures.length === 0 && (
                      <li className="text-muted-foreground italic">Nenhum requisito eliminatório rígido.</li>
                    )}
                  </ul>
                </div>

                {/* Preferências */}
                <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-2.5">
                  <div className="flex items-center gap-1 font-medium text-emerald-400">
                    <CheckCircle2 className="size-3" />
                    Preferências Informadas
                  </div>
                  <ul className="space-y-1 text-[11px] text-foreground">
                    {data.searchProfile.locations.length > 0 && (
                      <li>• Bairros de interesse: {data.searchProfile.locations.join(', ')}</li>
                    )}
                    {data.searchProfile.propertyTypes.length > 0 && (
                      <li>• Tipologias: {data.searchProfile.propertyTypes.join(', ')}</li>
                    )}
                    {data.searchProfile.priceMax && (
                      <li>• Orçamento alvo: R$ {data.searchProfile.priceMax.toLocaleString('pt-BR')}</li>
                    )}
                    {data.searchProfile.bedrooms.length > 0 && (
                      <li>• Quartos aceitos: {data.searchProfile.bedrooms.join(', ')}</li>
                    )}
                    {data.searchProfile.preferredFeatures.map((f, i) => (
                      <li key={i}>• Deseja: {f}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* Imóveis Enviados & Histórico de Interação (FASE 13 & 16) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-foreground">
                  Imóveis Enviados ({totalSent})
                </span>
                {lastSent && (
                  <span className="text-[11px] text-muted-foreground">Último envio: {lastSent}</span>
                )}
              </div>

              {data.sentProperties.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-card p-4 text-center text-xs text-muted-foreground">
                  Nenhum imóvel foi enviado ainda para este lead.
                </div>
              ) : (
                <div className="space-y-2">
                  {data.sentProperties.map((sp) => (
                    <div
                      key={sp.id}
                      className="rounded-xl border border-border bg-card p-3 space-y-2 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex gap-2.5">
                          {sp.propertyCoverUrl ? (
                            <img
                              src={sp.propertyCoverUrl}
                              alt={sp.propertyTitle}
                              className="size-11 rounded-lg object-cover border border-border"
                            />
                          ) : (
                            <div className="flex size-11 items-center justify-center rounded-lg bg-muted border border-border text-muted-foreground">
                              <Building2 className="size-5" />
                            </div>
                          )}
                          <div>
                            <h5 className="font-semibold text-foreground leading-tight">
                              {sp.propertyTitle}
                            </h5>
                            <p className="text-[11px] text-muted-foreground">
                              {sp.propertyNeighborhood}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              Enviado em {format(new Date(sp.sentAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                            </p>
                          </div>
                        </div>

                        {sp.isInterested && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-400 animate-pulse">
                            🔥 Tenho Interesse
                          </span>
                        )}
                      </div>

                      {/* Métricas de Abertura / Tracking */}
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/60 text-[11px]">
                        <div>
                          <span className="text-muted-foreground">Abriu link: </span>
                          <span className="font-medium text-foreground">
                            {sp.openCount > 0 ? `Sim (${sp.openCount}x)` : 'Não'}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Última abertura: </span>
                          <span className="font-medium text-foreground">
                            {sp.lastOpenedAt
                              ? format(new Date(sp.lastOpenedAt), 'dd/MM HH:mm', { locale: ptBR })
                              : '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Gerenciamento do Ciclo do Lead (FASE 10) */}
            <div className="pt-2 border-t border-border flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Status do Lead no CRM:</span>
              <div className="flex items-center gap-2">
                {data.lead.isPaused ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => handleCycleAction('resume')}
                    disabled={actionLoading}
                    className="gap-1 text-emerald-400"
                  >
                    <PlayCircle className="size-3" />
                    Reativar Lead
                  </Button>
                ) : (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => handleCycleAction('pause')}
                    disabled={actionLoading}
                    className="gap-1 text-amber-400"
                  >
                    <PauseCircle className="size-3" />
                    Pausar Lead
                  </Button>
                )}

                {data.lead.isArchived ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => handleCycleAction('unarchive')}
                    disabled={actionLoading}
                    className="gap-1"
                  >
                    Desarquivar
                  </Button>
                ) : (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => handleCycleAction('archive')}
                    disabled={actionLoading}
                    className="gap-1 text-muted-foreground"
                  >
                    <Archive className="size-3" />
                    Arquivar
                  </Button>
                )}

                <Button
                  size="xs"
                  variant="ghost"
                  onClick={handleDeleteLead}
                  disabled={actionLoading}
                  className="gap-1 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10"
                >
                  <Trash2 className="size-3" />
                  Excluir
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
