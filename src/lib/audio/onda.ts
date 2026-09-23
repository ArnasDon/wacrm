// ============================================================
// O player de áudio da conversa, na parte que se testa sem navegador: as
// barras da onda, o ciclo da velocidade e o relógio.
//
// O player em si (`src/components/inbox/player-de-audio.tsx`) substituiu o
// `<audio controls>` nativo, que escondia a velocidade atrás do menu de três
// pontos do navegador — três cliques para ouvir a 1,5× (pedido do operador,
// 23/09/2026, com o player do WhatsApp como referência).
// ============================================================

/** As velocidades do botão, na ordem em que o clique as percorre. */
export const VELOCIDADES = [1, 1.5, 2] as const;
export type Velocidade = (typeof VELOCIDADES)[number];

/**
 * A velocidade seguinte do ciclo 1× → 1,5× → 2× → 1×. Valor fora da lista
 * volta ao começo — nunca trava o botão.
 */
export function proximaVelocidade(atual: number): Velocidade {
  const i = VELOCIDADES.findIndex((v) => v === atual);
  return VELOCIDADES[(i + 1) % VELOCIDADES.length];
}

/**
 * Parse da velocidade lembrada no aparelho. É texto de `localStorage`, que
 * qualquer versão antiga (ou a mão de alguém) pode ter escrito: só vale um
 * valor da lista; o resto é 1×.
 */
export function lerVelocidade(bruto: string | null): Velocidade {
  const n = Number(bruto);
  return VELOCIDADES.find((v) => v === n) ?? 1;
}

/** Quantas barras a onda desenha. */
export const BARRAS_DA_ONDA = 40;

/**
 * Altura mínima de uma barra, em fração da altura da onda. Silêncio vira um
 * ponto, não um buraco — e é também a altura de TODAS as barras quando a
 * onda não pôde ser lida: uma fileira de pontos não finge um volume que
 * ninguém mediu.
 */
export const ALTURA_MINIMA = 0.12;

/**
 * As alturas das barras (0–1) a partir das amostras decodificadas.
 *
 * Energia RMS por fatia, normalizada pela fatia mais alta. A raiz no fim
 * aproxima a escala do ouvido: com a razão linear, a fala mais baixa de uma
 * nota de voz saía quase rente ao chão ao lado de um pico, e a onda parecia
 * vazia (medido num áudio real do lead de teste em 23/09/2026: barras de
 * 6–16% viram 24–40%).
 */
export function picosDaOnda(
  amostras: ArrayLike<number>,
  barras: number,
): number[] {
  if (!(barras > 0)) return [];
  const n = amostras.length;
  const energias: number[] = [];
  for (let b = 0; b < barras; b++) {
    const inicio = Math.floor((b * n) / barras);
    const fim = Math.floor(((b + 1) * n) / barras);
    let soma = 0;
    for (let i = inicio; i < fim; i++) soma += amostras[i] * amostras[i];
    energias.push(fim > inicio ? Math.sqrt(soma / (fim - inicio)) : 0);
  }
  const maior = Math.max(0, ...energias);
  if (!(maior > 0)) return energias.map(() => ALTURA_MINIMA);
  return energias.map((e) => Math.max(ALTURA_MINIMA, Math.sqrt(e / maior)));
}

/**
 * `m:ss` (ou `h:mm:ss` a partir de uma hora), com os segundos truncados — o
 * mesmo relógio do gravador do compositor. Valor inválido vira `0:00`; quem
 * não sabe a duração não chama isto (ver o traço do player).
 */
export function formatarTempo(segundos: number): string {
  const total =
    Number.isFinite(segundos) && segundos > 0 ? Math.floor(segundos) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Onde o ponteiro caiu na onda, de 0 (começo) a 1 (fim). */
export function fracaoNoPonto(
  x: number,
  esquerda: number,
  largura: number,
): number {
  if (!(largura > 0)) return 0;
  return Math.min(1, Math.max(0, (x - esquerda) / largura));
}
