'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Building2,
  Sparkles,
  Flame,
  Gauge,
  Send,
  Trash2,
  MoreVertical,
  PauseCircle,
  Archive,
  CheckCircle,
  Eye,
} from 'lucide-react';
import type { MatchStatus } from '@/lib/match/types';

export interface MatchCardItem {
  id: string;
  lead_id: string;
  property_id: string;
  match_score: number;
  score_breakdown: {
    price: number;
    location: number;
    propertyType: number;
    bedrooms: number;
    purpose: number;
    delivery: number;
    area: number;
    penalties?: string[];
    reasons?: string[];
  };
  profile_maturity: number;
  commercial_priority: number;
  match_status: MatchStatus;
  origin: string;
  sent_at?: string | null;
  contacts: {
    id: string;
    name: string | null;
    phone: string;
    ai_score: number | null;
    ai_score_reason?: string | null;
    paused_at?: string | null;
    archived_at?: string | null;
    has_purchased?: boolean;
    is_personal_whatsapp?: boolean;
  };
  property: {
    propertyId: string;
    title: string;
    code?: string | null;
    neighborhood: string;
    city: string;
    priceMin: number;
    priceMax: number;
    bedroomsMin?: number | null;
    bedroomsMax?: number | null;
    areaMin?: number | null;
    areaMax?: number | null;
    deliveryStatus: string;
    coverUrl?: string | null;
    publicUrl?: string | null;
    features?: string[];
  };
}

interface MatchCardProps {
  match: MatchCardItem;
  onOpenSend: (match: MatchCardItem) => void;
  onOpenProfile: (leadId: string) => void;
  onDiscard: (matchId: string) => void;
  onStatusChange: (matchId: string, status: MatchStatus) => void;
}

