// ============================================================
// O teclado do celular, em regras puras.
//
// Nasceu do relato do operador no iPhone (14/09/2026), com o CRM instalado
// na Tela de Início: ao tocar na caixa de mensagem, o cabeçalho da conversa
// (o nome do cliente e o número por onde a resposta sai) subia para fora da
// tela e só voltava rolando; não havia como recolher o teclado; e, recolhido,
// a tela ficava "desconfigurada".
//
// A causa: a casca do app media a altura TOTAL do aparelho, e essa medida
// não muda quando o teclado abre. O iPhone resolve empurrando a página
// inteira para cima até a caixa aparecer — e nem sempre a devolve ao fechar.
// O ajuste faz a casca medir só a área visível e acompanhar o empurrão.
//
// ⚠️⚠️ A primeira versão (PR #214) só agia quando `window.innerHeight` e a
// área visível diferiam em 120 px, e o print do operador no dia seguinte
// (15/09/2026) mostrou a tela EXATAMENTE como antes do ajuste: caixa colada
// no teclado, topo fora da tela. A causa mais provável — o navegador do
// computador não tem teclado virtual para medir — é a janela encolher junto
// com a área visível no app instalado, e a regra concluir "teclado fechado".
// Por isso ela não compara mais com a janela: com o foco na conversa, num
// aparelho de toque, a casca mede SEMPRE a área visível. Sem teclado, a área
// visível é a tela inteira, e medir não muda nada.
// ============================================================

/**
 * O que o `matchMedia` chama de aparelho de toque. É o que mantém o
 * computador fora do ajuste.
 *
 * ⚠️ A regra dos 16 px no `globals.css` usa a MESMA consulta, e há teste
 * cobrando: mudar aqui é mudar lá.
 */
export const MIDIA_DE_TOQUE = "(pointer: coarse)";

/**
 * Atributo que marca a área que precisa ficar ACIMA do teclado — o fio da
 * conversa. O ajuste só age com o foco dentro dela.
 *
 * ⚠️ Fora dela (formulário de outra tela, diálogo, o painel do contato), o
 * empurrão do iPhone é o que revela o campo acima do teclado: segurar a tela
 * esconderia justamente o campo em que a pessoa está digitando.
 */
export const ATRIBUTO_ACIMA_DO_TECLADO = "data-acima-do-teclado";

export interface LeituraDaTela {
  /** `visualViewport.height`: o que sobra acima do teclado. */
  alturaVisivel: number;
  /**
   * `visualViewport.offsetTop`: quanto o iPhone deslocou a área visível — o
   * "empurrão". A casca desce o mesmo tanto e fica parada na tela.
   */
  deslocamentoVisivel: number;
  /** `visualViewport.scale`: diferente de 1 é pinça de zoom. */
  escala: number;
  /** Aparelho de toque (`MIDIA_DE_TOQUE`). */
  toque: boolean;
  /** O foco está dentro de `[data-acima-do-teclado]`. */
  focoNaArea: boolean;
}

export interface AjusteDaTela {
  /** Altura da casca em px; `null` devolve a do CSS (`100dvh`). */
  altura: number | null;
  /** Quanto a casca desce, em px, acompanhando o empurrão; `null`, nada. */
  deslocamento: number | null;
  /** Rolar a janela de volta ao topo — só ao SAIR do ajuste. */
  desfazerEmpurrao: boolean;
  /** O que a leitura seguinte recebe como `estavaAjustada`. */
  ajustada: boolean;
}

export function ajusteDoTeclado(
  leitura: LeituraDaTela,
  estavaAjustada: boolean,
): AjusteDaTela {
  // Pinça de zoom também encolhe a área visível — mas porque a pessoa
  // ampliou, não porque o teclado abriu. Mexer na tela ali brigaria com o
  // dedo dela.
  const ampliada = Math.abs(leitura.escala - 1) > 0.01;

  if (leitura.toque && leitura.focoNaArea && !ampliada) {
    // ⚠️ ACOMPANHAR o empurrão, e não desfazê-lo com `scrollTo` enquanto o
    // teclado está aberto: se o iPhone mantém a área visível deslocada, a
    // rolagem de volta não pega e o topo continua fora da tela; se pega, a
    // casca desceria um quadro antes de a leitura seguinte zerar o
    // deslocamento — piscando. Descendo junto, ela fica parada nos dois casos.
    return {
      altura: Math.round(leitura.alturaVisivel),
      deslocamento: Math.round(leitura.deslocamentoVisivel),
      desfazerEmpurrao: false,
      ajustada: true,
    };
  }

  // O foco saiu da conversa (o teclado fechou) ou a pessoa ampliou: altura e
  // posição voltam às do CSS. E, se ESTA regra tinha ajustado, desfaz uma
  // última vez o empurrão que o iPhone deixou para trás — o "desconfigurado"
  // do relato.
  return {
    altura: null,
    deslocamento: null,
    desfazerEmpurrao: estavaAjustada && !ampliada,
    ajustada: false,
  };
}

/**
 * Quanto o dedo precisa descer para o arrasto da conversa recolher o teclado.
 * Abaixo disso é toque trêmulo numa bolha, não intenção de rolar.
 */
export const ARRASTO_QUE_RECOLHE_PX = 12;

/**
 * O arrasto na conversa recolhe o teclado? Só quando o dedo DESCE — rolando
 * para as mensagens antigas, o gesto do WhatsApp (pedido do operador,
 * 14/09/2026). Subir o dedo, rumo ao fim da conversa, é o gesto de quem
 * continua escrevendo.
 */
export function arrastoRecolheTeclado(
  inicioY: number | null,
  agoraY: number | undefined,
): boolean {
  if (inicioY === null || agoraY === undefined) return false;
  return agoraY - inicioY >= ARRASTO_QUE_RECOLHE_PX;
}

/**
 * O Enter envia a mensagem?
 *
 * No aparelho de toque, não: o teclado do celular não tem Shift+Enter, então
 * lá o retorno pula linha e só o botão envia — decisão do operador
 * (14/09/2026), como no WhatsApp. No computador nada muda: Enter envia e
 * Shift+Enter pula linha.
 */
export function enterEnvia(
  tecla: { key: string; shiftKey: boolean },
  toque: boolean,
): boolean {
  return tecla.key === "Enter" && !tecla.shiftKey && !toque;
}
