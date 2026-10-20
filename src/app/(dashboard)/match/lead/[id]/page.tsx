'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { SearchProfileTag } from '@/components/contacts/search-profile-tag';
import { MetaCapiQualifyButton } from '@/components/contacts/meta-capi-qualify-button';
import { LeadMatchesModal } from '@/components/match/lead-matches-modal';
import { SendWhatsAppModal } from '@/components/match/send-whatsapp-modal';
import type { LeadMatchGroup, MatchRecord } from '@/lib/match/types';
import type { MatchCardItem } from '@/components/match/match-card';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRight,
  Phone,
  Gauge,
  Flame,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  PauseCircle,
  Archive,
  Trash2,
  PlayCircle,
  Building2,
  Loader2,
  Sparkles,
  ShoppingBag,
  Send,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

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
    dimensions: Record<
      string,
      {
        baseWeight: number;
        normalizedWeight: number;
        earnedPoints: number;
        provenance: string;
        hasValue: boolean;
      }
    >;
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
  matchGroup?: LeadMatchGroup;
  matches?: MatchRecord[];
}

export default function LeadMatchProfilePage() {
  const params = useParams();
  const router = useRouter();
  const leadId = params?.id as string;

  const [data, setData] = useState<LeadDetailsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Estados operacionais do Workspace Comercial
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmBatchOpen, setConfirmBatchOpen] = useState(false);
  const [batchSending, setBatchSending] = useState(false);
  const [isAllModalOpen, setIsAllModalOpen] = useState(false);
  const [selectedMatchForSend, setSelectedMatchForSend] = useState<MatchCardItem | null>(null);
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);

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
    fetchLeadDetails();
  }, [fetchLeadDetails]);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deletingLead, setDeletingLead] = useState(false);

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
    } catch (err) {
      toast.error((err as Error).message || 'Erro ao atualizar');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteLead() {
    if (!leadId) return;
    setDeletingLead(true);
    try {
      const res = await fetch(`/api/match/lead/${leadId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || 'Falha ao excluir lead');
      }
      toast.success('Lead excluído com sucesso!');
      setConfirmDeleteOpen(false);
      router.push('/match');
    } catch (err) {
      console.error(err);
      toast.error((err as Error).message || 'Erro ao excluir lead');
    } finally {
      setDeletingLead(false);
    }
  }

  // Normalização dos matches em formato MatchCardItem
  const rawMatches = useMemo<MatchCardItem[]>(() => {
    return ((data?.matchGroup?.matches || []) as unknown) as MatchCardItem[];
  }, [data?.matchGroup?.matches]);

  // Melhores 5 ou 6 imóveis para a lista compacta de ação imediata
  const visibleMatches: MatchCardItem[] = rawMatches.slice(0, 6);
  const visibleIds: string[] = visibleMatches.map((m: MatchCardItem) => m.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id: string) => selectedIds.includes(id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleBatchSendClick = () => {
    if (selectedIds.length === 0) return;

    if (selectedIds.length === 1) {
      const match = rawMatches.find((m: MatchCardItem) => m.id === selectedIds[0]);
      if (match) {
        setSelectedMatchForSend(match);
      }
      return;
    }

    if (selectedIds.length >= 4) {
      setConfirmBatchOpen(true);
    } else {
      executeBatchSend();
    }
  };

  const executeBatchSend = async () => {
    if (!data?.matchGroup) return;
    setConfirmBatchOpen(false);
    setBatchSending(true);

    try {
      const selectedMatches = rawMatches.filter((m: MatchCardItem) => selectedIds.includes(m.id));
      const shareResults = [];

      for (const m of selectedMatches) {
        const res = await fetch('/api/match/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lead_id: m.lead_id,
            property_id: m.property_id,
            match_id: m.id,
            message_text: `Imóvel selecionado: ${m.property?.title}`,
          }),
        });

        if (res.ok) {
          const json = await res.json();
          if (json.ok) {
            shareResults.push({
              match: m,
              publicUrl: json.publicUrl,
              share: json.share,
            });
          }
        }
      }

      if (shareResults.length === 0) {
        throw new Error('Não foi possível gerar os links de compartilhamento');
      }

      const phone = data.lead.phone.replace(/\D/g, '');
      const firstName = (data.lead.name || 'Cliente').split(' ')[0];

      let msg = `Olá ${firstName}! Selecionei ${shareResults.length} opções especiais para você no nosso catálogo:\n\n`;

      shareResults.forEach((item, idx) => {
        const p = item.match.property;
        const price = p?.priceMin
          ? new Intl.NumberFormat('pt-BR', {
              style: 'currency',
              currency: 'BRL',
              maximumFractionDigits: 0,
            }).format(p.priceMin)
          : null;

        msg += `${idx + 1}. *${p?.title || 'Imóvel'}*\n`;
        if (p?.neighborhood) msg += `📍 ${p.neighborhood}\n`;
        if (price) msg += `💰 ${price}\n`;
        msg += `🔗 Acesse os detalhes e fotos: ${item.publicUrl}\n\n`;
      });

      msg += 'Qual dessas opções chamou mais a sua atenção?';

      const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
      window.open(waUrl, '_blank', 'noopener,noreferrer');

      toast.success(
        `${shareResults.length} ${
          shareResults.length === 1 ? 'imóvel compartilhado' : 'imóveis compartilhados'
        } com sucesso!`
      );

      setSelectedIds([]);
      await fetchLeadDetails();
    } catch (err) {
      console.error(err);
      toast.error((err as Error).message || 'Erro ao processar envio em lote');
    } finally {
      setBatchSending(false);
    }
  };

  const getScoreBadgeClass = (score: number) => {
    if (score >= 85) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    if (score >= 70) return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  };

  const initials = (data?.lead.name || 'Lead')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const totalSent = data?.sentProperties.length || 0;
  void totalSent;

  const qualifiedDimensionsCount = Object.values(data?.maturity.dimensions || {}).filter(
    (d) => d.hasValue
  ).length;

  // Métricas do Card KPI Oportunidades
  const totalOpportunities = data?.matchGroup?.totalMatches ?? rawMatches.length;
  const bestMatchScore = useMemo(() => {
    if (!rawMatches || rawMatches.length === 0) return 0;
    return Math.max(...rawMatches.map((m: MatchCardItem) => Math.round(m.match_score || 0)));
  }, [rawMatches]);

  const countStrong = useMemo(
    () => rawMatches.filter((m: MatchCardItem) => Math.round(m.match_score) >= 85).length,
    [rawMatches]
  );
  const countGood = useMemo(
    () =>
      rawMatches.filter(
        (m: MatchCardItem) => Math.round(m.match_score) >= 70 && Math.round(m.match_score) < 85
      ).length,
    [rawMatches]
  );
  const countPossible = useMemo(
    () =>
      rawMatches.filter(
        (m: MatchCardItem) => Math.round(m.match_score) >= 50 && Math.round(m.match_score) < 70
      ).length,
    [rawMatches]
  );
  const countManual = useMemo(
    () => rawMatches.filter((m: MatchCardItem) => Math.round(m.match_score) < 50).length,
    [rawMatches]
  );

  const distributionText = useMemo(() => {
    if (totalOpportunities === 0) return '';
    const parts = [
      `${countStrong} ${countStrong === 1 ? 'forte' : 'fortes'}`,
      `${countGood} ${countGood === 1 ? 'bom' : 'bons'}`,
      `${countPossible} ${countPossible === 1 ? 'possível' : 'possíveis'}`,
    ];
    if (countManual > 0) {
      parts.push(`${countManual} ${countManual === 1 ? 'consulta manual' : 'consultas manuais'}`);
    }
    return parts.join(' · ');
  }, [totalOpportunities, countStrong, countGood, countPossible, countManual]);

  const getBestMatchBarColor = (score: number) => {
    if (score >= 85) return 'bg-emerald-500';
    if (score >= 70) return 'bg-blue-500';
    if (score >= 50) return 'bg-amber-500';
    return 'bg-muted-foreground/40';
  };

  return (
    <div className="-m-4 sm:-m-6 flex flex-col min-h-[calc(100%+2rem)] sm:min-h-[calc(100%+3rem)] bg-background text-foreground">
      {/* 1. Page Header Integrado ao Topo (PRESERVADO) */}
      <div className="border-b border-border bg-card/50 backdrop-blur-md px-6 sm:px-8 py-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
          <Link href="/match" className="hover:text-primary transition-colors flex items-center gap-1 font-medium">
            <ArrowLeft className="size-3" />
            <span>Central Match</span>
          </Link>
          <ChevronRight className="size-3 text-muted-foreground/60" />
          <span className="text-foreground font-semibold truncate max-w-[240px]">
            {data?.lead.name || 'Carregando lead...'}
          </span>
        </div>

        {/* Lead Profile Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="size-12 rounded-full bg-primary/10 border border-primary/25 text-primary font-bold text-sm flex items-center justify-center shrink-0">
              {initials}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold tracking-tight text-foreground">
                  {data?.lead.name || (loading ? 'Carregando perfil...' : 'Lead')}
                </h1>
                {data?.lead.isPaused && (
                  <span className="rounded-full bg-amber-500/10 border border-amber-500/25 px-2.5 py-0.5 text-xs font-semibold text-amber-400">
                    Pausado
                  </span>
                )}
                {data?.lead.isArchived && (
                  <span className="rounded-full bg-muted border border-border px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                    Arquivado
                  </span>
                )}
                {data?.lead.hasPurchased && (
                  <span className="rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                    Já comprou
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground font-mono flex items-center gap-1.5 mt-0.5">
                <Phone className="size-3 text-muted-foreground/80" />
                {data?.lead.phone || '—'}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {data?.lead.isPaused ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleCycleAction('resume')}
                disabled={actionLoading}
                className="gap-1.5 text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
              >
                <PlayCircle className="size-3.5" />
                Reativar Lead
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleCycleAction('pause')}
                disabled={actionLoading}
                className="gap-1.5 text-xs text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
              >
                <PauseCircle className="size-3.5" />
                Pausar Matches
              </Button>
            )}

            {data?.lead.isArchived ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleCycleAction('unarchive')}
                disabled={actionLoading || deletingLead}
                className="gap-1.5 text-xs"
              >
                Desarquivar
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleCycleAction('archive')}
                disabled={actionLoading || deletingLead}
                className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <Archive className="size-3.5" />
                Arquivar
              </Button>
            )}

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={actionLoading || deletingLead}
              className="gap-1.5 text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-500/10"
            >
              <Trash2 className="size-3.5" />
              Excluir
            </Button>

            {data?.lead.id && (
              <MetaCapiQualifyButton contactId={data.lead.id} />
            )}

            <Button
              size="sm"
              variant="outline"
              onClick={() => router.push('/match')}
              className="gap-1.5 text-xs"
            >
              <ArrowLeft className="size-3.5" />
              Voltar
            </Button>
          </div>
        </div>
      </div>

      {/* 2. Conteúdo Principal da Página */}
      <div className="flex-1 p-6 sm:p-8 space-y-6 w-full">
        {loading ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">Carregando workspace comercial do lead...</p>
          </div>
        ) : !data ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
            <AlertCircle className="size-8 text-muted-foreground/60 mb-2" />
            <h3 className="text-sm font-semibold text-foreground">Perfil não encontrado</h3>
            <p className="text-xs text-muted-foreground max-w-sm mt-1">
              Não foi possível localizar os dados comerciais deste lead.
            </p>
          </div>
        ) : (
          <div className="space-y-6 w-full">
            {/* Notificação Especial: Lead que já comprou */}
            {data.lead.hasPurchased && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-xs">
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <ShoppingBag className="size-4 text-primary" />
                  Cliente já comprou com você anteriormente!
                </div>
                <p className="mt-1 text-muted-foreground">
                  O ciclo de recomendações pode ser encerrado ou mantido para futuras oportunidades de investimento.
                </p>
              </div>
            )}

            {/* SEÇÃO 1: LINHA DE 3 CARDS SUPERIORES BALANCEADOS (PRESERVADA) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 w-full">
              {/* Card 1: Temperatura Comercial */}
              <Card className="p-4 bg-card/80 border-border/80 rounded-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-semibold text-foreground">
                      <Flame className="size-4 text-amber-500" />
                      Temperatura Comercial
                    </span>
                    <span className="font-bold text-foreground">{data.lead.aiScore} / 10</span>
                  </div>
                  <div className="mt-2.5 h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 to-rose-500 rounded-full transition-all"
                      style={{ width: `${(data.lead.aiScore / 10) * 100}%` }}
                    />
                  </div>
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Engajamento e momento de compra apurado pelas conversas no WhatsApp.
                </p>
              </Card>

              {/* Card 2: Maturidade do Perfil */}
              <Card className="p-4 bg-card/80 border-border/80 rounded-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-semibold text-foreground">
                      <Gauge className="size-4 text-blue-500" />
                      Maturidade do Perfil
                    </span>
                    <span className="font-bold text-foreground">{data.maturity.maturity}%</span>
                  </div>
                  <div className="mt-2.5 h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        data.maturity.meetsThreshold ? 'bg-emerald-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${data.maturity.maturity}%` }}
                    />
                  </div>
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  {data.maturity.meetsThreshold
                    ? '🎯 Apto para recomendações automáticas (≥ 70%)'
                    : '⏳ Em qualificação comercial (< 70%)'}
                </p>
              </Card>

              {/* Card 3: Oportunidades (KPI Superior) */}
              <Card className="p-4 bg-card/80 border-border/80 rounded-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-semibold text-foreground">
                      <Sparkles className="size-4 text-emerald-500" />
                      Oportunidades
                    </span>
                    <span className="font-bold text-foreground">
                      {totalOpportunities} {totalOpportunities === 1 ? 'imóvel' : 'imóveis'}
                    </span>
                  </div>
                  <div className="mt-2.5 h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${getBestMatchBarColor(bestMatchScore)}`}
                      style={{ width: `${totalOpportunities > 0 ? bestMatchScore : 0}%` }}
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-0.5 text-[11px]">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-foreground">
                      {totalOpportunities > 0 ? `Melhor Match: ${bestMatchScore}%` : 'Sem compatibilidade'}
                    </span>
                  </div>
                  <p className="text-muted-foreground truncate" title={distributionText}>
                    {distributionText}
                  </p>
                </div>
              </Card>
            </div>

            {/* SEÇÃO 2: ÁREA OPERACIONAL PRINCIPAL (WORKSPACE COMERCIAL)
                Desktop: ~65% Esquerda (Imóveis Compatíveis) / ~35% Direita (Imóveis Enviados)
                Mobile/PWA: 1 Coluna Sequencial */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full items-start">
              {/* COLUNA ESQUERDA: IMÓVEIS COMPATÍVEIS (AÇÃO IMEDIATA) */}
              <div className="lg:col-span-8">
                <Card className="p-5 bg-card/80 border-border/80 rounded-xl space-y-4">
                  {/* Cabeçalho da Lista Operacional */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                        <Sparkles className="size-4 text-primary" />
                        <span>Imóveis Compatíveis</span>
                        <span className="rounded-full bg-primary/10 border border-primary/25 px-2 py-0.5 text-xs font-semibold text-primary">
                          {data.matchGroup?.totalMatches || 0}
                        </span>
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Melhores opções ordenadas por compatibilidade determinística e prioridade comercial.
                      </p>
                    </div>

                    {/* Toolbar de Multi-Seleção */}
                    {visibleMatches.length > 0 && (
                      <div className="flex items-center gap-3 shrink-0 text-xs">
                        <label className="flex items-center gap-1.5 cursor-pointer select-none text-muted-foreground hover:text-foreground">
                          <Checkbox
                            checked={allVisibleSelected}
                            onCheckedChange={toggleSelectAll}
                          />
                          <span>Todos</span>
                        </label>

                        {selectedIds.length > 0 && (
                          <Button
                            size="sm"
                            onClick={handleBatchSendClick}
                            disabled={batchSending}
                            className="h-7 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                          >
                            {batchSending ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Send className="size-3" />
                            )}
                            <span>Enviar selecionados ({selectedIds.length})</span>
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Lista Compacta dos Melhores Imóveis Compatíveis (5 a 6 opções) */}
                  {visibleMatches.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/70 p-8 text-center text-xs text-muted-foreground">
                      <Sparkles className="size-8 text-muted-foreground/40 mx-auto mb-2" />
                      <p className="font-semibold text-foreground">Nenhum imóvel compatível no momento</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Assim que novos imóveis forem sincronizados ou o perfil do lead amadurecer, os matches aparecerão aqui.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {visibleMatches.map((m: MatchCardItem) => {
                        const p = m.property;
                        const formattedPrice = p?.priceMin
                          ? new Intl.NumberFormat('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                              maximumFractionDigits: 0,
                            }).format(p.priceMin)
                          : 'Sob Consulta';

                        const specs = [
                          p?.bedroomsMin ? `${p.bedroomsMin} quarto(s)` : null,
                          p?.areaMin ? `${p.areaMin} m²` : null,
                          p?.deliveryStatus === 'pronto'
                            ? 'Pronto'
                            : p?.deliveryStatus === 'planta'
                            ? 'Na Planta'
                            : p?.deliveryStatus === 'em_construcao'
                            ? 'Em Construção'
                            : null,
                        ].filter(Boolean);

                        return (
                          <div
                            key={m.id}
                            className="rounded-lg border border-border/70 bg-muted/20 hover:bg-muted/40 transition-colors p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <Checkbox
                                checked={selectedIds.includes(m.id)}
                                onCheckedChange={() => toggleSelectOne(m.id)}
                                aria-label={`Selecionar ${p?.title}`}
                              />

                              <div className="size-14 rounded-md overflow-hidden bg-muted border border-border/60 shrink-0 relative">
                                {p?.coverUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={p.coverUrl}
                                    alt={p?.title || 'Imóvel'}
                                    loading="lazy"
                                    className="size-full object-cover"
                                  />
                                ) : (
                                  <div className="size-full flex items-center justify-center text-muted-foreground">
                                    <Building2 className="size-6 text-muted-foreground/50" />
                                  </div>
                                )}
                              </div>

                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span
                                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-bold font-mono text-[10px] border ${getScoreBadgeClass(
                                      m.match_score
                                    )}`}
                                  >
                                    {m.match_score}% Match
                                  </span>
                                  <span className="text-[11px] font-medium text-muted-foreground">
                                    {m.match_score >= 85
                                      ? 'Match Forte'
                                      : m.match_score >= 70
                                      ? 'Bom Match'
                                      : 'Compatível'}
                                  </span>
                                  <h4 className="font-semibold text-foreground truncate" title={p?.title}>
                                    {p?.title}
                                  </h4>
                                </div>

                                <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5 truncate">
                                  <span>{p?.neighborhood || 'João Pessoa'}</span>
                                  {specs.length > 0 && (
                                    <>
                                      <span>•</span>
                                      <span>{specs.join(' · ')}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border/40">
                              <span className="font-bold text-foreground font-mono text-sm whitespace-nowrap">
                                {formattedPrice}
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedMatchForSend(m)}
                                className="h-7 px-2.5 text-xs gap-1.5 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                              >
                                <Send className="size-3" />
                                <span>Enviar</span>
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Ação: Ver todos os imóveis compatíveis no modal central */}
                  {(data.matchGroup?.totalMatches || 0) > 0 && (
                    <div className="pt-2 border-t border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        Exibindo os {visibleMatches.length} melhores de {data.matchGroup?.totalMatches} disponíveis
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsAllModalOpen(true)}
                        className="text-xs font-semibold text-primary hover:text-primary/80 gap-1.5 p-0 h-auto self-start sm:self-auto"
                      >
                        <span>Ver todos os {data.matchGroup?.totalMatches} imóveis compatíveis</span>
                        <ArrowRight className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </Card>
              </div>

              {/* COLUNA DIREITA: IMÓVEIS ENVIADOS (HISTÓRICO OPERACIONAL) */}
              <div className="lg:col-span-4">
                <Card className="p-5 bg-card/80 border-border/80 rounded-xl space-y-4">
                  <div className="border-b border-border/60 pb-3">
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                      <Send className="size-4 text-emerald-500" />
                      <span>Imóveis Enviados</span>
                      <span className="rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                        {totalSent}
                      </span>
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Histórico e reação do cliente aos links compartilhados.
                    </p>
                  </div>

                  {data.sentProperties.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
                      <Building2 className="size-7 text-muted-foreground/40 mx-auto mb-2" />
                      <p className="font-semibold text-foreground text-xs">Nenhum imóvel enviado ainda</p>
                      <p className="text-[11px] text-muted-foreground mt-1 max-w-[220px] mx-auto">
                        Os imóveis enviados para este lead aparecerão aqui com abertura e interesse.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-1">
                      {data.sentProperties.map((sp) => (
                        <div
                          key={sp.id}
                          className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-2 text-xs"
                        >
                          <div className="flex items-start justify-between gap-2.5">
                            <div className="flex gap-2.5 min-w-0">
                              <div className="size-10 rounded-md overflow-hidden bg-muted border border-border/60 shrink-0 relative">
                                {sp.propertyCoverUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={sp.propertyCoverUrl}
                                    alt={sp.propertyTitle}
                                    className="size-full object-cover"
                                  />
                                ) : (
                                  <div className="size-full flex items-center justify-center text-muted-foreground">
                                    <Building2 className="size-4" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <h5 className="font-semibold text-foreground truncate text-xs" title={sp.propertyTitle}>
                                  {sp.propertyTitle}
                                </h5>
                                <p className="text-[11px] text-muted-foreground truncate">
                                  {sp.propertyNeighborhood}
                                </p>
                                <p className="text-[10px] text-muted-foreground mt-0.5">
                                  Enviado em {format(new Date(sp.sentAt), "dd/MM 'às' HH:mm", { locale: ptBR })}
                                </p>
                              </div>
                            </div>

                            {sp.isInterested && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-400 shrink-0">
                                🔥 Interesse
                              </span>
                            )}
                          </div>

                          {/* Métricas de Abertura / Tracking */}
                          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/60 text-[11px]">
                            <div>
                              <span className="text-muted-foreground">Abriu: </span>
                              <span className="font-medium text-foreground">
                                {sp.openCount > 0 ? `Sim (${sp.openCount}x)` : 'Ainda não'}
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Última: </span>
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
                </Card>
              </div>
            </div>

            {/* SEÇÃO 3: PERFIL E PREFERÊNCIAS (SEGUNDO PLANO ANALÍTICO) */}
            <Card className="p-5 bg-card/80 border-border/80 rounded-xl space-y-4">
              <h3 className="text-sm font-semibold text-foreground">
                Requisitos Eliminatórios vs Preferências Informadas
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                {/* Requisitos Obrigatórios */}
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3.5 space-y-2.5">
                  <div className="flex items-center gap-1.5 font-semibold text-rose-400 text-xs">
                    <AlertCircle className="size-3.5" />
                    Requisitos Eliminatórios
                  </div>
                  <ul className="space-y-1.5 text-[11px] text-foreground">
                    <li>
                      • Operação: <strong>{data.searchProfile.operation === 'venda' ? 'Compra' : 'Locação'}</strong>
                    </li>
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

                {/* Preferências Informadas */}
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3.5 space-y-2.5">
                  <div className="flex items-center gap-1.5 font-semibold text-emerald-400 text-xs">
                    <CheckCircle2 className="size-3.5" />
                    Preferências Informadas
                  </div>
                  <ul className="space-y-1.5 text-[11px] text-foreground">
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
            </Card>

            {/* SEÇÃO 4: DIAGNÓSTICO DA QUALIFICAÇÃO (RECOLHÍVEL / ACCORDION) */}
            <Card className="bg-card/80 border-border/80 rounded-xl overflow-hidden transition-all">
              <button
                type="button"
                onClick={() => setDiagnosticsExpanded((prev) => !prev)}
                className="w-full p-4 sm:p-5 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="size-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                    <Sparkles className="size-4 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      Diagnóstico da Qualificação
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Maturidade: <strong>{data.maturity.maturity}%</strong> • {qualifiedDimensionsCount}/8 dimensões qualificadas
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
                  <span>{diagnosticsExpanded ? 'Recolher' : 'Expandir detalhes'}</span>
                  {diagnosticsExpanded ? (
                    <ChevronUp className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  )}
                </div>
              </button>

              {diagnosticsExpanded && (
                <div className="p-4 sm:p-5 pt-0 border-t border-border/50 animate-in fade-in-0 duration-200">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs w-full pt-4">
                    {Object.entries(data.maturity.dimensions || {}).map(([key, dim]) => {
                      const labelMap: Record<string, string> = {
                        operation: 'Operação (Compra/Aluguel)',
                        purpose: 'Finalidade (Moradia/Invest.)',
                        propertyTypes: 'Tipologias Desejadas',
                        locations: 'Localização / Bairros',
                        price: 'Faixa de Preço / Teto',
                        bedrooms: 'Quantidade de Quartos',
                        delivery: 'Fase de Entrega',
                        features: 'Comodidades / Diferenciais',
                      };

                      return (
                        <div
                          key={key}
                          className={`flex flex-col justify-between p-3 rounded-lg border text-xs gap-2 ${
                            dim.hasValue
                              ? 'bg-emerald-500/5 border-emerald-500/25 text-foreground'
                              : 'bg-muted/20 border-border/50 text-muted-foreground'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {dim.hasValue ? (
                              <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                            ) : (
                              <div className="size-4 rounded-full border border-border shrink-0" />
                            )}
                            <span className="truncate text-xs font-semibold">
                              {labelMap[key] || key}
                            </span>
                          </div>

                          <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[11px]">
                            <span className="font-mono font-semibold">
                              {dim.earnedPoints} / {dim.normalizedWeight} pts
                            </span>
                            {dim.provenance && (
                              <span
                                className={`rounded px-1.5 py-0.2 font-mono text-[10px] ${
                                  dim.provenance === 'ctwa'
                                    ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                    : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                }`}
                              >
                                {dim.provenance}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>

            {/* SEÇÃO 5: TAGS DO PERFIL DE BUSCA E PROVENIÊNCIA */}
            <Card className="p-5 bg-card/80 border-border/80 rounded-xl space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold text-foreground">
                <span>Tags do Perfil de Busca</span>
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="inline-flex items-center gap-1 text-blue-400">
                    <span className="size-1.5 rounded-full bg-blue-400" />
                    Anúncio (CTWA)
                  </span>
                  <span className="inline-flex items-center gap-1 text-emerald-400">
                    <span className="size-1.5 rounded-full bg-emerald-400" />
                    Conversa
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 pt-1">
                {data.tags.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Nenhuma tag cadastrada.</p>
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
            </Card>
          </div>
        )}
      </div>

      {/* MODAL CENTRAL DE COMPATIBILIDADES (Reutilizado exatamente da Central Match) */}
      <LeadMatchesModal
        open={isAllModalOpen}
        onOpenChange={setIsAllModalOpen}
        group={data?.matchGroup || null}
        onOpenSendModal={(match) => setSelectedMatchForSend(match)}
        onMatchUpdated={fetchLeadDetails}
      />

      {/* MODAL DE ENVIO VIA WHATSAPP INDIVIDUAL */}
      {selectedMatchForSend && (
        <SendWhatsAppModal
          open={!!selectedMatchForSend}
          onOpenChange={(open) => !open && setSelectedMatchForSend(null)}
          matchId={selectedMatchForSend.id}
          leadId={selectedMatchForSend.lead_id || data?.lead.id || ''}
          leadName={data?.lead.name || 'Cliente'}
          leadPhone={data?.lead.phone || ''}
          propertyId={selectedMatchForSend.property_id}
          propertyTitle={selectedMatchForSend.property?.title || 'Imóvel'}
          propertyNeighborhood={selectedMatchForSend.property?.neighborhood || ''}
          propertyPriceMin={selectedMatchForSend.property?.priceMin}
          propertyCoverUrl={selectedMatchForSend.property?.coverUrl}
          matchScore={selectedMatchForSend.match_score || 0}
          onSent={() => {
            fetchLeadDetails();
            setSelectedMatchForSend(null);
          }}
        />
      )}

      {/* DIÁLOGO DE CONFIRMAÇÃO PARA ENVIO MÚLTIPLO (>= 4 Imóveis) */}
      <Dialog open={confirmBatchOpen} onOpenChange={setConfirmBatchOpen}>
        <DialogContent className="sm:max-w-md bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="size-5 text-amber-500" />
              Confirmar Envio Múltiplo
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground pt-2">
              Você selecionou <strong>{selectedIds.length} imóveis</strong> para {data?.lead.name || 'este cliente'}.
              Recomendamos enviar no máximo <strong>3 imóveis por vez</strong> para não sobrecarregar o cliente e garantir maior taxa de resposta.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmBatchOpen(false)}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={executeBatchSend}
              className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
            >
              Continuar com {selectedIds.length} imóveis
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIÁLOGO DE CONFIRMAÇÃO DE EXCLUSÃO DO LEAD */}
      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent className="sm:max-w-md bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-rose-500">
              <Trash2 className="size-5 text-rose-500" />
              Excluir Lead
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground pt-2">
              Tem certeza que deseja excluir o lead{' '}
              <strong className="text-foreground">{data?.lead.name || 'este lead'}</strong>? Esta ação é definitiva e removerá permanentemente o contato e todas as suas recomendações de match.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDeleteOpen(false)}
              disabled={deletingLead}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleDeleteLead}
              disabled={deletingLead}
              className="text-xs bg-rose-600 hover:bg-rose-700 text-white font-medium gap-1.5"
            >
              {deletingLead ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Excluindo...</span>
                </>
              ) : (
                <>
                  <Trash2 className="size-3.5" />
                  <span>Excluir Definitivamente</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
