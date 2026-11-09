import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/trafego/admin";
import { rodarAutomacoes } from "@/lib/patio/automacoes-servidor";

// Relógio de hora em hora (pg_cron do Supabase, ver supabase/agendador.sql):
// dispara as automações da equipe que estão na hora. Leve: não sincroniza
// campanhas (isso é o /api/trafego/sync, 1x por dia).
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
  try {
    const automacoes = await rodarAutomacoes(createAdminClient());
    return NextResponse.json({ ok: true, automacoes });
  } catch (e) {
    console.error("[agendador]", e);
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
