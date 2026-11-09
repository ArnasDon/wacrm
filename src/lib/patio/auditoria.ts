// Auditoria de vínculos: cada carro do Pátio × o carro do Marketing (tabela
// veiculos, onde as campanhas são ligadas) × as campanhas e o gasto de cada
// uma desde o início. Mostra o que está ligado, o que falta ligar e sugere
// o par certo pela placa e pelo modelo. Funções puras (auditoria.test.ts).
import type { Carro } from "./veiculo";
import { custoTotal, temCusto, valorVenda, IMPOSTO_META } from "./resumo";
import { candidatoNoPainel, normPlaca, type CarroPainel, type VeiculoSite } from "@/lib/trafego/estoqueSite";

export type VeiculoMkt = { id: string; placa: string | null; modelo: string | null; ano: number | null; status: string | null; origem: string | null; site_vehicle_id: string | null };
export type CampanhaAud = { id: string; nome: string; status: string | null; car_id: string | null; categoria_objetivo: string | null; destino_id: string | null; gasto: number; msgs: number };

export type CampanhaLinha = { id: string; nome: string; status: string | null; investido: number; msgs: number };
export type LinhaPatio = {
  id: string; nome: string; versao: string; ano: string; placa: string; status: string; img: string;
  veiculoId: string | null; campanhas: CampanhaLinha[]; investido: number; msgs: number;
  custo: number | null; venda: number; lucro: number | null; lucroAposTrafego: number | null;
  sugestao: { veiculoId: string; rotulo: string; motivo: string; investido: number } | null;
};
export type Orfao = { id: string; placa: string; modelo: string; ano: number | null; campanhas: CampanhaLinha[]; investido: number; msgs: number; sugestao: { carroId: string; rotulo: string; motivo: string } | null };

const comImposto = (g: number) => g * (1 + IMPOSTO_META);
const linhaCamp = (c: CampanhaAud): CampanhaLinha => ({ id: c.id, nome: c.nome, status: c.status, investido: comImposto(c.gasto), msgs: c.msgs });

function comoSite(c: Carro): VeiculoSite {
  const ano = Number(String(c.year ?? "").slice(0, 4)) || null;
  const nome = [c.brand, c.model, c.versao].filter(Boolean).join(" ");
  return { id: c.id, placa: String(c.plate ?? ""), nome, modelo: [c.brand, c.model].filter(Boolean).join(" "), ano, anoTexto: String(c.year ?? ""), status: c.status ?? "available", preco: Number(c.finance?.sale_price) || null, foto: c.img ?? null, categoria: c.cat ?? "carros" };
}

