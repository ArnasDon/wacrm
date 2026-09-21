import { NextResponse, after } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { verificarAssinatura } from "@/lib/calendly/assinatura";
import { EVENTO_CANCELADO, eventoDoCorpo, lerAgendamento, lerCancelamento } from "@/lib/calendly/payload";
import { TETO_DO_CANCELAMENTO_MS, processarCancelamento } from "@/lib/calendly/cancelamento";
import { comTetoDeProcessamento } from "@/lib/calendly/claim";
import { gravarResultado, processarAgendamento } from "@/lib/calendly/processar";
import { variaveisDoAgendamento } from "@/lib/calendly/variaveis";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { decrypt } from "@/lib/whatsapp/encryption";

/**
 * POST /api/cb/calendly/webhook/[token]  — PÚBLICO, assinado.
 *
 * O Calendly bate aqui a cada horário marcado. Ordem, e o motivo de cada
 * passo:
 *   1. corpo CRU primeiro (`request.text()`): o HMAC é sobre os bytes;
 *   2. o token da URL diz de QUAL conta é a assinatura (404 se não há);
 *   3. a assinatura `Calendly-Webhook-Signature` é conferida com a chave
 *      daquela conta (401 se não bate — nada é gravado);
 *   4. o evento é gravado com `ON CONFLICT DO NOTHING` na chave
 *      (conta, evento, invitee): o Calendly REENVIA a mesma entrega por 24h
 *      enquanto não recebe 2xx, e a cópia não pode disparar a automação de
 *      novo — quem decide é o UNIQUE da 977, não um `if`;
 *   5. responde 200 e processa em `after()`: o Calendly espera 15 s, e a
 *      automação pode mandar WhatsApp (segundos) — segurar a resposta é
 *      convidar a retentativa. ⚠️ O processamento CRIA a ficha do cliente
 *      quando o telefone ainda não é de nenhum contato (08/09/2026) — ver
 *      `processar.ts`.
 *
 * São DOIS eventos assinados desde 20/09/2026: `invitee.created` (o caminho
 * acima) e `invitee.canceled`, que não cria nada e só DESARMA os lembretes
 * daquele horário (1013). Qualquer outro evento responde 200 e não grava:
 * 4xx faria o Calendly retentar por 24h e desativar a assinatura inteira,
 * inclusive para os agendamentos.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const limit = checkRateLimit(`calendly:webhook:${token}`, RATE_LIMITS.calendlyWebhook);
  if (!limit.success) return rateLimitResponse(limit);

  const corpoCru = await request.text();
  const admin = supabaseAdmin();
  const { data: config, error } = await admin
    .from("cb_calendly_config")
    .select("account_id, signing_key, pergunta_telefone")
    .eq("webhook_token", token)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
  if (!config) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let chave: string;
  try {
    chave = decrypt(config.signing_key);
  } catch {
    console.error("[calendly] chave de assinatura ilegível para a conta", config.account_id);
    return NextResponse.json({ error: "signing_key_unreadable" }, { status: 500 });
  }
  if (!verificarAssinatura(request.headers.get("calendly-webhook-signature"), corpoCru, chave)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let corpo: unknown;
  try {
    corpo = JSON.parse(corpoCru);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const evento = eventoDoCorpo(corpo);

  // ------------------------------------------------------------
  // CANCELAMENTO (1013): caminho próprio, curto.
  //
  // Ele não cria ficha, não dispara automação e não mexe no card: só
  // DESARMA os lembretes daquele horário (ver `cancelamento.ts`). Mesma
  // mecânica do agendamento no resto — grava a linha com o cadeado, responde
  // 200 e processa em `after()` —, porque o Calendly reenvia por 24h e a
  // segunda cópia não pode refazer o trabalho.
  // ------------------------------------------------------------
  if (evento === EVENTO_CANCELADO) {
    const cancelamento = lerCancelamento(corpo);
    if (!cancelamento) {
      console.info(`[calendly] cancelamento sem forma conhecida na conta ${config.account_id}`);
      return NextResponse.json({ ok: true, ignorado: true });
    }

    const claimDoCancelamento = new Date().toISOString();
    const { data: linha, error: erroLinha } = await admin
      .from("cb_calendly_eventos")
      .upsert(
        {
          account_id: config.account_id,
          evento: cancelamento.evento,
          invitee_uri: cancelamento.inviteeUri,
          event_type_uri: cancelamento.eventoUri,
          event_type_nome: cancelamento.eventoNome,
          nome: cancelamento.nome,
          email: cancelamento.email,
          inicio: cancelamento.inicio,
          resultado: "recebido",
          processando_desde: claimDoCancelamento,
        },
        { onConflict: "account_id,evento,invitee_uri", ignoreDuplicates: true },
      )
      .select("id");
    if (erroLinha) {
      console.error("[calendly] não foi possível gravar o cancelamento:", erroLinha.message);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    const idDoCancelamento = linha?.[0]?.id as string | undefined;
    if (!idDoCancelamento) return NextResponse.json({ ok: true, duplicado: true });

    await admin
      .from("cb_calendly_config")
      .update({ last_event_at: new Date().toISOString(), webhook_state: "active" })
      .eq("account_id", config.account_id);

    const contaDoCancelamento = config.account_id as string;
    after(async () => {
      const db = supabaseAdmin();
      try {
        // ⚠️ Teto PRÓPRIO, maior que o do agendamento: o cancelamento pode
        // ficar esperando o agendamento terminar de ser processado, e com o
        // teto padrão ele se cortaria no meio da própria espera.
        const r = await comTetoDeProcessamento(
          processarCancelamento(db, contaDoCancelamento, cancelamento),
          TETO_DO_CANCELAMENTO_MS,
        );
        await gravarResultado(
          db,
          idDoCancelamento,
          r.pronto
            ? r.valor
            : { resultado: "falhou", detalhe: "o cancelamento passou do teto de processamento", contactId: null },
          claimDoCancelamento,
        );
      } catch (e) {
        console.error("[calendly] cancelamento estourou:", e);
        await gravarResultado(
          db,
          idDoCancelamento,
          { resultado: "falhou", detalhe: e instanceof Error ? e.message : "erro desconhecido", contactId: null },
          claimDoCancelamento,
        );
      }
    });

    return NextResponse.json({ ok: true, cancelamento: true });
  }

  const agendamento = lerAgendamento(corpo, { perguntaTelefone: config.pergunta_telefone });
  if (!agendamento) {
    console.info(`[calendly] evento ignorado (${evento ?? "sem event"}) na conta ${config.account_id}`);
    return NextResponse.json({ ok: true, ignorado: true });
  }

  const claimIso = new Date().toISOString();
  const { data: gravado, error: erroInsert } = await admin
    .from("cb_calendly_eventos")
    .upsert(
      {
        account_id: config.account_id,
        evento: agendamento.evento,
        invitee_uri: agendamento.inviteeUri,
        event_type_uri: agendamento.eventoUri,
        event_type_nome: agendamento.eventoNome,
        nome: agendamento.nome,
        email: agendamento.email,
        telefone: agendamento.telefone,
        telefone_origem: agendamento.telefoneOrigem,
        inicio: agendamento.inicio,
        fim: agendamento.fim,
        link: agendamento.link,
        perguntas: agendamento.perguntas,
        // As variáveis que ESTE agendamento entregou ao motor (979): é o que
        // torna "Processar de novo" fiel — a linha não guarda local, cancelar,
        // remarcar nem situação em coluna, e remontá-las daria menos do que a
        // primeira vez, em silêncio.
        variaveis: variaveisDoAgendamento(agendamento),
        resultado: "recebido",
        // ⚠️ O cadeado (980) nasce com a linha: o processamento começa logo
        // abaixo, em `after()`, e sem ele o botão "Processar de novo" podia
        // disparar a MESMA automação em paralelo. `gravarResultado` solta,
        // e toda escrita leva `claimIso` como CERCA DE POSSE.
        processando_desde: claimIso,
      },
      { onConflict: "account_id,evento,invitee_uri", ignoreDuplicates: true },
    )
    .select("id");
  if (erroInsert) {
    console.error("[calendly] não foi possível gravar o evento:", erroInsert.message);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  const eventoId = gravado?.[0]?.id as string | undefined;
  if (!eventoId) {
    // Reentrega: a primeira cópia já está (ou esteve) em processamento.
    return NextResponse.json({ ok: true, duplicado: true });
  }

  // Entrega chegando = assinatura viva: corrige um `disabled` que a
  // conferência do cartão possa ter gravado numa hora ruim.
  await admin
    .from("cb_calendly_config")
    .update({ last_event_at: new Date().toISOString(), webhook_state: "active" })
    .eq("account_id", config.account_id);

  const accountId = config.account_id as string;
  after(async () => {
    const db = supabaseAdmin();
    try {
      // ⚠️ Com TETO: quem passa dele desiste antes do recolhimento do
      // cadeado, para que "cadeado velho" signifique "dono morto" e não
      // "dono lento" — senão outro clique tomaria a linha e dispararia a
      // mesma automação em paralelo (Codex, PR #135).
      const r = await comTetoDeProcessamento(processarAgendamento(db, accountId, agendamento));
      await gravarResultado(
        db,
        eventoId,
        r.pronto
          ? r.valor
          : { resultado: "falhou", detalhe: "o processamento passou do tempo e foi interrompido", contactId: null },
        claimIso,
      );
    } catch (e) {
      console.error("[calendly] processamento falhou:", e instanceof Error ? e.message : e);
      await gravarResultado(
        db,
        eventoId,
        {
          resultado: "falhou",
          detalhe: e instanceof Error ? e.message.slice(0, 500) : "erro desconhecido",
          contactId: null,
        },
        claimIso,
      );
    }
  });

  return NextResponse.json({ ok: true, evento: eventoId });
}
