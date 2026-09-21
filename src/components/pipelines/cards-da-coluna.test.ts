import { describe, expect, it } from "vitest";

import { CARDS_POR_COLUNA, cardsDaColuna } from "./pipeline-board";

/**
 * O teto POR COLUNA do quadro do funil.
 *
 * Nasceu da medição da migração da Kommo: o funil "Trabalhista - Comercial"
 * fica com ~8.400 cards e a coluna "Perdido" com 2.719. Sem teto o quadro
 * monta todos num commit só (cada um com o seu `useDraggable`) e a tela
 * principal do funil deixa de abrir no celular.
 *
 * O que estes casos protegem é a SEGUNDA metade da regra — a que some com o
 * card arrastado se ninguém a escrever. A ordem do quadro é `created_at
 * DESC`, e mover um card NÃO o reordena: um negócio antigo solto numa
 * coluna cheia entra na posição ~2.700 e desaparece no instante em que foi
 * solto, sem erro nenhum.
 */

const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `d${i}` }));

describe("cardsDaColuna", () => {
  it("devolve a coluna inteira quando ela cabe no teto", () => {
    const coluna = cards(3);
    expect(cardsDaColuna(coluna, 100, null)).toEqual(coluna);
  });

  it("corta no teto quando a coluna passa dele", () => {
    const visiveis = cardsDaColuna(cards(2719), 100, null);
    expect(visiveis).toHaveLength(100);
    expect(visiveis[0]?.id).toBe("d0");
    expect(visiveis.at(-1)?.id).toBe("d99");
  });

  it("traz para o TOPO o card recém-solto que cairia fora do teto", () => {
    const visiveis = cardsDaColuna(cards(2719), 100, "d2700");
    expect(visiveis[0]?.id).toBe("d2700");
    expect(visiveis).toHaveLength(101);
  });

  it("não duplica o card recém-solto que já está visível", () => {
    const visiveis = cardsDaColuna(cards(2719), 100, "d7");
    expect(visiveis).toHaveLength(100);
    expect(visiveis.filter((d) => d.id === "d7")).toHaveLength(1);
  });

  it("ignora o card solto em OUTRA coluna", () => {
    // O id do último solto é do quadro inteiro, não desta coluna.
    const visiveis = cardsDaColuna(cards(2719), 100, "de-outra-coluna");
    expect(visiveis).toHaveLength(100);
  });

  it("não fabrica nada quando o teto é maior que a coluna, mesmo com card solto", () => {
    const coluna = cards(5);
    expect(cardsDaColuna(coluna, 100, "d4")).toEqual(coluna);
  });

  it("preserva a ordem dos visíveis ao fixar o solto", () => {
    const visiveis = cardsDaColuna(cards(300), 3, "d200");
    expect(visiveis.map((d) => d.id)).toEqual(["d200", "d0", "d1", "d2"]);
  });

  it("o teto inicial é o mesmo número que a lista de leads usa", () => {
    expect(CARDS_POR_COLUNA).toBe(100);
  });
});
