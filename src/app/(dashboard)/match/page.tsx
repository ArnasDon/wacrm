'use client';

import { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LeadMatchCard } from '@/components/match/lead-match-card';
import { LeadMatchesModal } from '@/components/match/lead-matches-modal';
import { SendWhatsAppModal } from '@/components/match/send-whatsapp-modal';
import type { MatchCardItem } from '@/components/match/match-card';
import { toast } from 'sonner';
import { Sparkles, Search, RefreshCw, Loader2, Building2 } from 'lucide-react';
import type { MatchStatus, LeadMatchGroup } from '@/lib/match/types';
import { createClient } from '@/lib/supabase/client';
import { PULL_TO_REFRESH_EVENT } from '@/hooks/use-pull-to-refresh';

const SCORE_FILTER_LABELS: Record<string, string> = {
  all: 'Todas as faixas',
  strong: '85%+ (Match Forte)',
  good: '70%–84% (Bom Match)',
  possible: '50%–69% (Compatibilidade Possível)',
  manual: '0%–49% (Consulta Manual)',
};

const MATURITY_FILTER_LABELS: Record<string, string> = {
  all: 'Maturidade: Todas',
  ready: '≥ 70% (Pronto para Match)',
  growing: '< 70% (Em Amadurecimento)',
};

const AI_SCORE_FILTER_LABELS: Record<string, string> = {
  '0': 'Score: Qualquer',
  '5': 'Score ≥ 5 (Morno/Quente)',
  '7': 'Score ≥ 7 (Qualificado)',
  '9': 'Score ≥ 9 (Altíssimo calor)',
};

