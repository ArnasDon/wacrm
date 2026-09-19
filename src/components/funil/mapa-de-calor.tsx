"use client";

/**
 * O mapa de saúde: linhas = transições, colunas = meses, cor RELATIVA À
 * LINHA (decisão D6: o melhor mês da transição é verde e o pior é vermelho —
 * escala absoluta pintaria "Lead → Contrato" de vermelho o ano inteiro).
 * Célula pequena (a base da taxa abaixo do piso) fica apagada, com o motivo
 * no `title`; coorte com lead ainda sem desfecho traz "N em aberto" sob o
 * mês (a taxa dela ainda pode mudar — e isso vale para agosto tanto quanto
 * para o mês corrente). Tabela HTML pura — não há biblioteca para desenhar
 * isto, e a rolagem horizontal fica no contêiner, nunca na página.
 */
export interface CelulaDoMapa {
  /** fração 0..1 ou nulo (sem denominador) */
  taxa: number | null;
  /** 0..1 relativo à linha ou nulo */
  posicao: number | null;
  /** o que a taxa divide (entradas da coorte, ou o degrau de partida no mês) — vai para o `title` */
  base: number;
  pequena: boolean;
}

export interface LinhaDoMapaDeCalor {
  chave: string;
  rotulo: string;
  celulas: CelulaDoMapa[];
}

/** Vermelho (0) → amarelo (0,5) → verde (1), sempre com alfa: legível nos dois temas. */
export function corDaCelula(posicao: number | null): string | undefined {
  if (posicao === null) return undefined;
  const matiz = Math.round(posicao * 130);
  return `hsl(${matiz} 70% 45% / 0.35)`;
}

export function MapaDeCalor({
  meses,
  linhas,
  formatarTaxa,
  tituloDaCelula,
  rotuloEmAndamento,
  rotuloEmAberto,
  rotuloPequena,
}: {
  meses: { chave: string; rotulo: string; emAberto: number }[];
  linhas: LinhaDoMapaDeCalor[];
  formatarTaxa: (taxa: number | null) => string;
  tituloDaCelula: (mes: string, taxa: string, base: number) => string;
  /** o `title` da contagem: explica que a taxa do mês ainda pode mudar */
  rotuloEmAndamento: (emAberto: number) => string;
  /** o texto visível sob o mês ("3 em aberto") */
  rotuloEmAberto: (emAberto: number) => string;
  rotuloPequena: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="w-44 text-left font-medium text-muted-foreground" />
            {meses.map((m) => (
              <th key={m.chave} className="px-1 py-1 text-center font-medium text-muted-foreground">
                {m.rotulo}
                {m.emAberto > 0 && (
                  <span className="block whitespace-nowrap text-[10px] font-normal" title={rotuloEmAndamento(m.emAberto)}>
                    {rotuloEmAberto(m.emAberto)}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => (
            <tr key={linha.chave}>
              <th className="whitespace-nowrap pr-2 text-left font-medium text-foreground">{linha.rotulo}</th>
              {linha.celulas.map((c, i) => {
                const texto = formatarTaxa(c.taxa);
                const apagada = c.pequena || c.taxa === null;
                return (
                  <td
                    key={meses[i]?.chave ?? i}
                    className={
                      apagada
                        ? "rounded-md bg-muted/60 px-1 py-2 text-center tabular-nums text-muted-foreground"
                        : "rounded-md px-1 py-2 text-center font-medium tabular-nums text-foreground"
                    }
                    style={apagada ? undefined : { backgroundColor: corDaCelula(c.posicao) }}
                    title={`${tituloDaCelula(meses[i]?.rotulo ?? "", texto, c.base)}${c.pequena ? ` · ${rotuloPequena}` : ""}`}
                  >
                    {c.taxa === null ? "—" : texto}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
