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
import { RECOLHER_CLAIM_MS } from '@/lib/calendly/claim';
import { DIAS_DE_RETIDA_NA_TELA } from '@/lib/meu-dia/correcoes';
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

/**
 * Os que param SEM depender do relógio: já terminaram e precisam de gente.
 *
 * ⚠️ `recebido` fica de fora daqui porque ele é AMBÍGUO — é o estado de
 * quem acabou de chegar e ainda está sendo processado no `after()` da rota
 * de entrada. Contá-lo cru faz a aba acusar entrada travada no exato
 * segundo em que a integração está funcionando, e o aviso falso fica até
 * alguém atualizar (Codex, PR #202). Ele entra só quando o CLAIM já
 * envelheceu — a mesma régua que o recolhedor usa para tomar a linha.
 */
const TERMINARAM_MAL = ['sem_contato', 'sem_automacao', 'falhou'];

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const limite = checkRateLimit(`cb:meuDia:pendencias:${ctx.userId}`, LIMITE);
    if (!limite.success) return rateLimitResponse(limite);

    const db = supabaseAdmin();
    // O corte do claim: antes dele, `recebido` ainda pode estar em curso.
    const claimVelho = new Date(Date.now() - RECOLHER_CLAIM_MS).toISOString();

    /**
     * `terminaram mal` OU (`recebido` com o claim velho ou ausente).
     *
     * ⚠️ `processando_desde.is.null` precisa estar aqui: a linha que NUNCA
     * foi reivindicada — o `after()` morreu antes do claim, ou o processo
     * caiu — é exatamente a que mais precisa de gente, e um filtro só por
     * idade a deixaria de fora para sempre.
     */
    const parado = (tabela: 'cb_calendly_eventos' | 'cb_webhook_eventos') =>
      db
        .from(tabela)
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .in('resultado', NAO_PROCESSADAS)
        .or(
          `resultado.in.(${TERMINARAM_MAL.join(',')}),` +
            `processando_desde.is.null,processando_desde.lt.${claimVelho}`
        );

    // As duas tabelas têm `account_id` PRÓPRIO (977 e 982), além da FK
    // composta com o webhook — o recorte é direto, como a rota
    // `/api/cb/webhooks` já faz. Sem embed: filtro em recurso embutido é a
    // armadilha de `filtros.ts`, e aqui nem seria preciso.
    // Mensagens de WhatsApp RETIDAS por terem chegado em `@lid` sem telefone
    // (1007) — também fechada ao navegador. Daqui saem a contagem e, das mais
    // recentes, só a CONEXÃO e a HORA: é o que diz ao operador em qual
    // celular olhar. Nada de conteúdo, telefone ou LID — a rota é de qualquer
    // membro.
    const desde = new Date(
      Date.now() - DIAS_DE_RETIDA_NA_TELA * 24 * 3600_000
    ).toISOString();
    const retidasDoPeriodo = db
      .from('cb_mensagens_sem_telefone')
      .select('channel_id, recebida_em, from_me', { count: 'exact' })
      .eq('account_id', ctx.accountId)
      .eq('situacao', 'retida')
      .gte('recebida_em', desde)
      .order('recebida_em', { ascending: false })
      .limit(5);

    const [calendly, webhooks, retidas] = await Promise.all([
      parado('cb_calendly_eventos'),
      parado('cb_webhook_eventos'),
      retidasDoPeriodo,
    ]);

    if (calendly.error || webhooks.error) {
      console.error('[cb/meu-dia/pendencias]', {
        calendly: calendly.error?.message,
        webhooks: webhooks.error?.message,
      });
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }

    // ⚠️ A falha SÓ das retidas não vira 500: derrubaria junto a contagem do
    // Calendly e dos webhooks, que responderam. Vira `null` — "não consegui
    // conferir" DAQUELA fonte, que a tela trata como tal (nunca como zero).
    // É também o que acontece num banco sem a 1007 (deploy antes da migration).
    if (retidas.error) {
      console.error('[cb/meu-dia/pendencias] retidas:', retidas.error.message);
    }

    return NextResponse.json({
      naoProcessadas: {
        calendly: calendly.count ?? 0,
        webhooks: webhooks.count ?? 0,
      },
      retidas: retidas.error
        ? null
        : {
            quantidade: retidas.count ?? (retidas.data ?? []).length,
            itens: (retidas.data ?? []).map((r) => ({
              canalId: (r.channel_id as string | null) ?? null,
              recebidaEm: r.recebida_em as string,
              daEquipe: r.from_me === true,
            })),
          },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
