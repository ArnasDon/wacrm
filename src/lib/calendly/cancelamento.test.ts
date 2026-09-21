import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { campoDoLembrete, mesmaReuniao, processarCancelamento } from "./cancelamento";
import { EVENTO_CANCELADO, type Cancelamento } from "./payload";

// ------------------------------------------------------------
// Cancelar no Calendly tem de DESARMAR os lembretes — e só os daquela
// reunião. O erro caro aqui não é deixar de desarmar: é desarmar o lembrete
// de uma reunião REMARCADA, calando um aviso legítimo sem que ninguém veja.
// ------------------------------------------------------------

const CANCELAMENTO: Cancelamento = {
  evento: EVENTO_CANCELADO,
  inviteeUri: "https://api.calendly.com/scheduled_events/E1/invitees/I1",
  nome: "Joel",
  email: null,
  inicio: "2026-09-25T17:00:00Z",
  eventoUri: null,
  eventoNome: null,
  reagendado: false,
  motivo: null,
};

interface Dados {
  original?: Record<string, unknown> | null;
  /** Leituras sucessivas do agendamento original (para a reléitura). */
  leituras?: (Record<string, unknown> | null)[];
  erroOriginal?: { message: string } | null;
  automacoes?: { id: string; trigger_config: unknown }[];
  erroAutomacoes?: { message: string } | null;
  valores?: { custom_field_id: string; value: string | null }[];
  erroValores?: { message: string } | null;
  erroTrava?: { message: string } | null;
}

function bancoFalso(dados: Dados) {
  const travas: Record<string, unknown>[] = [];
  const opcoesDoUpsert: unknown[] = [];
  let leu = 0;
  const db = {
    from(tabela: string) {
      const resposta = () => {
        if (tabela === "automations") return { data: dados.automacoes ?? [], error: dados.erroAutomacoes ?? null };
        if (tabela === "contact_custom_values") return { data: dados.valores ?? [], error: dados.erroValores ?? null };
        return { data: null, error: null };
      };
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        in: () => b,
        maybeSingle: async () => {
          const i = leu;
          leu += 1;
          const data = dados.leituras
            ? (dados.leituras[Math.min(i, dados.leituras.length - 1)] ?? null)
            : dados.original === undefined
              ? null
              : dados.original;
          return { data, error: dados.erroOriginal ?? null };
        },
        upsert: async (linhas: Record<string, unknown>[], opcoes?: unknown) => {
          travas.push(...linhas);
          opcoesDoUpsert.push(opcoes);
          return { error: dados.erroTrava ?? null };
        },
        then: (f: (v: unknown) => unknown) => Promise.resolve(resposta()).then(f),
      };
      return b;
    },
  } as unknown as SupabaseClient;
  return { db, travas, opcoesDoUpsert, leituras: () => leu };
}

const LEMBRETE = (id: string, campo: string) => ({
  id,
  trigger_config: { fonte: "campo", custom_field_id: campo, offset_hours: 24, direction: "antes" },
});

describe("mesmaReuniao", () => {
  it("o mesmo instante em formatos diferentes casa", () => {
    expect(mesmaReuniao("2026-09-25T17:00:00Z", "2026-09-25T17:00:00.000000Z")).toBe(true);
    expect(mesmaReuniao("2026-09-25T14:00:00-03:00", "2026-09-25T17:00:00Z")).toBe(true);
  });

  it("instante diferente não casa — é o caso do reagendamento", () => {
    expect(mesmaReuniao("2026-09-26T17:00:00Z", "2026-09-25T17:00:00Z")).toBe(false);
  });

  it("vazio, nulo ou impossível de ler não casa (falha para o lado de NÃO desarmar)", () => {
    expect(mesmaReuniao(null, "2026-09-25T17:00:00Z")).toBe(false);
    expect(mesmaReuniao("2026-09-25T17:00:00Z", null)).toBe(false);
    expect(mesmaReuniao("qualquer coisa", "2026-09-25T17:00:00Z")).toBe(false);
    // texto idêntico ainda casa, mesmo que nenhum dos dois seja data
    expect(mesmaReuniao(" x ", "x")).toBe(true);
  });
});

describe("campoDoLembrete", () => {
  it("lê o campo do gatilho por campo personalizado", () => {
    expect(campoDoLembrete({ custom_field_id: "c1" })).toBe("c1");
    expect(campoDoLembrete({ fonte: "campo", custom_field_id: "c1" })).toBe("c1");
  });

  it("gatilho da AGENDA não tem campo de contato", () => {
    expect(campoDoLembrete({ fonte: "reuniao" })).toBeNull();
  });

  it("config torta não vira campo", () => {
    expect(campoDoLembrete(null)).toBeNull();
    expect(campoDoLembrete({})).toBeNull();
    expect(campoDoLembrete({ custom_field_id: "  " })).toBeNull();
  });
});

