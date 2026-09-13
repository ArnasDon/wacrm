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
// do formulário, o payload achatado do Typebot. Daqui saem só CONTAGENS.
// Quem precisa consertar a entrega é quem está atendendo.
//
// ⚠️⚠️ NÃO devolve "próximos agendamentos", e a primeira versão devolvia.
// A integração do Calendly (977) grava SÓ `invitee.created`: cancelamento é
// ignorado, e reagendamento INSERE uma linha nova sem invalidar a antiga
// (a URI do convidado muda). Então uma consulta por `inicio >= agora`
// devolve reunião cancelada e as duas pontas de um reagendamento como se
// ambas fossem acontecer — a tela afirmaria compromisso que não existe
// (Codex, PR #202). Volta quando a 977 tratar `invitee.canceled`.
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

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const limite = checkRateLimit(`cb:meuDia:pendencias:${ctx.userId}`, LIMITE);
    if (!limite.success) return rateLimitResponse(limite);

    const db = supabaseAdmin();

    const [calendly, webhooks] = await Promise.all([
      db
        .from('cb_calendly_eventos')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .in('resultado', NAO_PROCESSADAS),
      // `cb_webhook_eventos` tem `account_id` PRÓPRIO (982), além da FK
      // composta com o webhook — o recorte é direto, como a rota
      // `/api/cb/webhooks` já faz. Sem embed: filtro em recurso embutido é
      // a armadilha de `filtros.ts`, e aqui nem seria preciso.
      db
        .from('cb_webhook_eventos')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .in('resultado', NAO_PROCESSADAS),
    ]);

    if (calendly.error || webhooks.error) {
      console.error('[cb/meu-dia/pendencias]', {
        calendly: calendly.error?.message,
        webhooks: webhooks.error?.message,
      });
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }

    return NextResponse.json({
      naoProcessadas: {
        calendly: calendly.count ?? 0,
        webhooks: webhooks.count ?? 0,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
