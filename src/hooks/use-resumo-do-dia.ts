'use client';

// ============================================================
// As pendências do dia de UMA pessoa, para a tela de entrada (Meu dia).
//
// Consultas em paralelo, cada bloco com estado PRÓPRIO (carregando / falhou
// / pronto). ⚠️ Nunca "0" sem resposta: é a armadilha "lista vazia virando
// afirmação" do CLAUDE.md — um bloco que dissesse "0 tarefas vencidas"
// durante a carga, ou depois de uma falha, liberaria a entrada com uma
// mentira, que é o oposto do que a tela existe para fazer.
//
// ⚠️ TODO filtro "meu" é pelo id do LOGIN (`user.id` = `profiles.user_id`),
// nunca `profiles.id`: `cb_tasks.responsavel_user_id`,
// `conversations.assigned_agent_id` e `notifications.user_id` guardam
// `auth.users.id`. O id errado devolve ZERO sem dar erro. E em `cb_tasks` e
// `conversations` a RLS deixa a conta inteira ler tudo, então o recorte por
// pessoa vai ESCRITO na consulta.
//
// ⚠️ NENHUM NÚMERO AFIRMADO COMO EXATO SAI DE UMA LISTA COM TETO. O
// PostgREST corta em 1000 linhas sem avisar, e uma lista cortada com cara de
// completa é o que a revisão do Codex pegou no PR #196: com mil tarefas
// vencidas, a de hoje ficava fora do teto e a tela dizia "0 vencem hoje".
// A regra aqui: número que a tela afirma vem de `count: 'exact'` (as
// novidades nem trazem linha — são três COUNTs); lista que passa por recorte
// em JS (conversas, fila) carrega o seu próprio sinal `truncada`, POR
// PARTIÇÃO, e a tela escreve "mais de N" naquela partição, nunca um número
// menor com cara de certo.
//
// ⚠️ O resultado é CARIMBADO com a chave do pedido, e outro pedido nunca vê
// o resultado deste: se `desdeMs` ou o contexto mudarem com a tela montada,
// os blocos voltam a "carregando" em vez de exibir os números do pedido
// anterior como se fossem do novo (a família "{ de, mapa }" do CLAUDE.md).
//
// ⚠️ O relógio é lido UMA vez, dentro do efeito, e guardado com o resultado:
// as réguas de "hoje" das tarefas, de "10 min" das conversas e de "desde a
// última entrada" das novidades usam o MESMO instante. (`Date.now()` no
// render reprova o lint do React Compiler; `new Date()` passa e é o mesmo
// erro.)
//
// ⚠️ O recorte por conexão do perfil é feito em JS (`conversaNoEscopo`), e
// por isso o select de conversas traz `group:cb_groups(channel_id)`: filtrar
// `conversations` por canal NA CONSULTA apaga os grupos, cujo `channel_id` é
// sempre nulo (armadilha documentada em `src/lib/inbox/filtros.ts`).
//
// ⚠️ O select é ENXUTO de propósito, e não o `CONVERSATION_SELECT` do inbox
// (contato inteiro + etiquetas + grupo inteiro): a fila sem responsável tem
// centenas de linhas (235 esperando em 12/09/2026), o inbox vai buscar tudo
// de novo logo depois do "Continuar", e aqui só entram o nome do cliente e
// as colunas que as réguas leem.
//
// ⚠️ A fila sai em DUAS consultas, repartidas pelo instante da confirmação
// anterior. Numa só, ordenada por espera e com teto, quem cai primeiro é o
// FIM da lista — as esperas mais recentes, que são exatamente as "novas":
// passando do teto, a tela diria "ninguém começou a esperar" sobre gente
// que começou (a lição do Radar: "com mais linhas que o teto, quem cai é o
// começo da janela").
// ============================================================

import { useEffect, useState } from 'react';