export function montarAuditoria(patio: Carro[], veiculos: VeiculoMkt[], campanhas: CampanhaAud[], socio: boolean) {
  const idsPatio = new Set(patio.map((c) => c.id));
  const veicDoCarro = new Map<string, VeiculoMkt>();
  for (const v of veiculos) if (v.site_vehicle_id && idsPatio.has(v.site_vehicle_id)) veicDoCarro.set(v.site_vehicle_id, v);
  const campsDoVeic = new Map<string, CampanhaAud[]>();
  for (const c of campanhas) if (c.car_id) campsDoVeic.set(c.car_id, [...(campsDoVeic.get(c.car_id) ?? []), c]);
  const soma = (l: CampanhaAud[]) => ({ investido: comImposto(l.reduce((s, c) => s + c.gasto, 0)), msgs: l.reduce((s, c) => s + c.msgs, 0) });

  // Carros do Marketing sem par no Pátio (com ou sem campanha)
  const orfaosBase = veiculos.filter((v) => !v.site_vehicle_id || !idsPatio.has(v.site_vehicle_id));
  const painel: CarroPainel[] = orfaosBase.map((v) => ({ id: v.id, placa: v.placa, modelo: v.modelo, ano: v.ano, site_vehicle_id: null, status: v.status }));
  const rotuloVeic = (v: VeiculoMkt) => [v.modelo, v.ano, v.placa].filter(Boolean).join(" · ");

  const linhas: LinhaPatio[] = patio.map((c) => {
    const v = veicDoCarro.get(c.id) ?? null;
    const camps = v ? campsDoVeic.get(v.id) ?? [] : [];
    const t = soma(camps);
    const custo = socio && temCusto(c) ? custoTotal(c) : null;
    const venda = valorVenda(c);
    const lucro = custo != null && venda ? venda - custo : null;
    let sugestao: LinhaPatio["sugestao"] = null;
    if (!v || !camps.length) {
      const cand = candidatoNoPainel(comoSite(c), painel);
      if (cand) {
        const vv = orfaosBase.find((o) => o.id === cand.car.id)!;
        const cs = soma(campsDoVeic.get(vv.id) ?? []);
        if (!v || cs.investido > 0) sugestao = { veiculoId: vv.id, rotulo: rotuloVeic(vv), motivo: cand.motivo, investido: cs.investido };
      }
    }
    return {
      id: c.id, nome: [c.brand, c.model].filter(Boolean).join(" ") || "Carro", versao: c.versao ?? "", ano: String(c.year ?? ""), placa: String(c.plate ?? ""),
      status: c.status ?? "available", img: c.img ?? "", veiculoId: v?.id ?? null, campanhas: camps.map(linhaCamp), investido: t.investido, msgs: t.msgs,
      custo, venda, lucro, lucroAposTrafego: lucro != null ? lucro - t.investido : null, sugestao,
    };
  });

  const livresPatio = linhas.filter((l) => !l.veiculoId || !l.campanhas.length);
  const orfaos: Orfao[] = orfaosBase
    .map((v) => {
      const camps = campsDoVeic.get(v.id) ?? [];
      const t = soma(camps);
      const pv = normPlaca(v.placa);
      const porPlaca = pv.length >= 7 ? livresPatio.find((l) => normPlaca(l.placa) === pv) : undefined;
      const porSugestao = linhas.find((l) => l.sugestao?.veiculoId === v.id);
      const alvo = porPlaca ?? porSugestao;
      return {
        id: v.id, placa: v.placa ?? "", modelo: v.modelo ?? "", ano: v.ano, campanhas: camps.map(linhaCamp), investido: t.investido, msgs: t.msgs,
        sugestao: alvo ? { carroId: alvo.id, rotulo: [alvo.nome, alvo.versao, alvo.ano, alvo.placa].filter(Boolean).join(" · "), motivo: porPlaca ? "placa igual" : porSugestao!.sugestao!.motivo } : null,
      };
    })
    .filter((o) => o.campanhas.length > 0 || o.sugestao)
    .sort((a, b) => b.investido - a.investido);

  const semVinculo = campanhas.filter((c) => !c.car_id && !c.categoria_objetivo && !c.destino_id && (c.gasto > 0 || c.msgs > 0)).map(linhaCamp).sort((a, b) => b.investido - a.investido);
  const comFinalidade = campanhas.filter((c) => !c.car_id && (c.categoria_objetivo || c.destino_id));

  return {
    linhas: linhas.sort((a, b) => Number(!!a.veiculoId && a.campanhas.length > 0) - Number(!!b.veiculoId && b.campanhas.length > 0) || b.investido - a.investido),
    orfaos,
    semVinculo,
    totais: {
      carrosPatio: linhas.length,
      comAnuncio: linhas.filter((l) => l.campanhas.length).length,
      comSugestao: linhas.filter((l) => l.sugestao).length + orfaos.filter((o) => o.sugestao && !linhas.some((l) => l.sugestao?.veiculoId === o.id)).length,
      investidoEmCarros: linhas.reduce((s, l) => s + l.investido, 0),
      investidoOrfaos: orfaos.reduce((s, o) => s + o.investido, 0),
      investidoSemVinculo: semVinculo.reduce((s, c) => s + c.investido, 0),
      investidoFinalidade: comImposto(comFinalidade.reduce((s, c) => s + c.gasto, 0)),
    },
  };
}