export default function MatchPage() {
  const [activeTab, setActiveTab] = useState<MatchStatus>('novo');
  const [groups, setGroups] = useState<LeadMatchGroup[]>([]);
  const [counts, setCounts] = useState({ novos: 0, enviados: 0, pausados: 0, arquivados: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filtros
  const [leadSearch, setLeadSearch] = useState('');
  const [propertySearch, setPropertySearch] = useState('');
  const [scoreFilter, setScoreFilter] = useState<'all' | 'strong' | 'good' | 'possible' | 'manual'>('all');
  const [maturityFilter, setMaturityFilter] = useState<'all' | 'ready' | 'growing'>('all');
  const [minAiScore, setMinAiScore] = useState<string>('0');

  // Modais
  const [selectedGroupForModal, setSelectedGroupForModal] = useState<LeadMatchGroup | null>(null);
  const [selectedMatchForSend, setSelectedMatchForSend] = useState<MatchCardItem | null>(null);

  const fetchMatches = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const params = new URLSearchParams();
      params.set('status', activeTab);

      if (leadSearch.trim()) params.set('lead_search', leadSearch.trim());
      if (propertySearch.trim()) params.set('property_search', propertySearch.trim());

      if (scoreFilter === 'strong') {
        params.set('min_score', '85');
      } else if (scoreFilter === 'good') {
        params.set('min_score', '70');
        params.set('max_score', '84');
      } else if (scoreFilter === 'possible') {
        params.set('min_score', '50');
        params.set('max_score', '69');
      } else if (scoreFilter === 'manual') {
        params.set('min_score', '0');
        params.set('max_score', '49');
      }

      if (maturityFilter === 'ready') {
        params.set('min_maturity', '70');
      }

      if (parseInt(minAiScore, 10) > 0) {
        params.set('min_ai_score', minAiScore);
      }

      const res = await fetch(`/api/match?${params.toString()}`);
      if (!res.ok) throw new Error('Falha ao carregar matches');
      const data = await res.json();

      const newGroups: LeadMatchGroup[] = data.groups || [];
      setGroups(newGroups);
      if (data.counts) {
        setCounts(data.counts);
      }
      // Se o modal estiver aberto, atualiza com os dados frescos
      setSelectedGroupForModal((prev) => {
        if (!prev) return null;
        return newGroups.find((g) => g.leadId === prev.leadId) || null;
      });
    } catch (err) {
      console.error(err);
      if (!silent) {
        toast.error('Erro ao carregar lista de matches');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeTab, leadSearch, propertySearch, scoreFilter, maturityFilter, minAiScore]);

  useEffect(() => {
    fetchMatches();
  }, [fetchMatches]);

  // Sincronização em tempo real via Supabase Realtime
  // Atualiza automaticamente quando imóveis ou matches forem modificados no banco
  useEffect(() => {
    const supabase = createClient();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        fetchMatches(true);
      }, 1200);
    };

    const channel = supabase
      .channel('match-page-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lead_property_matches' },
        scheduleRefresh
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'property_match_projections' },
        scheduleRefresh
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [fetchMatches]);

  // Sincronização em retomada de tela (PWA no iPhone/Windows) e Pull-to-Refresh
  useEffect(() => {
    const handleResume = () => {
      if (document.visibilityState === 'visible') {
        fetchMatches(true);
      }
    };

    const handlePull = () => {
      fetchMatches(true);
    };

    document.addEventListener('visibilitychange', handleResume);
    window.addEventListener('online', handleResume);
    window.addEventListener(PULL_TO_REFRESH_EVENT, handlePull);

    return () => {
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('online', handleResume);
      window.removeEventListener(PULL_TO_REFRESH_EVENT, handlePull);
    };
  }, [fetchMatches]);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Top Header */}
      <div className="border-b border-border bg-card/60 backdrop-blur-md px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                <Sparkles className="size-5 text-primary" />
                Match
              </h1>
              <span className="rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-xs font-semibold text-primary">
                Túnel Ativo
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Recomendações determinísticas de imóveis para leads qualificados.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRefreshing(true);
                fetchMatches();
              }}
              disabled={loading || refreshing}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
          </div>
        </div>

        {/* Tabs de Status Visíveis (FASE 11 & 12) */}
        <div className="mt-4">
          <Tabs
            value={activeTab}
            onValueChange={(val) => setActiveTab(val as MatchStatus)}
            className="w-full"
          >
            <TabsList className="bg-muted/60 p-1">
              <TabsTrigger value="novo" className="gap-2 text-xs">
                Novos
                <span className="rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] font-bold text-primary">
                  {counts.novos}
                </span>
              </TabsTrigger>
              <TabsTrigger value="enviado" className="gap-2 text-xs">
                Enviados
                <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] font-bold text-muted-foreground">
                  {counts.enviados}
                </span>
              </TabsTrigger>
              <TabsTrigger value="pausado" className="gap-2 text-xs">
                Pausados
                <span className="rounded-full bg-amber-500/10 px-1.5 py-0.2 text-[10px] font-bold text-amber-500">
                  {counts.pausados}
                </span>
              </TabsTrigger>
              <TabsTrigger value="arquivado" className="gap-2 text-xs">
                Arquivados
                <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] font-bold text-muted-foreground">
                  {counts.arquivados}
                </span>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Barra de Filtros Inteligentes */}
      <div className="border-b border-border bg-card/30 px-6 py-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
          {/* Busca por Lead */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar lead (nome/tel)..."
              value={leadSearch}
              onChange={(e) => setLeadSearch(e.target.value)}
              className="pl-8 text-xs h-8"
            />
          </div>

          {/* Busca por Imóvel */}
          <div className="relative">
            <Building2 className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar imóvel/bairro..."
              value={propertySearch}
              onChange={(e) => setPropertySearch(e.target.value)}
              className="pl-8 text-xs h-8"
            />
          </div>

          {/* Faixa de Match */}
          <Select
            value={scoreFilter}
            onValueChange={(val) => setScoreFilter((val as typeof scoreFilter) || 'all')}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Compatibilidade">
                {SCORE_FILTER_LABELS[scoreFilter] || 'Todas as faixas'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="text-xs">
              <SelectItem value="all">Todas as faixas</SelectItem>
              <SelectItem value="strong">85%+ (Match Forte)</SelectItem>
              <SelectItem value="good">70%–84% (Bom Match)</SelectItem>
              <SelectItem value="possible">50%–69% (Compatibilidade Possível)</SelectItem>
              <SelectItem value="manual">0%–49% (Consulta Manual)</SelectItem>
            </SelectContent>
          </Select>

          {/* Maturidade */}
          <Select
            value={maturityFilter}
            onValueChange={(val) => setMaturityFilter((val as typeof maturityFilter) || 'all')}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Maturidade">
                {MATURITY_FILTER_LABELS[maturityFilter] || 'Maturidade: Todas'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="text-xs">
              <SelectItem value="all">Maturidade: Todas</SelectItem>
              <SelectItem value="ready">≥ 70% (Pronto para Match)</SelectItem>
              <SelectItem value="growing">&lt; 70% (Em Amadurecimento)</SelectItem>
            </SelectContent>
          </Select>

          {/* Temperatura / Score IA */}
          <Select value={minAiScore} onValueChange={(val) => setMinAiScore(val || '0')}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Temperatura">
                {AI_SCORE_FILTER_LABELS[minAiScore] || 'Score: Qualquer'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="text-xs">
              <SelectItem value="0">Score: Qualquer</SelectItem>
              <SelectItem value="5">Score ≥ 5 (Morno/Quente)</SelectItem>
              <SelectItem value="7">Score ≥ 7 (Qualificado)</SelectItem>
              <SelectItem value="9">Score ≥ 9 (Altíssimo calor)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Conteúdo Principal: Grid de Leads (1 Card Visual = 1 Lead) */}
      <div className="flex-1 p-6">
        {loading ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">Calculando compatibilidades determinísticas...</p>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center">
            <Sparkles className="size-10 text-muted-foreground/40 mb-3" />
            <h3 className="text-sm font-semibold text-foreground">Nenhum Lead com Match nesta visualização</h3>
            <p className="text-xs text-muted-foreground max-w-sm mt-1">
              Não há recomendações correspondentes aos filtros selecionados na aba{' '}
              <strong>{activeTab.toUpperCase()}</strong>.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {groups.map((group) => (
              <LeadMatchCard
                key={group.leadId}
                group={group}
                onOpenModal={(g) => setSelectedGroupForModal(g)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal Central Grande de Imóveis Compatíveis do Lead */}
      <LeadMatchesModal
        open={!!selectedGroupForModal}
        onOpenChange={(open) => !open && setSelectedGroupForModal(null)}
        group={selectedGroupForModal}
        onOpenSendModal={(match) => setSelectedMatchForSend(match)}
        onMatchUpdated={() => fetchMatches()}
      />

      {/* Modal de Envio via WhatsApp Pessoal Individual */}
      {selectedMatchForSend && (
        <SendWhatsAppModal
          open={!!selectedMatchForSend}
          onOpenChange={(open) => !open && setSelectedMatchForSend(null)}
          matchId={selectedMatchForSend.id}
          leadId={selectedMatchForSend.lead_id}
          leadName={selectedMatchForSend.contacts.name || 'Lead'}
          leadPhone={selectedMatchForSend.contacts.phone}
          propertyId={selectedMatchForSend.property_id}
          propertyTitle={selectedMatchForSend.property.title}
          propertyNeighborhood={selectedMatchForSend.property.neighborhood}
          propertyPriceMin={selectedMatchForSend.property.priceMin}
          propertyCoverUrl={selectedMatchForSend.property.coverUrl}
          matchScore={Math.round(selectedMatchForSend.match_score)}
          onSent={() => {
            fetchMatches();
          }}
        />
      )}
    </div>
  );
}
