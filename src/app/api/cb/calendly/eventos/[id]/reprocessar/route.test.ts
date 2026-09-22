import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================
// "Processar de novo" roda uma automação que MANDA MENSAGEM e mexe no card.
// A serialização é o CADEADO (`processando_desde`, 980), não uma régua de
// tempo: dois cliques simultâneos, ou um clique enquanto o `after()` do
// webhook ainda roda, dariam dois avisos ao advogado (achado do Codex nos
// PRs #133 e #134). Aqui o "banco" conta quantas vezes o UPDATE do cadeado
// realmente pegou a linha.
// ============================================================

const h = vi.hoisted(() => ({
  state: {
    linha: null as Record<string, unknown> | null,
    cancelado: false as boolean | null,
    erroClaim: null as { message: string } | null,
    erroLeitura: null as { message: string } | null,
    claims: 0,
    liberacoes: 0,
    processados: [] as unknown[],
    gravados: [] as unknown[],
    papel: "admin",
    processarLanca: false,
  },
}));

// Banco de mentira com a semântica que importa: o UPDATE do cadeado só
// devolve linha se ela for reprocessável E o cadeado estiver livre.
const REPROCESSAVEIS = ["recebido", "sem_contato", "sem_automacao"];
const RECOLHER_MS = 10 * 60 * 1000;

vi.mock("@/lib/automations/admin-client", () => ({
  supabaseAdmin: () => ({
    from: () => {
      const ops = { tipo: "select", payload: null as Record<string, unknown> | null };
      const b: Record<string, unknown> = {
        select: () => b,
        update: (p: Record<string, unknown>) => ((ops.tipo = "update"), (ops.payload = p), b),
        eq: () => b,
        in: () => b,
        or: () => b,
        maybeSingle: async () => {
          if (ops.tipo !== "update") {
            return { data: h.state.linha, error: h.state.erroLeitura };
          }
          if (h.state.erroClaim) return { data: null, error: h.state.erroClaim };
          const linha = h.state.linha;
          const livre =
            !linha?.processando_desde ||
            new Date(String(linha.processando_desde)).getTime() <= Date.now() - RECOLHER_MS;
          if (!linha || !REPROCESSAVEIS.includes(String(linha.resultado)) || !livre) {
            return { data: null, error: null };
          }
          h.state.claims += 1;
          h.state.linha = { ...linha, processando_desde: ops.payload?.processando_desde };
          return { data: h.state.linha, error: null };
        },
        then: (f: (v: unknown) => unknown) => {
          // `update().eq()` sem `.select()`: soltar o cadeado.
          if (ops.tipo === "update" && ops.payload && "processando_desde" in ops.payload && ops.payload.processando_desde === null) {
            h.state.liberacoes += 1;
            if (h.state.linha) h.state.linha = { ...h.state.linha, processando_desde: null };
          }
          return Promise.resolve({ data: null, error: null }).then(f);
        },
      };
      return b;
    },
  }),
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: async () => {
    if (h.state.papel !== "admin") throw new Error("forbidden");
    return { accountId: "acc-1", userId: "u-1" };
  },
  toErrorResponse: () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
}));

vi.mock("@/lib/rate-limit", async (orig) => {
  const real = await orig<typeof import("@/lib/rate-limit")>();
  return { ...real, checkRateLimit: () => ({ success: true, limit: 1, remaining: 1, reset: 0 }) };
});

vi.mock("@/lib/calendly/cancelamento", () => ({
  houveCancelamento: vi.fn(async () => h.state.cancelado),
}));

vi.mock("@/lib/calendly/processar", () => ({
  processarAgendamento: vi.fn(async (_db: unknown, accountId: string, agendamento: unknown, vars: unknown) => {
    if (h.state.processarLanca) throw new Error("motor caiu");
    h.state.processados.push({ accountId, agendamento, vars });
    return { resultado: "disparado", detalhe: "1 automação", contactId: "c1" };
  }),
  gravarResultado: vi.fn(async (_db: unknown, id: string, r: unknown) => {
    h.state.gravados.push({ id, r });
    h.state.liberacoes += 1;
    if (h.state.linha) h.state.linha = { ...h.state.linha, processando_desde: null, resultado: (r as { resultado: string }).resultado };
  }),
}));

import { POST } from "./route";

const linhaBase = (patch: Record<string, unknown> = {}) => ({
  id: "evt-1",
  evento: "invitee.created",
  invitee_uri: "https://api.calendly.com/scheduled_events/E1/invitees/I1",
  event_type_uri: "https://api.calendly.com/event_types/T1",
  event_type_nome: "Reunião",
  nome: "Joel",
  email: null,
  telefone: "5519980000004",
  telefone_origem: "heuristica",
  inicio: "2026-09-09T19:00:00Z",
  fim: null,
  link: null,
  perguntas: [],
  variaveis: { agendamento_nome: "Joel", agendamento_cancelar: "https://calendly.com/cancelar/x" },
  resultado: "sem_contato",
  recebido_em: "2026-09-08T10:00:00Z",
  processando_desde: null,
  ...patch,
});

const chamar = async () => {
  const res = await POST(new Request("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ id: "evt-1" }),
  });
  return { status: res.status, corpo: await res.json() };
};

