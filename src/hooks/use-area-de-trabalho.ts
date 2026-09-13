'use client';

// ============================================================
// Os blocos que só existem na ABA /meu-dia (F5) — o que precisa ser
// corrigido, o dia até agora, os negócios no funil e a agenda.
//
// Irmão de `use-resumo-do-dia.ts`, com a MESMA disciplina e de propósito
// SEPARADO dele: o cartão da entrada continua pedindo só os quatro blocos
// pessoais, e ninguém paga por estas consultas ao abrir o app.
//
// O que se repete de lá, porque vale igual aqui:
//   · Cada bloco tem estado PRÓPRIO (carregando / falhou / pronto). Nunca
//     "0" sem resposta — aqui o preço é maior: um zero de carga no bloco de
//     correções vira "tudo em ordem" sobre uma mensagem que não saiu.
//   · O resultado é CARIMBADO com a chave do pedido; pedido novo não vê
//     resultado velho.
//   · O relógio é lido UMA vez, dentro do efeito (`Date.now()` no render
//     reprova o React Compiler; `new Date()` passa e é o mesmo erro).
//   · Nenhum número exato sai de lista com teto: aqui quase tudo é
//     `count: 'exact', head: true`, que não traz linha nenhuma.
//
// ⚠️ `head: true` devolve `count` NULO tanto em erro quanto — em tese — na
// ausência de cabeçalho. Por isso o `error` é conferido ANTES, e o bloco só
// assenta como `pronto` quando a consulta deu certo: um `count ?? 0` sem
// olhar o erro é a forma exata de a aba dizer "nenhuma falha" no dia em que
// a rede caiu.
// ============================================================

import { useEffect, useState } from 'react';

import { diaNoFuso, FUSO_PADRAO, paraInstante } from '@/lib/agenda/fuso';
import { startOfLocalDay } from '@/lib/dashboard/date-utils';
import type { Bloco } from '@/hooks/use-resumo-do-dia';
import {
  agruparPorEtapa,
  type GrupoDeEtapa,
  type NegocioDoBloco,
} from '@/lib/meu-dia/negocios';
import { recorteDeCanais, recorteDeFunis } from '@/lib/perfis/escopo';
import type { ContextoDeAcesso } from '@/lib/perfis/tipos';
import { somarDias } from '@/lib/tasks/prazo';
import { createClient } from '@/lib/supabase/client';
import type { Meeting } from '@/types';

/** O mínimo para `nomeDoContato` — a mesma projeção do resto do Meu dia. */
export interface ContatoDoGanho {
  id: string;
  name: string | null;
  phone: string | null;
  instagram_username?: string | null;
}

/** Quantas linhas cada lista da aba mostra — o número vem sempre do `count`. */
const LINHAS_LISTADAS = 5;

/** Teto defensivo das listas que passam por recorte em JS. */
const TETO_DE_LINHAS = 500;

export interface Correcoes {
  /**
   * Falhou e NÃO é entrega incerta — o que dá para reenviar.
   *
   * ⚠️ As duas contagens são DISJUNTAS de propósito: `entrega_incerta` vem
   * sempre junto de `failed` (926 — o envio estourou depois de o WhatsApp
   * aceitar), então somá-las cruas contaria a mesma linha duas vezes. E a
   * separação não é estética: são ações OPOSTAS. Reenviar o que falhou é
   * seguro; reenviar o incerto manda a mesma mensagem duas vezes ao cliente.
   */
  agendadasFalharam: number;
  entregaIncerta: number;
  automacoesFalharam: number;
}

export interface GanhoDoDia {
  id: string;
  quando: string;
  /**
   * ⚠️ O ganho é nomeado pelo CLIENTE, não pelo título do card:
   * `cb_lead_events.deal_id` NÃO tem FK (912 — a trilha preserva o rastro
   * de negócio apagado), então o PostgREST não embute `deals`. `contact_id`
   * tem FK e é o nome que o operador reconhece.
   */
  contato: ContatoDoGanho | null;
}

export interface Resultados {
  /** Mensagens que a EQUIPE mandou hoje — da conta, não da pessoa (ver a nota). */
  mensagensDoEscritorio: number;
  /** Tarefas SUAS concluídas hoje. */
  tarefasConcluidas: number;
  /** Negócios que o escritório ganhou hoje. */
  ganhos: number;
  ganhosRecentes: GanhoDoDia[];
}

export interface Negocios {
  grupos: GrupoDeEtapa[];
  /** Total de negócios abertos seus (depois do recorte de funil). */
  meus: number;
  /** Soma dos valores dos seus abertos. */
  valor: number;
  /** Abertos do escritório sem responsável — o que precisa de dono. */
  semResponsavel: number;
  /** A consulta bateu no teto: `meus` e `valor` são um piso. */
  truncada: boolean;
}

