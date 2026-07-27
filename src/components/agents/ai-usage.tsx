'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { BarChart3, Bot, PencilLine } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/dashboard/skeleton';
import { BarChart } from '@/components/tremor/bar-chart';
import { formatCompactNumber } from '@/lib/currency';
import { format, parseISO } from 'date-fns';

interface UsageResponse {
  window_days: number;
  truncated: boolean;
  totals: {
    calls: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  by_mode: {
    auto_reply: { calls: number; tokens: number };
    draft: { calls: number; tokens: number };
  };
  by_model: {
    model: string;
    provider: string;
    calls: number;
    tokens: number;
  }[];
  daily: { date: string; tokens: number; calls: number }[];
}

const WINDOWS = [7, 30, 90] as const;

/**
 * Token-spend dashboard for the account's BYO key. Admin-only (spend is
 * billing-class), mirroring the `ai_usage_log` SELECT policy and the
 * `GET /api/ai/usage` route. Renders nothing for non-admins.
 */
export function AiUsageCard() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canView = accountRole ? canEditSettings(accountRole) : false;

  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<UsageResponse | null>(null);
  const loadedRef = useRef<string | null>(null);

  const fetchUsage = useCallback(async (windowDays: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/usage?days=${windowDays}`, {
        cache: 'no-store',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error ?? 'Falha ao carregar o uso');
        setData(null);
        return;
      }
      setData(json as UsageResponse);
    } catch {
      toast.error('Falha ao carregar o uso');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canView || !accountId) return;
    // Refetch on account switch or window change.
    const key = `${accountId}:${days}`;
    if (loadedRef.current === key) return;
    loadedRef.current = key;
    void fetchUsage(days);
  }, [canView, accountId, days, fetchUsage]);

  if (profileLoading || !canView) return null;

  const chartData =
    data?.daily.map((d) => ({ day: format(parseISO(d.date), 'MMM d'), Tokens: d.tokens })) ??
    [];
  const hasSpend = (data?.totals.total_tokens ?? 0) > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-primary" /> Uso de tokens
            </CardTitle>
            <CardDescription>
              Tokens gastos na sua chave de provedor pelos rascunhos e pelo
              bot de resposta automática. Apenas contagens — nenhum conteúdo
              de mensagem é armazenado aqui.
            </CardDescription>
          </div>
          <Select
            value={String(days)}
            onValueChange={(v) => setDays(Number(v))}
          >
            <SelectTrigger className="w-32 flex-shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOWS.map((w) => (
                <SelectItem key={w} value={String(w)}>
                  Últimos {w} dias
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading || !data ? (
          <Skeleton className="h-[220px] w-full" />
        ) : !hasSpend ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <BarChart3 className="h-8 w-8 opacity-40" />
            <p>Nenhum uso de IA nos últimos {data.window_days} dias ainda.</p>
            <p className="text-xs">
              Isso é preenchido conforme o assistente gera rascunhos e respostas automáticas.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Total de tokens" value={formatCompactNumber(data.totals.total_tokens)} />
              <Stat label="Chamadas de LLM" value={String(data.totals.calls)} />
              <Stat
                label="Resposta automática"
                value={formatCompactNumber(data.by_mode.auto_reply.tokens)}
                icon={Bot}
              />
              <Stat
                label="Rascunhos"
                value={formatCompactNumber(data.by_mode.draft.tokens)}
                icon={PencilLine}
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Tokens por dia
              </p>
              <BarChart
                data={chartData}
                index="day"
                categories={['Tokens']}
                colors={['violet']}
                valueFormatter={(v) => formatCompactNumber(v)}
                showLegend={false}
                yAxisWidth={48}
                className="h-[200px]"
              />
            </div>

            {data.by_model.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Por modelo
                </p>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {data.by_model.map((m) => (
                    <li
                      key={`${m.provider}:${m.model}`}
                      className="flex items-center justify-between px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        <span className="text-foreground">{m.model}</span>{' '}
                        <span className="text-xs text-muted-foreground">
                          ({m.provider})
                        </span>
                      </span>
                      <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                        {formatCompactNumber(m.tokens)} tok · {m.calls}{' '}
                        {m.calls === 1 ? 'chamada' : 'chamadas'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.truncated && (
              <p className="text-xs text-muted-foreground">
                Mostrando uma janela parcial — o uso é alto o suficiente para
                que apenas os registros mais recentes sejam resumidos aqui.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: typeof Bot;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {value}
      </p>
    </div>
  );
}