export function MatchCard({
  match,
  onOpenSend,
  onOpenProfile,
  onDiscard,
  onStatusChange,
}: MatchCardProps) {
  const leadName = match.contacts.name || 'Lead';
  const initials = leadName
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const score = Math.round(match.match_score);
  const isStrong = score >= 85;
  const isGood = score >= 70 && score < 85;
  const isPossible = score >= 50 && score < 70;

  // Faixas de Match conforme especificação oficial
  let scoreBadgeColor = 'border-muted-foreground/30 bg-muted/30 text-muted-foreground';
  let scoreLabel = 'Consulta Manual';
  if (isStrong) {
    scoreBadgeColor = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-bold';
    scoreLabel = 'Match Forte';
  } else if (isGood) {
    scoreBadgeColor = 'border-primary/30 bg-primary/10 text-primary font-semibold';
    scoreLabel = 'Bom Match';
  } else if (isPossible) {
    scoreBadgeColor = 'border-blue-500/30 bg-blue-500/10 text-blue-400 font-medium';
    scoreLabel = 'Compatibilidade Possível';
  }

  const reasons = match.score_breakdown?.reasons || [];

  return (
    <Card className="flex flex-col justify-between overflow-hidden border border-border bg-card p-4 transition-all hover:border-primary/40 hover:shadow-md">
      <div className="space-y-3.5">
        {/* Top Header: Lead + Status & Ações */}
        <div className="flex items-start justify-between gap-2">
          {/* Avatar tipográfico elegante com iniciais (sem foto fictícia) */}
          <div
            className="flex items-center gap-2.5 cursor-pointer group"
            onClick={() => onOpenProfile(match.lead_id)}
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 border border-primary/20 text-xs font-bold text-primary transition-all group-hover:ring-2 group-hover:ring-primary/40">
              {initials}
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                {leadName}
              </h4>
              <p className="text-[11px] text-muted-foreground">{match.contacts.phone}</p>
            </div>
          </div>

          {/* Menu de ações do card */}
          <div className="flex items-center gap-1">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${scoreBadgeColor}`}
            >
              <Sparkles className="size-3" />
              {score}% {scoreLabel}
            </span>

            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="size-7" />}>
                <MoreVertical className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="text-xs">
                <DropdownMenuItem onClick={() => onOpenProfile(match.lead_id)} className="gap-2">
                  <Eye className="size-3.5" />
                  Ver Perfil do Lead
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {match.match_status !== 'enviado' && (
                  <DropdownMenuItem onClick={() => onStatusChange(match.id, 'enviado')} className="gap-2">
                    <CheckCircle className="size-3.5 text-emerald-400" />
                    Marcar como Enviado
                  </DropdownMenuItem>
                )}
                {match.match_status !== 'pausado' ? (
                  <DropdownMenuItem onClick={() => onStatusChange(match.id, 'pausado')} className="gap-2">
                    <PauseCircle className="size-3.5 text-amber-400" />
                    Pausar Match
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => onStatusChange(match.id, 'novo')} className="gap-2">
                    Reativar Match
                  </DropdownMenuItem>
                )}
                {match.match_status !== 'arquivado' && (
                  <DropdownMenuItem onClick={() => onStatusChange(match.id, 'arquivado')} className="gap-2">
                    <Archive className="size-3.5 text-muted-foreground" />
                    Arquivar Match
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onDiscard(match.id)}
                  className="gap-2 text-rose-400 hover:text-rose-500"
                >
                  <Trash2 className="size-3.5" />
                  Descartar Match
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Informações do Imóvel Recomendado */}
        <div className="flex gap-3 rounded-xl border border-border/80 bg-muted/30 p-2.5">
          {match.property.coverUrl ? (
            <img
              src={match.property.coverUrl}
              alt={match.property.title}
              className="size-14 rounded-lg object-cover border border-border shrink-0"
            />
          ) : (
            <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-card border border-border text-muted-foreground">
              <Building2 className="size-6" />
            </div>
          )}
          <div className="min-w-0 flex-1 text-xs">
            <div className="flex items-center justify-between">
              <h5 className="font-semibold text-foreground truncate">{match.property.title}</h5>
              {match.origin === 'origem_ctwa' && (
                <span className="rounded bg-blue-500/10 px-1.5 py-0.2 text-[9px] font-medium text-blue-400 shrink-0">
                  Origem CTWA
                </span>
              )}
            </div>
            <p className="text-muted-foreground truncate">{match.property.neighborhood}, {match.property.city}</p>
            {match.property.priceMin > 0 && (
              <p className="font-medium text-foreground mt-0.5">
                A partir de R$ {match.property.priceMin.toLocaleString('pt-BR')}
              </p>
            )}
          </div>
        </div>

        {/* Indicadores Secundários: Temperatura e Maturidade */}
        <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-card px-2.5 py-1.5">
            <Flame className="size-3.5 text-amber-500 shrink-0" />
            <span>Score: <strong className="text-foreground">{match.contacts.ai_score ?? 0}/10</strong></span>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-card px-2.5 py-1.5">
            <Gauge className="size-3.5 text-blue-400 shrink-0" />
            <span>Maturidade: <strong className="text-foreground">{match.profile_maturity}%</strong></span>
          </div>
        </div>

        {/* Razões Principais de Compatibilidade (Chips discretos) */}
        {reasons.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Motivos da compatibilidade:
            </p>
            <div className="flex flex-wrap gap-1">
              {reasons.slice(0, 2).map((r, i) => (
                <span
                  key={i}
                  className="rounded-md bg-muted px-2 py-0.5 text-[10px] text-foreground truncate max-w-full"
                >
                  ✓ {r}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Ações no Rodapé do Card */}
      <div className="mt-4 pt-3 border-t border-border/80 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpenProfile(match.lead_id)}
          className="text-xs flex-1 gap-1"
        >
          <Eye className="size-3.5" />
          Ver Perfil
        </Button>

        <Button
          type="button"
          size="sm"
          onClick={() => onOpenSend(match)}
          className="text-xs flex-1 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Send className="size-3.5" />
          {match.match_status === 'enviado' ? 'Reenviar' : 'Enviar'}
        </Button>
      </div>
    </Card>
  );
}