export interface Agenda {
  /**
   * Suas reuniões de hoje e amanhã, da agenda do CRM.
   *
   * ⚠️ SÓ `cb_meetings`. Os agendamentos do Calendly não entram: aquela
   * tabela guarda só `invitee.created`, então uma reunião cancelada — ou a
   * ponta velha de um reagendamento — continua lá com hora futura, e a
   * tela afirmaria compromisso que não existe.
   */
  reunioes: Meeting[];
  /**
   * Quantas ficaram FORA do teto da lista.
   *
   * ⚠️ Vem do `count: 'exact'`, não de contar o array: com mais de
   * `LINHAS_LISTADAS` reuniões em dois dias, o teto derrubava as últimas em
   * silêncio e o bloco não dizia que havia mais — escondendo justamente o
   * compromisso do fim do dia (Codex, PR #202).
   */
  restantes: number;
}

export interface Integracoes {
  calendly: number;
  webhooks: number;
}

export interface AreaDeTrabalho {
  agoraMs: number;
  correcoes: Bloco<Correcoes>;
  integracoes: Bloco<Integracoes>;
  resultados: Bloco<Resultados>;
  negocios: Bloco<Negocios>;
  agenda: Bloco<Agenda>;
}

const CARREGANDO = { status: 'carregando' } as const;
const FALHOU = { status: 'falhou' } as const;

const VAZIA: AreaDeTrabalho = {
  agoraMs: 0,
  correcoes: CARREGANDO,
  integracoes: CARREGANDO,
  resultados: CARREGANDO,
  negocios: CARREGANDO,
  agenda: CARREGANDO,
};

/** Só o que o bloco de negócios lê — o quadro tem select próprio, bem maior. */
const SELECT_DE_NEGOCIO =
  'id, title, value, pipeline_id, stage_id, ' +
  'pipeline:pipelines(id, name), stage:pipeline_stages(id, name, position)';

const linhas = <T>(data: unknown): T[] => (data ?? []) as T[];

export interface PedidoDaArea {
  userId: string;
  /**
   * ⚠️ `profiles.id`, NÃO `user.id`. `deals.assigned_to` aponta para
   * `profiles`, ao contrário de `cb_tasks`/`conversations`/`notifications`.
   * Ver a nota em `src/lib/meu-dia/negocios.ts`. Nulo enquanto o perfil não
   * resolveu — e aí o bloco de negócios espera, em vez de afirmar zero.
   */
  profileId: string | null;
  accountId: string;
  /** A LENTE do "Ver como" — esta aba vive dentro do app. */
  ctx: ContextoDeAcesso;
  /** Muda para consultar de novo (o "Atualizar"). */
  versao?: number;
}

function chaveDoPedido(p: PedidoDaArea): string {
  return [
    p.userId,
    p.profileId ?? '',
    p.accountId,
    p.ctx.papel ?? '',
    p.ctx.perfil?.id ?? '',
    p.versao ?? 0,
  ].join('|');
}

