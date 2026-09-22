import { describe, expect, it } from "vitest";

import { agendamentoDaLinha, varsDaLinha } from "./reprocessar";

// ============================================================
// "Processar de novo" roda o agendamento a partir da LINHA gravada. A
// sutileza toda está nas variáveis: a tabela não guarda local, cancelar,
// remarcar nem situação em coluna, então um remonte cru entregaria à
// automação menos do que a primeira entrega — em silêncio, com o link de
// cancelamento saindo vazio numa mensagem que o pede.
// ============================================================

const LINHA = {
  evento: "invitee.created",
  invitee_uri: "https://api.calendly.com/scheduled_events/E1/invitees/I1",
  event_type_uri: "https://api.calendly.com/event_types/T1",
  event_type_nome: "Reunião com Advogado - Kommo",
  nome: "Joel",
  email: "joel@exemplo.com",
  telefone: "5519980000004",
  telefone_origem: "heuristica",
  inicio: "2026-09-09T19:00:00Z",
  fim: "2026-09-09T20:00:00Z",
  link: "https://meet.google.com/x",
  perguntas: [{ pergunta: "Telefone (Whatsapp)", resposta: "+55 19 98000-0004" }],
  variaveis: {},
};

describe("agendamentoDaLinha", () => {
  it("remonta o agendamento a partir do que a linha guarda", () => {
    const a = agendamentoDaLinha(LINHA);
    expect(a).toMatchObject({
      evento: "invitee.created",
      nome: "Joel",
      telefone: "5519980000004",
      telefoneOrigem: "heuristica",
      eventoUri: "https://api.calendly.com/event_types/T1",
      inicio: "2026-09-09T19:00:00Z",
    });
    expect(a?.perguntas).toHaveLength(1);
  });

  it("linha sem invitee, ou de outro tipo de evento, é recusada", () => {
    expect(agendamentoDaLinha({ ...LINHA, invitee_uri: null })).toBeNull();
    expect(agendamentoDaLinha({ ...LINHA, evento: "invitee.canceled" })).toBeNull();
  });

  it("campo vazio vira null, não string vazia", () => {
    const a = agendamentoDaLinha({ ...LINHA, email: "", event_type_nome: "   " });
    expect(a?.email).toBeNull();
    expect(a?.eventoNome).toBeNull();
  });

  it("os quatro campos que a tabela não guarda ficam nulos — é por isso que as vars gravadas mandam", () => {
    const a = agendamentoDaLinha(LINHA)!;
    expect(a.local).toBeNull();
    expect(a.cancelarUrl).toBeNull();
    expect(a.remarcarUrl).toBeNull();
    expect(a.reagendado).toBe(false);
  });
});

describe("varsDaLinha", () => {
  it("CRÍTICO: as variáveis GRAVADAS vencem o remonte", () => {
    const a = agendamentoDaLinha(LINHA)!;
    const vars = varsDaLinha(
      { ...LINHA, variaveis: { agendamento_nome: "Joel", agendamento_cancelar: "https://calendly.com/cancelar/x" } },
      a,
    );
    expect(vars.agendamento_cancelar).toBe("https://calendly.com/cancelar/x");
    // O remonte não teria esta: a coluna não existe.
    expect(varsDaLinha(LINHA, a).agendamento_cancelar).toBe("");
  });

  it("linha anterior à 979 (sem variáveis) cai no remonte, que é o que há", () => {
    const a = agendamentoDaLinha(LINHA)!;
    for (const guardadas of [{}, null, undefined, [], "texto"]) {
      const vars = varsDaLinha({ ...LINHA, variaveis: guardadas }, a);
      expect(vars.agendamento_nome).toBe("Joel");
      expect(vars.agendamento_data).toBe("09/09/2026 às 16:00h");
    }
  });

  it("valor que não é texto é descartado — o motor interpola string", () => {
    const a = agendamentoDaLinha(LINHA)!;
    const vars = varsDaLinha({ ...LINHA, variaveis: { agendamento_nome: "Joel", lixo: { a: 1 }, n: 7 } }, a);
    expect(vars).toEqual({ agendamento_nome: "Joel" });
  });
});
