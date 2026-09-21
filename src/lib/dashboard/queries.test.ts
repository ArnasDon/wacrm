import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadMetrics, loadPipelineDonut } from "./queries";
import { PAGINA } from "@/lib/supabase/paginar";

/**
 * O painel somava NO MÁXIMO mil negócios e apresentava o resultado como
 * total. O PostgREST corta em ~1000 linhas sem avisar — sem `range` nem
 * `count`, a consulta volta com `error: null` e cara de completa —, e a carga
 * da Kommo traz ~12.700 negócios de uma vez. Estes testes pinam as duas
 * metades do conserto: a soma percorre TODAS as páginas, e a leitura que não
 * pode ser confiada vira "não sei" em vez de uma soma parcial.
 *
 * O dublê imita o construtor do PostgREST: cada `.from()` abre uma consulta
 * nova (é assim que o laço paginado funciona — uma chamada por página) e o
 * objeto é "thenable", então `await` devolve o que o responder disser.
 */

interface Consulta {
  tabela: string;
  colunas: string;
  head: boolean;
  filtros: Record<string, unknown>;
  ordens: string[];
  faixa: [number, number] | null;
}

interface RespostaCrua {
  data: unknown[] | null;
  error: { message: string } | null;
  count: number | null;
}

function dubleDeBanco(responder: (c: Consulta) => RespostaCrua) {
  const consultas: Consulta[] = [];
  const db = {
    from(tabela: string) {
      const c: Consulta = {
        tabela,
        colunas: "",
        head: false,
        filtros: {},
        ordens: [],
        faixa: null,
      };
      consultas.push(c);
      const b = {
        select(colunas: string, opcoes?: { count?: string; head?: boolean }) {
          c.colunas = colunas;
          c.head = opcoes?.head === true;
          return b;
        },
        eq(coluna: string, valor: unknown) {
          c.filtros[coluna] = valor;
          return b;
        },
        is(coluna: string, valor: unknown) {
          c.filtros[coluna] = valor;
          return b;
        },
        gte(coluna: string, valor: unknown) {
          c.filtros[`gte:${coluna}`] = valor;
          return b;
        },
        lt(coluna: string, valor: unknown) {
          c.filtros[`lt:${coluna}`] = valor;
          return b;
        },
        order(coluna: string) {
          c.ordens.push(coluna);
          return b;
        },
        limit() {
          return b;
        },
        range(de: number, ate: number) {
          c.faixa = [de, ate];
          return b;
        },
        then(ok: (r: RespostaCrua) => void) {
          ok(responder(c));
        },
      };
      return b;
    },
  };
  // O painel recebe um SupabaseClient de verdade; o dublê cobre só a fatia
  // que estas consultas usam.
  return { db: db as unknown as Parameters<typeof loadMetrics>[0], consultas };
}

/** Uma etapa só: a rosca precisa de nome para a fatia, não de variedade. */
const ETAPAS = [{ id: "s1", name: "Lead", color: "#123456" }];

function negocios(quantos: number, valor = 10) {
  return Array.from({ length: quantos }, () => ({ stage_id: "s1", value: valor }));
}

/** Responder padrão: contagens fixas nas outras tabelas, negócios paginados. */
function responderCom(
  todosOsNegocios: { stage_id: string; value: number }[],
  sobrescrever?: (c: Consulta) => RespostaCrua | null,
) {
  return (c: Consulta): RespostaCrua => {
    const especial = sobrescrever?.(c);
    if (especial) return especial;
    if (c.tabela === "deals") {
      // ⚠️ Consulta SEM `range` é cortada em PAGINA linhas, com `error: null`
      // e a contagem verdadeira no cabeçalho — é exatamente assim que o
      // PostgREST engana, e é o defeito que este arquivo pina. Sem isto aqui,
      // o dublê devolveria a coleção inteira e o teste passaria em cima do
      // código quebrado.
      const [de, ate] = c.faixa ?? [0, PAGINA - 1];
      return {
        data: todosOsNegocios.slice(de, ate + 1),
        error: null,
        count: todosOsNegocios.length,
      };
    }
    if (c.tabela === "pipeline_stages") {
      return { data: ETAPAS, error: null, count: null };
    }
    return { data: null, error: null, count: 7 };
  };
}

