/**
 * O laço PAGINADO do PostgREST, num lugar só.
 *
 * ⚠️⚠️ O PostgREST corta em ~1000 linhas **sem avisar**: a consulta volta com
 * `error: null`, `data` com mil linhas e cara de completa. Não há sintoma —
 * nenhum toast, nenhum log, nada na tela dizendo que faltou. Já mordeu três
 * vezes neste repositório, e das três a última só foi descoberta ao medir o
 * que a migração da Kommo faria:
 *
 *  - a consulta de `deals` do filtro da caixa de entrada (PR #71): passar de
 *    1000 negócios derrubava o recorte por etapa PARA SEMPRE;
 *  - a RPC das trajetórias do funil (`src/lib/funil/carregar.ts`, 975);
 *  - o QUADRO do funil e a LISTA de conversas, consertados aqui.
 *
 * Quatro invariantes, e todas já foram violadas:
 *
 *  1. **`order` é obrigatório em quem chama.** `range` sem `order` é
 *     LIMIT/OFFSET sobre ordem INDEFINIDA: uma linha que muda de posição
 *     entre duas páginas some ou vem duas vezes. E o `order` precisa
 *     DESEMPATAR — ordenar 8 mil cards só por `created_at` deixa os empates
 *     soltos, e o empate é exatamente onde a página quebra. Some sempre uma
 *     coluna única (`id`) no fim.
 *  2. **`count: 'exact'` é o que FECHA o laço.** Sem ele não há como
 *     distinguir "a coleção acabou" de "a página veio cheia por acaso".
 *  3. **`null` é o contrato para "não confie".** Quem chama esconde a vista,
 *     mostra o erro ou cai num plano B — nunca publica a lista parcial. Meia
 *     lista com cara de lista inteira é o defeito que este módulo existe para
 *     impedir.
 *  4. **Teto de páginas.** Acima dele, admitir que não coube é melhor que
 *     recortar errado em silêncio.
 *  5. **As páginas vão EM FILA, uma depois da outra.** Não é descuido: foi
 *     paralelizado em 21/09/2026 (PR #247) e desfeito na mesma noite, por
 *     duas anotações do Codex. Páginas por OFFSET pedidas JUNTAS não
 *     compartilham a foto do banco, e podem vê-la em ordem inversa à dos
 *     offsets: se o offset 2000 responde ANTES de uma inserção na posição
 *     1500 e o 1000 responde DEPOIS, a linha que estava na posição 1999 não
 *     vem em página nenhuma — uma linha que JÁ EXISTIA, não a nova —, e a
 *     página seguinte devolve outra repetida, fechando a contagem. Num
 *     disparo, é um destinatário pulado em silêncio. Em fila, a página de
 *     offset maior nunca vê o banco antes da menor, e a inserção no meio só
 *     repete linha ou perde a NOVA. Quem precisar de velocidade aqui troca
 *     OFFSET por chave (keyset), não paraleliza.
 *
 * ⚠️ Recorte que MUDA enquanto se lê pede `buscarPorChave`, não este laço —
 * ver lá.
 *
 * ⚠️ `src/lib/funil/carregar.ts` tem uma cópia deste laço e NÃO foi migrada
 * de propósito: ela faz o parse de cada linha (`lerLinha`) dentro do laço e
 * descarta a carga no primeiro desvio de forma, o que é uma garantia a mais
 * que este módulo não oferece. Quem for unificar os dois precisa resolver
 * isso antes — e tem teste próprio dos dois lados para se apoiar.
 */

export const PAGINA = 1000;

/** 25 páginas = 25.000 linhas. Acima disso, `motivo: 'teto'`. */
export const MAX_PAGINAS = 25;

/** O erro do PostgREST tem propriedades NÃO enumeráveis — logar campo a campo. */
export interface ErroDoPostgrest {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}

export interface RespostaDaPagina<T> {
  data: T[] | null;
  error: ErroDoPostgrest | null;
  count: number | null;
}

export type MotivoDaDesconfianca = "erro" | "sem_contagem" | "incompleto" | "teto";

