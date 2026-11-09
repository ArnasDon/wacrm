import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/trafego/admin";
import { syncCredentials, type CredentialRow } from "@/lib/trafego/windsor-sync";
import { syncEstoqueTodas } from "@/lib/trafego/estoque-sync";
import { tokensMetaDasLojas, chavesWindsorDasLojas } from "@/lib/trafego/servidor";

// Sincronização automática do módulo Tráfego (todas as lojas):
// campanhas do Meta (diária + por hora) e estoque do site → veículos.
//
// Quem chama: o agendador do Supabase do CRM (pg_cron), a cada 15 min no
// modo "rapido" e 1x por dia no "completo", com o header x-sync-chave. O
// repositório guarda só o SHA-256 da chave; a chave fica no Vault do Supabase.
// Roda com a service_role (ignora RLS) — nunca é chamada pelo navegador.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYNC_CHAVE_HASH = "efc089d8fce585418759e6a7eb774ac64140b1c86f386a40b8a0d691b271710f";

function chaveValida(chave: string | null) {
  if (!chave) return false;
  const h = createHash("sha256").update(chave).digest("hex");
  return timingSafeEqual(Buffer.from(h), Buffer.from(SYNC_CHAVE_HASH));
}

export async function GET(request: Request) {
  if (!chaveValida(request.headers.get("x-sync-chave"))) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  const modo = new URL(request.url).searchParams.get("modo") === "rapido" ? "rapido" : "completo";
  const admin = createAdminClient();

  const { data: credentials, error } = await admin
    .from("tr_integration_credentials")
    .select("id, org_id, provedor, referencia_externa")
    .eq("ativo", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let tokens: Record<string, string> = {};
  try {
    tokens = await tokensMetaDasLojas(admin);
  } catch (e) {
    console.error("[trafego/sync] tokens:", e);
  }

  // Cada loja usa a própria chave do Windsor (Ajustes → Conexões); sem ela, a do ambiente.
  const windsor = await chavesWindsorDasLojas(admin).catch(() => ({}) as Record<string, string>);
  const porLoja = new Map<string, CredentialRow[]>();
  for (const c of (credentials ?? []) as CredentialRow[]) porLoja.set(c.org_id, [...(porLoja.get(c.org_id) ?? []), c]);
  const results = [];
  for (const [org, creds] of porLoja) {
    results.push(...(await syncCredentials(admin, creds, windsor[org] || process.env.WINDSOR_API_KEY || "", modo, tokens)));
  }

  // Estoque do site → veículos. Falha aqui não derruba a sync das campanhas.
  let estoque: unknown = null;
  try {
    estoque = await syncEstoqueTodas(admin);
  } catch (err) {
    estoque = { erro: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json({ ok: true, modo, results, estoque });
}
