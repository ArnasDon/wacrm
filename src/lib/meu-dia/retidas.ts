// ============================================================
// Mensagens RETIDAS sem telefone (1009), como o bloco de correções do Meu dia
// as recebe da rota `/api/cb/meu-dia/pendencias`.
//
// Puro. Só ONDE (a conexão) e QUANDO — nada de conteúdo, telefone ou LID: a
// rota é de qualquer membro. Ver docs/PLANO-lid-sem-telefone.md.
// ============================================================

export interface MensagemRetida {
  canalId: string | null;
  recebidaEm: string;
  /** Saiu do escritório (eco do celular pareado), não do cliente. */
  daEquipe: boolean;
}

export interface RetidasNaTela {
  /** O total da janela — a lista traz só as mais recentes. */
  quantidade: number;
  itens: MensagemRetida[];
}

/**
 * PARSE, nunca `as`. Devolve `null` — "não sei" — para tudo que não tem a
 * forma esperada: a rota que não conseguiu conferir (`retidas: null`), o
 * servidor antigo no meio de um deploy (campo ausente), corpo estranho.
 *
 * ⚠️ `null` NUNCA vira zero: zero deixaria o bloco dizer "tudo em ordem"
 * sobre uma pergunta que não foi respondida — a armadilha "lista vazia
 * virando afirmação" do CLAUDE.md.
 */
export function lerRetidas(bruto: unknown): RetidasNaTela | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const { quantidade, itens } = bruto as { quantidade?: unknown; itens?: unknown };
  if (typeof quantidade !== 'number' || !Number.isInteger(quantidade) || quantidade < 0) {
    return null;
  }
  const lista = Array.isArray(itens) ? itens : [];
  return {
    quantidade,
    itens: lista.flatMap((i): MensagemRetida[] => {
      if (!i || typeof i !== 'object') return [];
      const { canalId, recebidaEm, daEquipe } = i as Record<string, unknown>;
      if (typeof recebidaEm !== 'string' || Number.isNaN(Date.parse(recebidaEm))) return [];
      return [
        {
          canalId: typeof canalId === 'string' ? canalId : null,
          recebidaEm,
          // Só o booleano `true` liga (`"true"` e `1` são truthy em JS).
          daEquipe: daEquipe === true,
        },
      ];
    }),
  };
}
