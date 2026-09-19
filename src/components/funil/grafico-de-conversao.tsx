"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { eixoDasTaxas } from "@/lib/funil/apresentacao";

/**
 * Uma série por transição do funil. ⚠️ A cor vem em TRÊS classes literais
 * (traço, ponto, bloco da legenda), nunca numa só derivada por `replace`: o
 * Tailwind não gera classe montada em tempo de execução — ver o comentário
 * de `COR_DA_TRANSICAO` em `saude.tsx`.
 */
export interface SerieDeConversao {
  chave: string;
  rotulo: string;
  cor: { traco: string; ponto: string; bloco: string };
  /** um ponto por mês, em pontos percentuais (0..100); nulo sem denominador */
  valores: (number | null)[];
}

/**
 * Conversão por degrau ao longo dos meses — recharts direto, como o gráfico
 * de entradas (`grafico-de-entradas.tsx`). As cores saem de classes com
 * `stroke=""` vazio (o truque do Tremor), então o gráfico segue o tema.
 */
export function GraficoDeConversao({
  meses,
  series,
  formatarValor,
}: {
  meses: string[];
  series: SerieDeConversao[];
  formatarValor: (v: number | null) => string;
}) {
  const dados = meses.map((mes, i) => {
    const linha: Record<string, string | number | null> = { mes };
    for (const s of series) linha[s.chave] = s.valores[i];
    return linha;
  });
  // 0–100 enquanto couber; por período a taxa pode passar de 100%, e com o
  // domínio cravado o ponto ficava acima da última marca rotulada, numa faixa
  // sem grade (o recharts alarga o domínio, mas não as marcas — ver
  // `eixoDasTaxas`).
  const eixo = eixoDasTaxas(series.flatMap((s) => s.valores));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.chave} className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-2 w-3 rounded-sm ${s.cor.bloco}`} />
            {s.rotulo}
          </span>
        ))}
      </div>
      <div className="h-[300px] w-full text-muted-foreground">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={dados} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" stroke="" />
            <XAxis dataKey="mes" tick={{ fill: "currentColor", fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis
              domain={[0, eixo.teto]}
              ticks={eixo.ticks}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fill: "currentColor", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                return (
                  <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
                    <div className="mb-1 font-medium">{String(label)}</div>
                    {series.map((s) => {
                      const v = payload.find((p) => p.dataKey === s.chave)?.value;
                      return (
                        <div key={s.chave} className="flex items-center gap-1.5">
                          <span className={`inline-block h-2 w-2 rounded-full ${s.cor.bloco}`} />
                          <span className="text-muted-foreground">{s.rotulo}:</span>
                          <span className="font-medium">{formatarValor(typeof v === "number" ? v : null)}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />
            {series.map((s) => (
              <Line
                key={s.chave}
                type="monotone"
                dataKey={s.chave}
                strokeWidth={2}
                className={s.cor.traco}
                stroke=""
                dot={{ r: 3, className: `${s.cor.traco} ${s.cor.ponto}`, stroke: "", fill: "" }}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
