import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { comTetoDeProcessamento, liberarClaim, motivoDaRecusa, reivindicarEvento } from "@/lib/calendly/claim";
import { gravarResultado, processarAgendamento } from "@/lib/calendly/processar";
import { houveCancelamento } from "@/lib/calendly/cancelamento";
import { agendamentoDaLinha, varsDaLinha } from "@/lib/calendly/reprocessar";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/cb/calendly/eventos/[id]/reprocessar  (admin+)
 *
 * "Processar de novo": roda o agendamento que já está gravado, com as
 * variáveis que ele entregou da primeira vez (979).
 *
 * Existe porque a razão de um agendamento não ter disparado costuma ser
 * passageira e externa: a automação ainda não existia ou estava desligada,
 * ou o CRM não conseguiu criar a ficha do cliente. O operador arruma o que
 * faltava e pede a repetição.
 *
 * ⚠️⚠️ Passa pelo CADEADO (`reivindicarEvento`, 980) — nunca por "ler o
 * estado e então processar". Isto MANDA MENSAGEM: dois cliques simultâneos,
 * ou um clique enquanto o `after()` do webhook ainda roda, dariam dois
 * avisos ao advogado e mexeriam no card duas vezes. Quem consegue escrever
 * o cadeado é o dono; os demais recebem 409 com o motivo real.
 *
 * ⚠️ Só linha REPROCESSÁVEL é reivindicável (`RESULTADOS_REPROCESSAVEIS`):
 * repetir um `disparado` mandaria a mesma mensagem de novo, e em `falhou`
 * não se sabe se o passo de envio já tinha rodado (aí o caminho é o
 * histórico da automação e o "Executar automação" da conversa).
 *
 * ⚠️ Toda escrita daqui para baixo leva a CERCA DE POSSE do claim, e o
 * processamento tem TETO (`TETO_DE_PROCESSAMENTO_MS`, menor que o
 * recolhimento). Os dois juntos são o que garante o cadeado: o teto faz o
 * dono desistir antes de ser recolhido, e a cerca faz as escritas de um
 * dono recolhido virarem no-op.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:calendly:reprocessar:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const admin = supabaseAdmin();

    const { linha, erro } = await reivindicarEvento(admin, { id, accountId: ctx.accountId });
    if (erro) return NextResponse.json({ error: "db_error" }, { status: 500 });

    if (!linha) {
      // Não pegou. O motivo vem do estado REAL — e erro de banco aqui NÃO é
      // "não encontrado": um blip viraria 404 e o operador concluiria que o
      // agendamento sumiu do log.
      const { data: atual, error: erroLeitura } = await admin
        .from("cb_calendly_eventos")
        .select("resultado, processando_desde")
        .eq("id", id)
        .eq("account_id", ctx.accountId)
        .maybeSingle();
      if (erroLeitura) return NextResponse.json({ error: "db_error" }, { status: 500 });
      const motivo = motivoDaRecusa(atual, Date.now());
      return NextResponse.json({ error: motivo }, { status: motivo === "not_found" ? 404 : 409 });
    }

    // O carimbo do NOSSO claim — a cerca de toda escrita daqui para baixo.
    const claimIso = String(linha.processando_desde);

    // ⚠️⚠️ AGENDAMENTO CANCELADO NÃO SE REPROCESSA (Codex, PR #235). A linha
    // que terminou `sem_contato` continua reprocessável de propósito — o
    // operador arruma a ficha e clica. Só que, se a reunião foi DESMARCADA
    // no meio, repetir roda a automação inteira: avisa o advogado, move o
    // card para "Reunião Agendada" e grava a data de uma reunião que não vai
    // acontecer — e os lembretes voltam armados, sem trava nenhuma.
    //
    // Falha FECHADA: não conseguindo conferir, recusa. Recusar é reversível
    // (basta clicar de novo); disparar não é.
    const cancelado = await houveCancelamento(admin, ctx.accountId, String(linha.invitee_uri ?? ""));
    if (cancelado !== false) {
      await liberarClaim(admin, id, String(linha.processando_desde));
      return NextResponse.json(
        { error: cancelado === null ? "db_error" : "agendamento_cancelado" },
        { status: cancelado === null ? 500 : 409 },
      );
    }

    const agendamento = agendamentoDaLinha(linha);
    if (!agendamento) {
      await liberarClaim(admin, id, claimIso);
      return NextResponse.json({ error: "linha_incompleta" }, { status: 422 });
    }

    try {
      const r = await comTetoDeProcessamento(
        processarAgendamento(admin, ctx.accountId, agendamento, varsDaLinha(linha, agendamento)),
      );
      if (!r.pronto) {
        // ⚠️ Estourou o teto. Desistimos ANTES do recolhimento, para que
        // "cadeado velho" signifique mesmo "dono morto" — e gravamos
        // `falhou` (não reprocessável) porque o envio pode ter saído.
        await gravarResultado(
          admin,
          id,
          { resultado: "falhou", detalhe: "o processamento passou do tempo e foi interrompido", contactId: null },
          claimIso,
        );
        return NextResponse.json({ error: "tempo_esgotado" }, { status: 504 });
      }
      await gravarResultado(admin, id, r.valor, claimIso);
      return NextResponse.json({ ok: true, resultado: r.valor.resultado, detalhe: r.valor.detalhe });
    } catch (e) {
      // ⚠️ Estourou DEPOIS do cadeado: a automação pode ter mandado
      // mensagem antes de morrer. Grava `falhou` — que não é reprocessável —
      // em vez de soltar o cadeado limpo, senão o próximo clique repetiria
      // um envio que talvez tenha saído. `gravarResultado` solta o cadeado.
      await gravarResultado(
        admin,
        id,
        { resultado: "falhou", detalhe: e instanceof Error ? e.message.slice(0, 500) : "erro desconhecido", contactId: null },
        claimIso,
      );
      return NextResponse.json({ error: "processamento_falhou" }, { status: 500 });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
