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
// O ajuste faz a casca medir só a área visível e desfaz o empurrão.
// ============================================================

/**
 * O que o `matchMedia` chama de aparelho de toque.
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
 * empurrão do iPhone é o que revela o campo acima do teclado: desfazê-lo
 * esconderia justamente o campo em que a pessoa está digitando.
 */
export const ATRIBUTO_ACIMA_DO_TECLADO = "data-acima-do-teclado";

/**
 * Diferença mínima entre a janela e a área visível para contar como teclado
 * aberto. Teclado de celular passa de 250 px; abaixo de 120 é barra do
 * navegador aparecendo e sumindo, que não pede ajuste nenhum.
 */
export const DIFERENCA_DO_TECLADO_PX = 120;

export interface LeituraDaTela {
  /** `visualViewport.height`: o que sobra acima do teclado. */
  alturaVisivel: number;
  /** `visualViewport.scale`: diferente de 1 é pinça de zoom. */
  escala: number;
  /** `window.innerHeight`: a janela inteira, que não encolhe com o teclado. */
  alturaDaJanela: number;
  /** O foco está dentro de `[data-acima-do-teclado]`. */
  focoNaArea: boolean;
}

export interface AjusteDaTela {
  /** Altura da casca em px; `null` devolve a do CSS (`100dvh`). */
  altura: number | null;
  /** Rolar a janela de volta ao topo, desfazendo o empurrão do iPhone. */
  desfazerEmpurrao: boolean;
  /** O que a leitura seguinte recebe como `estavaAjustada`. */
  ajustada: boolean;
}

export function ajusteDoTeclado(
  leitura: LeituraDaTela,
  estavaAjustada: boolean,
): AjusteDaTela {
  // Pinça de zoom também encolhe a área visível — mas porque a pessoa
  // ampliou, não porque o teclado abriu. Mexer na rolagem ali brigaria com
  // o dedo dela.
  const ampliada = Math.abs(leitura.escala - 1) > 0.01;
  const tecladoAberto =
    leitura.alturaDaJanela - leitura.alturaVisivel >= DIFERENCA_DO_TECLADO_PX;

  if (!ampliada && tecladoAberto && leitura.focoNaArea) {
    return {
      altura: Math.round(leitura.alturaVisivel),
      desfazerEmpurrao: true,
      ajustada: true,
    };
  }

  // Teclado fechou, o foco saiu da conversa ou a pessoa ampliou: a altura
  // volta à do CSS. E, se ESTA regra tinha ajustado, desfaz uma última vez o
  // empurrão que o iPhone deixou para trás — o "desconfigurado" do relato.
  return {
    altura: null,
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