export interface ResultadoPaginado<T> {
  /** `null` = NÃO CONFIE. Nunca é uma lista parcial. */
  linhas: T[] | null;
  /**
   * Preenchido SÓ quando o PostgREST recusou a consulta — é o que permite a
   * quem chama distinguir "embed recusado, tenta o plano B" de "a coleção
   * mudou embaixo de mim". Nulo nos outros três motivos.
   */
  erro: ErroDoPostgrest | null;
  motivo: MotivoDaDesconfianca | null;
}

/**
 * Percorre a coleção inteira, mil linhas por vez.
 *
 * `pagina(de, ate)` monta a consulta com o `order` e o `count: 'exact'` de
 * quem chama e devolve a resposta crua do Supabase.
 */
export async function buscarPaginado<T>(
  pagina: (de: number, ate: number) => PromiseLike<RespostaDaPagina<T>>,
): Promise<ResultadoPaginado<T>> {
  const acumulado: T[] = [];
  let total: number | null = null;

  for (let n = 0; n < MAX_PAGINAS; n++) {
    const de = n * PAGINA;
    const { data, error, count } = await pagina(de, de + PAGINA - 1);
    if (error || !data) return { linhas: null, erro: error ?? null, motivo: "erro" };

    acumulado.push(...data);
    // A contagem MAIS RECENTE manda: linha apagada entre duas páginas encolhe
    // o total, e é por ele que se descobre que a leitura saiu incompleta.
    total = count ?? total;
    const curta = data.length < PAGINA;

    if (total == null) {
      // Sem contagem, só a página curta prova o fim. Página cheia pode ter
      // continuação, e devolver o acumulado afirmaria completude sem base.
      return curta
        ? { linhas: acumulado, erro: null, motivo: null }
        : { linhas: null, erro: null, motivo: "sem_contagem" };
    }

    if (curta || acumulado.length >= total) {
      return acumulado.length >= total
        ? { linhas: acumulado, erro: null, motivo: null }
        : { linhas: null, erro: null, motivo: "incompleto" };
    }
  }

  return { linhas: null, erro: null, motivo: "teto" };
}

/**
 * A variante POR CHAVE (keyset): cada página pede as linhas de `id` maior que
 * o último visto, em ordem de `id`.
 *
 * ⚠️⚠️ É a que serve quando o RECORTE muda enquanto se lê — o
 * `unread_count > 0` do contador do menu muda a cada conversa lida. Por
 * OFFSET, a linha que SAI do recorte na 1ª página empurra uma linha para fora
 * da 2ª, e ela não vem em página nenhuma; a contagem nova ainda fecha, e a
 * leitura parece completa (Codex, PR #247). Por chave, entrar ou sair do
 * recorte não desloca as outras linhas. Não precisa de `count`: a página
 * seguinte começa depois do último visto, então página curta é o fim — e,
 * com as `MAX_PAGINAS` cheias, uma sondagem vazia também.
 *
 * `pagina(depoisDe)` tem de ordenar por `id` ASCENDENTE, limitar a `PAGINA`
 * e, com `depoisDe` preenchido, filtrar `.gt('id', depoisDe)`.
 */
export async function buscarPorChave<T extends { id: string }>(
  pagina: (
    depoisDe: string | null,
  ) => PromiseLike<{ data: T[] | null; error: ErroDoPostgrest | null }>,
): Promise<ResultadoPaginado<T>> {
  const acumulado: T[] = [];
  let depoisDe: string | null = null;

  for (let n = 0; n < MAX_PAGINAS; n++) {
    const { data, error } = await pagina(depoisDe);
    if (error || !data) return { linhas: null, erro: error ?? null, motivo: "erro" };

    acumulado.push(...data);
    if (data.length < PAGINA) return { linhas: acumulado, erro: null, motivo: null };
    depoisDe = data[data.length - 1].id;
  }

  // As MAX_PAGINAS páginas vieram CHEIAS. Sem `count`, só uma sondagem separa
  // "a coleção terminou exatamente no teto" de "passou dele" — sem ela, uma
  // coleção de exatamente 25.000 linhas era dada como "teto", e o contador
  // ficava no valor antigo (Codex, PR #260).
  const { data, error } = await pagina(depoisDe);
  if (error || !data) return { linhas: null, erro: error ?? null, motivo: "erro" };
  return data.length === 0
    ? { linhas: acumulado, erro: null, motivo: null }
    : { linhas: null, erro: null, motivo: "teto" };
}
