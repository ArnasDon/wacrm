import { SupabaseClient } from "@supabase/supabase-js";
import { tipoDeCampanha } from "@/lib/trafego/windsor-sync";

// Sync direto com a API oficial do Meta (Marketing API / Graph API) — sem
// Windsor.ai no meio. Motivo (08/10/2026): no plano grátis o Windsor só
// atualiza os dados uma vez por dia (e chegou a travar: o dia 07/10 ficou
// com centavos de gasto e o 08/10 nem aparecia), então o painel nunca era
// "tempo real". A API do Meta é grátis, devolve o dado com poucos minutos
// de atraso e lista TODAS as campanhas da conta (inclusive pausadas e sem
// gasto no período), espelhando o Gerenciador de Anúncios.
//
// Precisa de META_ACCESS_TOKEN (variável de ambiente na Vercel): token de um
// usuário do sistema do Gerenciador de Negócios com permissão ads_read na
// conta de anúncios. Se não estiver configurado, lib/windsor-sync.ts cai de
// volta no Windsor, como antes.
//
// Grava nas MESMAS tabelas de antes (campaigns, campaign_metrics_daily,
// campaign_metrics_hourly), então nenhuma tela precisa mudar.

const GRAPH = "https://graph.facebook.com/v23.0";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any>;
type Acao = { action_type?: string; value?: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Linha = Record<string, any>;

export type ModoSync = "rapido" | "completo";

// Janelas de busca. O "rápido" roda a cada 15 min (e quando alguém abre o
// painel): só os últimos dias, que são os que mudam. O "completo" roda uma
// vez por dia e reescreve 30 dias, pra pegar ajustes tardios do Meta
// (conversões atribuídas depois, por exemplo).
const JANELAS: Record<ModoSync, { dias: number; diasHora: number }> = {
  rapido: { dias: 3, diasHora: 2 },
  completo: { dias: 30, diasHora: 10 },
};

async function graphTodasPaginas(caminho: string, params: Record<string, string>, token: string): Promise<Linha[]> {
  const url = new URL(`${GRAPH}/${caminho}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);

  const linhas: Linha[] = [];
  let proxima: string | null = url.toString();
  for (let paginas = 0; proxima && paginas < 50; paginas++) {
    const res: Response = await fetch(proxima, { cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.error) {
      const msg = json?.error?.message || `HTTP ${res.status}`;
      // 190 = token inválido/expirado — mensagem clara pra aparecer no painel.
      if (json?.error?.code === 190) throw new Error(`Token do Meta inválido ou expirado — gere um novo e salve em Tráfego → Conexões. (${msg})`);
      throw new Error(`Meta API: ${msg}`);
    }
    linhas.push(...(json.data ?? []));
    proxima = json.paging?.next ?? null;
  }
  return linhas;
}

function somaAcao(acoes: Acao[] | undefined, ...tipos: string[]): number {
  if (!Array.isArray(acoes)) return 0;
  for (const tipo of tipos) {
    const a = acoes.find((x) => x.action_type === tipo);
    if (a) return Number(a.value) || 0;
  }
  return 0;
}

// Mesmos campos de resultado que o sync do Windsor usava:
// actions_onsite_conversion_messaging_conversation_started_7d, actions_lead,
// actions_purchase e os vídeos 25/50/75/100%.
function resultados(l: Linha) {
  return {
    msgs: somaAcao(l.actions, "onsite_conversion.messaging_conversation_started_7d"),
    leads: somaAcao(l.actions, "lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"),
    purchases: somaAcao(l.actions, "purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"),
    v25: somaAcao(l.video_p25_watched_actions, "video_view"),
    v50: somaAcao(l.video_p50_watched_actions, "video_view"),
    v75: somaAcao(l.video_p75_watched_actions, "video_view"),
    v100: somaAcao(l.video_p100_watched_actions, "video_view"),
  };
}

function horaDoBucket(bucket: unknown): number | null {
  const m = String(bucket ?? "").match(/^(\d{1,2}):/);
  if (!m) return null;
  const h = Number(m[1]);
  return h >= 0 && h <= 23 ? h : null;
}

// Status igual ao da coluna "Veiculação" do Gerenciador: ACTIVE / PAUSED
// (o painel já trata esses dois); arquivada/excluída/com problema passam
// como vêm.
function statusDe(c: Linha): string {
  const s = String(c.effective_status || c.status || "");
  if (s === "CAMPAIGN_PAUSED") return "PAUSED";
  return s;
}

async function upsertEmLotes(supabase: Supa, tabela: string, linhas: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabase.from(tabela).upsert(linhas.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${tabela}: ${error.message}`);
  }
}