beforeEach(() => {
  // A leitura duvidosa registra o motivo; o teste não precisa do barulho.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("cartão de negócios abertos", () => {
  it("soma TODOS os negócios, não os mil primeiros", async () => {
    const total = PAGINA * 2 + 500;
    const { db, consultas } = dubleDeBanco(responderCom(negocios(total, 10)));

    const metrics = await loadMetrics(db);

    expect(metrics.openDeals).toEqual({ value: total * 10, count: total });
    // Três páginas: sem o laço, a resposta pararia em PAGINA.
    expect(consultas.filter((c) => c.tabela === "deals")).toHaveLength(3);
  });

  it("pagina com ordem estável e contagem exata", async () => {
    const { db, consultas } = dubleDeBanco(responderCom(negocios(10)));

    await loadMetrics(db);

    const paginas = consultas.filter((c) => c.tabela === "deals");
    // `range` sem `order` é LIMIT/OFFSET sobre ordem indefinida, e `id` é a
    // única coluna que desempata sozinha.
    expect(paginas[0].ordens).toEqual(["id"]);
    expect(paginas[0].faixa).toEqual([0, PAGINA - 1]);
  });

  it("leitura incompleta vira 'não sei', nunca soma parcial", async () => {
    // O banco diz que há 5.000, mas devolve uma página e para: é o retrato de
    // uma coleção que mudou no meio da leitura. Somar as mil que vieram daria
    // um número plausível e menor que a verdade.
    const { db } = dubleDeBanco((c) => {
      if (c.tabela !== "deals") return { data: null, error: null, count: 7 };
      const primeira = c.faixa?.[0] === 0;
      return {
        data: primeira ? negocios(PAGINA) : [],
        error: null,
        count: 5000,
      };
    });

    const metrics = await loadMetrics(db);

    expect(metrics.openDeals).toBeNull();
  });

  it("consulta recusada não derruba os outros três cartões", async () => {
    // Os outros saem de `count/head` e estão certos — esconder os três por
    // causa do quarto é perder informação boa.
    const { db } = dubleDeBanco(
      responderCom([], (c) =>
        c.tabela === "deals"
          ? { data: null, error: { message: "recusado" }, count: null }
          : null,
      ),
    );

    const metrics = await loadMetrics(db);

    expect(metrics.openDeals).toBeNull();
    expect(metrics.activeConversations.current).toBe(7);
    expect(metrics.messagesSentToday.current).toBe(7);
  });

  it("falha numa CONTAGEM continua derrubando a função", async () => {
    // Contagem que falha e vira zero é o cartão mentindo "0 conversas
    // ativas"; ali não há terceiro estado a mostrar, então a falha sobe.
    const { db } = dubleDeBanco(
      responderCom(negocios(3), (c) =>
        c.tabela === "conversations"
          ? { data: null, error: { message: "sem resposta" }, count: null }
          : null,
      ),
    );

    await expect(loadMetrics(db)).rejects.toMatchObject({ message: "sem resposta" });
  });

  it("o recorte por canal vai em TODAS as páginas", async () => {
    const { db, consultas } = dubleDeBanco(responderCom(negocios(PAGINA + 1)));

    await loadMetrics(db, "canal-1");

    const paginas = consultas.filter((c) => c.tabela === "deals");
    expect(paginas).toHaveLength(2);
    for (const p of paginas) expect(p.filtros.channel_id).toBe("canal-1");
  });
});

describe("rosca do funil", () => {
  it("soma as fatias com a coleção inteira", async () => {
    const total = PAGINA + 7;
    const { db } = dubleDeBanco(responderCom(negocios(total, 5)));

    const rosca = await loadPipelineDonut(db);

    expect(rosca.confiavel).toBe(true);
    if (!rosca.confiavel) return;
    expect(rosca.totalValue).toBe(total * 5);
    expect(rosca.stages[0].dealCount).toBe(total);
  });

  it("leitura duvidosa dos negócios não vira anel", async () => {
    const { db } = dubleDeBanco(
      responderCom([], (c) =>
        c.tabela === "deals"
          ? { data: null, error: { message: "recusado" }, count: null }
          : null,
      ),
    );

    // `confiavel: false` é o que impede a tela de cair no "Nenhum negócio
    // aberto ainda" — lista vazia virando afirmação sobre uma conta cheia.
    expect(await loadPipelineDonut(db)).toEqual({ confiavel: false });
  });

  it("etapas que não carregaram não viram rosca vazia", async () => {
    const { db } = dubleDeBanco(
      responderCom(negocios(3), (c) =>
        c.tabela === "pipeline_stages"
          ? { data: null, error: { message: "recusado" }, count: null }
          : null,
      ),
    );

    expect(await loadPipelineDonut(db)).toEqual({ confiavel: false });
  });
});
