// ============================================================
// GET /api/cb/meu-dia/pendencias — o que o NAVEGADOR não consegue perguntar.
//
// `cb_calendly_eventos` e `cb_webhook_eventos` são fechadas ao cliente
// (`REVOKE ALL … FROM authenticated`, RLS ligada e ZERO policies): do
// navegador a consulta volta **0 linhas com `error: null`** — bloco
// permanentemente zerado com cara de resposta certa. Por isso a aba pergunta
// por aqui, em service-role.
//
// ⚠️ Qualquer MEMBRO, não `admin` — ao contrário das rotas de LOG dessas
// mesmas tabelas (`/api/cb/calendly/eventos`, `/api/cb/webhooks/[id]/eventos`),
// que são de admin porque devolvem o registro inteiro: telefone, respostas
// do formulário, o payload achatado do Typebot. Aqui saem CONTAGENS e, dos
// agendamentos, só o que o atendente já vê na ficha do cliente (nome e
// horário). Quem precisa consertar a entrega é quem está atendendo.
//
// ⚠️ Erro vira 500, nunca `{}` com zeros: um objeto vazio com 200 faria a
// aba dizer "tudo em ordem" sobre uma pergunta que não foi respondida — a
// razão de `resumirCorrecoes` ter um estado `incompleto`.
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';

/** A aba pede na abertura e no "Atualizar"; 30/min cobre várias abas. */
const LIMITE = { limit: 30, windowMs: 60_000 };

/**
 * Entrada que PAROU antes de virar trabalho. `sem_telefone` e `ignorado`
 * ficam de fora: são desfechos legítimos — o agendamento sem telefone não
 * tem como virar conversa, e `ignorado` é o que a própria regra descartou.
 * `em_espera` também fica de fora: a automação está num "Aguardar", e quem
 * a retoma é o agendador (a linha do evento não muda mais).
 */
const NAO_PROCESSADAS = ['recebido', 'sem_contato', 'sem_automacao', 'falhou'];

/** Quantos agendamentos futuros a aba mostra. */
const PROXIMOS = 5;

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const limite = checkRateLimit(`cb:meuDia:pendencias:${ctx.userId}`, LIMITE);
    if (!limite.success) return rateLimitResponse(limite);

    const db = supabaseAdmin();
    const agoraISO = new Date().toISOString();

    // ⚠️ `cb_webhook_eventos` NÃO tem `account_id` próprio — a conta entra
    // pelo webhook dono (FK composta `(webhook_id, account_id)`). Sem o
    // `!inner`, o embed não recorta nada e a contagem seria da instalação
    // inteira.
    const [calendly, webhooks, agendamentos] = await Promise.all([
      db
        .from('cb_calendly_eventos')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .in('resultado', NAO_PROCESSADAS),
      db
        .from('cb_webhook_eventos')
        .select('id, webhook:cb_webhooks!inner(account_id)', {
          count: 'exact',
          head: true,
        })
        .eq('webhook.account_id', ctx.accountId)
        .in('resultado', NAO_PROCESSADAS),
      db
        .from('cb_calendly_eventos')
        .select('id, nome, inicio, link, contact_id')
        .eq('account_id', ctx.accountId)
        .not('inicio', 'is', null)
        .gte('inicio', agoraISO)
        .order('inicio', { ascending: true })
        .limit(PROXIMOS),
    ]);

    if (calendly.error || webhooks.error || agendamentos.error) {
      console.error('[cb/meu-dia/pendencias]', {
        calendly: calendly.error?.message,
        webhooks: webhooks.error?.message,
        agendamentos: agendamentos.error?.message,
      });
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }

    return NextResponse.json({
      naoProcessadas: {
        calendly: calendly.count ?? 0,
        webhooks: webhooks.count ?? 0,
      },
      proximosAgendamentos: agendamentos.data ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
