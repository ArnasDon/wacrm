'use client';

// ============================================================
// As conversas que EU marquei (migration 924).
//
// ⚠️ É pessoal, não da conta. A policy de leitura já filtra por
// `user_id = auth.uid()`, então a consulta abaixo não precisa repetir o
// filtro — mas o `user_id` no insert precisa estar certo, porque a policy de
// escrita compara com ele.
//
// Escrita direta do navegador, sob RLS, e isso é deliberado: é o mesmo molde
// das etiquetas e da atribuição de responsável. Uma rota de servidor só faria
// sentido se houvesse efeito colateral (como na anotação, que dispara
// notificação de menção) — aqui não há.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';

export interface UseFavoritasResult {
  /** Ids das conversas que este membro marcou. */
  favoritas: Set<string>;
  /**
   * `false` enquanto a sessão e a conta ainda não resolveram. A tela usa isto
   * para DESABILITAR a estrela: sem ele o clique cai fora e o operador leva um
   * "não deu, tente de novo" sem que nada tenha sido tentado.
   */
  pronto: boolean;
  /**
   * A leitura das favoritas DESTE membro já voltou (com ou sem erro). Antes
   * disso `favoritas` é o conjunto vazio da montagem, e o recorte "Favoritas"
   * aplicado sobre ele diria "nenhuma conversa" (Codex, PR #247).
   */
  carregadas: boolean;
  /** A leitura inicial falhou — as estrelas na tela não são confiáveis. */
  falhouAoCarregar: boolean;
  /** Marca ou desmarca. Devolve `false` quando a gravação falhou. */
  alternar: (conversationId: string) => Promise<boolean>;
}

export function useFavoritas(resyncToken = 0): UseFavoritasResult {
  const { user, accountId } = useAuth();
  // Extraído aqui, e não lido como `user?.id` lá dentro, porque o React
  // Compiler infere a dependência como o objeto `user` inteiro e recusa a
  // memoização manual — o hook inteiro deixa de ser otimizado.
  const userId = user?.id ?? null;
  const [favoritas, setFavoritas] = useState<Set<string>>(new Set());
  const [falhouAoCarregar, setFalhouAoCarregar] = useState(false);
  // De QUEM é a última leitura que voltou. Carimbado com o dono, e não um
  // booleano: trocar de login não pode herdar o "já carregou" do anterior.
  const [carregadasDe, setCarregadasDe] = useState<string | null>(null);

  /**
   * O que está em voo, por conversa: `'marcar'` ou `'desmarcar'`.
   *
   * ⚠️ Existe por dois motivos distintos, e os dois já produziriam divergência
   * silenciosa entre a tela e o banco:
   *
   *  1. **Dois cliques seguidos na mesma linha.** INSERT e DELETE são duas
   *     requisições independentes, sem ordem garantida. Chegando trocadas, o
   *     DELETE não acha linha e volta SUCESSO (`error: null`, 0 linhas), o
   *     INSERT grava depois, e a tela fica desmarcada com a linha existindo.
   *     Nenhum rollback dispara, porque os dois "deram certo".
   *  2. **A leitura inicial (e a do resync) chegando DEPOIS de um clique.**
   *     Ela substitui o conjunto inteiro; sem reaplicar o que está em voo, a
   *     estrela recém-acesa apaga sozinha.
   */
  const emVoo = useRef(new Map<string, 'marcar' | 'desmarcar'>());

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    let cancelado = false;
    void (async () => {
      const { data, error } = await supabase
        .from('cb_conversation_favorites')
        .select('conversation_id');
      if (cancelado) return;
      setCarregadasDe(userId);
      if (error || !data) {
        // ⚠️ Não dá para tratar como "não tenho nenhuma favorita": a tela
        // ficaria com todas as estrelas apagadas e o filtro "Favoritas"
        // diria "nenhuma conversa" para quem marcou vinte ontem. Quem chama
        // avisa o operador.
        setFalhouAoCarregar(true);
        return;
      }
      setFalhouAoCarregar(false);
      const doServidor = new Set(
        data.map((r) => (r as { conversation_id: string }).conversation_id),
      );
      // Reaplica o que ainda não voltou do servidor — ver `emVoo`.
      for (const [id, acao] of emVoo.current) {
        if (acao === 'marcar') doServidor.add(id);
        else doServidor.delete(id);
      }
      setFavoritas(doServidor);
    })();
    return () => {
      cancelado = true;
    };
  }, [userId, resyncToken]);

  const alternar = useCallback(
    async (conversationId: string): Promise<boolean> => {
      if (!userId || !accountId) return false;
      // Um clique por linha de cada vez. O segundo clique enquanto o primeiro
      // está em voo é ignorado, em vez de virar uma segunda requisição sem
      // ordem garantida.
      if (emVoo.current.has(conversationId)) return true;

      const supabase = createClient();
      const jaEra = favoritas.has(conversationId);
      emVoo.current.set(conversationId, jaEra ? 'desmarcar' : 'marcar');

      // Otimista: a estrela acende no clique. O rollback abaixo é o que
      // impede a mentira — sem ele a estrela ficaria acesa até o próximo
      // carregamento e o operador acharia que marcou.
      setFavoritas((prev) => {
        const proximo = new Set(prev);
        if (jaEra) proximo.delete(conversationId);
        else proximo.add(conversationId);
        return proximo;
      });

      const { error } = jaEra
        ? await supabase
            .from('cb_conversation_favorites')
            .delete()
            .eq('conversation_id', conversationId)
            .eq('user_id', userId)
        : await supabase.from('cb_conversation_favorites').insert({
            user_id: userId,
            conversation_id: conversationId,
            account_id: accountId,
          });

      emVoo.current.delete(conversationId);

      // 23505 = a linha já existia. Acontece quando a leitura inicial falhou
      // (a estrela nasceu apagada) e o operador clicou para marcar de novo:
      // o estado que ele queria é exatamente o que já está no banco.
      if (error && error.code !== '23505') {
        setFavoritas((prev) => {
          const volta = new Set(prev);
          if (jaEra) volta.add(conversationId);
          else volta.delete(conversationId);
          return volta;
        });
        return false;
      }
      return true;
    },
    [userId, accountId, favoritas],
  );

  return {
    favoritas,
    pronto: !!userId && !!accountId,
    carregadas: userId !== null && carregadasDe === userId,
    falhouAoCarregar,
    alternar,
  };
}
