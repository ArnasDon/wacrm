import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/trafego/admin";
import { encrypt } from "@/lib/whatsapp/encryption";
import { gestorDaLoja } from "@/lib/trafego/servidor";

// Conexão da loja com o Meta (Tráfego → Conexões).
//   GET  → o que está configurado (nunca devolve o token, só se existe).
//   POST → { contaAnuncios?: string, token?: string, estoqueProjeto?: string }
// O token é guardado criptografado em tr_config e só o servidor o lê.

export const dynamic = "force-dynamic";

export async function GET() {
  const quem = await gestorDaLoja();
  if ("erro" in quem) return NextResponse.json({ error: quem.erro }, { status: quem.status });
  const admin = createAdminClient();
  const [{ data: cfg }, { data: cred }] = await Promise.all([
    admin.from("tr_config").select("meta_access_token, estoque_firestore_projeto, windsor_api_key, ga4_property_id, atualizado_em").eq("org_id", quem.orgId).maybeSingle(),
    admin
      .from("tr_integration_credentials")
      .select("referencia_externa")
      .eq("org_id", quem.orgId)
      .eq("provedor", "facebook")
      .eq("ativo", true)
      .maybeSingle(),
  ]);
  return NextResponse.json({
    temToken: !!cfg?.meta_access_token,
    tokenAtualizadoEm: cfg?.atualizado_em ?? null,
    contaAnuncios: cred?.referencia_externa ?? null,
    estoqueProjeto: cfg?.estoque_firestore_projeto ?? null,
    temWindsor: !!cfg?.windsor_api_key,
    ga4Propriedade: cfg?.ga4_property_id ?? null,
  });
}

export async function POST(request: Request) {
  const quem = await gestorDaLoja();
  if ("erro" in quem) return NextResponse.json({ error: quem.erro }, { status: quem.status });
  const corpo = (await request.json().catch(() => ({}))) as { contaAnuncios?: string; token?: string; estoqueProjeto?: string; windsorChave?: string; ga4Propriedade?: string; removerWindsor?: boolean };
  const admin = createAdminClient();

  const conta = (corpo.contaAnuncios ?? "").replace(/^act_/, "").trim();
  if (conta) {
    if (!/^\d{5,25}$/.test(conta)) {
      return NextResponse.json({ error: "Conta de anúncios inválida (só números)." }, { status: 400 });
    }
    const { data: existente } = await admin
      .from("tr_integration_credentials")
      .select("id")
      .eq("org_id", quem.orgId)
      .eq("provedor", "facebook")
      .maybeSingle();
    const { error } = existente
      ? await admin.from("tr_integration_credentials").update({ referencia_externa: conta, ativo: true }).eq("id", existente.id)
      : await admin.from("tr_integration_credentials").insert({ org_id: quem.orgId, provedor: "facebook", referencia_externa: conta });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const token = (corpo.token ?? "").trim();
  if (token) {
    if (token.length < 50) return NextResponse.json({ error: "Token do Meta parece incompleto." }, { status: 400 });
    // Confere o token no Meta antes de salvar.
    const teste = await fetch(`https://graph.facebook.com/v23.0/me?access_token=${encodeURIComponent(token)}`, { cache: "no-store" });
    if (!teste.ok) return NextResponse.json({ error: "O Meta recusou esse token." }, { status: 400 });
    const { error } = await admin
      .from("tr_config")
      .upsert({ org_id: quem.orgId, meta_access_token: encrypt(token), atualizado_em: new Date().toISOString() }, { onConflict: "org_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Projeto Firebase do estoque do site (ex.: "ibox-site").
  const projeto = (corpo.estoqueProjeto ?? "").trim();
  if (projeto) {
    if (!/^[a-z0-9-]{4,40}$/.test(projeto)) {
      return NextResponse.json({ error: "Projeto do estoque inválido." }, { status: 400 });
    }
    const { error } = await admin
      .from("tr_config")
      .upsert({ org_id: quem.orgId, estoque_firestore_projeto: projeto, atualizado_em: new Date().toISOString() }, { onConflict: "org_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Windsor.ai (opcional): métricas do Instagram e outras fontes.
  const chaveWindsor = (corpo.windsorChave ?? "").trim();
  if (chaveWindsor || corpo.removerWindsor) {
    if (chaveWindsor && chaveWindsor.length < 20) return NextResponse.json({ error: "Chave do Windsor parece incompleta." }, { status: 400 });
    if (chaveWindsor) {
      const teste = await fetch(`https://connectors.windsor.ai/all?api_key=${encodeURIComponent(chaveWindsor)}&date_preset=last_7d&fields=date&_renderer=json`, { cache: "no-store" });
      if (teste.status === 401 || teste.status === 403) return NextResponse.json({ error: "O Windsor recusou essa chave." }, { status: 400 });
    }
    const { error } = await admin
      .from("tr_config")
      .upsert({ org_id: quem.orgId, windsor_api_key: chaveWindsor ? encrypt(chaveWindsor) : null, atualizado_em: new Date().toISOString() }, { onConflict: "org_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Google Analytics 4 (opcional): visitas do site e de cada carro.
  if (typeof corpo.ga4Propriedade === "string") {
    const prop = corpo.ga4Propriedade.replace(/^properties\//, "").trim();
    if (prop && !/^\d{6,15}$/.test(prop)) return NextResponse.json({ error: "ID da propriedade do GA4 inválido (só números)." }, { status: 400 });
    const { error } = await admin
      .from("tr_config")
      .upsert({ org_id: quem.orgId, ga4_property_id: prop || null, atualizado_em: new Date().toISOString() }, { onConflict: "org_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
