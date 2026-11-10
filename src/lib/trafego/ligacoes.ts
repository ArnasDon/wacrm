// Tela "Ligar campanhas": cada campanha do Meta vai para UM lugar — um carro
// do Pátio ou uma finalidade (perfil do Instagram, site, marca…). Aqui fica a
// parte pura: montar as linhas da tela com a situação de cada campanha e a
// sugestão (carro pelo nome/placa, finalidade pelo objetivo do Meta).
// Testado em ligacoes.test.ts.

import { sugerirCarroParaCampanha, palavras, MARCAS } from "./estoqueSite";
import { sugerirFinalidade, rotuloFinalidade } from "./finalidades";

export const IMPOSTO = 0.12;

export type CarroDoPatio = { id: string; nome: string; placa: string | null; ano: number | null; status: string; img: string | null; modelo: string | null; preco?: number | null };
export type CampanhaCrua = { id: string; nome: string; objetivo: string | null; status: string | null; car_id: string | null; categoria_objetivo: string | null; destino_id: string | null };
export type VeiculoCru = { id: string; modelo: string | null; placa: string | null; site_vehicle_id: string | null };
export type Metrica = { campaign_id: string; data: string; gasto: number; msgs: number };

export type Situacao = "sem" | "fora" | "carro" | "finalidade";
export type Sugestao = { tipo: "carro"; patioId: string; rotulo: string } | { tipo: "finalidade"; chave: string; rotulo: string };

export type LinhaLigacao = {
  id: string;
  nome: string;
  status: string;
  ativa: boolean;
  investido: number; // com imposto
  msgs: number;
  primeiroDia: string | null;
  ultimoDia: string | null;
  situacao: Situacao;
  ligadaA: string | null; // rótulo do que está ligado hoje
  patioId: string | null;
  finalidade: string | null;
  foraId: string | null; // carro do Marketing sem par no Pátio
  sugestao: Sugestao | null;
  opcoes: { patioId: string; rotulo: string }[]; // vários carros do mesmo modelo: escolha rápida
  candidatos: string[]; // carros do Pátio que o nome da campanha cita (visão "por carro")
};