import type { ContatoDaTarefa } from '@/hooks/use-tarefas';
import type { ContextoDeAcesso } from '@/lib/perfis/tipos';
import {
  conversasEsperando,
  resumirConversas,
  resumirFila,
  type ResumoDaFila,
  type ResumoDasConversas,
} from '@/lib/resumo-do-dia/contagens';
import { createClient } from '@/lib/supabase/client';
import { agruparPorPrazo, diaLocal } from '@/lib/tasks/prazo';
import type { Conversation, Task } from '@/types';

export type Bloco<T> =
  | { status: 'carregando' }
  | { status: 'falhou' }
  | { status: 'pronto'; dados: T };

/** Avisos recebidos depois da última confirmação, por tipo — COUNT exato. */
export interface Novidades {
  /** `note_mention` — a pessoa foi citada numa anotação interna. */
  mencoes: number;
  /** `task_assigned` + `task_reply` — tarefa encaminhada ou respondida. */
  tarefas: number;
  /** `conversation_assigned`. */
  conversas: number;
  total: number;
}

export type TarefaDoResumo = Task & { contact: ContatoDaTarefa | null };

export interface Tarefas {
  /** Até `LINHAS_LISTADAS` de cada grupo, na ordem da tela de Tarefas. */
  vencidas: TarefaDoResumo[];
  hoje: TarefaDoResumo[];
  /** Os TOTAIS, do `count: 'exact'` — são estes que a tela afirma. */
  totais: { vencidas: number; hoje: number };
}

export interface Conversas extends ResumoDasConversas {
  /** A consulta das ATRIBUÍDAS bateu no teto: "atribuídas" é PELO MENOS o mostrado. */
  truncada: boolean;
  /**
   * A consulta das ESPERANDO bateu no teto — sinal PRÓPRIO, de consulta
   * própria: derivá-lo da lista de todas as atribuídas dizia "mais de 0
   * seus" para quem tem mil atribuídas e nenhuma esperando (Codex, PR #197).
   */
  truncadaEsperando: boolean;
}

export interface Fila extends ResumoDaFila {
  /**
   * Cada partição com o SEU sinal: só a que bateu no teto vira "mais de N".
   * Com o recorte de perfil feito em JS, o `count` do banco não serve de
   * número — serve de aviso.
   */
  truncadaNovas: boolean;
  truncadaAntigas: boolean;
}

export interface ResumoDoDia {
  /** Instante em que as consultas saíram — a régua de todos os blocos. */
  agoraMs: number;
  novidades: Bloco<Novidades>;
  tarefas: Bloco<Tarefas>;
  conversas: Bloco<Conversas>;
  fila: Bloco<Fila>;
}

const CARREGANDO = { status: 'carregando' } as const;
const FALHOU = { status: 'falhou' } as const;

const VAZIO: ResumoDoDia = {
  agoraMs: 0,
  novidades: CARREGANDO,
  tarefas: CARREGANDO,
  conversas: CARREGANDO,
  fila: CARREGANDO,
};

/** Para-choque das listas que passam por recorte em JS (o sinal `truncada` avisa quando morde). */
const TETO_DE_LINHAS = 1000;

/** Quantas tarefas por grupo vêm como LINHA — a tela lista 5; o número vem do `count`. */
const LINHAS_LISTADAS = 50;

/**
 * Só o que as réguas leem: `conversaNoEscopo` (canal, grupo e o canal do
 * grupo), `atrasoDeResposta` (situação, grupo, espera) e o nome do cliente.
 */
const SELECT_DE_CONVERSA =
  'id, status, assigned_agent_id, channel_id, group_id, aguardando_desde, ' +
  'contact:contacts(id, name, phone, instagram_username), group:cb_groups(channel_id)';

/** O cliente do Supabase devolve `any[]`; as colunas acima são as do tipo que as réguas pedem. */
const conversasDe = (data: unknown): Conversation[] =>
  (data ?? []) as Conversation[];

/** `count` nulo (cabeçalho ausente) NÃO vira zero: cai no tamanho da lista, que é o mínimo verdadeiro. */
const total = (count: number | null, linhas: number): number => count ?? linhas;

