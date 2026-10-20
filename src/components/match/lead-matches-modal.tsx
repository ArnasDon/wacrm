'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Flame,
  Gauge,
  Building2,
  Send,
  MoreVertical,
  ExternalLink,
  PauseCircle,
  Archive,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Phone,
  Bed,
} from 'lucide-react';
import { toast } from 'sonner';
import type { LeadMatchGroup, MatchStatus } from '@/lib/match/types';
import type { MatchCardItem } from '@/components/match/match-card';

interface LeadMatchesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: LeadMatchGroup | null;
  onOpenSendModal: (match: MatchCardItem) => void;
  onMatchUpdated: () => void;
}

type SortOption = 'score_desc' | 'priority_desc' | 'price_asc' | 'price_desc';
type FilterTab = 'all' | 'strong' | 'good' | 'possible';

const SORT_LABELS: Record<SortOption, string> = {
  score_desc: 'Maior compatibilidade',
  priority_desc: 'Maior prioridade',
  price_asc: 'Menor preço',
  price_desc: 'Maior preço',
};

export function LeadMatchesModal({
  open,
  onOpenChange,
  group,
  onOpenSendModal,
  onMatchUpdated,
}: LeadMatchesModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>('score_desc');
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [confirmBatchOpen, setConfirmBatchOpen] = useState(false);
  const [batchSending, setBatchSending] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Normalização incondicional dos matches
  const rawMatches = useMemo(() => {
    return ((group?.matches || []) as unknown) as MatchCardItem[];
  }, [group?.matches]);

  // Contadores para as abas de filtro (incondicionais)
  const countStrong = useMemo(
    () => rawMatches.filter((m) => Math.round(m.match_score) >= 85).length,
    [rawMatches]
  );
  const countGood = useMemo(
    () =>
      rawMatches.filter(
        (m) => Math.round(m.match_score) >= 70 && Math.round(m.match_score) < 85
      ).length,
    [rawMatches]
  );
  const countPossible = useMemo(
    () =>
      rawMatches.filter(
        (m) => Math.round(m.match_score) >= 50 && Math.round(m.match_score) < 70
      ).length,
    [rawMatches]
  );

  // Filtragem e ordenação (incondicionais)
  const filteredMatches = useMemo(() => {
    let list = [...rawMatches];

    if (filterTab === 'strong') {
      list = list.filter((m) => Math.round(m.match_score) >= 85);
    } else if (filterTab === 'good') {
      list = list.filter(
        (m) => Math.round(m.match_score) >= 70 && Math.round(m.match_score) < 85
      );
    } else if (filterTab === 'possible') {
      list = list.filter(
        (m) => Math.round(m.match_score) >= 50 && Math.round(m.match_score) < 70
      );
    }

    list.sort((a, b) => {
      if (sortBy === 'score_desc') {
        if (b.match_score !== a.match_score) return b.match_score - a.match_score;
        return (b.commercial_priority || 0) - (a.commercial_priority || 0);
      }
      if (sortBy === 'priority_desc') {
        if ((b.commercial_priority || 0) !== (a.commercial_priority || 0)) {
          return (b.commercial_priority || 0) - (a.commercial_priority || 0);
        }
        return b.match_score - a.match_score;
      }
      if (sortBy === 'price_asc') {
        const priceA = a.property?.priceMin || 0;
        const priceB = b.property?.priceMin || 0;
        return priceA - priceB;
      }
      if (sortBy === 'price_desc') {
        const priceA = a.property?.priceMin || 0;
        const priceB = b.property?.priceMin || 0;
        return priceB - priceA;
      }
      return 0;
    });

    return list;
  }, [rawMatches, filterTab, sortBy]);

  // Limpeza de seleção ao fechar ou trocar de lead (incondicional)
  useEffect(() => {
    if (!open) {
      setSelectedIds([]);
      setFilterTab('all');
      setSortBy('score_desc');
    }
  }, [open, group?.leadId]);

  // Todos os hooks foram executados na ordem exata e invariante.
  // Agora e somente agora o return condicional é seguro.
  if (!group) return null;

  const leadName = group.lead.name || 'Lead sem nome';

  // Controle de Multi-seleção
  const allFilteredSelected =
    filteredMatches.length > 0 &&
    filteredMatches.every((m) => selectedIds.includes(m.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      // Remove os IDs visíveis
      const visibleIds = new Set(filteredMatches.map((m) => m.id));
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.has(id)));
    } else {
      // Adiciona todos os visíveis
      const visibleIds = filteredMatches.map((m) => m.id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // Botão "Enviar Selecionados"
  const handleBatchSendClick = () => {
    if (selectedIds.length === 0) return;

    if (selectedIds.length === 1) {
      const match = rawMatches.find((m) => m.id === selectedIds[0]);
      if (match) {
        onOpenSendModal(match);
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
    setConfirmBatchOpen(false);
    setBatchSending(true);

    try {
      const selectedMatches = rawMatches.filter((m) => selectedIds.includes(m.id));
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

      // Monta a mensagem combinada com os links rastreáveis
      const phone = group.lead.phone.replace(/\D/g, '');
      const firstName = leadName.split(' ')[0];

      let msg = `Olá ${firstName}! Selecionei ${shareResults.length} opções especiais para você no nosso catálogo:\n\n`;

      shareResults.forEach((item, idx) => {
        const p = item.match.property;
        const price = p?.priceMin
          ? new Intl.NumberFormat('pt-BR', {
              style: 'currency',
              currency: 'BRL',
              maximumFractionDigits: 0,
            }).format(p.priceMin)
          : '';
        msg += `${idx + 1}. *${p?.title}* (${p?.neighborhood || 'João Pessoa'})\n`;
        if (price) msg += `   Valor: ${price}\n`;
        msg += `   👉 ${item.publicUrl}\n\n`;
      });

      msg += 'Qual dessas opções chama mais a sua atenção? Fico à disposição!';

      const waLink = `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(
        msg
      )}`;

      window.open(waLink, '_blank', 'noopener,noreferrer');
      toast.success(`${shareResults.length} imóveis marcados como enviados! WhatsApp aberto.`);

      setSelectedIds([]);
      onMatchUpdated();
    } catch (err) {
      console.error(err);
      toast.error((err as Error).message || 'Erro ao processar envio em lote');
    } finally {
      setBatchSending(false);
    }
  };

  // Ações de Status do Match
  const handleStatusChange = async (matchId: string, newStatus: MatchStatus) => {
    setActionLoadingId(matchId);
    try {
      const res = await fetch(`/api/match/${matchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Falha ao atualizar status');
      toast.success('Status do match atualizado!');
      onMatchUpdated();
    } catch (err) {
      toast.error((err as Error).message || 'Erro ao alterar status');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDiscard = async (matchId: string) => {
    setActionLoadingId(matchId);
    try {
      const res = await fetch(`/api/match/${matchId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Falha ao descartar match');
      toast.success('Match descartado com sucesso.');
      onMatchUpdated();
    } catch (err) {
      toast.error((err as Error).message || 'Erro ao descartar match');
    } finally {
      setActionLoadingId(null);
    }
  };

  const getScoreBadgeClass = (score: number) => {
    if (score >= 85) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    if (score >= 70) return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-5xl w-[92vw] h-[85vh] max-h-[calc(100dvh-2rem)] flex flex-col p-0 gap-0 overflow-hidden bg-card border-border/80 text-foreground"
          overlayClassName="bg-black/75 backdrop-blur-sm"
        >
          {/* 1. Header do Modal (Fixo e Estável) */}
          <div className="border-b border-border/80 px-6 py-4 bg-muted/20 shrink-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
                    <span>{leadName}</span>
                    <span className="text-xs font-mono font-normal text-muted-foreground flex items-center gap-1">
                      <Phone className="size-3" />
                      {group.lead.phone}
                    </span>
                  </DialogTitle>

                  <span className="rounded-full bg-primary/10 border border-primary/25 px-2.5 py-0.5 text-xs font-bold text-primary">
                    {group.totalMatches} {group.totalMatches === 1 ? 'imóvel compatível' : 'imóveis compatíveis'}
                  </span>
                </div>

                <DialogDescription className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                  <span>Recomendações determinísticas calculadas com base nas preferências deste lead.</span>
                </DialogDescription>
              </div>

              {/* Badges de Qualificação + Link do Perfil */}
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                    group.profileMaturity >= 70
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                  }`}
                >
                  <Gauge className="size-3" />
                  {group.profileMaturity}% Maturidade
                </span>

                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                    group.aiScore >= 7
                      ? 'bg-rose-500/10 text-rose-400 border-rose-500/25'
                      : group.aiScore >= 4
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                      : 'bg-muted text-muted-foreground border-border/50'
                  }`}
                >
                  <Flame className="size-3" />
                  Score {group.aiScore}/10
                </span>

                <Link
                  href={`/match/lead/${group.leadId}`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/70 border border-border/60 rounded-md px-2.5 py-1 transition-colors"
                >
                  <span>Ver Perfil</span>
                  <ExternalLink className="size-3 text-muted-foreground/80" />
                </Link>
              </div>
            </div>

            {/* 2. Barra de Controles: Filtros Rápidos + Ordenação */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4 pt-3 border-t border-border/50">
              {/* Abas de Filtro Rápido */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 text-xs">
                <button
                  type="button"
                  onClick={() => setFilterTab('all')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    filterTab === 'all'
                      ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                      : 'bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  Todas ({rawMatches.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterTab('strong')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    filterTab === 'strong'
                      ? 'bg-emerald-500 text-white font-semibold shadow-xs'
                      : 'bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  Match Forte ≥85% ({countStrong})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterTab('good')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    filterTab === 'good'
                      ? 'bg-blue-500 text-white font-semibold shadow-xs'
                      : 'bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  Bom Match 70–84% ({countGood})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterTab('possible')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    filterTab === 'possible'
                      ? 'bg-amber-500 text-white font-semibold shadow-xs'
                      : 'bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  Possível 50–69% ({countPossible})
                </button>
              </div>

              {/* Ordenação */}
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground">Ordenar:</span>
                <Select value={sortBy} onValueChange={(val) => setSortBy(val as SortOption)}>
                  <SelectTrigger className="h-7 text-xs w-[180px]">
                    <SelectValue>{SORT_LABELS[sortBy] || 'Maior compatibilidade'}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="text-xs">
                    <SelectItem value="score_desc">Maior compatibilidade</SelectItem>
                    <SelectItem value="priority_desc">Maior prioridade</SelectItem>
                    <SelectItem value="price_asc">Menor preço</SelectItem>
                    <SelectItem value="price_desc">Maior preço</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 3. Barra de Multi-seleção */}
            <div className="flex items-center justify-between gap-3 mt-3 pt-2.5 border-t border-border/40 text-xs">
              <label className="flex items-center gap-2 cursor-pointer select-none text-muted-foreground hover:text-foreground">
                <Checkbox
                  checked={allFilteredSelected}
                  onCheckedChange={toggleSelectAll}
                />
                <span>Selecionar todos visíveis ({filteredMatches.length})</span>
              </label>

              <div className="flex items-center gap-2">
                {selectedIds.length > 0 && (
                  <span className="text-xs font-medium text-primary">
                    {selectedIds.length} {selectedIds.length === 1 ? 'selecionado' : 'selecionados'}
                  </span>
                )}
                <Button
                  size="sm"
                  onClick={handleBatchSendClick}
                  disabled={selectedIds.length === 0 || batchSending}
                  className="h-7 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                >
                  {batchSending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Send className="size-3" />
                  )}
                  <span>Enviar selecionados ({selectedIds.length})</span>
                </Button>
              </div>
            </div>
          </div>

          {/* 4. Lista Compacta Vertical de Imóveis (Área flex-1 rolável com altura estável) */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            <div
              key={filterTab}
              className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out divide-y divide-border/40 space-y-2"
            >
              {filteredMatches.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center text-center p-6">
                  <Building2 className="size-8 text-muted-foreground/40 mb-2" />
                  <p className="text-xs font-medium text-foreground">Nenhum imóvel nesta faixa</p>
                  <p className="text-[11px] text-muted-foreground">Tente alternar o filtro de compatibilidade.</p>
                </div>
              ) : (
                filteredMatches.map((m) => {
                const isSelected = selectedIds.includes(m.id);
                const score = Math.round(m.match_score);
                const prop = m.property;
                const formattedPrice = prop?.priceMin
                  ? new Intl.NumberFormat('pt-BR', {
                      style: 'currency',
                      currency: 'BRL',
                      maximumFractionDigits: 0,
                    }).format(prop.priceMin)
                  : 'Sob consulta';

                return (
                  <div
                    key={m.id}
                    className={`flex items-center justify-between gap-3 p-2.5 rounded-lg transition-colors border ${
                      isSelected
                        ? 'bg-primary/5 border-primary/30'
                        : 'bg-card/40 border-border/40 hover:bg-muted/30 hover:border-border/80'
                    }`}
                  >
                    {/* Checkbox + Thumbnail */}
                    <div className="flex items-center gap-3 shrink-0">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelectOne(m.id)}
                      />

                      <div className="size-13 rounded-md overflow-hidden bg-muted border border-border/60 shrink-0 relative">
                        {prop?.coverUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={prop.coverUrl}
                            alt={prop.title}
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="size-full flex items-center justify-center text-muted-foreground">
                            <Building2 className="size-5" />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Detalhes do Imóvel */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`rounded-full px-2 py-0.2 text-[10px] font-bold border ${getScoreBadgeClass(
                            score
                          )}`}
                        >
                          {score}% match
                        </span>

                        <h4 className="text-xs font-semibold text-foreground truncate max-w-[280px] sm:max-w-md" title={prop?.title}>
                          {prop?.title}
                        </h4>

                        {m.match_status !== 'novo' && (
                          <span className="rounded-full bg-muted border border-border/60 px-1.5 py-0.2 text-[10px] text-muted-foreground">
                            {m.match_status}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1 flex-wrap">
                        <span>{prop?.neighborhood ? `${prop.neighborhood}, ${prop.city}` : prop?.city}</span>

                        {prop?.bedroomsMin && (
                          <span className="flex items-center gap-1">
                            <Bed className="size-3" />
                            {prop.bedroomsMin} {prop.bedroomsMin === 1 ? 'quarto' : 'quartos'}
                          </span>
                        )}

                        <span className="capitalize">{prop?.deliveryStatus?.replace('_', ' ')}</span>
                      </div>
                    </div>

                    {/* Preço + Ações */}
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <p className="text-xs font-bold text-foreground">
                          {formattedPrice}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Prioridade: {Math.round(m.commercial_priority || 0)}
                        </p>
                      </div>

                      {/* Botão Enviar Direto */}
                      <Button
                        size="sm"
                        onClick={() => onOpenSendModal(m)}
                        className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-2.5"
                      >
                        <Send className="size-3" />
                        <span>Enviar</span>
                      </Button>

                      {/* Menu de Ações Secundárias */}
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="size-7 text-muted-foreground hover:text-foreground"
                              disabled={actionLoadingId === m.id}
                            >
                              {actionLoadingId === m.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <MoreVertical className="size-3.5" />
                              )}
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end" className="text-xs">
                          {prop?.publicUrl && (
                            <DropdownMenuItem
                              onClick={() => window.open(prop.publicUrl!, '_blank')}
                              className="gap-2 cursor-pointer"
                            >
                              <ExternalLink className="size-3.5 text-muted-foreground" />
                              Ver imóvel no catálogo
                            </DropdownMenuItem>
                          )}

                          {m.match_status !== 'pausado' ? (
                            <DropdownMenuItem
                              onClick={() => handleStatusChange(m.id, 'pausado')}
                              className="gap-2 cursor-pointer"
                            >
                              <PauseCircle className="size-3.5 text-amber-500" />
                              Pausar recomendação
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => handleStatusChange(m.id, 'novo')}
                              className="gap-2 cursor-pointer"
                            >
                              <CheckCircle2 className="size-3.5 text-emerald-500" />
                              Reativar recomendação
                            </DropdownMenuItem>
                          )}

                          {m.match_status !== 'arquivado' ? (
                            <DropdownMenuItem
                              onClick={() => handleStatusChange(m.id, 'arquivado')}
                              className="gap-2 cursor-pointer"
                            >
                              <Archive className="size-3.5 text-muted-foreground" />
                              Arquivar
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => handleStatusChange(m.id, 'novo')}
                              className="gap-2 cursor-pointer"
                            >
                              <CheckCircle2 className="size-3.5 text-emerald-500" />
                              Desarquivar
                            </DropdownMenuItem>
                          )}

                          <DropdownMenuSeparator />

                          <DropdownMenuItem
                            onClick={() => handleDiscard(m.id)}
                            className="gap-2 text-rose-500 focus:text-rose-500 cursor-pointer"
                          >
                            <Trash2 className="size-3.5" />
                            Descartar match
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })
            )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Diálogo de Confirmação para Envio >= 4 Imóveis */}
      <Dialog open={confirmBatchOpen} onOpenChange={setConfirmBatchOpen}>
        <DialogContent className="sm:max-w-md bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="size-5 text-amber-500" />
              Confirmar Envio Múltiplo
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground pt-2">
              Você selecionou <strong>{selectedIds.length} imóveis</strong> para {leadName}.
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
    </>
  );
}