/** Carros do Pátio cujo modelo aparece no nome da campanha (sem contar a marca). */
export function candidatosDoNome(nome: string, patio: CarroDoPatio[]): CarroDoPatio[] {
  const texto = palavras(nome);
  const junto = texto.join("");
  return patio.filter((c) => {
    const principal = palavras(c.modelo || c.nome).find((w) => !MARCAS.has(w) && !/^(19|20)\d{2}$/.test(w) && w.length >= 3);
    return !!principal && (texto.includes(principal) || junto.includes(principal));
  });
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export const rotuloCarro = (c: Pick<CarroDoPatio, "nome" | "placa"> & { status?: string }) => [c.nome, c.placa, c.status === "sold" ? "vendido" : null].filter(Boolean).join(" · ");

export function montarLigacoes(campanhas: CampanhaCrua[], veiculos: VeiculoCru[], patio: CarroDoPatio[], metricas: Metrica[], destinos: Record<string, string> = {}): LinhaLigacao[] {
  const soma = new Map<string, { gasto: number; msgs: number; de: string | null; ate: string | null }>();
  for (const m of metricas) {
    const s = soma.get(m.campaign_id) ?? { gasto: 0, msgs: 0, de: null, ate: null };
    s.gasto += Number(m.gasto) || 0;
    s.msgs += Number(m.msgs) || 0;
    if ((Number(m.gasto) || 0) > 0) {
      if (!s.de || m.data < s.de) s.de = m.data;
      if (!s.ate || m.data > s.ate) s.ate = m.data;
    }
    soma.set(m.campaign_id, s);
  }
  const veic = new Map(veiculos.map((v) => [v.id, v]));
  const porPatio = new Map(patio.map((c) => [c.id, c]));
  const opcoes = patio.map((c) => ({ id: c.id, placa: c.placa, modelo: c.nome, ano: c.ano, status: c.status === "sold" ? "vendido" : "estoque", nomeSite: c.nome, modeloSite: c.modelo }));

  return campanhas
    .map((c) => {
      const s = soma.get(c.id);
      const status = String(c.status || "");
      const base = {
        id: c.id, nome: c.nome || "(sem nome)", status, ativa: status === "ACTIVE",
        investido: r2((s?.gasto ?? 0) * (1 + IMPOSTO)), msgs: s?.msgs ?? 0, primeiroDia: s?.de ?? null, ultimoDia: s?.ate ?? null,
      };
      let situacao: Situacao = "sem";
      let ligadaA: string | null = null;
      let patioId: string | null = null;
      let foraId: string | null = null;
      if (c.car_id) {
        const v = veic.get(c.car_id);
        const p = v?.site_vehicle_id ? porPatio.get(v.site_vehicle_id) : undefined;
        if (p) { situacao = "carro"; patioId = p.id; ligadaA = rotuloCarro(p); }
        else { situacao = "fora"; foraId = c.car_id; ligadaA = [v?.modelo, v?.placa].filter(Boolean).join(" · ") || "carro apagado"; }
      } else if (c.categoria_objetivo) {
        situacao = "finalidade"; ligadaA = rotuloFinalidade(c.categoria_objetivo);
      } else if (c.destino_id) {
        // jeito antigo de marcar "não é carro": o destino (Instagram, site…)
        situacao = "finalidade"; ligadaA = `Destino: ${destinos[c.destino_id] ?? "cadastrado"}`;
      }
      let sugestao: Sugestao | null = null;
      let escolhas: { patioId: string; rotulo: string }[] = [];
      if (situacao === "sem" || situacao === "fora") {
        const carro = sugerirCarroParaCampanha(c.nome || "", opcoes);
        if (carro) sugestao = { tipo: "carro", patioId: carro.id, rotulo: rotuloCarro(porPatio.get(carro.id)!) };
        else {
          const cands = candidatosDoNome(c.nome || "", patio).sort((a, b) => Number(a.status === "sold") - Number(b.status === "sold"));
          if (cands.length) escolhas = cands.slice(0, 4).map((x) => ({ patioId: x.id, rotulo: rotuloCarro(x) }));
          else if (situacao === "sem") {
            // finalidade só quando o nome não cita nenhum carro do Pátio
            const f = sugerirFinalidade(c.objetivo, c.nome || "");
            if (f) sugestao = { tipo: "finalidade", chave: f, rotulo: rotuloFinalidade(f) };
          }
        }
      }
      const citados = new Set(candidatosDoNome(c.nome || "", patio).map((x) => x.id));
      if (sugestao?.tipo === "carro") citados.add(sugestao.patioId);
      return { ...base, situacao, ligadaA, patioId, finalidade: c.categoria_objetivo, foraId, sugestao, opcoes: escolhas, candidatos: [...citados] };
    })
    .filter((l) => l.investido > 0 || l.ativa || l.situacao !== "sem")
    .sort((a, b) => Number(b.ativa) - Number(a.ativa) || b.investido - a.investido);
}

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Busca de carro do Pátio por qualquer pedaço do nome, ano ou placa. */
export function buscarCarros(patio: CarroDoPatio[], termo: string, limite = 8): CarroDoPatio[] {
  const partes = sem(termo).split(/\s+/).filter(Boolean);
  if (!partes.length) return [];
  const placa = (p: string | null) => String(p ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return patio
    .filter((c) => {
      const alvo = `${sem(c.nome)} ${c.ano ?? ""} ${placa(c.placa)}`;
      return partes.every((p) => alvo.includes(p.replace(/[^a-z0-9]/g, "") || p));
    })
    .sort((a, b) => Number(a.status === "sold") - Number(b.status === "sold"))
    .slice(0, limite);
}
