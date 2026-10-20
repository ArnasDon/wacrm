'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Sparkles,
  Flame,
  Gauge,
  Building2,
  ChevronRight,
  ExternalLink,
  Phone,
} from 'lucide-react';
import type { LeadMatchGroup } from '@/lib/match/types';
import type { MatchCardItem } from '@/components/match/match-card';

interface LeadMatchCardProps {
  group: LeadMatchGroup;
  onOpenModal: (group: LeadMatchGroup) => void;
}

export function LeadMatchCard({ group, onOpenModal }: LeadMatchCardProps) {
  const leadName = group.lead.name || 'Lead sem nome';
  const initials = leadName
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'L';

  const bestMatch = group.bestMatch as unknown as MatchCardItem;
  const bestScore = Math.round(bestMatch?.match_score ?? 0);
  const bestProp = bestMatch?.property;

  const formattedPrice = bestProp?.priceMin
    ? new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        maximumFractionDigits: 0,
      }).format(bestProp.priceMin)
    : 'Sob consulta';

  // Badge de Score do Melhor Match
  const getScoreBadgeClass = (score: number) => {
    if (score >= 85) {
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    }
    if (score >= 70) {
      return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    }
    return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  };

  const totalMatchesCount = group.totalMatches || group.matches.length || 0;

  return (
    <Card className="flex flex-col justify-between border-border/70 bg-card/70 hover:border-primary/40 transition-all duration-200 rounded-xl p-4 gap-3 shadow-xs hover:shadow-md">
      {/* 1. Header do Lead */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="size-8 rounded-full bg-primary/10 border border-primary/20 text-primary font-bold text-xs flex items-center justify-center shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate" title={leadName}>
              {leadName}
            </h3>
            <p className="text-[11px] text-muted-foreground font-mono flex items-center gap-1">
              <Phone className="size-2.5 text-muted-foreground/70" />
              {group.lead.phone}
            </p>
          </div>
        </div>

        {/* Badges de Qualificação */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Maturidade */}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
              group.profileMaturity >= 70
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/25'
            }`}
            title={`Maturidade do perfil: ${group.profileMaturity}%`}
          >
            <Gauge className="size-2.5" />
            {group.profileMaturity}%
          </span>

          {/* Temperatura IA */}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
              group.aiScore >= 7
                ? 'bg-rose-500/10 text-rose-400 border-rose-500/25'
                : group.aiScore >= 4
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                : 'bg-muted text-muted-foreground border-border/50'
            }`}
            title={`Temperatura IA: ${group.aiScore}/10`}
          >
            <Flame className="size-2.5" />
            {group.aiScore}/10
          </span>
        </div>
      </div>

      {/* 2. Seção Central: MELHOR MATCH */}
      <div className="rounded-lg bg-muted/40 border border-border/50 p-2.5">
        <div className="flex items-center justify-between gap-1 mb-1.5">
          <span className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground/80 flex items-center gap-1">
            <Sparkles className="size-2.5 text-primary" />
            Melhor Match
          </span>
          {bestMatch && (
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold border ${getScoreBadgeClass(
                bestScore
              )}`}
            >
              {bestScore}% match
            </span>
          )}
        </div>

        {bestProp ? (
          <div className="flex items-center gap-2.5">
            {/* Foto de Capa / Fallback */}
            <div className="size-11 rounded-md overflow-hidden bg-muted border border-border/60 shrink-0 relative">
              {bestProp.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={bestProp.coverUrl}
                  alt={bestProp.title}
                  className="size-full object-cover"
                />
              ) : (
                <div className="size-full flex items-center justify-center text-muted-foreground">
                  <Building2 className="size-4" />
                </div>
              )}
            </div>

            {/* Informações Resumidas do Imóvel */}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground truncate" title={bestProp.title}>
                {bestProp.title}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {bestProp.neighborhood ? `${bestProp.neighborhood}, ${bestProp.city}` : bestProp.city}
              </p>
              <p className="text-xs font-semibold text-foreground/90 mt-0.5">
                {formattedPrice}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">Nenhum match calculado</p>
        )}
      </div>

      {/* 3. Rodapé de Ações: Contador Clicável e Ver Perfil */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpenModal(group)}
          className="h-7 text-xs font-medium bg-primary/10 hover:bg-primary/20 text-primary border-primary/25 hover:border-primary/40 px-2.5 gap-1 transition-colors"
        >
          <span>{totalMatchesCount} {totalMatchesCount === 1 ? 'imóvel compatível' : 'imóveis compatíveis'}</span>
          <ChevronRight className="size-3" />
        </Button>

        <Link
          href={`/match/lead/${group.leadId}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/70 border border-border/60 rounded-md px-2.5 py-1 h-7 transition-colors"
        >
          <span>Ver Perfil</span>
          <ExternalLink className="size-3 text-muted-foreground/80" />
        </Link>
      </div>
    </Card>
  );
}
