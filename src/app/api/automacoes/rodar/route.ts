import { NextResponse } from "next/server";
import { quemNoPatio } from "@/lib/patio/servidor";
import { createAdminClient } from "@/lib/trafego/admin";
import { rodarAutomacoes } from "@/lib/patio/automacoes-servidor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/automacoes/rodar { id } — botão "Disparar agora" (sócio ou marketing).
// O agendador roda todas pelo /api/trafego/sync.
export async function POST(req: Request) {
  const quem = await quemNoPatio();
  if ("erro" in quem) return NextResponse.json({ erro: quem.erro }, { status: quem.status });
  if (quem.papel === "vendedor") return NextResponse.json({ erro: "Só sócios e marketing disparam automações." }, { status: 403 });
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ erro: "pedido inválido" }, { status: 400 });
  const admin = createAdminClient();
  const { error } = await admin.from("tr_automations").update({ run_requested: true, run_requested_at: new Date().toISOString() }).eq("id", id).eq("org_id", quem.orgId);
  if (error) return NextResponse.json({ erro: "Automação não encontrada." }, { status: 404 });
  const r = await rodarAutomacoes(admin, { so: { orgId: quem.orgId, id } });
  if (!r.length) return NextResponse.json({ erro: "Nada foi disparado (automação não encontrada ou do tipo sistema)." }, { status: 400 });
  return NextResponse.json({ ok: r[0].status === "success", resultado: r[0] });
}
