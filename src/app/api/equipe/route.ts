import { NextResponse } from "next/server";
import { quemNoPatio } from "@/lib/patio/servidor";
import { createAdminClient } from "@/lib/trafego/admin";

export const dynamic = "force-dynamic";

// Equipe da loja e o papel de cada um (sócio, marketing, vendedor).
// Sem papel escolhido, vale a regra do banco (migration 052): dono/admin da
// conta principal = sócio; os demais = vendedor.
type Pessoa = { user_id: string; nome: string; email: string; papel: "socio" | "marketing" | "vendedor"; escolhido: boolean; conta: string };
const PAPEIS = ["socio", "marketing", "vendedor"] as const;

async function montar(orgId: string): Promise<Pessoa[]> {
  const admin = createAdminClient();
  const { data: org } = await admin.from("organizations").select("owner_account_id").eq("id", orgId).maybeSingle();
  const { data: contas } = await admin.from("accounts").select("id, name").eq("organization_id", orgId);
  const nomeConta = new Map(((contas ?? []) as { id: string; name: string | null }[]).map((c) => [c.id, c.name ?? ""]));
  if (org?.owner_account_id) nomeConta.set(org.owner_account_id as string, nomeConta.get(org.owner_account_id as string) ?? "");
  const ids = [...nomeConta.keys()];
  if (!ids.length) return [];
  const [{ data: perfis }, { data: papeis }] = await Promise.all([
    admin.from("profiles").select("user_id, full_name, email, account_id, account_role").in("account_id", ids),
    admin.from("org_papeis").select("user_id, papel").eq("org_id", orgId),
  ]);
  const escolhido = new Map(((papeis ?? []) as { user_id: string; papel: Pessoa["papel"] }[]).map((p) => [p.user_id, p.papel]));
  return ((perfis ?? []) as { user_id: string; full_name: string | null; email: string | null; account_id: string; account_role: string }[])
    .map((p) => {
      const padrao: Pessoa["papel"] = p.account_id === org?.owner_account_id && ["owner", "admin"].includes(p.account_role) ? "socio" : "vendedor";
      return { user_id: p.user_id, nome: p.full_name || p.email || "Sem nome", email: p.email ?? "", papel: escolhido.get(p.user_id) ?? padrao, escolhido: escolhido.has(p.user_id), conta: nomeConta.get(p.account_id) ?? "" };
    })
    .sort((a, b) => PAPEIS.indexOf(a.papel) - PAPEIS.indexOf(b.papel) || a.nome.localeCompare(b.nome));
}

export async function GET() {
  const quem = await quemNoPatio();
  if ("erro" in quem) return NextResponse.json({ erro: quem.erro }, { status: quem.status });
  return NextResponse.json({ pessoas: await montar(quem.orgId), eu: quem.userId, podeMudar: quem.papel === "socio" });
}

export async function PUT(req: Request) {
  const quem = await quemNoPatio();
  if ("erro" in quem) return NextResponse.json({ erro: quem.erro }, { status: quem.status });
  if (quem.papel !== "socio") return NextResponse.json({ erro: "Só sócio muda o papel das pessoas." }, { status: 403 });
  let corpo: { user_id?: string; papel?: string };
  try { corpo = await req.json(); } catch { return NextResponse.json({ erro: "pedido inválido" }, { status: 400 }); }
  const papel = corpo.papel as Pessoa["papel"];
  if (!corpo.user_id || !PAPEIS.includes(papel)) return NextResponse.json({ erro: "pedido inválido" }, { status: 400 });
  const pessoas = await montar(quem.orgId);
  const alvo = pessoas.find((p) => p.user_id === corpo.user_id);
  if (!alvo) return NextResponse.json({ erro: "Essa pessoa não é da loja." }, { status: 404 });
  if (alvo.papel === "socio" && papel !== "socio" && pessoas.filter((p) => p.papel === "socio").length <= 1)
    return NextResponse.json({ erro: "A loja precisa de pelo menos um sócio." }, { status: 400 });
  const { error } = await createAdminClient()
    .from("org_papeis")
    .upsert({ org_id: quem.orgId, user_id: alvo.user_id, papel, atualizado_em: new Date().toISOString() }, { onConflict: "org_id,user_id" });
  if (error) return NextResponse.json({ erro: "Não foi possível salvar agora." }, { status: 502 });
  return NextResponse.json({ ok: true, pessoas: await montar(quem.orgId) });
}
