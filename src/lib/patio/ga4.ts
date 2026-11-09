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
