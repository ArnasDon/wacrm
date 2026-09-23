// ============================================================
// POST /api/cb/webhooks-de-saida/{id}/teste — o botão "Enviar teste". Admin+.
//
// Corpo: `{ "evento": <WebhookEvent> }`. Manda o envelope de EXEMPLO daquele
// evento (`test: true`) ao endereço cadastrado e devolve o que aconteceu
// (`ResultadoDoTeste`, em `enviar-teste.ts`).
//
// Respostas:
//   400 { error: 'evento_invalido' }       — evento fora do vocabulário
//   404 { error: 'nao_encontrado' }        — o endpoint não é desta conta
//   500 { error: 'db_error' }              — a leitura falhou (nunca vira 404)
//   200 ResultadoDoTeste                   — o teste RODOU; ok ou não, é dado
//
// ⚠️ Funciona com o endpoint DESLIGADO e para evento que ele NÃO assina: é
// teste de formato. E não mexe em `failure_count`/`last_delivery_at` — ver o
// cabeçalho de `enviar-teste.ts`.
//
// O limite de pedidos é o MESMO balde da rota irmã (`[id]/route.ts`): o teste
// faz uma chamada HTTP de saída por clique, e um balde próprio dobraria o que
// um admin consegue disparar por minuto.
// ============================================================

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { ehUuid } from "@/lib/tasks/validar";
import { enviarTeste } from "@/lib/webhooks/enviar-teste";
import { isWebhookEvent } from "@/lib/webhooks/events";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole("admin");
    const limite = checkRateLimit(
      `cb:webhooks-saida:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limite.success) return rateLimitResponse(limite);

    const corpo = (await request.json().catch(() => null)) as {
      evento?: unknown;
    } | null;
    const evento = corpo?.evento;
    if (!isWebhookEvent(evento)) {
      return NextResponse.json({ error: "evento_invalido" }, { status: 400 });
    }

    // Id que não é UUID não existe — e mandá-lo ao Postgres viraria erro de
    // sintaxe (22P02), que cairia no 500 como se o banco tivesse falhado.
    const { id } = await params;
    if (!ehUuid(id)) {
      return NextResponse.json({ error: "nao_encontrado" }, { status: 404 });
    }

    const { data: endpoint, error } = await supabaseAdmin()
      .from("webhook_endpoints")
      .select("id, url, secret")
      .eq("id", id)
      // Service role ignora RLS: a conta é o que impede testar (e descobrir a
      // URL de) o endpoint de outro escritório.
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error("[cb/webhooks-de-saida] teste:", error);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    if (!endpoint) {
      return NextResponse.json({ error: "nao_encontrado" }, { status: 404 });
    }

    const resultado = await enviarTeste(
      {
        id: endpoint.id as string,
        url: endpoint.url as string,
        secret: endpoint.secret as string,
      },
      evento,
      ctx.accountId
    );
    return NextResponse.json(resultado);
  } catch (err) {
    return toErrorResponse(err);
  }
}