beforeEach(() => {
  h.state.cancelado = false;
  h.state.linha = linhaBase();
  h.state.erroClaim = null;
  h.state.erroLeitura = null;
  h.state.claims = 0;
  h.state.liberacoes = 0;
  h.state.processados = [];
  h.state.gravados = [];
  h.state.papel = "admin";
  h.state.processarLanca = false;
});

describe("POST /api/cb/calendly/eventos/[id]/reprocessar", () => {
  it("reivindica, roda com as VARIÁVEIS gravadas e solta o cadeado no resultado", async () => {
    const r = await chamar();
    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ ok: true, resultado: "disparado" });
    expect(h.state.claims).toBe(1);
    expect(h.state.processados[0]).toMatchObject({
      accountId: "acc-1",
      // 979: o link de cancelamento não tem coluna; só as vars gravadas o têm.
      vars: { agendamento_cancelar: "https://calendly.com/cancelar/x" },
    });
    expect(h.state.gravados[0]).toMatchObject({ id: "evt-1", r: { resultado: "disparado" } });
    expect(h.state.liberacoes).toBeGreaterThan(0);
  });

  it("CRÍTICO: dois cliques ao mesmo tempo → UM processamento só", async () => {
    const [a, b] = await Promise.all([chamar(), chamar()]);
    const status = [a.status, b.status].sort();
    expect(status).toEqual([200, 409]);
    expect(h.state.claims).toBe(1);
    expect(h.state.processados).toHaveLength(1);
    const recusado = a.status === 409 ? a : b;
    expect(recusado.corpo.error).toBe("ainda_processando");
  });

  it("CRÍTICO: cadeado vivo (o after() do webhook rodando) recusa, por mais longo que seja", async () => {
    // Uma hora de processamento: a régua de idade que existia antes já teria
    // liberado; o cadeado não libera enquanto ninguém o solta.
    h.state.linha = linhaBase({ resultado: "recebido", processando_desde: new Date(Date.now() - 60 * 60_000).toISOString() });
    // …passado o recolhimento de 10 min, porém, ele É tomado: processo morto
    // no meio não pode travar o agendamento para sempre.
    const r = await chamar();
    expect(r.status).toBe(200);

    h.state.linha = linhaBase({ resultado: "recebido", processando_desde: new Date(Date.now() - 30_000).toISOString() });
    const fresco = await chamar();
    expect(fresco.status).toBe(409);
    expect(fresco.corpo.error).toBe("ainda_processando");
    expect(h.state.processados).toHaveLength(1);
  });

  it("CRÍTICO: o que JÁ rodou não repete — mandaria a mesma mensagem outra vez", async () => {
    for (const resultado of ["disparado", "em_espera", "falhou", "sem_telefone"]) {
      h.state.linha = linhaBase({ resultado });
      const r = await chamar();
      expect(r.status, resultado).toBe(409);
      expect(r.corpo.error).toBe("ja_processado");
    }
    expect(h.state.processados).toHaveLength(0);
    expect(h.state.claims).toBe(0);
  });

  it("processamento que estoura vira `falhou` (não reprocessável), nunca cadeado solto e limpo", async () => {
    h.state.processarLanca = true;
    const r = await chamar();
    expect(r.status).toBe(500);
    expect(h.state.gravados[0]).toMatchObject({ r: { resultado: "falhou", detalhe: "motor caiu" } });
    // E aí o clique seguinte é recusado, porque a mensagem pode ter saído.
    h.state.processarLanca = false;
    expect((await chamar()).corpo.error).toBe("ja_processado");
  });

  it("erro de banco NÃO é 404 — senão o operador conclui que o agendamento sumiu", async () => {
    h.state.erroClaim = { message: "timeout" };
    expect((await chamar()).status).toBe(500);

    h.state.erroClaim = null;
    h.state.linha = null;
    expect((await chamar()).status).toBe(404);
  });

  it("linha sem invitee solta o cadeado antes de recusar", async () => {
    h.state.linha = linhaBase({ invitee_uri: null });
    const r = await chamar();
    expect(r.status).toBe(422);
    expect(h.state.processados).toHaveLength(0);
    expect(h.state.liberacoes).toBe(1);
  });

  it("só admin", async () => {
    h.state.papel = "agent";
    expect((await chamar()).status).toBe(403);
    expect(h.state.claims).toBe(0);
  });
});

describe("agendamento CANCELADO não se reprocessa", () => {
  it("CRÍTICO: recusa com 409 e não chama o motor", async () => {
    // Repetir rodaria a automação inteira — aviso ao advogado, card para
    // "Reunião Agendada", data gravada — por uma reunião desmarcada, e os
    // lembretes voltariam armados (Codex, PR #235, 4ª rodada).
    h.state.cancelado = true;
    const r = await chamar();
    expect(r.status).toBe(409);
    expect(r.corpo).toEqual({ error: "agendamento_cancelado" });
    expect(h.state.processados).toHaveLength(0);
  });

  it("CRÍTICO: não conseguindo conferir, RECUSA (falha fechada)", async () => {
    // Recusar é reversível — o operador clica de novo. Disparar não é.
    h.state.cancelado = null;
    const r = await chamar();
    expect(r.status).toBe(500);
    expect(h.state.processados).toHaveLength(0);
  });

  it("sem cancelamento, reprocessa normalmente", async () => {
    h.state.cancelado = false;
    const r = await chamar();
    expect(r.status).toBe(200);
    expect(h.state.processados).toHaveLength(1);
  });
});
