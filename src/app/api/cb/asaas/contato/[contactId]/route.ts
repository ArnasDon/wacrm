import { NextResponse } from "next/server";

import { cicloCompleto, leituraFresca, lerClientesDoContato, lerCobrancasDosClientes, lerConfigDoEspelho, lerEnviosDoContato } from "@/lib/asaas/espelho";
import { GATILHOS_DA_REGUA } from "@/lib/asaas/regua";
import type { ParcelaDoEspelho } from "@/lib/asaas/inadimplencia";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/cb/asaas/contato/[contactId] — a aba Cobranças de UM contato.
 *
 * `{ conectado, leituraFresca, atualizadoEm, clientes: [{ id, asaasId, nome,
 * origem, notificacoesDesligadas }], parcelas: parcela[] }` — os clientes do
 * Asaas ligados ao contato e TODAS as parcelas deles que o espelho guarda
 * (as devidas, as que regularizaram, as estornadas, a que vence hoje). Quem
 * reparte é o navegador (`separarParcelas`), com o relógio da tela.
 *
 * Qualquer membro lê (D4). Sem CPF — ele só sai mascarado, e só para o
 * administrador, pelas listas do cartão. Contato de outra conta → a
 * consulta simplesmente não acha cliente ligado (`account_id` na cerca).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const ctx = await getCurrentAccount();
    const limit = checkRateLimit(`cb:asaas:contato:${ctx.userId}`, RATE_LIMITS.execucao);
    if (!limit.success) return rateLimitResponse(limit);

    const { contactId } = await params;
    if (!UUID.test(contactId)) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const admin = supabaseAdmin();
    const config = await lerConfigDoEspelho(admin, ctx.accountId);
    if (!config) return NextResponse.json({ conectado: false, leituraFresca: false, atualizadoEm: null, cicloCompleto: false, clientes: [], parcelas: [], reguaAtiva: false, reguaComAutomacoes: false, envios: [] });

    // Paginado (o catch abaixo responde 500 acima do teto): um contato com
    // mais clientes que uma página perderia clientes E as cobranças deles.
    const ligados = await lerClientesDoContato(admin, ctx.accountId, contactId);
    const clientes = ligados.map((c) => ({
      id: c.id,
      asaasId: c.asaas_customer_id,
      nome: c.nome ?? "",
      origem: c.vinculo_origem,
      notificacoesDesligadas: c.notificacoes_desligadas,
      reguaDesligada: c.regua_desligada,
    }));

    // Paginada, e acima do teto ESTOURA (o catch abaixo responde 500):
    // uma lista parcial seria lida como "as outras não existem".
    const parcelas: ParcelaDoEspelho[] = await lerCobrancasDosClientes(
      admin,
      ctx.accountId,
      clientes.map((c) => c.asaasId),
    );

    // A régua (998): o histórico deste contato e o estado do interruptor —
    // a aba diz "Cobrança automática desligada" quando há automação ligada
    // e o interruptor não (D20).
    const [envios, { count: automacoesLigadas }] = await Promise.all([
      lerEnviosDoContato(admin, ctx.accountId, contactId),
      admin.from("automations").select("id", { count: "exact", head: true }).eq("account_id", ctx.accountId).eq("is_active", true).in("trigger_type", [...GATILHOS_DA_REGUA]),
    ]);

    return NextResponse.json({
      conectado: true,
      leituraFresca: leituraFresca(config, new Date()),
      atualizadoEm: config.vencidas_listadas_em,
      // Ver `cicloCompleto`: só com o ciclo da listagem atual terminado
      // "nenhum cliente ligado" é resposta, e não lacuna do vínculo.
      cicloCompleto: cicloCompleto(config),
      clientes,
      parcelas,
      reguaAtiva: config.regua_ativa === true,
      reguaComAutomacoes: (automacoesLigadas ?? 0) > 0,
      envios,
    });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      console.error("[asaas/contato] leitura falhou:", err.message);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    return toErrorResponse(err);
  }
}
