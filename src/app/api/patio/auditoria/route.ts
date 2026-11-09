import { NextResponse } from "next/server";
import { quemNoPatio } from "@/lib/patio/servidor";
import { situacaoChave } from "@/lib/patio/google";
import { listarPublicos, lerPrivados } from "@/lib/patio/firestore";
import { montarCarro } from "@/lib/patio/veiculo";
import { montarAuditoria, type CampanhaAud, type VeiculoMkt } from "@/lib/patio/auditoria";
import { createAdminClient } from "@/lib/trafego/admin";
import { fetchAll } from "@/lib/trafego/fetchAll";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET  /api/patio/auditoria — cada carro do Pátio com o carro do Marketing,
//      as campanhas e o gasto desde o início; órfãos e sugestões.
// POST /api/patio/auditoria { veiculoId, carroId } — liga o carro do
//      Marketing ao carro do Pátio sem perder nada:
//      - se o carro do Pátio ainda não tem par no Marketing: só liga;
//      - se já tem: as campanhas do carro escolhido passam para o par que já
//        existe (o gasto vai junto) e o escolhido fica sem campanhas.
// Sócio e marketing.

async function quem() {
  const q = await quemNoPatio();
  if ("erro" in q) return NextResponse.json({ erro: q.erro }, { status: q.status });
  if (q.papel === "vendedor") return NextResponse.json({ erro: "Só sócios e marketing." }, { status: 403 });
  if (situacaoChave() !== "ok") return NextResponse.json({ erro: "A chave do Firebase não está pronta." }, { status: 503 });
  return q;
}

export async function GET() {
  const q = await quem();
  if (q instanceof NextResponse) return q;
  const admin = createAdminClient();
  try {
    const publicos = await listarPublicos(q.projeto);
    const privados = q.papel === "socio" ? await lerPrivados(q.projeto, publicos.map((p) => p.id)) : {};
    const patio = publicos.map((p) => montarCarro(p.id, p.dados, privados[p.id] ?? {}, { criadoEm: p.criadoEm, atualizadoEm: p.atualizadoEm }));
    const [{ data: veic }, { data: camps }, { data: mets }] = await Promise.all([
      fetchAll((a, b) => admin.from("veiculos").select("id, placa, modelo, ano, status, origem, site_vehicle_id").eq("org_id", q.orgId).order("id").range(a, b)),
      fetchAll((a, b) => admin.from("tr_campaigns").select("id, nome, status, car_id, categoria_objetivo, destino_id").eq("org_id", q.orgId).order("id").range(a, b)),
      fetchAll((a, b) => admin.from("tr_campaign_metrics_daily").select("id, campaign_id, gasto, msgs").eq("org_id", q.orgId).order("id").range(a, b)),
    ]);
    const soma = new Map<string, { gasto: number; msgs: number }>();
    for (const m of mets as { campaign_id: string; gasto: number | string; msgs: number }[]) {
      const s = soma.get(m.campaign_id) ?? { gasto: 0, msgs: 0 };
      s.gasto += Number(m.gasto) || 0; s.msgs += Number(m.msgs) || 0;
      soma.set(m.campaign_id, s);
    }
    const campanhas: CampanhaAud[] = (camps as Omit<CampanhaAud, "gasto" | "msgs">[]).map((c) => ({ ...c, gasto: soma.get(c.id)?.gasto ?? 0, msgs: soma.get(c.id)?.msgs ?? 0 }));
    return NextResponse.json({ papel: q.papel, ...montarAuditoria(patio, veic as VeiculoMkt[], campanhas, q.papel === "socio") });
  } catch (e) {
    console.error("[patio/auditoria]", e);
    return NextResponse.json({ erro: "Não foi possível montar a auditoria agora." }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const q = await quem();
  if (q instanceof NextResponse) return q;
  const { veiculoId, carroId } = (await req.json().catch(() => ({}))) as { veiculoId?: string; carroId?: string };
  if (!veiculoId || !carroId || !/^[0-9a-f-]{36}$/i.test(veiculoId) || !/^[A-Za-z0-9_-]{1,64}$/.test(carroId)) return NextResponse.json({ erro: "pedido inválido" }, { status: 400 });
  const admin = createAdminClient();
  const { data: escolhido } = await admin.from("veiculos").select("id, site_vehicle_id").eq("org_id", q.orgId).eq("id", veiculoId).maybeSingle();
  if (!escolhido) return NextResponse.json({ erro: "Carro do Marketing não encontrado." }, { status: 404 });
  const { data: par } = await admin.from("veiculos").select("id").eq("org_id", q.orgId).eq("site_vehicle_id", carroId).maybeSingle();

  if (!par || par.id === veiculoId) {
    const { error } = await admin.from("veiculos").update({ site_vehicle_id: carroId }).eq("id", veiculoId);
    if (error) return NextResponse.json({ erro: "Não foi possível ligar." }, { status: 502 });
    return NextResponse.json({ ok: true, como: "ligado" });
  }
  // O carro do Pátio já tem par: as campanhas vêm para ele.
  const { data: movidas, error } = await admin.from("tr_campaigns").update({ car_id: par.id }).eq("org_id", q.orgId).eq("car_id", veiculoId).select("id");
  if (error) return NextResponse.json({ erro: "Não foi possível mover as campanhas." }, { status: 502 });
  await admin.from("patio_historico").insert({ org_id: q.orgId, veiculo_site_id: carroId, user_id: q.userId, quem: q.nome, acao: `juntou ${movidas?.length ?? 0} campanha(s) de outro cadastro do Marketing`, campos: [], antes: { veiculo: veiculoId }, depois: { veiculo: par.id } });
  return NextResponse.json({ ok: true, como: "campanhas movidas", campanhas: movidas?.length ?? 0 });
}
