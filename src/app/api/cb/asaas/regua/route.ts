import { NextResponse } from "next/server";

import { GATILHOS_DA_REGUA, HORA_PADRAO_COBRANCA, HORA_PADRAO_LEMBRETE } from "@/lib/asaas/regua";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { insertSteps } from "@/lib/automations/steps-tree";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/cb/asaas/regua  (admin+) — "Criar régua padrão" (§3.6): cria,
 * DESLIGADAS, as automações que ainda faltam — "Cobrança · 1 dia", "· 5
 * dias", "· 30 dias" (gatilho `asaas_cobranca_vencida`) e "Lembrete · vence
 * hoje" (`asaas_cobranca_vence_hoje`) —, cada uma com um passo de mensagem
 * editável, pulando o marco que já existe. O operador troca o texto no
 * editor de sempre e liga uma a uma; mais marcos são automações novas do
 * mesmo gatilho.
 *
 * ⚠️ A conexão do passo (D19, obrigatória para ligar) nasce com a conexão
 * PADRÃO da conta quando ela é por QR Code (a Meta fica fora da v1: texto
 * livre fora das 24 h não sai); sem uma, o passo nasce sem conexão e a
 * ativação recusa até alguém escolher — nunca o padrão em silêncio.
 *
 * Os dois textos se APRESENTAM ("Aqui é do…") porque, para as fichas criadas
 * pela D2, esta é a PRIMEIRA mensagem que o cliente recebe deste número, e a
 * assinatura da conta pode estar desligada; e dizem "se já pagou,
 * desconsidere" porque o boleto pago no caixa fica PENDING até compensar.
 */

const MARCOS_PADRAO = [1, 5, 30] as const;

const TEXTO_DA_COBRANCA = [
  "Olá, {{vars.cliente_primeiro_nome}}! Aqui é do {{vars.escritorio_nome}}.",
  "Constam em aberto no seu cadastro {{vars.cobranca_quantidade}} parcela(s), num total de {{vars.cobranca_valor}}:",
  "{{vars.cobranca_detalhe}}",
  "{{vars.vence_hoje_detalhe}}",
  "Se já pagou, pode desconsiderar esta mensagem. Qualquer dúvida, é só responder por aqui.",
].join("\n");

const TEXTO_DO_LEMBRETE = [
  "Olá, {{vars.cliente_primeiro_nome}}! Aqui é do {{vars.escritorio_nome}}.",
  "Passando para lembrar que {{vars.vencimento_texto}}:",
  "{{vars.cobranca_detalhe}}",
  "Se já pagou, pode desconsiderar. Qualquer dúvida, é só responder por aqui.",
].join("\n");

export async function POST() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:asaas:regua:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    const { data: existentes, error } = await admin
      .from("automations")
      .select("id, trigger_type, trigger_config")
      .eq("account_id", ctx.accountId)
      .in("trigger_type", [...GATILHOS_DA_REGUA]);
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
    const marcosExistentes = new Set<number>();
    let temLembrete = false;
    for (const a of (existentes ?? []) as { trigger_type: string; trigger_config: Record<string, unknown> | null }[]) {
      if (a.trigger_type === "asaas_cobranca_vence_hoje") temLembrete = true;
      else marcosExistentes.add(Number(a.trigger_config?.dias_de_atraso));
    }

    // A conexão padrão por QR Code, se houver — nunca a Meta (texto livre
    // fora das 24 h não sai) e nunca em silêncio: sem ela o passo nasce sem
    // conexão e a ativação recusa até alguém escolher.
    const { data: canais } = await admin
      .from("cb_channels")
      .select("id, kind, is_default")
      .eq("account_id", ctx.accountId)
      .eq("status", "connected")
      .eq("kind", "evolution")
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1);
    const canalId = (canais?.[0]?.id as string | undefined) ?? null;
    const passo = (texto: string) => ({ step_type: "send_message", step_config: canalId ? { text: texto, channel_id: canalId } : { text: texto } });

    const criadas: string[] = [];
    const criar = async (nome: string, tipo: string, config: Record<string, unknown>, texto: string) => {
      const { data: automacao, error: erroInsert } = await admin
        .from("automations")
        .insert({
          user_id: ctx.userId,
          account_id: ctx.accountId,
          name: nome,
          description: null,
          trigger_type: tipo,
          trigger_config: config,
          channel_ids: null,
          stage_ids: null,
          is_active: false,
        })
        .select("id")
        .single();
      if (erroInsert || !automacao) throw new Error(erroInsert?.message ?? "insert falhou");
      const erroPassos = await insertSteps(automacao.id as string, [passo(texto)]);
      if (erroPassos) throw new Error(erroPassos);
      criadas.push(nome);
    };

    for (const marco of MARCOS_PADRAO) {
      if (marcosExistentes.has(marco)) continue;
      await criar(`Cobrança · ${marco} dia${marco > 1 ? "s" : ""}`, "asaas_cobranca_vencida", { dias_de_atraso: marco, hora_envio: HORA_PADRAO_COBRANCA, somente_dias_uteis: true }, TEXTO_DA_COBRANCA);
    }
    if (!temLembrete) {
      await criar("Lembrete · vence hoje", "asaas_cobranca_vence_hoje", { hora_envio: HORA_PADRAO_LEMBRETE, somente_dias_uteis: true }, TEXTO_DO_LEMBRETE);
    }
    return NextResponse.json({ ok: true, criadas, semConexao: canalId === null });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      console.error("[asaas/regua] criar régua padrão falhou:", err.message);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    return toErrorResponse(err);
  }
}
