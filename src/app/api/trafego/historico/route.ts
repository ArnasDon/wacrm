import { NextResponse } from "next/server";
import { quemNoPatio } from "@/lib/patio/servidor";
import { createAdminClient } from "@/lib/trafego/admin";
import { tokensMetaDasLojas } from "@/lib/trafego/servidor";
import { syncMeta } from "@/lib/trafego/meta-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/trafego/historico { desde, ate } — busca no Meta as métricas por
// dia de um mês (no máximo 31 dias por chamada, para caber no tempo da
// função). A tela chama mês a mês. Grava pelo mesmo id (upsert): repetir só
// atualiza, nunca duplica. Só sócio.
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const quem = await quemNoPatio();
  if ("erro" in quem) return NextResponse.json({ erro: quem.erro }, { status: quem.status });
  if (quem.papel !== "socio") return NextResponse.json({ erro: "Só sócio busca o histórico." }, { status: 403 });
  const { desde, ate } = (await req.json().catch(() => ({}))) as { desde?: string; ate?: string };
  if (!desde || !ate || !DATA.test(desde) || !DATA.test(ate) || desde > ate) return NextResponse.json({ erro: "período inválido" }, { status: 400 });
  if ((Date.parse(ate) - Date.parse(desde)) / 86_400_000 > 31) return NextResponse.json({ erro: "No máximo 31 dias por vez." }, { status: 400 });
  const admin = createAdminClient();
  const token = (await tokensMetaDasLojas(admin, [quem.orgId]).catch(() => ({}) as Record<string, string>))[quem.orgId] || process.env.META_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ erro: "Falta o token do Meta em Conexões." }, { status: 400 });
  const { data: cred } = await admin.from("tr_integration_credentials").select("referencia_externa").eq("org_id", quem.orgId).eq("provedor", "facebook").eq("ativo", true).maybeSingle();
  if (!cred?.referencia_externa) return NextResponse.json({ erro: "Falta a conta de anúncios em Conexões." }, { status: 400 });
  try {
    const linhas = await syncMeta(admin, quem.orgId, String(cred.referencia_externa), token, "completo", { desde, ate });
    return NextResponse.json({ ok: true, linhas });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ erro: msg.slice(0, 300) }, { status: 502 });
  }
}
