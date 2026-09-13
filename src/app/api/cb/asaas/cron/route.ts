import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { sincronizarAsaas } from "@/lib/asaas/sincronizar";
import { origemPublica } from "@/lib/asaas/webhook";
import { cuidarDoWebhook } from "@/lib/asaas/webhook-asaas";
import { supabaseAdmin } from "@/lib/automations/admin-client";

/**
 * GET /api/cb/asaas/cron — sincroniza TODAS as contas conectadas ao Asaas.
 * Entra no laço LENTO do `docker-stack.yml` (`for rota in cb/scheduled
 * flows cb/radar cb/meta-ads cb/tldv cb/asaas`), com o mesmo
 * `AUTOMATION_CRON_SECRET` das rotas irmãs.
 *
 * ⚠️ Como nas outras rotas de cron: sem alguém batendo aqui, nada
 * sincroniza — e o CI NÃO relê o `command` do agendador: incluir a rota no
 * laço só vale depois de `docker stack deploy` manual na VPS, com o
 * `crm.env` carregado (as três linhas do CLAUDE.md).
 *
 * Teto: o `-m 120` do curl. O laço para de abrir contas novas depois de
 * 90 s — a que ficou entra no ciclo seguinte (15 min), e vem para a frente
 * pelo rodízio de `last_sync_attempt_at`.
 */
export const maxDuration = 120;

const ORCAMENTO_MS = 90_000;

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  const supplied = request.headers.get("x-cron-secret") ?? "";
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (suppliedBuf.length !== expectedBuf.length || !timingSafeEqual(suppliedBuf, expectedBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const inicio = Date.now();
  // Pagina, e ordena pelo RODÍZIO: nunca tentada primeiro, depois da
  // tentativa mais antiga para a mais recente — `sincronizarAsaas` carimba
  // `last_sync_attempt_at` no começo de toda varredura (o achado do Codex no
  // PR #163, copiado do tl;dv).
  const contas: { account_id: string }[] = [];
  for (let pagina = 0; pagina < 20; pagina++) {
    const { data, error } = await admin
      .from("cb_asaas_config")
      .select("account_id")
      .order("last_sync_attempt_at", { ascending: true, nullsFirst: true })
      .order("account_id")
      .range(pagina * 1000, pagina * 1000 + 999);
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
    if (!data) break;
    contas.push(...(data as { account_id: string }[]));
    if (data.length < 1000) break;
  }

  let ok = 0;
  let falhas = 0;
  let adiadas = 0;
  // ⚠️ A criação AUTOMÁTICA do webhook (D7) vive só aqui, de propósito: o
  // cron só roda na VPS, onde `NEXT_PUBLIC_SITE_URL` é o endereço que
  // atende de verdade. O preview carrega a mesma URL e NÃO pode registrar
  // o webhook — ele bateria numa rota que só existe depois do deploy.
  const origem = origemPublica();
  for (const conta of contas) {
    if (Date.now() - inicio > ORCAMENTO_MS) {
      adiadas++;
      continue;
    }
    const r = await sincronizarAsaas(admin, conta.account_id, { prazoMs: inicio + ORCAMENTO_MS });
    if (r.ok) {
      ok++;
      console.log(
        `[asaas] ciclo da conta ${conta.account_id}: ${r.clientesListados} clientes listados, ${r.cobrancasGravadas} cobranças, ${r.reconciliadas} reconciliadas, ${r.ligados} ligados, ${r.fichasCriadas} fichas criadas, ${r.adiadas} adiadas`,
      );
      // Com a conta sincronizada, o webhook: confere o que existe, cria o
      // que nunca foi tentado. Falha aqui não é falha do ciclo.
      const w = await cuidarDoWebhook(admin, conta.account_id, { origem });
      if (!w.ok && w.codigo !== "url_inalcancavel") console.warn(`[asaas] webhook da conta ${conta.account_id}: ${w.codigo}`);
    } else if (r.codigo === "em_curso" || r.codigo === "cadeado_perdido") adiadas++;
    else falhas++;
  }
  if (ok || falhas || adiadas) {
    console.log(`[asaas] ciclo: ${ok} ok, ${falhas} falha(s), ${adiadas} adiada(s)`);
  }
  return NextResponse.json({ ok, falhas, adiadas });
}