export interface PedidoDoResumo {
  userId: string;
  accountId: string;
  /** O contexto de acesso REAL da pessoa — nunca a lente do "Ver como". */
  ctx: ContextoDeAcesso;
  /** Desde quando contar novidades e fila nova (a confirmação anterior). */
  desdeMs: number;
}

function chaveDoPedido(p: PedidoDoResumo): string {
  return [
    p.userId,
    p.accountId,
    p.desdeMs,
    p.ctx.papel ?? '',
    p.ctx.perfil?.id ?? '',
  ].join('|');
}

export function useResumoDoDia(pedido: PedidoDoResumo): ResumoDoDia {
  const { userId, accountId, ctx, desdeMs } = pedido;
  const chave = chaveDoPedido(pedido);
  const [estado, setEstado] = useState<{ chave: string; resumo: ResumoDoDia }>(
    () => ({
      chave,
      resumo: VAZIO,
    })
  );

  useEffect(() => {
    const supabase = createClient();
    let vivo = true;
    const agora = new Date();
    const agoraMs = agora.getTime();
    const hoje = diaLocal(agora);
    const desdeISO = new Date(desdeMs).toISOString();

    const assentar = <K extends keyof Omit<ResumoDoDia, 'agoraMs'>>(
      bloco: K,
      valor: ResumoDoDia[K]
    ) => {
      if (!vivo) return;
      setEstado((e) => {
        const base = e.chave === chave ? e.resumo : VAZIO;
        return { chave, resumo: { ...base, agoraMs, [bloco]: valor } };
      });
    };

    // Cada bloco assenta sozinho (quem responde primeiro aparece primeiro) e
    // qualquer estouro — do banco OU da conta em JS — vira "falhou" naquele
    // bloco: uma rejeição solta deixaria o bloco em "carregando" para sempre.
    const carregar = <K extends keyof Omit<ResumoDoDia, 'agoraMs'>>(
      bloco: K,
      consulta: () => Promise<
        Extract<ResumoDoDia[K], { status: 'pronto' }>['dados']
      >
    ) => {
      void (async () => {
        try {
          const dados = await consulta();
          assentar(bloco, { status: 'pronto', dados } as ResumoDoDia[K]);
        } catch (e) {
          console.error(
            `[useResumoDoDia] ${bloco}:`,
            e instanceof Error ? e.message : e
          );
          assentar(bloco, FALHOU);
        }
      })();
    };

    carregar('novidades', async () => {
      // Três COUNTs (`head: true`): número exato, nenhuma linha, sem teto.
      // `gt` (estrito): o aviso do próprio instante da confirmação já estava
      // na tela quando ela foi confirmada.
      const contar = (tipos: string[]) =>
        supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('account_id', accountId)
          .gt('created_at', desdeISO)
          .in('type', tipos);
      const [mencoes, tarefas, conversas] = await Promise.all([
        contar(['note_mention']),
        contar(['task_assigned', 'task_reply']),
        contar(['conversation_assigned']),
      ]);
      for (const r of [mencoes, tarefas, conversas]) {
        if (r.error) throw new Error(r.error.message);
      }
      const m = mencoes.count ?? 0;
      const t = tarefas.count ?? 0;
      const c = conversas.count ?? 0;
      return { mencoes: m, tarefas: t, conversas: c, total: m + t + c };
    });

    carregar('tarefas', async () => {
      // Dois grupos, cada um com o seu `count`: o número vem do banco, a
      // lista traz só o começo (mais antiga primeiro, como a tela de Tarefas
      // ordena). Numa consulta só, ordenada por prazo e com teto, mil
      // vencidas empurrariam TODAS as de hoje para fora — e "0 vencem hoje"
      // seria mentira.
      const abertas = () =>
        supabase
          .from('cb_tasks')
          .select('*, contact:contacts(id, name, phone, instagram_username)', {
            count: 'exact',
          })
          .eq('account_id', accountId)
          .eq('responsavel_user_id', userId)
          .eq('status', 'aberta')
          .order('vence_em', { ascending: true })
          .order('vence_as', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true })
          .limit(LINHAS_LISTADAS);
      const [vencidas, deHoje] = await Promise.all([
        // A régua é o DIA de quem lê (`diaLocal`), como em /tarefas.
        abertas().lt('vence_em', hoje),
        abertas().eq('vence_em', hoje),
      ]);
      if (vencidas.error) throw new Error(vencidas.error.message);
      if (deHoje.error) throw new Error(deHoje.error.message);
      const linhas = [
        ...(vencidas.data ?? []),
        ...(deHoje.data ?? []),
      ] as unknown as TarefaDoResumo[];
      const grupos = agruparPorPrazo(linhas, agora);
      return {
        vencidas: grupos.vencidas,
        hoje: grupos.hoje,
        totais: {
          vencidas: total(vencidas.count, grupos.vencidas.length),
          hoje: total(deHoje.count, grupos.hoje.length),
        },
      };
    });

    carregar('conversas', async () => {
      const atribuidas = () =>
        supabase
          .from('conversations')
          .select(SELECT_DE_CONVERSA, { count: 'exact' })
          .eq('account_id', accountId)
          .eq('assigned_agent_id', userId)
          .neq('status', 'closed')
          .limit(TETO_DE_LINHAS);
      // As "esperando" numa consulta PRÓPRIA (só quem tem `aguardando_desde`,
      // mais antiga primeiro): o sinal de truncamento delas é delas.
      const [todas, esperando] = await Promise.all([
        atribuidas(),
        atribuidas()
          .is('group_id', null)
          .not('aguardando_desde', 'is', null)
          .order('aguardando_desde', { ascending: true }),
      ]);
      if (todas.error) throw new Error(todas.error.message);
      if (esperando.error) throw new Error(esperando.error.message);
      const linhas = conversasDe(todas.data);
      const linhasEsperando = conversasDe(esperando.data);
      return {
        ...resumirConversas(linhas, ctx, agoraMs),
        esperando: conversasEsperando(linhasEsperando, ctx, agoraMs),
        truncada: total(todas.count, linhas.length) > linhas.length,
        truncadaEsperando:
          total(esperando.count, linhasEsperando.length) >
          linhasEsperando.length,
      };
    });

    carregar('fila', async () => {
      const semResponsavel = () =>
        supabase
          .from('conversations')
          .select(SELECT_DE_CONVERSA, { count: 'exact' })
          .eq('account_id', accountId)
          .is('assigned_agent_id', null)
          .neq('status', 'closed')
          // Grupo nunca tem `aguardando_desde` (972) e a régua o exclui de
          // qualquer jeito; filtrar aqui só poupa linhas.
          .is('group_id', null)
          .order('aguardando_desde', { ascending: true })
          .limit(TETO_DE_LINHAS);
      const [novas, antigas] = await Promise.all([
        semResponsavel().gte('aguardando_desde', desdeISO),
        semResponsavel().lt('aguardando_desde', desdeISO),
      ]);
      if (novas.error) throw new Error(novas.error.message);
      if (antigas.error) throw new Error(antigas.error.message);
      const linhasNovas = conversasDe(novas.data);
      const linhasAntigas = conversasDe(antigas.data);
      return {
        ...resumirFila(
          [...linhasNovas, ...linhasAntigas],
          ctx,
          agoraMs,
          desdeMs
        ),
        truncadaNovas:
          total(novas.count, linhasNovas.length) > linhasNovas.length,
        truncadaAntigas:
          total(antigas.count, linhasAntigas.length) > linhasAntigas.length,
      };
    });

    return () => {
      vivo = false;
    };
  }, [userId, accountId, ctx, desdeMs, chave]);

  return estado.chave === chave ? estado.resumo : VAZIO;
}
