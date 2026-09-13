import { NextResponse } from "next/server";

import { leituraFresca, lerCobrancasDevidas, lerConfigDoEspelho } from "@/lib/asaas/espelho";
import type { ParcelaDoEspelho } from "@/lib/asaas/inadimplencia";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/cb/asaas/resumo — quem está INADIMPLENTE, para a caixa inteira.
 *
 * A resposta em LOTE para a lista de conversas (o ícone da linha e o filtro)
 * e para a faixa do fio: `{ conectado, leituraFresca, atualizadoEm,
 * contatos: { [contactId]: parcela[] } }`, com as parcelas DEVIDAS (vencidas
 * e negativadas) dos clientes do Asaas ligados a cada contato. Os DIAS são
 * calculados no navegador, com a régua (`inadimplencia.ts`) e o relógio da
 * tela.
 *
 * ⚠️ É rota, e não leitura sob RLS, porque as tabelas do Asaas são FECHADAS
 * ao navegador (994) — e porque a tela precisa saber se está CONECTADO e se
 * a leitura é FRESCA, que só a config (também fechada) responde. Sem isso
 * "em dia" seria afirmação sobre dado parado. Qualquer membro lê (D4):
 * quem responde ao cliente precisa saber que ele deve. Erro → 500, nunca
 * `{}` — um objeto vazio seria lido como "ninguém deve".
 */

const PAGINA = 1000;

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const limit = checkRateLimit(`cb:asaas:resumo:${ctx.userId}`, RATE_LIMITS.execucao);
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    const config = await lerConfigDoEspelho(admin, ctx.accountId);
    if (!config) return NextResponse.json({ conectado: false, leituraFresca: false, atualizadoEm: null, contatos: {} });

    // cliente do Asaas → contato (só os ligados), paginado. ⚠️ Acima do
    // teto ESTOURA (500), nunca devolve lista parcial: metade dos ligados
    // seria lida como "os outros estão em dia".
    const contatoPorCliente = new Map<string, string>();
    let completo = false;
    for (let pagina = 0; pagina < 50; pagina++) {
      const { data, error } = await admin
        .from("cb_asaas_clientes")
        .select("asaas_customer_id, contact_id")
        .eq("account_id", ctx.accountId)
        .eq("deleted", false)
        .not("contact_id", "is", null)
        .order("id")
        .range(pagina * PAGINA, (pagina + 1) * PAGINA - 1);
      if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
      const linhas = (data ?? []) as { asaas_customer_id: string; contact_id: string }[];
      for (const l of linhas) contatoPorCliente.set(l.asaas_customer_id, l.contact_id);
      if (linhas.length < PAGINA) {
        completo = true;
        break;
      }
    }
    if (!completo) {
      console.error("[asaas/resumo] mais de 50 páginas de clientes ligados");
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }

    const contatos: Record<string, ParcelaDoEspelho[]> = {};
    if (contatoPorCliente.size > 0) {
      const devidas = await lerCobrancasDevidas(admin, ctx.accountId);
      for (const p of devidas) {
        const contactId = contatoPorCliente.get(p.asaas_customer_id);
        if (!contactId) continue;
        (contatos[contactId] ??= []).push(p);
      }
    }

    return NextResponse.json({
      conectado: true,
      leituraFresca: leituraFresca(config, new Date()),
      atualizadoEm: config.vencidas_listadas_em,
      contatos,
    });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      console.error("[asaas/resumo] leitura falhou:", err.message);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    return toErrorResponse(err);
  }
}