describe("processarCancelamento", () => {
  it("desarma os lembretes cujo campo ainda aponta para a reunião cancelada", async () => {
    const { db, travas } = bancoFalso({
      original: { contact_id: "contato-1" },
      automacoes: [LEMBRETE("a24", "campo-data"), LEMBRETE("a1h", "campo-data")],
      valores: [{ custom_field_id: "campo-data", value: "2026-09-25T17:00:00Z" }],
    });
    const r = await processarCancelamento(db, "conta-1", CANCELAMENTO);
    expect(r.resultado).toBe("cancelado");
    expect(r.contactId).toBe("contato-1");
    expect(travas).toHaveLength(2);
    expect(travas[0]).toMatchObject({
      account_id: "conta-1",
      automation_id: "a24",
      contact_id: "contato-1",
      valor: "2026-09-25T17:00:00Z",
      motivo: "cancelamento",
    });
  });

  it("CRÍTICO: reagendamento não desarma nada", async () => {
    const { db, travas } = bancoFalso({
      original: { contact_id: "contato-1" },
      automacoes: [LEMBRETE("a24", "campo-data")],
      valores: [{ custom_field_id: "campo-data", value: "2026-09-25T17:00:00Z" }],
    });
    const r = await processarCancelamento(db, "conta-1", { ...CANCELAMENTO, reagendado: true });
    expect(r.resultado).toBe("ignorado");
    expect(travas).toEqual([]);
  });

  it("CRÍTICO: se a ficha já tem OUTRO horário, não desarma (o invitee.created chegou primeiro)", async () => {
    // O Calendly manda cancelamento e criação sem ordem garantida. Desarmar
    // aqui calaria o lembrete da reunião NOVA, que existe.
    const { db, travas } = bancoFalso({
      original: { contact_id: "contato-1" },
      automacoes: [LEMBRETE("a24", "campo-data")],
      valores: [{ custom_field_id: "campo-data", value: "2026-10-02T17:00:00Z" }],
    });
    const r = await processarCancelamento(db, "conta-1", CANCELAMENTO);
    expect(r.resultado).toBe("ignorado");
    expect(r.detalhe).toContain("não é mais a da reunião cancelada");
    expect(travas).toEqual([]);
  });

  it("desarma também o lembrete DESLIGADO — ele pode ser ligado antes da reunião", async () => {
    // A consulta não filtra `is_active` de propósito; aqui isso se vê pelo
    // fato de a automação entrar na trava sem nenhum sinal de estar ativa.
    const { db, travas } = bancoFalso({
      original: { contact_id: "contato-1" },
      automacoes: [{ id: "a-desligada", trigger_config: { custom_field_id: "campo-data" } }],
      valores: [{ custom_field_id: "campo-data", value: "2026-09-25T17:00:00Z" }],
    });
    const r = await processarCancelamento(db, "conta-1", CANCELAMENTO);
    expect(r.resultado).toBe("cancelado");
    expect(travas.map((t) => t.automation_id)).toEqual(["a-desligada"]);
  });

  it("sem horário no cancelamento, não há o que casar", async () => {
    const { db, travas } = bancoFalso({ original: { contact_id: "c" } });
    const r = await processarCancelamento(db, "conta-1", { ...CANCELAMENTO, inicio: null });
    expect(r.resultado).toBe("ignorado");
    expect(travas).toEqual([]);
  });

  it("agendamento sem contato no log não desarma nada", async () => {
    const { db, travas } = bancoFalso({ original: { contact_id: null } });
    expect((await processarCancelamento(db, "conta-1", CANCELAMENTO)).resultado).toBe("ignorado");
    const semLinha = bancoFalso({ original: null });
    expect((await processarCancelamento(semLinha.db, "conta-1", CANCELAMENTO)).resultado).toBe("ignorado");
    expect(travas).toEqual([]);
  });

  it("conta sem lembrete por data: nada a fazer", async () => {
    const { db } = bancoFalso({ original: { contact_id: "c" }, automacoes: [] });
    const r = await processarCancelamento(db, "conta-1", CANCELAMENTO);
    expect(r.resultado).toBe("ignorado");
    expect(r.contactId).toBe("c");
  });

  it("erro de banco vira FALHA visível, nunca 'ignorado'", async () => {
    const original = bancoFalso({ erroOriginal: { message: "timeout" } });
    expect((await processarCancelamento(original.db, "c1", CANCELAMENTO)).resultado).toBe("falhou");

    const autos = bancoFalso({ original: { contact_id: "c" }, erroAutomacoes: { message: "boom" } });
    expect((await processarCancelamento(autos.db, "c1", CANCELAMENTO)).resultado).toBe("falhou");

    const valores = bancoFalso({
      original: { contact_id: "c" },
      automacoes: [LEMBRETE("a", "campo-data")],
      erroValores: { message: "boom" },
    });
    expect((await processarCancelamento(valores.db, "c1", CANCELAMENTO)).resultado).toBe("falhou");

    const trava = bancoFalso({
      original: { contact_id: "c" },
      automacoes: [LEMBRETE("a", "campo-data")],
      valores: [{ custom_field_id: "campo-data", value: "2026-09-25T17:00:00Z" }],
      erroTrava: { message: "23505 não, outro" },
    });
    expect((await processarCancelamento(trava.db, "c1", CANCELAMENTO)).resultado).toBe("falhou");
  });
});

