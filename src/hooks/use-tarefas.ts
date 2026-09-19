'use client';

// ============================================================
// As tarefas para a tela (migration 944).
//
// Lê direto da tabela: a policy de SELECT já recorta por conta e não há nada a
// compor que justifique uma rota. Escrita é outra história — essa passa toda
// por `/api/cb/tasks` (ver `use-acoes-da-tarefa`).
//
// ⚠️ DUAS CONSULTAS, E SÓ UMA PAGINA — mesmo desenho da tela de agendadas, e
// pelo mesmo motivo. As pendentes vêm INTEIRAS porque cada uma é trabalho que
// alguém ainda tem de fazer: uma tarefa vencida há três meses continua
// esperando, e é exatamente ela que uma paginação empurraria para fora da tela,
// deixando a fila com cara de resolvida. As concluídas paginam porque são o
// único grupo que só cresce e não pede nada de ninguém.
//
// ⚠️ SEM REALTIME NA LISTA, de propósito — a etiqueta do menu tem
// (`use-tarefas-nao-lidas`), e é ela que precisa estar certa em toda tela. Aqui
// o payload do realtime não traz o contato embutido, então cada evento
// obrigaria a refazer a consulta inteira; a tela recarrega quando a visão muda
// e depois de cada ação, que é quando o conteúdo realmente muda para quem está
// olhando.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import type { Task } from '@/types';

/**
 * Os três recortes da tela.
 *
 * ⚠️ `todas` é de TODO MUNDO, não só do admin: a policy não recorta por papel
 * e a decisão do operador é que a equipe inteira enxergue a fila inteira —
 * tarefa escondida é tarefa que ninguém cobre quando o responsável falta.
 */
export type VisaoDeTarefas = 'para-mim' | 'criadas-por-mim' | 'todas';

export const VISOES: readonly VisaoDeTarefas[] = [
  'para-mim',
  'criadas-por-mim',
  'todas',
] as const;

/** Quantas concluídas por página. */
export const PAGINA = 50;

/**
 * Para-choque das pendentes, que vêm sem paginação.
 *
 * ⚠️ Não é paginação: é o limite que impede um dia ruim de despejar milhares
 * de linhas na tela. Se for atingido, `pendentesTruncadas` acende e a tela
 * avisa — em vez de cortar em silêncio, que é o que o teto de 1000 linhas do
 * PostgREST faria sozinho.
 */
const TETO_PENDENTES = 500;

/** O contato como ele chega aqui — só o que a linha mostra. */
export interface ContatoDaTarefa {
  id: string;
  name: string | null;
  phone: string | null;
  instagram_username?: string | null;
}

export type TarefaNaTela = Task & {
  /** Nulo se o contato sumiu entre a leitura e o embed. */
  contact: ContatoDaTarefa | null;
  /**
   * A conversa daquele cliente, para o clique abrir o inbox.
   *
   * ⚠️ DERIVADA, não guardada: `cb_tasks` não tem `conversation_id` de
   * propósito (uma segunda cópia da mesma verdade envelheceria quando a
   * conversa fosse apagada e recriada). Nulo para cliente cadastrado à mão que
   * nunca trocou mensagem — a tela cai na ficha em vez do fio.
   */
  conversation_id: string | null;
};

const SELECT = '*, contact:contacts(id, name, phone, instagram_username)';

export interface TarefasDaTela {
  pendentes: TarefaNaTela[];
  concluidas: TarefaNaTela[];
  carregando: boolean;
  /**
   * ⚠️ Separado de "lista vazia": as duas pintam a mesma tela em branco, e
   * "não há tarefa nenhuma" é uma afirmação que faz alguém criar de novo o que
   * já existe — ou, pior, ir embora achando que não tem nada para fazer.
   */
  falhou: boolean;
  pendentesTruncadas: boolean;
  /** Quantas existem NA CONTA, não quantas foram carregadas. */
  totalPendentes: number;
  totalConcluidas: number;
  temMaisConcluidas: boolean;
  carregarMaisConcluidas: () => void;
  recarregar: () => void;
  /**
   * Recarrega MANTENDO a lista na tela e as páginas já abertas: é o de quem
   * volta para o app (`useAoVoltarParaOApp`). O `recarregar` comum liga o
   * "carregando", que troca a lista pelo spinner.
   */
  recarregarEmSilencio: () => void;
}

