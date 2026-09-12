import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Acao = "ligar" | "desligar" | "ignorar" | "reconsiderar";

/**
 * PUT /api/cb/asaas/clientes/[id]/vinculo  (admin+) — o vínculo feito por
 * GENTE. Corpo: `{ acao: 'ligar', contact_id }`, `{ acao: 'desligar' }`,
 * `{ acao: 'ignorar' }` ou `{ acao: 'reconsiderar' }`.
 *
 * - `ligar`: origem `manual`, com o nome de quem ligou CARIMBADO (sobrevive
 *   à saída do login). O contato é conferido contra a conta.
 * - `desligar`: o contato entra em `contatos_recusados` — a regra automática
 *   NUNCA religa este cliente a ele —, e a origem volta a nula: a regra
 *   continua procurando outra ficha nos ciclos seguintes.
 * - `ignorar`: origem `desvinculado` (o fornecedor cadastrado no Asaas): a
 *   regra deixa de olhar. Se estava ligado, o contato também entra nos
 *   recusados.
 * - `reconsiderar`: desfaz o "ignorar" — a origem volta a nula.
 *
 * ⚠️ Toda escrita confere o ROWCOUNT: em service role o `.eq('account_id')`
 * é a única cerca, e um update que não achou a linha volta sem erro.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:asaas:vinculo:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const corpo = (await request.json().catch(() => null)) as { acao?: unknown; contact_id?: unknown } | null;
    const acao = corpo?.acao;
    if (acao !== "ligar" && acao !== "desligar" && acao !== "ignorar" && acao !== "reconsiderar") {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const { data: atual, error: erroLeitura } = await admin
      .from("cb_asaas_clientes")
      .select("id, contact_id, vinculo_origem, contatos_recusados")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (erroLeitura) return NextResponse.json({ error: "db_error" }, { status: 500 });
    if (!atual) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const agora = new Date().toISOString();
    const { data: perfil } = await ctx.supabase.from("profiles").select("full_name, email").eq("user_id", ctx.userId).maybeSingle();
    const quem = ((perfil?.full_name as string | null) || (perfil?.email as string | null) || "").trim() || null;
    const recusados = Array.isArray(atual.contatos_recusados) ? (atual.contatos_recusados as string[]) : [];
    const contatoAtual = (atual.contact_id as string | null) ?? null;
    const comORecusado = contatoAtual && !recusados.includes(contatoAtual) ? [...recusados, contatoAtual] : recusados;

    let patch: Record<string, unknown>;
    if ((acao as Acao) === "ligar") {
      const contactId = typeof corpo?.contact_id === "string" && UUID.test(corpo.contact_id) ? corpo.contact_id : null;
      if (!contactId) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      const { data: contato } = await admin.from("contacts").select("id").eq("id", contactId).eq("account_id", ctx.accountId).maybeSingle();
      if (!contato) return NextResponse.json({ error: "contato_nao_encontrado" }, { status: 400 });
      patch = {
        contact_id: contactId,
        vinculo_origem: "manual",
        vinculado_por: ctx.userId,
        vinculado_por_nome: quem,
        vinculado_em: agora,
        candidatos: [],
        // a pendência de etiqueta era da ficha CRIADA pelo CRM, não desta
        etiqueta_pendente: false,
        updated_at: agora,
      };
    } else if (acao === "desligar") {
      if (!contatoAtual) return NextResponse.json({ error: "nao_ligado" }, { status: 409 });
      patch = {
        contact_id: null,
        vinculo_origem: null,
        vinculado_por: ctx.userId,
        vinculado_por_nome: quem,
        vinculado_em: agora,
        contatos_recusados: comORecusado,
        candidatos: [],
        etiqueta_pendente: false,
        updated_at: agora,
      };
    } else if (acao === "ignorar") {
      patch = {
        contact_id: null,
        vinculo_origem: "desvinculado",
        vinculado_por: ctx.userId,
        vinculado_por_nome: quem,
        vinculado_em: agora,
        contatos_recusados: comORecusado,
        candidatos: [],
        etiqueta_pendente: false,
        updated_at: agora,
      };
    } else {
      if (atual.vinculo_origem !== "desvinculado") return NextResponse.json({ error: "nao_ignorado" }, { status: 409 });
      patch = { vinculo_origem: null, vinculado_por: ctx.userId, vinculado_por_nome: quem, vinculado_em: agora, updated_at: agora };
    }

    const { data, error } = await admin.from("cb_asaas_clientes").update(patch).eq("id", id).eq("account_id", ctx.accountId).select("id, contact_id, vinculo_origem");
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
    if (!data || data.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, cliente: data[0] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