describe("processarCancelamento — corridas (Codex, PR #235)", () => {
  const semDormir = { esperar: async () => {} };

  it("CRÍTICO: agendamento AINDA EM PROCESSAMENTO é relido antes de desistir", async () => {
    // A rota responde 200 ao Calendly e processa em after(): quem marca e
    // cancela em seguida chega aqui com `contact_id` ainda nulo. Desistir no
    // primeiro olhar deixaria os lembretes armados, e a reentrega do
    // Calendly não tenta de novo (a linha do cancelamento já existe).
    const { db, travas, leituras } = bancoFalso({
      leituras: [
        { contact_id: null, resultado: "recebido", processando_desde: "2026-09-21T01:00:00Z" },
        { contact_id: null, resultado: "recebido", processando_desde: "2026-09-21T01:00:00Z" },
        { contact_id: "contato-1", resultado: "disparado", processando_desde: null },
      ],
      automacoes: [LEMBRETE("a24", "campo-data")],
      valores: [{ custom_field_id: "campo-data", value: "2026-09-25T17:00:00Z" }],
    });
    const r = await processarCancelamento(db, "conta-1", CANCELAMENTO, semDormir);
    expect(leituras()).toBe(3);
    expect(r.resultado).toBe("cancelado");
    expect(travas).toHaveLength(1);
  });

  it("agendamento JÁ FINALIZADO sem contato não fica relendo à toa", async () => {
    const { db, leituras } = bancoFalso({
      original: { contact_id: null, resultado: "sem_telefone", processando_desde: null },
    });
    const r = await processarCancelamento(db, "conta-1", CANCELAMENTO, semDormir);
    expect(leituras()).toBe(1);
    expect(r.resultado).toBe("ignorado");
  });

  it("esgotadas as tentativas, o detalhe DIZ que os lembretes podem ter ficado armados", async () => {
    const { db } = bancoFalso({
      original: { contact_id: null, resultado: "recebido", processando_desde: "2026-09-21T01:00:00Z" },
    });
    const r = await processarCancelamento(db, "conta-1", CANCELAMENTO, { ...semDormir, tentativas: 2 });
    expect(r.resultado).toBe("ignorado");
    expect(r.detalhe).toContain("podem ter ficado armados");
  });

  it("CRÍTICO: o upsert PROMOVE a trava existente — nunca ignora o conflito", async () => {
    // A varredura insere a trava ANTES de disparar e a DEVOLVE quando o
    // recorte barra. Ignorando o conflito, um cancelamento concorrente não
    // deixava marca e a devolução apagava tudo: o ciclo seguinte mandaria o
    // lembrete da reunião cancelada.
    const { db, opcoesDoUpsert } = bancoFalso({
      original: { contact_id: "contato-1" },
      automacoes: [LEMBRETE("a24", "campo-data")],
      valores: [{ custom_field_id: "campo-data", value: "2026-09-25T17:00:00Z" }],
    });
    await processarCancelamento(db, "conta-1", CANCELAMENTO, semDormir);
    expect(opcoesDoUpsert).toHaveLength(1);
    expect((opcoesDoUpsert[0] as { ignoreDuplicates?: boolean })?.ignoreDuplicates).toBeUndefined();
    expect((opcoesDoUpsert[0] as { onConflict?: string })?.onConflict).toBe("automation_id,contact_id,valor");
  });
});

describe("a devolução da trava não alcança o cancelamento (pino estrutural)", () => {
  it("varrer-lembretes só apaga a linha com motivo = 'disparo'", async () => {
    // As duas correções se cruzam nesta linha: sem a cerca, a devolução
    // apagaria uma trava PROMOVIDA por cancelamento. O comportamento não tem
    // teste de banco, então o que segura é ler o fonte.
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("src/lib/automations/varrer-lembretes.ts", "utf-8").replace(/\/\/.*$/gm, "");
    expect(fonte).toMatch(/\.delete\(\)[\s\S]{0,200}?\.eq\('motivo', 'disparo'\)/);
  });
});
