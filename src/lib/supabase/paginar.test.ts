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

  it("admite o teto em vez de recortar em silêncio — sem pedir o que vai descartar", async () => {
    const cheias = Array.from({ length: MAX_PAGINAS }, (_, n) => linhas(n * PAGINA, PAGINA));
    const { pagina, chamadas } = fonte(cheias, MAX_PAGINAS * PAGINA + 1);
    const r = await buscarPaginado(pagina);

    expect(r.linhas).toBeNull();
    expect(r.motivo).toBe("teto");
    // A contagem da 1ª página já prova que não cabe.
    expect(chamadas).toHaveLength(1);
  });

  it("admite o teto quando a coleção CRESCE além dele no meio da leitura", async () => {
    const cheias = Array.from({ length: MAX_PAGINAS }, (_, n) => linhas(n * PAGINA, PAGINA));
    // A 1ª contagem promete 2 páginas; as seguintes dizem que não para de crescer.
    const contagens = [2 * PAGINA, ...Array.from({ length: MAX_PAGINAS }, () => MAX_PAGINAS * PAGINA + 1)];
    const { pagina, chamadas } = fonte(cheias, contagens);
    const r = await buscarPaginado(pagina);

    expect(r.linhas).toBeNull();
    expect(r.motivo).toBe("teto");
    expect(chamadas).toHaveLength(MAX_PAGINAS);
  });

  // ⚠️ O motivo de a função existir nesta forma: em fila, o quadro de 3.669
  // cards levava 4× o tempo de uma página. As seguintes à 1ª saem JUNTAS.
  it("pede as páginas seguintes JUNTAS, sem esperar uma pela outra, e as junta na ordem", async () => {
    const total = 3 * PAGINA + 5;
    const pedidas: number[] = [];
    const soltar: Array<() => void> = [];
    const pagina = (de: number) => {
      pedidas.push(de);
      const n = de / PAGINA;
      const resposta: RespostaDaPagina<Linha> = {
        data: linhas(de, n < 3 ? PAGINA : 5),
        error: null,
        count: total,
      };
      if (n === 0) return Promise.resolve(resposta);
      return new Promise<RespostaDaPagina<Linha>>((ok) => soltar.push(() => ok(resposta)));
    };

    const promessa = buscarPaginado(pagina);
    await new Promise((r) => setTimeout(r, 0));
    // Nenhuma das seguintes voltou, e as três já foram pedidas.
    expect(pedidas).toEqual([0, PAGINA, 2 * PAGINA, 3 * PAGINA]);

    // Voltam FORA de ordem — o resultado tem de sair na ordem das páginas.
    soltar.reverse().forEach((s) => s());
    const r = await promessa;
    expect(r.motivo).toBeNull();
    expect(r.linhas?.map((l) => l.id)).toEqual(linhas(0, total).map((l) => l.id));
  });

  it("continua uma a uma quando a coleção cresceu além da 1ª contagem", async () => {
    const { pagina, chamadas } = fonte(
      [linhas(0, PAGINA), linhas(PAGINA, PAGINA), linhas(2 * PAGINA, 3)],
      [PAGINA + 5, 2 * PAGINA + 3, 2 * PAGINA + 3],
    );
    const r = await buscarPaginado(pagina);

    expect(r.linhas).toHaveLength(2 * PAGINA + 3);
    expect(r.motivo).toBeNull();
    expect(chamadas).toHaveLength(3);
  });

  // ⚠️⚠️ As páginas do lote saem JUNTAS e não têm ordem de tempo entre si:
  // a do offset 1000 pode ter visto a coleção DEPOIS de crescer (3.500) e a
  // do 2000, ANTES (3.000). Assentar na ordem do offset deixava a contagem
  // velha vencer e 3.000 linhas "fechavam" uma coleção de 3.500 — 500 linhas
  // a menos com cara de lista completa (Codex, PR #247).
  it("o lote paralelo vale pela MAIOR contagem dele — a velha não fecha a leitura", async () => {
    const { pagina, chamadas } = fonte(
      [
        linhas(0, PAGINA),
        linhas(PAGINA, PAGINA),
        linhas(2 * PAGINA, PAGINA),
        linhas(3 * PAGINA, 500),
      ],
      [3 * PAGINA, 3 * PAGINA + 500, 3 * PAGINA, 3 * PAGINA + 500],
    );
    const r = await buscarPaginado(pagina);

    expect(r.motivo).toBeNull();
    expect(r.linhas).toHaveLength(3 * PAGINA + 500);
    // A 4ª página (depois do lote) é a que prova o fim.
    expect(chamadas).toHaveLength(4);
  });

  it("no lote que encolheu, a maior contagem deixa a leitura 'incompleto', nunca completa com buraco", async () => {
    // A 1000 viu a coleção antes da exclusão (3.000) e a 2000, depois (2.990,
    // página curta). Não dá para saber qual é a mais nova: não confie.
    const { pagina } = fonte(
      [linhas(0, PAGINA), linhas(PAGINA, PAGINA), linhas(2 * PAGINA, 990)],
      [3 * PAGINA, 3 * PAGINA, 3 * PAGINA - 10],
    );
    const r = await buscarPaginado(pagina);

    expect(r.linhas).toBeNull();
    expect(r.motivo).toBe("incompleto");
  });

  it("uma página do meio com erro derruba a leitura inteira", async () => {
    const erro = { message: "timeout", code: "57014" };
    let n = 0;
    const r = await buscarPaginado<Linha>((de) => {
      n++;
      return Promise.resolve(
        de === PAGINA
          ? { data: null, error: erro, count: null }
          : { data: linhas(de, PAGINA), error: null, count: 3 * PAGINA },
      );
    });

    expect(r.linhas).toBeNull();
    expect(r.motivo).toBe("erro");
    expect(r.erro).toBe(erro);
    expect(n).toBe(3);
  });
});
