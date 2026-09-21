import { describe, expect, it } from "vitest";

import {
  buscarPaginado,
  MAX_PAGINAS,
  PAGINA,
  type RespostaDaPagina,
} from "./paginar";

interface Chamada {
  de: number;
  ate: number;
}

type Linha = { id: string };

const linhas = (de: number, quantas: number): Linha[] =>
  Array.from({ length: quantas }, (_, i) => ({ id: `r${String(de + i).padStart(6, "0")}` }));

/** Devolve as páginas na ordem pedida, com o `count` que o teste mandar. */
function fonte(
  paginas: Linha[][],
  count: number | null | (number | null)[],
  error: RespostaDaPagina<Linha>["error"] = null,
): {
  pagina: (de: number, ate: number) => Promise<RespostaDaPagina<Linha>>;
  chamadas: Chamada[];
} {
  const chamadas: Chamada[] = [];
  return {
    chamadas,
    pagina: (de, ate) => {
      chamadas.push({ de, ate });
      const n = Math.floor(de / PAGINA);
      const contagem = Array.isArray(count) ? (count[n] ?? null) : count;
      return Promise.resolve({
        data: error ? null : (paginas[n] ?? []),
        error,
        count: contagem,
      });
    },
  };
}

describe("buscarPaginado", () => {
  // ⚠️⚠️ Invariante 5 do módulo: a página seguinte só é pedida DEPOIS de a
  // anterior voltar. Paralelizar páginas por OFFSET pula linha que já existia
  // quando a coleção recebe inserção no meio da leitura (Codex, PR #247).
  it("pede a página seguinte só depois de a anterior voltar", async () => {
    const pedidas: number[] = [];
    const soltar: Array<() => void> = [];
    const total = 2 * PAGINA + 3;
    const promessa = buscarPaginado<Linha>((de) => {
      pedidas.push(de);
      const quantas = de < 2 * PAGINA ? PAGINA : 3;
      return new Promise<RespostaDaPagina<Linha>>((ok) =>
        soltar.push(() => ok({ data: linhas(de, quantas), error: null, count: total })),
      );
    });

    for (let pagina = 1; pagina <= 3; pagina++) {
      await new Promise((r) => setTimeout(r, 0));
      // Só a página corrente foi pedida — nenhuma adiantada.
      expect(pedidas).toHaveLength(pagina);
      soltar[pagina - 1]();
    }
    const r = await promessa;
    expect(r.motivo).toBeNull();
    expect(r.linhas).toHaveLength(total);
  });


  it("devolve a página única quando ela vem curta", async () => {
    const { pagina, chamadas } = fonte([linhas(0, 12)], 12);
    const r = await buscarPaginado(pagina);

    expect(r.linhas).toHaveLength(12);
    expect(r.motivo).toBeNull();
    expect(chamadas).toEqual([{ de: 0, ate: PAGINA - 1 }]);
  });

  it("junta as páginas e para quando o acumulado alcança a contagem", async () => {
    const { pagina, chamadas } = fonte([linhas(0, PAGINA), linhas(PAGINA, 5)], PAGINA + 5);
    const r = await buscarPaginado(pagina);

    expect(r.linhas).toHaveLength(PAGINA + 5);
    expect(r.linhas?.[PAGINA].id).toBe(linhas(PAGINA, 1)[0].id);
    expect(chamadas).toEqual([
      { de: 0, ate: PAGINA - 1 },
      { de: PAGINA, ate: 2 * PAGINA - 1 },
    ]);
  });

  it("não pede página a mais quando a contagem fecha numa página CHEIA", async () => {
    const { pagina, chamadas } = fonte([linhas(0, PAGINA)], PAGINA);
    const r = await buscarPaginado(pagina);

    expect(r.linhas).toHaveLength(PAGINA);
    expect(chamadas).toHaveLength(1);
  });

  // ⚠️ O caso que este módulo existe para impedir: a página CHEIA sem
  // contagem é indistinguível de "a coleção acabou em exatamente 1000".
  it("recusa página cheia sem contagem — nunca devolve lista parcial", async () => {
    const { pagina } = fonte([linhas(0, PAGINA)], null);
    const r = await buscarPaginado(pagina);

    expect(r.linhas).toBeNull();
    expect(r.motivo).toBe("sem_contagem");
    expect(r.erro).toBeNull();
  });

  it("aceita página curta sem contagem — o fim está provado", async () => {
    const { pagina } = fonte([linhas(0, 3)], null);
    const r = await buscarPaginado(pagina);

    expect(r.linhas).toHaveLength(3);
    expect(r.motivo).toBeNull();
  });

  it("devolve o erro do PostgREST para quem chama decidir o plano B", async () => {
    const erro = { message: "could not embed", code: "PGRST200" };
    const { pagina } = fonte([], null, erro);
    const r = await buscarPaginado(pagina);

    expect(r.linhas).toBeNull();
    expect(r.motivo).toBe("erro");
    expect(r.erro).toBe(erro);
  });

  // Linha apagada entre duas páginas: o acumulado nunca alcança a contagem
  // vista antes, e a página curta chega com menos do que se prometeu.
  it("recusa leitura incompleta quando a coleção muda no meio", async () => {
    const { pagina } = fonte([linhas(0, PAGINA), linhas(PAGINA, 2)], [PAGINA + 9, PAGINA + 9]);
    const r = await buscarPaginado(pagina);

    expect(r.linhas).toBeNull();
    expect(r.motivo).toBe("incompleto");
  });

  // A contagem MAIS RECENTE manda: se a coleção encolheu de verdade, a
  // leitura curta é completa e tem de passar.
  it("aceita quando a contagem nova explica a página curta", async () => {
    const { pagina } = fonte(
      [linhas(0, PAGINA), linhas(PAGINA, 2)],
      [PAGINA + 9, PAGINA + 2],
    );
    const r = await buscarPaginado(pagina);

    expect(r.linhas).toHaveLength(PAGINA + 2);
    expect(r.motivo).toBeNull();
  });

  it("admite o teto em vez de recortar em silêncio", async () => {
    const cheias = Array.from({ length: MAX_PAGINAS }, (_, n) => linhas(n * PAGINA, PAGINA));
    const { pagina, chamadas } = fonte(cheias, MAX_PAGINAS * PAGINA + 1);
    const r = await buscarPaginado(pagina);

    expect(r.linhas).toBeNull();
    expect(r.motivo).toBe("teto");
    expect(chamadas).toHaveLength(MAX_PAGINAS);
  });
});
