// ============================================================
// O ponto de retorno do funil: onde o operador estava quando clicou para a
// conversa, para a volta cair no MESMO lugar.
//
// ⚠️ sessionStorage, não localStorage: o retorno é da JORNADA daquela aba
// (funil → conversa → funil), não uma preferência. Em localStorage, uma aba
// restauraria a rolagem gravada por outra.
//
// ⚠️ O registro NÃO é apagado ao ser consumido — ele EXPIRA (10 min). A
// primeira versão limpava no consumo, e a revisão do PR #71 achou os três
// buracos disso: apagar antes dos rAF perdia a restauração se o quadro
// desmontasse na janela; ir e voltar duas vezes (Back do navegador + faixa)
// teleportava para `list[0]`; e um funil restaurado SEM etapas nunca
// consumia o registro. Com prazo, a jornada inteira reusa o mesmo registro
// e a visita desavisada de amanhã não é sequestrada por ele.
// ============================================================

export const CHAVE_RETORNO_DO_FUNIL = "wacrm:pipelines:retorno";

/** Vida útil do registro. Curta de propósito: é uma jornada, não um estado. */
export const VALIDADE_DO_RETORNO_MS = 10 * 60_000;

export interface RetornoDoFunil {
  pipelineId: string;
  /** Do `.pipeline-scroll` (eixo horizontal do quadro). */
  scrollLeft: number;
  /** Do `<main>` do dashboard (único scroll vertical da página). */
  scrollTop: number;
  /**
   * Quantos cards cada coluna estava mostrando (id da etapa → teto).
   *
   * ⚠️⚠️ Sem isto, a rolagem restaurada não vale nada depois do teto por
   * coluna: quem abriu a conversa a partir do card 150 volta para um quadro
   * em que só os 100 primeiros existem, o card de origem não está
   * renderizado e o `scrollTop` é grampeado pela altura menor. Os dois
   * conseguem o mesmo resultado — a rolagem certa sobre o quadro errado —,
   * e é por isso que eles viajam JUNTOS. (Achado do Codex no PR #231.)
   *
   * Vazio = nenhuma coluna expandida, que é o caso comum.
   */
  limites: Record<string, number>;
  /** Quando foi gravado (epoch ms) — o que faz o registro expirar. */
  em: number;
}

function numeroOuZero(valor: unknown): number {
  return typeof valor === "number" && Number.isFinite(valor) && valor > 0
    ? valor
    : 0;
}

/**
 * Teto máximo de colunas guardadas. Não é defesa contra o quadro real (um
 * funil tem dezenas de etapas): é contra registro adulterado ou de uma
 * versão futura — `sessionStorage` é escrita pelo navegador, e o valor volta
 * para dentro de um `useState`.
 */
const MAX_COLUNAS_GUARDADAS = 200;

/**
 * Lê o mapa de tetos com desconfiança: chave que não seja string não-vazia,
 * ou valor que não seja inteiro positivo, é DESCARTADO — não derruba o
 * registro inteiro. Um teto estragado só faz a coluna voltar ao padrão, e
 * perder a restauração de uma coluna é muito mais barato que perder a
 * rolagem da jornada inteira.
 */
function limitesOuVazio(valor: unknown): Record<string, number> {
  if (typeof valor !== "object" || valor === null) return {};
  const saida: Record<string, number> = {};
  for (const [etapa, teto] of Object.entries(valor as Record<string, unknown>)) {
    if (Object.keys(saida).length >= MAX_COLUNAS_GUARDADAS) break;
    if (!etapa) continue;
    if (typeof teto !== "number" || !Number.isInteger(teto) || teto <= 0) continue;
    saida[etapa] = teto;
  }
  return saida;
}

/**
 * Desserialização defensiva: registro estranho ou VENCIDO vira `null`, nunca
 * exceção. `agora` entra por parâmetro para o módulo continuar puro/testável.
 */
export function desserializarRetorno(
  cru: string | null,
  agora: number,
): RetornoDoFunil | null {
  if (!cru) return null;
  try {
    const dado: unknown = JSON.parse(cru);
    if (typeof dado !== "object" || dado === null) return null;
    const objeto = dado as Record<string, unknown>;
    if (typeof objeto.pipelineId !== "string" || !objeto.pipelineId) return null;
    if (typeof objeto.em !== "number" || !Number.isFinite(objeto.em)) return null;
    if (agora - objeto.em > VALIDADE_DO_RETORNO_MS) return null;
    return {
      pipelineId: objeto.pipelineId,
      scrollLeft: numeroOuZero(objeto.scrollLeft),
      scrollTop: numeroOuZero(objeto.scrollTop),
      limites: limitesOuVazio(objeto.limites),
      em: objeto.em,
    };
  } catch {
    return null;
  }
}

/**
 * ⚠️⚠️ `limites` é OBRIGATÓRIO, e isso é o pino: são DUAS saídas do funil
 * para o inbox — o quadro (corpo do card e botão da coluna) e a página (o
 * link "ver conversa" do formulário do negócio, aberto pelo lápis de um
 * card) —, e cada uma já esqueceu os tetos uma vez. Rolagem sem tetos é
 * rolagem sobre o quadro errado: quem saiu do card 150 volta para um quadro
 * de 100, o card de origem não existe e o `scrollTop` é grampeado pela
 * altura menor.
 *
 * A primeira versão deste parâmetro era opcional e PRESERVAVA o que já
 * estivesse gravado. Parecia defensivo e escondia o defeito: a página não
 * tinha os tetos em mão, então a preservação só podia reusar um registro
 * ANTERIOR — na primeira volta da jornada não havia nenhum, e depois de
 * expandir outra coluna o registro velho estava desatualizado (Codex, PR
 * #231, 1ª e 2ª rodadas). Hoje a página recebe os tetos do quadro por ref e
 * as duas saídas passam o valor de verdade; exigi-lo faz o compilador cobrar
 * de quem criar a terceira.
 */
export function gravarRetorno(retorno: Omit<RetornoDoFunil, "em">): void {
  try {
    sessionStorage.setItem(
      CHAVE_RETORNO_DO_FUNIL,
      JSON.stringify({ ...retorno, em: Date.now() }),
    );
  } catch {
    // Storage bloqueado — a volta simplesmente abre no topo.
  }
}

export function lerRetorno(): RetornoDoFunil | null {
  try {
    return desserializarRetorno(
      sessionStorage.getItem(CHAVE_RETORNO_DO_FUNIL),
      Date.now(),
    );
  } catch {
    return null;
  }
}