export async function syncMeta(
  supabase: Supa,
  accountId: string,
  adAccountId: string,
  token: string,
  modo: ModoSync = "rapido",
  // Busca de histórico: um intervalo fixo (AAAA-MM-DD), só métricas por dia.
  intervalo?: { desde: string; ate: string },
): Promise<number> {
  const act = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const { dias, diasHora } = JANELAS[modo];
  // "Hoje" no fuso da conta de anúncios (Bahia), não no UTC do servidor —
  // depois das 21h daqui o UTC já está em "amanhã", e o Meta recusa data futura.
  const hojeBahia = (deltaDias: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(new Date(Date.now() + deltaDias * 24 * 3600e3));
  const ate = intervalo?.ate ?? hojeBahia(0);
  const desde = intervalo?.desde ?? hojeBahia(-dias);
  const desdeHora = hojeBahia(-diasHora);

  // 1) TODAS as campanhas da conta (inclusive pausadas e sem gasto) — é isso
  //    que faz o painel espelhar o Gerenciador de Anúncios.
  // 2) Métricas por campanha por dia.
  // 3) Métricas por campanha por hora (gráfico de horário de pico).
  const camposMetricas = "campaign_id,campaign_name,spend,impressions,clicks,actions";
  const [campanhas, diarias, horarias] = await Promise.all([
    graphTodasPaginas(`${act}/campaigns`, {
      fields: "id,name,objective,status,effective_status,created_time",
      limit: "500",
    }, token),
    graphTodasPaginas(`${act}/insights`, {
      level: "campaign",
      time_increment: "1",
      time_range: JSON.stringify({ since: desde, until: ate }),
      fields: `${camposMetricas},video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions`,
      limit: "500",
    }, token),
    intervalo ? Promise.resolve([] as Linha[]) : graphTodasPaginas(`${act}/insights`, {
      level: "campaign",
      time_increment: "1",
      breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone",
      time_range: JSON.stringify({ since: desdeHora, until: ate }),
      fields: camposMetricas,
      limit: "500",
    }, token).catch((e) => {
      // Horário de pico é complemento: se falhar, não derruba o resto.
      console.error("Meta: falha nas métricas por hora:", e);
      return [] as Linha[];
    }),
  ]);

  // --- campanhas: cria/atualiza nome, objetivo e status. Campos que a equipe
  // preenche no painel (carro, vendedor, projeto, destino) não são tocados.
  const porId = new Map<string, Linha>();
  for (const c of campanhas) porId.set(String(c.id), c);
  // Campanha que tem métrica mas não veio na lista (arquivada/excluída) também entra.
  for (const l of diarias) if (!porId.has(String(l.campaign_id))) porId.set(String(l.campaign_id), { id: l.campaign_id, name: l.campaign_name, status: "ARCHIVED" });

  await upsertEmLotes(
    supabase,
    "tr_campaigns",
    Array.from(porId.values()).map((c) => ({
      org_id: accountId,
      external_campaign_id: String(c.id),
      nome: String(c.name || `Campanha ${c.id}`),
      objetivo: c.objective ?? null,
      status: statusDe(c),
    })),
    "org_id,external_campaign_id"
  );

  // id do Meta -> id interno
  const { data: mapa, error: erroMapa } = await supabase
    .from("tr_campaigns")
    .select("id, external_campaign_id")
    .eq("org_id", accountId)
    .not("external_campaign_id", "is", null)
    .range(0, 9999);
  if (erroMapa) throw new Error(erroMapa.message);
  const interno = new Map<string, string>((mapa ?? []).map((r) => [String(r.external_campaign_id), String(r.id)]));

  // --- métricas diárias
  const agora = new Date().toISOString();
  const totais = new Map<string, { msgs: number; leads: number; purchases: number; impressions: number }>();
  const linhasDia: Record<string, unknown>[] = [];
  for (const l of diarias) {
    const cid = interno.get(String(l.campaign_id));
    if (!cid || !l.date_start) continue;
    const r = resultados(l);
    const t = totais.get(cid) ?? { msgs: 0, leads: 0, purchases: 0, impressions: 0 };
    t.msgs += r.msgs; t.leads += r.leads; t.purchases += r.purchases; t.impressions += Number(l.impressions) || 0;
    totais.set(cid, t);
    linhasDia.push({
      org_id: accountId,
      campaign_id: cid,
      data: l.date_start,
      gasto: Number(l.spend) || 0,
      impressions: Number(l.impressions) || 0,
      clicks: Number(l.clicks) || 0,
      ...r,
      atualizado_em: agora,
    });
  }
  await upsertEmLotes(supabase, "tr_campaign_metrics_daily", linhasDia, "campaign_id,data");

  // Tipo (WhatsApp / Lead site / Outro) pelas campanhas com resultado no período.
  for (const [cid, t] of totais) {
    await supabase.from("tr_campaigns").update({ tipo: tipoDeCampanha(t.msgs, t.leads, t.purchases, t.impressions) }).eq("id", cid);
  }

  // --- métricas por hora
  const linhasHora: Record<string, unknown>[] = [];
  const vistas = new Set<string>();
  for (const l of horarias) {
    const cid = interno.get(String(l.campaign_id));
    const hora = horaDoBucket(l.hourly_stats_aggregated_by_advertiser_time_zone);
    if (!cid || hora === null || !l.date_start) continue;
    const chave = `${cid}|${l.date_start}|${hora}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    const r = resultados(l);
    linhasHora.push({
      org_id: accountId,
      campaign_id: cid,
      data: l.date_start,
      hora,
      gasto: Number(l.spend) || 0,
      impressions: Number(l.impressions) || 0,
      clicks: Number(l.clicks) || 0,
      msgs: r.msgs,
      leads: r.leads,
      purchases: r.purchases,
      atualizado_em: agora,
    });
  }
  // Horário de pico é complemento: se a tabela por hora ainda não existir no banco
  // (migration 0009 não aplicada) ou falhar, a sincronização diária, já gravada acima, vale.
  let horasGravadas = 0;
  try {
    await upsertEmLotes(supabase, "tr_campaign_metrics_hourly", linhasHora, "campaign_id,data,hora");
    horasGravadas = linhasHora.length;
  } catch (erroHora) {
    console.error("Sync por hora não gravada (não bloqueia a diária):", erroHora);
  }

  return linhasDia.length + horasGravadas;
}
