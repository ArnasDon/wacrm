/**
 * Formatação dos números do painel de Desempenho — pt-BR fixo, como
 * `src/lib/currency.ts` (o app serve um locale só). Puro, para o teste.
 */

const percentual = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const inteiroComSinal = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
});

const umaCasaComSinal = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/** 0.6 → "60,0%"; nulo → "—". */
export function formatarPercentual(fracao: number | null): string {
  return fracao === null ? "—" : percentual.format(fracao);
}

/** Variação de contagem, em %: 0.07 → "+7%"; -0.5 → "-50%"; nulo → null. */
export function formatarVariacao(variacao: number | null): string | null {
  return variacao === null ? null : `${inteiroComSinal.format(variacao * 100)}%`;
}

/** Diferença de taxa, em pontos percentuais: 20 → "+20,0 pp"; nulo → null. */
export function formatarPp(pp: number | null): string | null {
  return pp === null ? null : `${umaCasaComSinal.format(pp)} pp`;
}

/**
 * O sinal do que a tela ESCREVE, não o do número cru. `Intl` decide o sinal
 * sobre o valor ARREDONDADO, então -0,04 pp sai como "0,0 pp": com o sinal
 * cru, a seta vermelha para baixo aparecia ao lado de um texto dizendo zero
 * (revisão do PR #123).
 */
export function sinalArredondado(valor: number, casas: number): number {
  const fator = 10 ** casas;
  const arredondado = Math.round(valor * fator) / fator;
  return sinalDe(arredondado);
}

/** -1, 0 ou 1 do valor CRU — a tela usa `sinalArredondado`. */
export function sinalDe(n: number | null): number {
  if (n === null || n === 0) return 0;
  return n > 0 ? 1 : -1;
}

/** "2026-09-01" → "01/09" (rótulo do eixo do gráfico de entradas). */
export function rotuloCurtoDoDia(chave: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(chave);
  return m ? `${m[3]}/${m[2]}` : chave;
}

const PASSOS_DO_EIXO = [25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/**
 * O eixo dos gráficos de taxa, em pontos percentuais. 0–100 de 25 em 25
 * enquanto couber — é o de sempre. ⚠️ Na contagem POR PERÍODO a taxa é razão
 * de fluxo e pode passar de 100% (`por-periodo.ts`). O recharts NÃO corta o
 * dado: sem `allowDataOverflow` ele ALARGA o domínio até o valor
 * (`extendDomain`, `util/isDomainSpecifiedByUser.js`) — mas alargava sem
 * marca: com `domain=[0,100]` e `ticks=[0..100]` o ponto acima de 100% ficava
 * numa faixa sem rótulo nem grade, e o Tremor inventava as marcas por conta
 * própria. Aqui o teto é redondo e as marcas são rotuladas: até seis marcas
 * enquanto o maior valor cabe em 50.000 pp; acima disso o passo para de
 * crescer e sobram mais marcas, sem relevância prática.
 */
export function eixoDasTaxas(valores: readonly (number | null)[]): { teto: number; ticks: number[] } {
  const maior = Math.max(
    0,
    ...valores.filter((v): v is number => v !== null && Number.isFinite(v)),
  );
  const passo = PASSOS_DO_EIXO.find((p) => maior / p <= 5) ?? PASSOS_DO_EIXO[PASSOS_DO_EIXO.length - 1];
  const teto = Math.max(100, Math.ceil(maior / passo) * passo);
  const ticks: number[] = [];
  for (let v = 0; v <= teto; v += passo) ticks.push(v);
  return { teto, ticks };
}

/** Uma fração 0..1 vira 0..100 com uma casa, para o eixo do gráfico de taxas. */
export function paraPontosPercentuais(fracao: number | null): number | null {
  return fracao === null ? null : Math.round(fracao * 1000) / 10;
}
