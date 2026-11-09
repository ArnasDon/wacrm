import type { SupabaseClient } from "@supabase/supabase-js";

// Liga sozinho o cliente novo ao carro e ao anúncio de onde ele veio:
//   1. anúncio de clique para WhatsApp → id do anúncio → campanha → carro;
//   2. link da página do carro no site (na referência do anúncio ou no texto);
//   3. mensagem pronta do botão "Tenho interesse" do site ("…interesse no
//      BYD Song Plus GS 2025/2026…").
// Nunca troca um carro que alguém já escolheu à mão.

export type ReferenciaAnuncio = { adId?: string; sourceUrl?: string; titulo?: string };

/** Procura a referência de anúncio em qualquer formato de provedor (Meta, uazapi, Z-API). */
export function extrairReferenciaDeAnuncio(bruto: unknown): ReferenciaAnuncio | null {
  let achado: ReferenciaAnuncio | null = null;
  const visitar = (o: unknown, prof: number) => {
    if (achado || !o || typeof o !== "object" || prof > 7) return;
    const r = o as Record<string, unknown>;
    const ref = (r.referral ?? r.externalAdReply ?? r.adReply ?? r.ctwaContext) as Record<string, unknown> | undefined;
    if (ref && typeof ref === "object") {
      const adId = String(ref.source_id ?? ref.sourceId ?? ref.sourceID ?? ref.adId ?? "").trim();
      const sourceUrl = String(ref.source_url ?? ref.sourceUrl ?? ref.sourceURL ?? "").trim();
      const titulo = String(ref.headline ?? ref.title ?? "").trim();
      if (adId || sourceUrl || titulo) {
        achado = { ...(adId ? { adId } : {}), ...(sourceUrl ? { sourceUrl } : {}), ...(titulo ? { titulo } : {}) };
        return;
      }
    }
    for (const v of Object.values(r)) visitar(v, prof + 1);
  };
  visitar(bruto, 0);
  return achado;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9/]+/g, " ").trim();

/** Acha o carro pelo nome na mensagem pronta do site. Escolhe o nome mais longo que bate. */
export function carroPeloTexto(texto: string, carros: { id: string; nome: string }[]): string | null {
  const m = texto.match(/interesse n[oa]s?\s+(.+?)(?:\.|$)/i);
  if (!m) return null;
  const alvo = " " + norm(m[1]) + " ";
  let melhor: { id: string; n: number } | null = null;
  for (const c of carros) {
    const n = norm(c.nome);
    if (n.length >= 4 && alvo.includes(" " + n + " ") && (!melhor || n.length > melhor.n)) melhor = { id: c.id, n: n.length };
  }
  return melhor?.id ?? null;
}

/** Acha o carro pelo link da página dele no site. */
export function carroPeloLink(texto: string, indice: Record<string, string>): string | null {
  const porId = texto.match(/[?&]id=([A-Za-z0-9_-]{6,64})/);
  if (porId) return porId[1];
  const m = texto.match(/iboxprime\.com\.br(\/[^\s?#]*)/i);
  if (!m) return null;
  const caminho = m[1].replace(/\/+$/, "") + "/";
  for (const [id, cam] of Object.entries(indice)) if (cam.replace(/\/+$/, "") + "/" === caminho) return id;
  return null;
}

/** Faz a ligação no banco. Silencioso: qualquer falha só fica no log. */
export async function ligarClienteAoCarro(
  admin: SupabaseClient,
  p: { accountId: string; contactId: string; texto: string | null; referencia: ReferenciaAnuncio | null; tokenMeta?: (orgId: string) => Promise<string | null> },
): Promise<void> {
  try {
    const { data: contato } = await admin.from("contacts").select("veiculo_site_id, origem").eq("id", p.contactId).maybeSingle();
    if (!contato || contato.veiculo_site_id) return;
    const { data: conta } = await admin.from("accounts").select("organization_id").eq("id", p.accountId).maybeSingle();
    const orgId = conta?.organization_id as string | undefined;
    if (!orgId) return;

    let carro: string | null = null;
    let origem: string | null = null;
    let campanhaId: string | null = null;

    // 1. Anúncio do Meta
    if (p.referencia?.adId && p.tokenMeta) {
      const token = await p.tokenMeta(orgId);
      if (token) {
        const r = await fetch(`https://graph.facebook.com/v23.0/${encodeURIComponent(p.referencia.adId)}?fields=campaign_id&access_token=${encodeURIComponent(token)}`, { cache: "no-store" });
        const j = (await r.json().catch(() => ({}))) as { campaign_id?: string };
        if (j.campaign_id) {
          const { data: camp } = await admin.from("tr_campaigns").select("id, car_id").eq("org_id", orgId).eq("external_campaign_id", j.campaign_id).maybeSingle();
          if (camp) {
            campanhaId = camp.id as string;
            origem = "Anúncio (Meta)";
            if (camp.car_id) {
              const { data: v } = await admin.from("veiculos").select("site_vehicle_id").eq("id", camp.car_id).maybeSingle();
              carro = (v?.site_vehicle_id as string) ?? null;
            }
          }
        }
      }
    }
    if (p.referencia && !origem) origem = "Anúncio (Meta)";

    // 2 e 3. Link ou mensagem pronta do site
    const texto = [p.referencia?.sourceUrl, p.texto].filter(Boolean).join(" ");
    if (!carro && texto) {
      if (/iboxprime\.com\.br|[?&]id=/i.test(texto)) {
        let indice: Record<string, string> = {};
        try {
          const r = await fetch("https://iboxprime.com.br/vehicles-index.json", { cache: "no-store" });
          const j = (await r.json()) as { byId?: Record<string, string> };
          indice = j.byId ?? {};
        } catch { /* sem índice */ }
        carro = carroPeloLink(texto, indice);
        if (carro && !origem) origem = "Site";
      }
      if (!carro && /interesse/i.test(texto)) {
        const { data: vs } = await admin.from("veiculos").select("site_vehicle_id, nome_site, modelo_site").eq("org_id", orgId).not("site_vehicle_id", "is", null);
        const lista = ((vs ?? []) as { site_vehicle_id: string; nome_site: string | null }[]).filter((v) => v.nome_site).map((v) => ({ id: v.site_vehicle_id, nome: v.nome_site! }));
        carro = carroPeloTexto(texto, lista);
        if (carro && !origem) origem = "Site";
      }
    }

    if (!carro && !origem) return;
    const mudar: Record<string, unknown> = {};
    if (carro) mudar.veiculo_site_id = carro;
    if (origem && !contato.origem) mudar.origem = origem;
    if (campanhaId) mudar.origem_campanha_id = campanhaId;
    if (Object.keys(mudar).length) await admin.from("contacts").update(mudar).eq("id", p.contactId);
  } catch (e) {
    console.error("[origem-cliente]", e);
  }
}
