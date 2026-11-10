import { NextResponse } from "next/server";
import { quemNoPatio } from "@/lib/patio/servidor";
import { situacaoChave } from "@/lib/patio/google";
import { listarPublicos, lerPrivados, lerUm, gravarCarro } from "@/lib/patio/firestore";
import { montarCarro, aplicarMudanca, separarParaFirestore, recorte, type Carro } from "@/lib/patio/veiculo";
import { valorVenda } from "@/lib/patio/resumo";
import { sugerirOrigem } from "@/lib/patio/sugestao-origem";
import { createAdminClient } from "@/lib/trafego/admin";
import { fetchAll } from "@/lib/trafego/fetchAll";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET  /api/patio/origens-venda/pendentes — carros vendidos sem origem da
//      venda, cada um com uma sugestão (clientes do carro no CRM / anúncios).
// POST /api/patio/origens-venda/pendentes { itens: [{ id, origem, detalhe }] }
//      — grava a origem em cada venda (só mexe em sale.origem e
//      sale.origem_detalhe; o resto da venda fica como está). Só sócio.

async function socio() {
  const q = await quemNoPatio();
  if ("erro" in q) return NextResponse.json({ erro: q.erro }, { status: q.status });
  if (q.papel !== "socio") return NextResponse.json({ erro: "Só sócio." }, { status: 403 });
  if (situacaoChave() !== "ok") return NextResponse.json({ erro: "A chave do Firebase não está pronta." }, { status: 503 });
  return q;
}

const nomeDo = (c: Carro) => [c.brand, c.model, c.versao, c.year].filter(Boolean).join(" ");
const dataDaVenda = (c: Carro) => String(c.sale?.date || c.finance?.sale_date || "") || null;

