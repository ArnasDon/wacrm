import { NextResponse } from "next/server";
import { quemNoPatio } from "@/lib/patio/servidor";
import { createAdminClient } from "@/lib/trafego/admin";
import { tokensMetaDasLojas } from "@/lib/trafego/servidor";
import { graphTodasPaginas, insightsDeTodas, syncMeta } from "@/lib/trafego/meta-sync";
import { fetchAll } from "@/lib/trafego/fetchAll";
import { conferir, sobrasDoMes, type LinhaBanco } from "@/lib/trafego/conferencia";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET  /api/trafego/conferir           → compara o painel com o Facebook (período máximo)
// POST /api/trafego/conferir {mes}     → busca aquele mês de novo no Facebook e apaga
//                                        o que o Facebook não tem (dia/campanha que sobrou)
// Só sócio.

type Acao = { action_type?: string; value?: string };
const msgsDe = (acoes: Acao[] | undefined) => Number(acoes?.find((a) => a.action_type === "onsite_conversion.messaging_conversation_started_7d")?.value) || 0;
const hojeBahia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(new Date());

async function contexto() {
  const quem = await quemNoPatio();
  if ("erro" in quem) return { erro: NextResponse.json({ erro: quem.erro }, { status: quem.status }) };
  if (quem.papel !== "socio") return { erro: NextResponse.json({ erro: "Só sócio confere com o Facebook." }, { status: 403 }) };
  const admin = createAdminClient();
  const token = (await tokensMetaDasLojas(admin, [quem.orgId]).catch(() => ({}) as Record<string, string>))[quem.orgId] || process.env.META_ACCESS_TOKEN;
  if (!token) return { erro: NextResponse.json({ erro: "Falta o token do Meta em Conexões." }, { status: 400 }) };
  const { data: cred } = await admin.from("tr_integration_credentials").select("referencia_externa").eq("org_id", quem.orgId).eq("provedor", "facebook").eq("ativo", true).maybeSingle();
  if (!cred?.referencia_externa) return { erro: NextResponse.json({ erro: "Falta a conta de anúncios em Conexões." }, { status: 400 }) };
  const ref = String(cred.referencia_externa);
  return { orgId: quem.orgId, admin, token, act: ref.startsWith("act_") ? ref : `act_${ref}` };
}

async function mapaCampanhas(admin: ReturnType<typeof createAdminClient>, orgId: string) {
  const { data, error } = await fetchAll<{ id: string; external_campaign_id: string | null; nome: string }>((a, b) =>
    admin.from("tr_campaigns").select("id, external_campaign_id, nome").eq("org_id", orgId).order("id").range(a, b));
  if (error) throw new Error("campanhas do painel não carregaram");
  return new Map(data.map((c) => [String(c.id), c]));
}

export async function GET() {
  const c = await contexto();
  if ("erro" in c) return c.erro;
  const { orgId, admin, token, act } = c;
  try {
    const [dias, porCampanha, lista, campanhas, metricas] = await Promise.all([
      graphTodasPaginas(`${act}/insights`, { level: "account", date_preset: "maximum", time_increment: "1", fields: "spend", limit: "500" }, token),
      insightsDeTodas(`${act}/insights`, { level: "campaign", date_preset: "maximum", fields: "campaign_id,campaign_name,spend,impressions,clicks,actions", limit: "500" }, token),
      graphTodasPaginas(`${act}/campaigns`, { fields: "id,name,effective_status", limit: "500", effective_status: JSON.stringify(["ACTIVE", "PAUSED", "ARCHIVED", "IN_PROCESS", "WITH_ISSUES"]) }, token).catch(() => []),
      mapaCampanhas(admin, orgId),
      fetchAll<{ campaign_id: string; data: string; gasto: number; impressions: number; clicks: number; msgs: number }>((a, b) =>
        admin.from("tr_campaign_metrics_daily").select("campaign_id, data, gasto, impressions, clicks, msgs").eq("org_id", orgId).order("id").range(a, b)),
    ]);
    if (metricas.error) throw new Error("métricas do painel não carregaram");
    const status = new Map(lista.map((x) => [String(x.id), String(x.effective_status || "")]));
    const banco: LinhaBanco[] = metricas.data.map((l) => {
      const camp = campanhas.get(String(l.campaign_id));
      return { externo: camp?.external_campaign_id ?? null, campanhaId: String(l.campaign_id), nome: camp?.nome ?? "(campanha apagada do painel)", data: l.data, gasto: Number(l.gasto) || 0, impressions: Number(l.impressions) || 0, clicks: Number(l.clicks) || 0, msgs: Number(l.msgs) || 0 };
    });
    const resultado = conferir(
      dias.map((d) => ({ data: String(d.date_start), gasto: Number(d.spend) || 0 })),
      porCampanha.map((x) => ({ id: String(x.campaign_id), nome: String(x.campaign_name || ""), status: status.get(String(x.campaign_id)) || "EXCLUÍDA", gasto: Number(x.spend) || 0, impressions: Number(x.impressions) || 0, clicks: Number(x.clicks) || 0, msgs: msgsDe(x.actions) })),
      banco,
    );
    return NextResponse.json({ ...resultado, conferidoEm: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ erro: (e instanceof Error ? e.message : String(e)).slice(0, 300) }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const c = await contexto();
  if ("erro" in c) return c.erro;
  const { orgId, admin, token, act } = c;
  const { mes } = (await req.json().catch(() => ({}))) as { mes?: string };
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return NextResponse.json({ erro: "mês inválido" }, { status: 400 });
  const [a, m] = mes.split("-").map(Number);
  const desde = `${mes}-01`;
  const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  const hoje = hojeBahia();
  const ate = fim > hoje ? hoje : fim;
  if (desde > ate) return NextResponse.json({ erro: "mês no futuro" }, { status: 400 });
  try {
    // 1) grava de novo o mês inteiro pelo Facebook (inclui excluídas/arquivadas)
    const linhas = await syncMeta(admin, orgId, act, token, "completo", { desde, ate });
    // 2) o que o Facebook tem nesse mês, campanha × dia
    const meta = await insightsDeTodas(`${act}/insights`, { level: "campaign", time_increment: "1", time_range: JSON.stringify({ since: desde, until: ate }), fields: "campaign_id,spend", limit: "500" }, token);
    const chaves = new Set(meta.map((l) => `${l.campaign_id}|${l.date_start}`));
    // 3) apaga do painel o que sobrou (dia/campanha que o Facebook não tem)
    const campanhas = await mapaCampanhas(admin, orgId);
    const { data: doMes, error } = await fetchAll<{ id: string; campaign_id: string; data: string }>((x, y) =>
      admin.from("tr_campaign_metrics_daily").select("id, campaign_id, data").eq("org_id", orgId).gte("data", desde).lte("data", ate).order("id").range(x, y));
    if (error) throw new Error("métricas do mês não carregaram");
    const sobras = sobrasDoMes(doMes.map((l) => ({ id: String(l.id), externo: campanhas.get(String(l.campaign_id))?.external_campaign_id ?? null, data: l.data })), chaves);
    for (let i = 0; i < sobras.length; i += 200) {
      const { error: e2 } = await admin.from("tr_campaign_metrics_daily").delete().eq("org_id", orgId).in("id", sobras.slice(i, i + 200));
      if (e2) throw new Error(`não consegui apagar as sobras: ${e2.message}`);
    }
    return NextResponse.json({ ok: true, gravadas: linhas, apagadas: sobras.length });
  } catch (e) {
    return NextResponse.json({ erro: (e instanceof Error ? e.message : String(e)).slice(0, 300) }, { status: 502 });
  }
}
