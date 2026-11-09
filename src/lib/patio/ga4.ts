import { tokenGoogle } from "./google";

// Visitas do site pelo Google Analytics 4 (Data API), com a mesma chave de
// serviço do Firebase do site. Cada carro é achado pelo caminho da página:
// o site publica vehicles-index.json com "id do carro → caminho".

const ESCOPO = "https://www.googleapis.com/auth/analytics.readonly";

export type VisitasSite = { total: number; porCarro: Record<string, number> };

export function casarVisitas(porCaminho: Record<string, number>, indice: Record<string, string>): VisitasSite {
  const norm = (p: string) => "/" + p.replace(/^https?:\/\/[^/]+/, "").replace(/^\/+|\/+$/g, "") + "/";
  const porNorm = new Map<string, number>();
  let total = 0;
  for (const [cam, n] of Object.entries(porCaminho)) {
    total += n;
    const k = norm(cam);
    porNorm.set(k, (porNorm.get(k) ?? 0) + n);
  }
  const porCarro: Record<string, number> = {};
  for (const [id, cam] of Object.entries(indice)) {
    const n = porNorm.get(norm(cam));
    if (n) porCarro[id] = n;
  }
  return { total, porCarro };
}

export async function visitasDoSite(propriedade: string, dias = 30, siteUrl = "https://iboxprime.com.br"): Promise<VisitasSite> {
  const token = await tokenGoogle(ESCOPO);
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propriedade)}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: [{ startDate: `${dias}daysAgo`, endDate: "today" }],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      limit: 5000,
    }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`GA4 ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = (await r.json()) as { rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[] };
  const porCaminho: Record<string, number> = {};
  for (const row of d.rows ?? []) porCaminho[row.dimensionValues[0].value] = Number(row.metricValues[0].value) || 0;
  let indice: Record<string, string> = {};
  try {
    const ir = await fetch(`${siteUrl}/vehicles-index.json`, { cache: "no-store" });
    if (ir.ok) {
      const j = (await ir.json()) as { byId?: Record<string, string> } | Record<string, string>;
      indice = ("byId" in j && j.byId && typeof j.byId === "object" ? j.byId : j) as Record<string, string>;
    }
  } catch {
    /* sem índice: só o total */
  }
  return casarVisitas(porCaminho, indice);
}

// ---- Resumo do site num período (o mesmo que o painel do admin mostrava) ----

type Linha = { dimensionValues?: { value: string }[]; metricValues: { value: string }[] };

async function relatorio(propriedade: string, corpo: Record<string, unknown>): Promise<Linha[]> {
  const token = await tokenGoogle(ESCOPO);
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propriedade)}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`GA4 ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return ((await r.json()) as { rows?: Linha[] }).rows ?? [];
}

export type ResumoSite = {
  sessoes: number;
  usuarios: number;
  cliquesWhatsapp: number;
  carrosVistos: number;
  porOrigem: { origem: string; cliques: number }[] | null; // null = dimensão "source" não criada no GA4
  maisVistos: { nome: string; vistas: number }[] | null; // null = dimensão "vehicle_name" não criada
  canais: { canal: string; sessoes: number }[];
};

/** Visitas, cliques no WhatsApp (com a origem) e carros mais vistos, entre duas datas (AAAA-MM-DD). */
export async function resumoSite(propriedade: string, de: string, ate: string): Promise<ResumoSite> {
  const dateRanges = [{ startDate: de, endDate: ate }];
  const n = (l: Linha, i = 0) => Number(l.metricValues[i]?.value) || 0;
  const [total, eventos, canais, origem, vistos] = await Promise.all([
    relatorio(propriedade, { dateRanges, metrics: [{ name: "sessions" }, { name: "totalUsers" }] }),
    relatorio(propriedade, { dateRanges, dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }], dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: ["click_whatsapp", "view_vehicle"] } } } }),
    relatorio(propriedade, { dateRanges, dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 10 }).catch(() => []),
    relatorio(propriedade, { dateRanges, dimensions: [{ name: "customEvent:source" }], metrics: [{ name: "eventCount" }], dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { value: "click_whatsapp" } } }, orderBys: [{ metric: { metricName: "eventCount" }, desc: true }], limit: 15 }).catch(() => null),
    relatorio(propriedade, { dateRanges, dimensions: [{ name: "customEvent:vehicle_name" }], metrics: [{ name: "eventCount" }], dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { value: "view_vehicle" } } }, orderBys: [{ metric: { metricName: "eventCount" }, desc: true }], limit: 10 }).catch(() => null),
  ]);
  const ev = Object.fromEntries(eventos.map((l) => [l.dimensionValues?.[0]?.value ?? "", n(l)]));
  return {
    sessoes: total[0] ? n(total[0], 0) : 0,
    usuarios: total[0] ? n(total[0], 1) : 0,
    cliquesWhatsapp: ev.click_whatsapp ?? 0,
    carrosVistos: ev.view_vehicle ?? 0,
    porOrigem: origem ? origem.map((l) => ({ origem: l.dimensionValues?.[0]?.value || "(sem origem)", cliques: n(l) })) : null,
    maisVistos: vistos ? vistos.map((l) => ({ nome: l.dimensionValues?.[0]?.value || "(sem nome)", vistas: n(l) })) : null,
    canais: canais.map((l) => ({ canal: l.dimensionValues?.[0]?.value || "(outros)", sessoes: n(l) })),
  };
}
