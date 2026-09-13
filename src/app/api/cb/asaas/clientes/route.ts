import { NextResponse } from "next/server";

import { lerEspelho } from "@/lib/asaas/espelho";
import { casaComABusca, ehNomeDeLista, paginar, POR_PAGINA, type ItemDaLista, type ItemInadimplente } from "@/lib/asaas/listas";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/cb/asaas/clientes?lista=confirmar|sem_ficha|ligados|ignorados|inadimplentes&pagina=1&busca=
 * (admin+) — UMA das cinco listas do cartão, paginada.
 *
 * Lê o espelho inteiro em service role (as tabelas são fechadas ao
 * navegador) e devolve a página pedida. O CPF/CNPJ sai MASCARADO, e só daqui
 * (D3). A busca vale nas listas de clientes; a de inadimplentes tem o
 * recorte por faixa de dias (`faixa=ate_5|de_6_a_30|mais_de_30`).
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:asaas:listas:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const url = new URL(request.url);
    const lista = url.searchParams.get("lista") ?? "";
    if (!ehNomeDeLista(lista)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const pagina = Number(url.searchParams.get("pagina") ?? "1");
    const busca = (url.searchParams.get("busca") ?? "").slice(0, 80);
    const faixa = url.searchParams.get("faixa") ?? "";

    const espelho = await lerEspelho(supabaseAdmin(), ctx.accountId);
    if (lista === "inadimplentes") {
      const itens: ItemInadimplente[] = espelho.listas.inadimplentes.filter((i) => faixa === "" || i.faixa === faixa);
      return NextResponse.json({ conectado: espelho.conectado, leituraFresca: espelho.leituraFresca, ...paginar(itens, pagina, POR_PAGINA) });
    }
    const itens: ItemDaLista[] = espelho.listas[lista].filter((i) => casaComABusca(i, busca));
    return NextResponse.json({ conectado: espelho.conectado, leituraFresca: espelho.leituraFresca, ...paginar(itens, pagina, POR_PAGINA) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
