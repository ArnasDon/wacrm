import { quemNoPatio } from "@/lib/patio/servidor";
import { situacaoChave } from "@/lib/patio/google";
import { listarPublicos, lerPrivados } from "@/lib/patio/firestore";
import { montarCarro } from "@/lib/patio/veiculo";
import { custoTotal, valorVenda } from "@/lib/patio/resumo";
import { createAdminClient } from "@/lib/trafego/admin";
import { fetchAll } from "@/lib/trafego/fetchAll";
import { carregarGastoPorCarro } from "@/lib/trafego/gasto-carro";
import { montarRelatorio, type CarroRel, type VeiculoRel } from "@/lib/trafego/relatorio-anuncios";
import { planilhaRelatorio } from "@/lib/trafego/relatorio-anuncios-xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/trafego/relatorio?de=AAAA-MM-DD&ate=AAAA-MM-DD — planilha (.xlsx)
// com resumo, por carro, por campanha, divisões, sem vínculo e dia a dia.
// Sem datas = desde o início. Custo e lucro dos carros só para sócio.
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const erro = (msg: string, status: number) => new Response(JSON.stringify({ erro: msg }), { status, headers: { "Content-Type": "application/json" } });

export async function GET(req: Request) {
  const q = await quemNoPatio();
  if ("erro" in q) return erro(q.erro, q.status);
  if (q.papel === "vendedor") return erro("Só sócios e marketing.", 403);
  const u = new URL(req.url);
  const de = u.searchParams.get("de") || "";
  const ate = u.searchParams.get("ate") || "";
  if ((de && !DATA.test(de)) || (ate && !DATA.test(ate)) || (de && ate && de > ate)) return erro("período inválido", 400);
  const socio = q.papel === "socio";
  const admin = createAdminClient();
  try {
    const [g, veic, dest, pub] = await Promise.all([
      carregarGastoPorCarro(admin, q.orgId, { desde: de || undefined, ate: ate || undefined }),
      fetchAll<VeiculoRel>((a, b) => admin.from("veiculos").select("id, modelo, placa, site_vehicle_id").eq("org_id", q.orgId).order("id").range(a, b)),
      admin.from("tr_link_destinos").select("id, nome").eq("org_id", q.orgId),
      situacaoChave() === "ok" ? listarPublicos(q.projeto) : Promise.resolve([]),
    ]);
    const priv = socio && pub.length ? await lerPrivados(q.projeto, pub.map((p) => p.id)) : {};
    const s = (v: unknown) => (v == null ? "" : String(v)).trim();
    const patio: CarroRel[] = pub.map((p) => {
      const c = montarCarro(p.id, p.dados, priv[p.id] ?? {}, { criadoEm: p.criadoEm, atualizadoEm: p.atualizadoEm });
      const custo = socio ? custoTotal(c) : 0;
      return {
        id: p.id,
        nome: [s(c.brand), s(c.model), s(c.versao), s(c.year)].filter(Boolean).join(" ") || "Carro sem nome",
        placa: s(c.plate) || null, status: s(c.status), preco: Number(c.finance?.sale_price) || null,
        custo: socio && custo > 0 ? custo : null,
        venda: socio && c.status === "sold" ? valorVenda(c) || null : null,
      };
    });
    const r = montarRelatorio({
      campanhas: g.campanhas, metricas: g.metricas, linhasCarro: g.linhas, divisoes: g.divisoes, patio, veiculos: veic.data,
      destinos: Object.fromEntries(((dest.data ?? []) as { id: string; nome: string }[]).map((d) => [d.id, d.nome])),
    });
    const fmt = (d: string) => d.split("-").reverse().join("/");
    const periodo = de || ate ? `${de ? fmt(de) : "início"} a ${ate ? fmt(ate) : "hoje"}` : "desde o início";
    const agora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", dateStyle: "short", timeStyle: "short" }).format(new Date());
    const arquivo = await planilhaRelatorio(r, { periodo, socio, geradoEm: agora });
    const nome = `relatorio-anuncios-ibox-${de || "inicio"}-a-${ate || new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bahia" }).format(new Date())}.xlsx`;
    return new Response(new Uint8Array(arquivo), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nome}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[trafego/relatorio]", e);
    return erro("Não foi possível gerar o relatório agora.", 502);
  }
}