export function useAreaDeTrabalho(pedido: PedidoDaArea): AreaDeTrabalho {
  const { userId, profileId, accountId, ctx } = pedido;
  const chave = chaveDoPedido(pedido);
  const [estado, setEstado] = useState<{ chave: string; area: AreaDeTrabalho }>(
    () => ({ chave, area: VAZIA })
  );

  useEffect(() => {
    const supabase = createClient();
    let vivo = true;
    const agora = new Date();
    const agoraMs = agora.getTime();
    // ⚠️ São DOIS "hojes" nesta tela, e a diferença é deliberada. Aqui o
    // dia é o de QUEM LÊ (`startOfLocalDay`, o mesmo do Painel e da régua de
    // prazo das tarefas): "o que aconteceu hoje" é uma pergunta sobre o dia
    // da pessoa. Já a AGENDA recorta no fuso da agenda (`FUSO_PADRAO`),
    // porque `cb_meetings` define e exibe data naquele fuso. Unificar os
    // dois moveria uma das duas respostas para um dia que ninguém pediu.
    const inicioDoDia = startOfLocalDay(agora).toISOString();
    const canais = recorteDeCanais(ctx);
    const funis = recorteDeFunis(ctx);

    const assentar = <K extends keyof Omit<AreaDeTrabalho, 'agoraMs'>>(
      bloco: K,
      valor: AreaDeTrabalho[K]
    ) => {
      if (!vivo) return;
      setEstado((e) => {
        const base = e.chave === chave ? e.area : VAZIA;
        return { chave, area: { ...base, agoraMs, [bloco]: valor } };
      });
    };

    const carregar = <K extends keyof Omit<AreaDeTrabalho, 'agoraMs'>>(
      bloco: K,
      consulta: () => Promise<
        Extract<AreaDeTrabalho[K], { status: 'pronto' }>['dados']
      >
    ) => {
      void (async () => {
        try {
          const dados = await consulta();
          assentar(bloco, { status: 'pronto', dados } as AreaDeTrabalho[K]);
        } catch (e) {
          console.error(
            `[useAreaDeTrabalho] ${bloco}:`,
            e instanceof Error ? e.message : e
          );
          assentar(bloco, FALHOU);
        }
      })();
    };

    carregar('correcoes', async () => {
      // ⚠️ O recorte por conexão vai NA CONSULTA aqui, e isso só é seguro
      // porque `cb_scheduled_messages` carrega o próprio `channel_id`,
      // fixado no agendamento (925). Em `conversations` seria errado — lá o
      // canal do grupo mora noutra tabela.
      const agendadas = () => {
        const q = supabase
          .from('cb_scheduled_messages')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', accountId)
          .eq('status', 'failed');
        return canais ? q.in('channel_id', canais) : q;
      };
      const [falharam, incertas, automacoes] = await Promise.all([
        agendadas().eq('entrega_incerta', false),
        agendadas().eq('entrega_incerta', true),
        // ⚠️⚠️ `desfecho`, NUNCA `status`: `automation_logs.status` nasce
        // 'failed' no INSERT, ANTES do primeiro passo (985) — filtrar por
        // ele pintaria de vermelho toda automação que apenas COMEÇOU,
        // inclusive as paradas num "Aguardar". `finalizado_em` no filtro
        // recorta o dia E garante que a execução terminou.
        supabase
          .from('automation_logs')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', accountId)
          .eq('desfecho', 'falhou')
          .gte('finalizado_em', inicioDoDia),
      ]);
      if (falharam.error) throw new Error(falharam.error.message);
      if (incertas.error) throw new Error(incertas.error.message);
      if (automacoes.error) throw new Error(automacoes.error.message);
      return {
        agendadasFalharam: falharam.count ?? 0,
        entregaIncerta: incertas.count ?? 0,
        automacoesFalharam: automacoes.count ?? 0,
      };
    });

    carregar('integracoes', async () => {
      const r = await fetch('/api/cb/meu-dia/pendencias');
      if (!r.ok) throw new Error(`pendencias: HTTP ${r.status}`);
      const json = (await r.json()) as {
        naoProcessadas?: { calendly?: number; webhooks?: number };
      };
      return {
        calendly: json.naoProcessadas?.calendly ?? 0,
        webhooks: json.naoProcessadas?.webhooks ?? 0,
      };
    });

    carregar('resultados', async () => {
      const [mensagens, tarefas, ganhos] = await Promise.all([
        // ⚠️ "Da EQUIPE", não "suas": a régua de resposta humana é
        // `sender_id` OU `from_device` (CLAUDE.md), e o celular pareado —
        // por onde 948 de 956 mensagens da equipe saíram, medido — grava
        // `from_device` com `sender_id` NULO. Não há autor a quem creditar
        // a maior parte do trabalho real, então a aba credita ao escritório
        // em vez de mostrar um dia quase vazio para quem trabalhou o dia
        // inteiro. ⚠️ `messages` não tem `account_id`: a conta entra pelo
        // embed `!inner`, senão o número seria de todas as contas de que a
        // pessoa é membro.
        supabase
          .from('messages')
          .select('id, conversation:conversations!inner(account_id)', {
            count: 'exact',
            head: true,
          })
          .eq('conversation.account_id', accountId)
          .eq('sender_type', 'agent')
          .or('sender_id.not.is.null,from_device.is.true')
          .is('deleted_at', null)
          .gte('created_at', inicioDoDia),
        // ⚠️ "Suas tarefas concluídas", nunca "que você concluiu": não
        // existe `concluida_por`, e criador e admin também dão baixa.
        supabase
          .from('cb_tasks')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', accountId)
          .eq('responsavel_user_id', userId)
          .eq('status', 'concluida')
          .gte('concluida_em', inicioDoDia),
        // ⚠️ Do ESCRITÓRIO: ganho carimbado por automação ou pelo gatilho
        // da etapa (950) tem `actor_user_id` NULO, então "ganhos por mim"
        // subcontaria em silêncio justamente quando a operação funciona.
        supabase
          .from('cb_lead_events')
          .select(
            'id, occurred_at, contact:contacts(id, name, phone, instagram_username)',
            { count: 'exact' }
          )
          .eq('account_id', accountId)
          .eq('event_type', 'status_changed')
          .eq('to_status', 'won')
          .gte('occurred_at', inicioDoDia)
          .order('occurred_at', { ascending: false })
          .limit(LINHAS_LISTADAS),
      ]);
      if (mensagens.error) throw new Error(mensagens.error.message);
      if (tarefas.error) throw new Error(tarefas.error.message);
      if (ganhos.error) throw new Error(ganhos.error.message);
      const linhasGanhas = linhas<{
        id: string;
        occurred_at: string;
        contact: ContatoDoGanho | null;
      }>(ganhos.data);
      return {
        mensagensDoEscritorio: mensagens.count ?? 0,
        tarefasConcluidas: tarefas.count ?? 0,
        ganhos: ganhos.count ?? linhasGanhas.length,
        ganhosRecentes: linhasGanhas.map((l) => ({
          id: l.id,
          quando: l.occurred_at,
          contato: l.contact ?? null,
        })),
      };
    });

    // ⚠️ Sem o perfil resolvido não há como perguntar "meus", e as duas
    // respostas possíveis seriam erradas: zero é a mentira do bloco vazio, e
    // "falhou" pisca vermelho sobre algo que não falhou — nada foi
    // perguntado ainda. O bloco fica no estado inicial (carregando) e o
    // efeito roda de novo quando o perfil chega, porque `profileId` entra na
    // chave do pedido.
    if (profileId)
      carregar('negocios', async () => {
        const semResponsavel = () => {
          const q = supabase
            .from('deals')
            .select('id', { count: 'exact', head: true })
            .eq('account_id', accountId)
            .is('assigned_to', null)
            .eq('status', 'open');
          // Lista vazia = sem recorte = todos, a convenção do projeto.
          return funis && funis.length > 0 ? q.in('pipeline_id', funis) : q;
        };
        const [meus, orfas] = await Promise.all([
          supabase
            .from('deals')
            .select(SELECT_DE_NEGOCIO, { count: 'exact' })
            .eq('account_id', accountId)
            .eq('assigned_to', profileId)
            .eq('status', 'open')
            .limit(TETO_DE_LINHAS),
          // ⚠️ Os sem responsável passam pelo MESMO recorte de funil dos
          // seus — aqui na consulta, porque é contagem e não há lista para
          // filtrar depois. Sem ele, um perfil restrito ao trabalhista via
          // "12 negócios sem responsável" do escritório inteiro e, ao
          // seguir o link, não achava nenhum: a tela de Funis só oferece os
          // funis visíveis (Codex, PR #202).
          semResponsavel(),
        ]);
        if (meus.error) throw new Error(meus.error.message);
        if (orfas.error) throw new Error(orfas.error.message);
        const lista = linhas<NegocioDoBloco>(meus.data);
        const grupos = agruparPorEtapa(lista, ctx);
        return {
          grupos,
          meus: grupos.reduce((s, g) => s + g.quantidade, 0),
          valor: grupos.reduce((s, g) => s + g.valor, 0),
          semResponsavel: orfas.count ?? 0,
          truncada: (meus.count ?? lista.length) > lista.length,
        };
      });

    carregar('agenda', async () => {
      // Hoje e amanhã: a reunião de amanhã cedo precisa aparecer para quem
      // olha a tela no fim da tarde.
      //
      // ⚠️ O recorte é no FUSO DA AGENDA (`FUSO_PADRAO`), não na meia-noite
      // local do navegador: `cb_meetings` define e exibe data naquele fuso,
      // e um navegador em UTC logo depois da meia-noite cortaria boa parte
      // do dia ainda corrente em São Paulo e traria um pedaço de um dia a
      // mais (Codex, PR #202). Aqui não muda nada enquanto todo mundo está
      // no Brasil — muda no dia em que houver advogado em outro país, que é
      // o mesmo motivo pelo qual `cb_availability` guarda `time` + fuso.
      const hojeNoFuso = diaNoFuso(agora, FUSO_PADRAO);
      const de = paraInstante(hojeNoFuso, '00:00', FUSO_PADRAO);
      const ate = paraInstante(somarDias(hojeNoFuso, 2), '00:00', FUSO_PADRAO);
      const { data, error, count } = await supabase
        .from('cb_meetings')
        .select('*', { count: 'exact' })
        .eq('account_id', accountId)
        .eq('owner_user_id', userId)
        .neq('status', 'cancelada')
        .gte('starts_at', de.toISOString())
        .lt('starts_at', ate.toISOString())
        .order('starts_at', { ascending: true })
        .limit(LINHAS_LISTADAS);
      if (error) throw new Error(error.message);
      const lista = linhas<Meeting>(data);
      return {
        reunioes: lista,
        restantes: Math.max(0, (count ?? lista.length) - lista.length),
      };
    });

    return () => {
      vivo = false;
    };
  }, [userId, profileId, accountId, ctx, chave]);

  return estado.chave === chave ? estado.area : VAZIA;
}
