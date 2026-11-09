import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/trafego/admin";
import { rodarAutomacoes } from "@/lib/patio/automacoes-servidor";
import { syncCredentials, type CredentialRow } from "@/lib/trafego/windsor-sync";
import { tokensMetaDasLojas, chavesWindsorDasLojas } from "@/lib/trafego/servidor";

// Relógio de hora em hora (pg_cron do Supabase, ver supabase/agendador.sql):
// 1) dispara as automações da equipe que estão na hora;
// 2) atualiza as campanhas no modo rápido (últimos 3 dias, direto do Meta),
//    para os números ficarem com no máximo 1 hora de atraso. A rodada
//    completa (30 dias) continua 1x por dia no /api/trafego/sync.
// O repositório guarda só o SHA-256 da chave; a chave fica no Vault do Supabase.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHAVE_HASH = "b166d6f69b92591d56c0a60e17f383d14582564361929cb9623e916cc31f0c05";

function chaveValida(chave: string | null) {
  if (!chave) return false;
  const a = createHash("sha256").update(chave).digest("hex");
  return timingSafeEqual(Buffer.from(a), Buffer.from(CHAVE_HASH));
}

export async function GET(req: Request) {
  if (!chaveValida(req.headers.get("x-agendador-chave"))) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const admin = createAdminClient();
  let automacoes: unknown = null;
  try {
    automacoes = await rodarAutomacoes(admin);
  } catch (e) {
    console.error("[agendador] automações:", e);
    automacoes = { erro: e instanceof Error ? e.message : String(e) };
  }
  let campanhas: unknown = null;
  try {
    const { data: creds } = await admin.from("tr_integration_credentials").select("id, org_id, provedor, referencia_externa").eq("ativo", true);
    const tokens = await tokensMetaDasLojas(admin).catch(() => ({}) as Record<string, string>);
    const windsor = await chavesWindsorDasLojas(admin).catch(() => ({}) as Record<string, string>);
    const porLoja = new Map<string, CredentialRow[]>();
    for (const c of (creds ?? []) as CredentialRow[]) porLoja.set(c.org_id, [...(porLoja.get(c.org_id) ?? []), c]);
    const r = [];
    for (const [org, lista] of porLoja) r.push(...(await syncCredentials(admin, lista, windsor[org] || process.env.WINDSOR_API_KEY || "", "rapido", tokens)));
    campanhas = r;
  } catch (e) {
    console.error("[agendador] campanhas:", e);
    campanhas = { erro: e instanceof Error ? e.message : String(e) };
  }
  return NextResponse.json({ ok: true, automacoes, campanhas });
}
