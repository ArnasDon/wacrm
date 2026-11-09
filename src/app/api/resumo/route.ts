import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/trafego/admin";
import { quemNoPatio } from "@/lib/patio/servidor";
import { situacaoChave } from "@/lib/patio/google";
import { carrosCompletos, campanhasNoPeriodo } from "@/lib/patio/dados";
import { resumoPatio, resumoTrafego } from "@/lib/patio/resumo";
import { avaliar, type Regra, type Item } from "@/lib/patio/regras";

export const dynamic = "force-dynamic";

const DIA = 86_400_000;
const dataISO = (t: number) => new Date(t).toISOString().slice(0, 10);

// GET /api/resumo?de=2026-10-10&ate=2026-11-09 (ou ?dias=30)
// Números da tela Hoje e do Relatório: pátio, tráfego e clientes, já
// recortados pelo papel de quem pede (financeiro só para sócios).
export async function GET(req: Request) {
  const quem = await quemNoPatio();
  if ("erro" in quem) return NextResponse.json({ erro: quem.erro }, { status: quem.status });
  const url = new URL(req.url);
  const agora = Date.now();
  const dias = Math.min(Math.max(Number(url.searchParams.get("dias")) || 30, 1), 366);
  const ateTxt = url.searchParams.get("ate");
  const deTxt = url.searchParams.get("de");
  const ate = ateTxt && Number.isFinite(Date.parse(ateTxt)) ? Date.parse(ateTxt) + DIA - 1 : agora;
  const de = deTxt && Number.isFinite(Date.parse(deTxt)) ? Date.parse(deTxt) : ate - dias * DIA + 1;
  const admin = createAdminClient();

  try {
    const [carros, campanhas] = await Promise.all([
      situacaoChave() === "ok" ? carrosCompletos(quem, admin) : Promise.resolve(null),
      campanhasNoPeriodo(admin, quem.orgId, dataISO(de), dataISO(ate)),
    ]);
    const patio = carros ? resumoPatio(carros, de, ate) : null;
    if (patio && quem.papel !== "socio") {
      patio.capitalParado = 0;
      patio.lucroPeriodo = 0;
      patio.receitaPeriodo = 0;
    }

    // Clientes: o que a pessoa enxerga no CRM (as regras do banco recortam).
    const supabase = await createClient();
    const [esperando, novos] = await Promise.all([
      supabase.from("conversations").select("id", { count: "exact", head: true }).gt("unread_count", 0).neq("status", "closed"),
      supabase.from("contacts").select("id", { count: "exact", head: true }).gte("created_at", new Date(de).toISOString()).lte("created_at", new Date(ate).toISOString()),
    ]);

    // Regras montadas pela loja → alertas em Hoje.
    let alertas: ReturnType<typeof avaliar> = [];
    const { data: regras } = await admin.from("regras").select("id, nome, ativo, gatilho, condicoes, acoes").eq("org_id", quem.orgId).eq("ativo", true);
    if (regras?.length) {
      const IMP = 1.12;
      const itensCarro: Item[] = (carros ?? [])
        .filter((c) => ["available", "reserved", "unavailable"].includes(c.status ?? "available"))
        .map((c) => ({
          id: c.id,
          nome: [c.brand, c.model, c.versao].filter(Boolean).join(" "),
          href: `/patio/${c.id}`,
          valores: {
            ...(c.dias != null ? { dias_no_patio: c.dias } : {}),
            conversas_30d: c.anuncios?.msgs ?? 0,
            gasto_30d: (c.anuncios?.gasto ?? 0) * IMP,
            preco: Number(c.finance?.sale_price) || 0,
            tem_anuncio: c.anuncios?.campanhas.length ? 1 : 0,
          },
        }));
      const itensCampanha: Item[] = campanhas
        .filter((c) => c.gasto > 0 || c.msgs > 0)
        .map((c) => ({
          id: c.id,
          nome: c.nome,
          href: "/trafego/campanhas",
          valores: { gasto: c.gasto * IMP, conversas: c.msgs, ...(c.msgs ? { custo_por_conversa: (c.gasto * IMP) / c.msgs } : {}), carro_vendido: c.carro === "vendido" ? 1 : 0, sem_carro: c.carro === "sem" ? 1 : 0 },
        }));
      const { data: conversas } = await supabase.from("conversations").select("id, last_message_at, contact:contacts(name, phone)").gt("unread_count", 0).neq("status", "closed").limit(200);
      const itensConversa: Item[] = ((conversas ?? []) as unknown as { id: string; last_message_at: string | null; contact: { name: string | null; phone: string } | null }[])
        .filter((c) => c.last_message_at)
        .map((c) => ({ id: c.id, nome: c.contact?.name || c.contact?.phone || "Cliente", href: `/inbox?conversation=${c.id}`, valores: { minutos_sem_resposta: Math.floor((agora - Date.parse(c.last_message_at!)) / 60000) } }));
      alertas = avaliar(regras as Regra[], { carro: itensCarro, campanha: itensCampanha, conversa: itensConversa });
    }

    return NextResponse.json({
      alertas,
      papel: quem.papel,
      periodo: { de: dataISO(de), ate: dataISO(ate) },
      patio,
      trafego: resumoTrafego(campanhas),
      clientes: { esperando: esperando.count ?? 0, novos: novos.count ?? 0 },
      avisos: carros ? [] : ["A chave do Firebase não está pronta: os números do pátio não aparecem."],
    });
  } catch (e) {
    console.error("[resumo]", e);
    return NextResponse.json({ erro: "Não foi possível montar os números agora." }, { status: 502 });
  }
}