export function useTarefas(visao: VisaoDeTarefas): TarefasDaTela {
  const { user, accountId } = useAuth();
  const userId = user?.id ?? null;

  const [pendentes, setPendentes] = useState<TarefaNaTela[]>([]);
  const [concluidas, setConcluidas] = useState<TarefaNaTela[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [falhou, setFalhou] = useState(false);
  const [totalPendentes, setTotalPendentes] = useState(0);
  const [totalConcluidas, setTotalConcluidas] = useState(0);
  const [paginas, setPaginas] = useState(1);
  const [token, setToken] = useState(0);
  /**
   * A próxima consulta é SILENCIOSA (pedida por `recarregarEmSilencio`): a
   * lista fica na tela até a resposta chegar, e uma falha não a troca pelo
   * aviso de erro — o que está na tela era verdade quando chegou.
   */
  const silenciosaRef = useRef(false);

  const recarregar = useCallback(() => {
    setPaginas(1);
    setToken((t) => t + 1);
  }, []);

  const recarregarEmSilencio = useCallback(() => {
    silenciosaRef.current = true;
    setToken((t) => t + 1);
  }, []);

  const carregarMaisConcluidas = useCallback(() => {
    setPaginas((p) => p + 1);
  }, []);

  // Trocar de visão volta o acervo para a primeira página — senão "Todas"
  // herdaria as cinco páginas que alguém abriu em "Para mim".
  //
  // ⚠️ Ajustado DURANTE a render, não num efeito. É o padrão do React para
  // "estado que depende de uma prop que mudou": num efeito, a tela chegaria a
  // pintar uma vez com a visão nova e a paginação velha — e essa render
  // intermediária dispararia a consulta errada antes de ser corrigida.
  const [visaoAnterior, setVisaoAnterior] = useState(visao);
  if (visao !== visaoAnterior) {
    setVisaoAnterior(visao);
    setPaginas(1);
  }

  useEffect(() => {
    if (!accountId || !userId) return;
    const supabase = createClient();
    let cancelado = false;
    const silenciosa = silenciosaRef.current;
    silenciosaRef.current = false;

    (async () => {
      if (!silenciosa) setCarregando(true);

      /** O recorte da visão, aplicado igual nas duas consultas. */
      const recortar = <T extends { eq: (c: string, v: string) => T }>(q: T): T => {
        if (visao === 'para-mim') return q.eq('responsavel_user_id', userId);
        if (visao === 'criadas-por-mim') return q.eq('criador_user_id', userId);
        return q;
      };

      const [pend, conc] = await Promise.all([
        recortar(
          supabase
            .from('cb_tasks')
            .select(SELECT, { count: 'exact' })
            .eq('account_id', accountId)
            .eq('status', 'aberta'),
        )
          // A ordem final é da `agruparPorPrazo`; esta só garante que, se o
          // teto morder, o que fica são as mais urgentes.
          .order('vence_em', { ascending: true })
          .limit(TETO_PENDENTES),
        recortar(
          supabase
            .from('cb_tasks')
            .select(SELECT, { count: 'exact' })
            .eq('account_id', accountId)
            .eq('status', 'concluida'),
        )
          .order('concluida_em', { ascending: false })
          .range(0, paginas * PAGINA - 1),
      ]);

      if (cancelado) return;

      if (pend.error || conc.error) {
        console.error(
          '[useTarefas] falha ao carregar:',
          pend.error?.message ?? conc.error?.message,
        );
        if (!silenciosa) setFalhou(true);
        setCarregando(false);
        return;
      }

      const linhas = [
        ...((pend.data ?? []) as unknown as TarefaNaTela[]),
        ...((conc.data ?? []) as unknown as TarefaNaTela[]),
      ];

      // ------------------------------------------------------------
      // A conversa de cada cliente, para o clique abrir o fio
      // ------------------------------------------------------------
      // `idx_conversations_account_contact` é UNIQUE em (account_id,
      // contact_id) desde a 036, então isto é 1:1 e o mapa não perde nada.
      const ids = [...new Set(linhas.map((t) => t.contact_id))];
      const conversaDe = new Map<string, string>();
      if (ids.length > 0) {
        const { data: conversas } = await supabase
          .from('conversations')
          .select('id, contact_id')
          .eq('account_id', accountId)
          .in('contact_id', ids);
        for (const c of conversas ?? []) {
          if (c.contact_id) conversaDe.set(c.contact_id as string, c.id as string);
        }
      }
      if (cancelado) return;

      const comConversa = (t: TarefaNaTela): TarefaNaTela => ({
        ...t,
        conversation_id: conversaDe.get(t.contact_id) ?? null,
      });

      setPendentes(((pend.data ?? []) as unknown as TarefaNaTela[]).map(comConversa));
      setConcluidas(((conc.data ?? []) as unknown as TarefaNaTela[]).map(comConversa));
      setTotalPendentes(pend.count ?? 0);
      setTotalConcluidas(conc.count ?? 0);
      setFalhou(false);
      setCarregando(false);
    })();

    return () => {
      cancelado = true;
    };
  }, [accountId, userId, visao, paginas, token]);

  return {
    pendentes,
    concluidas,
    carregando,
    falhou,
    // ⚠️ Comparado com o TOTAL da conta (`count: exact`), não com o teto: com
    // exatamente 500 pendentes, `length >= TETO` acusaria corte onde nada foi
    // cortado — o aviso de lista incompleta em cima de uma lista completa.
    pendentesTruncadas: totalPendentes > pendentes.length,
    totalPendentes,
    totalConcluidas,
    temMaisConcluidas: concluidas.length < totalConcluidas,
    carregarMaisConcluidas,
    recarregar,
    recarregarEmSilencio,
  };
}