export async function GET() {
  const q = await socio();
  if (q instanceof NextResponse) return q;
  try {
    const publicos = await listarPublicos(q.projeto);
    const vendidos = publicos.filter((p) => p.dados.status === "sold");
    const privados = await lerPrivados(q.projeto, vendidos.map((p) => p.id));
    const carros = vendidos.map((p) => montarCarro(p.id, p.dados, privados[p.id] ?? {}, { criadoEm: p.criadoEm, atualizadoEm: p.atualizadoEm }));
    const semOrigem = carros.filter((c) => !String(c.sale?.origem ?? "").trim());
    const ids = semOrigem.map((c) => c.id);

    const admin = createAdminClient();
    const { data: contas } = await admin.from("accounts").select("id").eq("organization_id", q.orgId);
    const idsContas = (contas ?? []).map((c) => c.id as string);
    const [clientes, veic, camps, mets] = await Promise.all([
      idsContas.length && ids.length
        ? fetchAll<{ veiculo_site_id: string; origem: string | null }>((a, b) => admin.from("contacts").select("id, veiculo_site_id, origem").in("account_id", idsContas).in("veiculo_site_id", ids).order("id").range(a, b))
        : Promise.resolve({ data: [], error: null }),
      fetchAll<{ id: string; site_vehicle_id: string | null }>((a, b) => admin.from("veiculos").select("id, site_vehicle_id").eq("org_id", q.orgId).order("id").range(a, b)),
      fetchAll<{ id: string; nome: string; car_id: string | null }>((a, b) => admin.from("tr_campaigns").select("id, nome, car_id").eq("org_id", q.orgId).not("car_id", "is", null).order("id").range(a, b)),
      fetchAll<{ campaign_id: string; gasto: number }>((a, b) => admin.from("tr_campaign_metrics_daily").select("id, campaign_id, gasto").eq("org_id", q.orgId).order("id").range(a, b)),
    ]);

    const origensPorCarro = new Map<string, (string | null)[]>();
    for (const c of clientes.data) origensPorCarro.set(c.veiculo_site_id, [...(origensPorCarro.get(c.veiculo_site_id) ?? []), c.origem]);
    const sitePorVeiculo = new Map(veic.data.filter((v) => v.site_vehicle_id).map((v) => [String(v.id), String(v.site_vehicle_id)]));
    const gastoPorCampanha = new Map<string, number>();
    for (const m of mets.data) gastoPorCampanha.set(m.campaign_id, (gastoPorCampanha.get(m.campaign_id) ?? 0) + (Number(m.gasto) || 0));
    const anuncios = new Map<string, { gasto: number; top: string; topGasto: number }>();
    for (const c of camps.data) {
      const site = sitePorVeiculo.get(String(c.car_id));
      if (!site) continue;
      const g = gastoPorCampanha.get(c.id) ?? 0;
      const a = anuncios.get(site) ?? { gasto: 0, top: "", topGasto: -1 };
      a.gasto += g;
      if (g > a.topGasto) { a.top = c.nome; a.topGasto = g; }
      anuncios.set(site, a);
    }

    const itens = semOrigem
      .map((c) => {
        const a = anuncios.get(c.id);
        const gasto = Math.round((a?.gasto ?? 0) * 100) / 100;
        return {
          id: c.id,
          nome: nomeDo(c) || "Carro sem nome",
          placa: c.plate ?? null,
          foto: c.img ?? null,
          dataVenda: dataDaVenda(c),
          valor: valorVenda(c),
          comprador: String(c.finance?.buyer_name ?? "") || null,
          gastoAnuncios: gasto,
          sugestao: sugerirOrigem({ origensClientes: origensPorCarro.get(c.id) ?? [], gastoAnuncios: gasto, campanhaQueMaisGastou: a?.topGasto && a.topGasto > 0 ? a.top : null }),
        };
      })
      .sort((x, y) => String(y.dataVenda ?? "").localeCompare(String(x.dataVenda ?? "")));
    return NextResponse.json({ itens, vendidos: carros.length, comOrigem: carros.length - semOrigem.length });
  } catch (e) {
    console.error("[origens-venda/pendentes]", e);
    return NextResponse.json({ erro: "Não foi possível montar a lista agora." }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const q = await socio();
  if (q instanceof NextResponse) return q;
  const { itens } = (await req.json().catch(() => ({}))) as { itens?: { id?: string; origem?: string; detalhe?: string }[] };
  if (!Array.isArray(itens) || !itens.length || itens.length > 200) return NextResponse.json({ erro: "lista inválida" }, { status: 400 });
  const admin = createAdminClient();
  const salvos: string[] = [];
  const falhas: { id: string; erro: string }[] = [];
  for (const it of itens) {
    const id = String(it.id ?? "");
    const origem = String(it.origem ?? "").trim().slice(0, 80);
    const detalhe = String(it.detalhe ?? "").trim().slice(0, 160);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !origem) { falhas.push({ id, erro: "dados inválidos" }); continue; }
    try {
      const lido = await lerUm(q.projeto, id);
      if (!lido) { falhas.push({ id, erro: "carro não encontrado" }); continue; }
      const atual = montarCarro(id, lido.publico.dados, lido.privado, { criadoEm: lido.publico.criadoEm, atualizadoEm: lido.publico.atualizadoEm });
      if (atual.status !== "sold") { falhas.push({ id, erro: "o carro não está vendido" }); continue; }
      const r = aplicarMudanca(atual, { sale: { ...(atual.sale ?? {}), origem, origem_detalhe: detalhe } }, q.papel);
      if ("erro" in r) { falhas.push({ id, erro: r.erro }); continue; }
      if (!r.campos.length) { salvos.push(id); continue; }
      const { publico, privado } = separarParaFirestore(r.carro);
      await gravarCarro(q.projeto, id, publico, privado);
      await admin.from("patio_historico").insert({
        org_id: q.orgId, veiculo_site_id: id, user_id: q.userId, quem: q.nome, acao: "origem da venda",
        campos: r.campos, antes: recorte(atual, r.campos), depois: recorte(r.carro, r.campos),
      });
      salvos.push(id);
    } catch (e) {
      falhas.push({ id, erro: (e instanceof Error ? e.message : String(e)).slice(0, 120) });
    }
  }
  return NextResponse.json({ ok: falhas.length === 0, salvos, falhas });
}
