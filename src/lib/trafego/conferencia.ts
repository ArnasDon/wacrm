// Conferência do painel com o Facebook (Gerenciador de Anúncios).
//
// Compara o que está gravado no banco com o que o Meta devolve para o
// período máximo da conta: dia a dia (gasto da conta inteira) e campanha a
// campanha (gasto, impressões, cliques e conversas desde o início). Cada
// diferença acima de R$ 0,05 vira uma linha para corrigir. Funções puras,
// testadas em conferencia.test.ts.

export type DiaMeta = { data: string; gasto: number };
export type CampanhaMeta = { id: string; nome: string; status: string; gasto: number; impressions: number; clicks: number; msgs: number };
export type LinhaBanco = { externo: string | null; campanhaId: string; nome: string; data: string; gasto: number; impressions: number; clicks: number; msgs: number };

export type DiferencaDia = { data: string; meta: number; banco: number };
export type DiferencaCampanha = {
  id: string;
  nome: string;
  status: string;
  meta: { gasto: number; impressions: number; clicks: number; msgs: number };
  banco: { gasto: number; impressions: number; clicks: number; msgs: number };
  motivo: "falta no painel" | "valor diferente" | "só no painel";
};

export type Conferencia = {
  totalMeta: number;
  totalBanco: number;
  primeiroDia: string | null;
  ultimoDia: string | null;
  campanhasMeta: number;
  campanhasBanco: number;
  dias: DiferencaDia[];
  campanhas: DiferencaCampanha[];
  meses: string[]; // AAAA-MM com diferença: são os que a correção busca de novo
  bate: boolean;
};

const TOLERANCIA = 0.05;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function conferir(diasMeta: DiaMeta[], campanhasMeta: CampanhaMeta[], banco: LinhaBanco[]): Conferencia {
  const porDiaMeta = new Map<string, number>();
  for (const d of diasMeta) porDiaMeta.set(d.data, (porDiaMeta.get(d.data) ?? 0) + d.gasto);
  const porDiaBanco = new Map<string, number>();
  for (const l of banco) porDiaBanco.set(l.data, (porDiaBanco.get(l.data) ?? 0) + l.gasto);

  const dias: DiferencaDia[] = [];
  for (const data of new Set([...porDiaMeta.keys(), ...porDiaBanco.keys()])) {
    const meta = r2(porDiaMeta.get(data) ?? 0);
    const b = r2(porDiaBanco.get(data) ?? 0);
    if (Math.abs(meta - b) > TOLERANCIA) dias.push({ data, meta, banco: b });
  }
  dias.sort((a, b) => a.data.localeCompare(b.data));

  type Soma = { nome: string; gasto: number; impressions: number; clicks: number; msgs: number };
  const porCampanhaBanco = new Map<string, Soma>();
  for (const l of banco) {
    const chave = l.externo || `interno:${l.campanhaId}`;
    const s = porCampanhaBanco.get(chave) ?? { nome: l.nome, gasto: 0, impressions: 0, clicks: 0, msgs: 0 };
    s.gasto += l.gasto; s.impressions += l.impressions; s.clicks += l.clicks; s.msgs += l.msgs;
    porCampanhaBanco.set(chave, s);
  }

  const campanhas: DiferencaCampanha[] = [];
  const vistas = new Set<string>();
  for (const c of campanhasMeta) {
    vistas.add(c.id);
    const b = porCampanhaBanco.get(c.id);
    const meta = { gasto: r2(c.gasto), impressions: c.impressions, clicks: c.clicks, msgs: c.msgs };
    if (!b) {
      if (c.gasto > TOLERANCIA || c.impressions > 0) campanhas.push({ id: c.id, nome: c.nome, status: c.status, meta, banco: { gasto: 0, impressions: 0, clicks: 0, msgs: 0 }, motivo: "falta no painel" });
      continue;
    }
    const bb = { gasto: r2(b.gasto), impressions: b.impressions, clicks: b.clicks, msgs: b.msgs };
    if (Math.abs(meta.gasto - bb.gasto) > TOLERANCIA || meta.impressions !== bb.impressions || meta.clicks !== bb.clicks || meta.msgs !== bb.msgs) {
      campanhas.push({ id: c.id, nome: c.nome, status: c.status, meta, banco: bb, motivo: "valor diferente" });
    }
  }
  for (const [chave, b] of porCampanhaBanco) {
    if (vistas.has(chave) || (b.gasto <= TOLERANCIA && b.impressions === 0)) continue;
    campanhas.push({ id: chave, nome: b.nome, status: "", meta: { gasto: 0, impressions: 0, clicks: 0, msgs: 0 }, banco: { gasto: r2(b.gasto), impressions: b.impressions, clicks: b.clicks, msgs: b.msgs }, motivo: "só no painel" });
  }
  campanhas.sort((a, b) => Math.abs(b.meta.gasto - b.banco.gasto) - Math.abs(a.meta.gasto - a.banco.gasto));

  const datas = [...porDiaMeta.keys()].filter((d) => (porDiaMeta.get(d) ?? 0) > 0).sort();
  const meses = [...new Set(dias.map((d) => d.data.slice(0, 7)))].sort();
  const totalMeta = r2([...porDiaMeta.values()].reduce((s, v) => s + v, 0));
  const totalBanco = r2([...porDiaBanco.values()].reduce((s, v) => s + v, 0));
  return {
    totalMeta,
    totalBanco,
    primeiroDia: datas[0] ?? null,
    ultimoDia: datas[datas.length - 1] ?? null,
    campanhasMeta: campanhasMeta.filter((c) => c.gasto > 0 || c.impressions > 0).length,
    campanhasBanco: [...porCampanhaBanco.values()].filter((b) => b.gasto > 0 || b.impressions > 0).length,
    dias,
    campanhas,
    meses,
    bate: dias.length === 0 && campanhas.length === 0 && Math.abs(totalMeta - totalBanco) <= TOLERANCIA,
  };
}

// Linhas do banco num mês que o Meta não devolveu (campanha/dia que não
// existe no Facebook): são as que sobram depois de buscar o mês de novo.
// Linha de campanha sem id do Facebook nunca é apagada aqui — aparece na
// conferência como "só no painel" para a pessoa decidir.
export function sobrasDoMes(banco: { id: string; externo: string | null; data: string }[], chavesMeta: Set<string>): string[] {
  return banco.filter((l) => l.externo && !chavesMeta.has(`${l.externo}|${l.data}`)).map((l) => l.id);
}
