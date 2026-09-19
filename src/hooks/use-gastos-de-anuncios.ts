"use client";

import { useCallback, useEffect, useState } from "react";

import { diasDoPeriodo, type CampanhaMapeada, type GastoDoDia } from "@/lib/meta-ads/atribuicao";
import type { Intervalo } from "@/lib/funil/periodo";
import { createClient } from "@/lib/supabase/client";

/**
 * O gasto em anúncios que o Desempenho lê: as campanhas (com o funil de
 * cada uma) e o gasto por dia no intervalo, sob RLS (SELECT do membro —
 * a config com o token continua fechada). `conectado` é derivado de haver
 * campanhas: o membro não enxerga a config, e campanha só existe depois de
 * uma sincronização.
 *
 * Mesmo desenho do `useTrajetorias`: `carregando` DERIVADO da chave do
 * pedido, setState só no `.then`, resposta atrasada descartada — e a mesma
 * `versao` dentro da chave, que o `recarregar` sobe (a volta ao app, no
 * Desempenho). Recarregar liga o `carregando` e esconde os cartões de
 * investimento até a resposta, de propósito: é a escolha de piscar das
 * trajetórias, porque a tela afirma custo por lead e CAC.
 *
 * ⚠️ **Consulta que falhou, ou que não coube, NÃO vira número** — devolve
 * `falhou`, e o Desempenho diz que não conseguiu ler. É a mesma regra do
 * `carregar.ts`, e pelo mesmo motivo: uma soma parcial apresentada como
 * total faz o custo por lead e o CAC mentirem PARA BAIXO, que é o erro que
 * ninguém percebe (achados do Codex no PR #123). O `dia` ordena ASCENDENTE,
 * então o que o teto cortaria seria justamente o gasto mais NOVO.
 */

interface Resultado {
  chave: string;
  campanhas: CampanhaMapeada[];
  gastos: GastoDoDia[];
  falhou: boolean;
}

const PAGINA = 1000;
const MAX_PAGINAS = 25;

export function useGastosDeAnuncios(intervalo: Intervalo): {
  campanhas: CampanhaMapeada[];
  gastos: GastoDoDia[];
  carregando: boolean;
  conectado: boolean;
  falhou: boolean;
  /** Refaz as duas consultas (campanhas e gasto) do mesmo intervalo. */
  recarregar: () => void;
} {
  const supabase = createClient();
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [versao, setVersao] = useState(0);
  const dias = diasDoPeriodo(intervalo, new Date());
  const chave = `${dias.desde ?? ""}|${dias.ate ?? ""}|${versao}`;

  useEffect(() => {
    let ativo = true;
    void (async () => {
      // ⚠️ Campanhas também PAGINAM. Passando do teto de 1000 do PostgREST,
      // a campanha que não veio some do mapa — e `gastoDoPeriodo` DESCARTA o
      // gasto dela (sem nome, sem funil), sem sequer contá-lo no aviso
      // "sem funil". O custo por lead sairia menor do que é (Codex, PR #123).
      const campanhas: CampanhaMapeada[] = [];
      let falhou = false;
      for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
        const { data, error } = await supabase
          .from("cb_meta_ads_campanhas")
          .select("campaign_id, nome, pipeline_id")
          .order("campaign_id")
          .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
        if (error || !data) {
          falhou = true;
          break;
        }
        campanhas.push(...(data as CampanhaMapeada[]));
        if (data.length < PAGINA) break;
        if (pagina === MAX_PAGINAS - 1) falhou = true;
      }
      const gastos: GastoDoDia[] = [];
      if (!falhou) {
        let coube = false;
        for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
          let consulta = supabase
            .from("cb_meta_ads_gastos")
            .select("campaign_id, dia, gasto")
            .order("dia")
            .order("campaign_id")
            .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
          if (dias.desde) consulta = consulta.gte("dia", dias.desde);
          if (dias.ate) consulta = consulta.lt("dia", dias.ate);
          const { data, error } = await consulta;
          if (error || !data) {
            falhou = true;
            break;
          }
          for (const g of data) gastos.push({ campaign_id: g.campaign_id, dia: g.dia, gasto: Number(g.gasto) });
          if (data.length < PAGINA) {
            coube = true;
            break;
          }
        }
        // Saiu pelo teto do laço: veio mais gasto do que cabe, e o que
        // ficou de fora é o mais RECENTE. Somar isso seria mentir.
        if (!coube) falhou = true;
      }
      if (ativo) setResultado({ chave, campanhas, gastos, falhou });
    })();
    return () => {
      ativo = false;
    };
  }, [supabase, chave, dias.desde, dias.ate]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  const vigente = resultado !== null && resultado.chave === chave;
  const falhou = vigente && resultado.falhou;
  return {
    campanhas: vigente ? resultado.campanhas : SEM_CAMPANHAS,
    gastos: vigente && !falhou ? resultado.gastos : SEM_GASTOS,
    carregando: !vigente,
    // Falhou = não sabemos o gasto. Nem "conectado" (mostraria zeros), nem
    // "não conectado" (mandaria conectar o que já está conectado).
    conectado: vigente && !falhou && resultado.campanhas.length > 0,
    falhou,
    recarregar,
  };
}

const SEM_CAMPANHAS: CampanhaMapeada[] = [];
const SEM_GASTOS: GastoDoDia[] = [];
