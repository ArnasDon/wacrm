import { describe, expect, it } from "vitest";

import type { Agendamento } from "./payload";
import { formatarDataHora, VARIAVEIS_DO_AGENDAMENTO, variaveisDoAgendamento } from "./variaveis";

const base: Agendamento = {
  evento: "invitee.created",
  inviteeUri: "https://api.calendly.com/scheduled_events/E/invitees/I",
  nome: "Marcelo",
  email: "m@x.com",
  telefone: "5596990000016",
  telefoneOrigem: "pergunta",
  eventoUri: "https://api.calendly.com/event_types/T",
  eventoNome: "Reunião com Advogado - Kommo",
  eventoAgendadoUri: "https://api.calendly.com/scheduled_events/E",
  inicio: "2026-08-26T16:45:00.000000Z",
  fim: "2026-08-26T17:15:00.000000Z",
  link: "https://meet.google.com/abc",
  local: null,
  cancelarUrl: "https://calendly.com/cancellations/I",
  remarcarUrl: "https://calendly.com/reschedulings/I",
  reagendado: false,
  fusoDoConvidado: "America/Sao_Paulo",
  perguntas: [],
};

describe("formatarDataHora", () => {
  it("UTC → hora de Brasília, dd/mm/aaaa hh:mm (o exemplo do pedido)", () => {
    expect(formatarDataHora("2026-08-26T16:45:00.000000Z")).toBe("26/08/2026 às 13:45h");
  });

  it("meia-noite não vira 24:00", () => {
    expect(formatarDataHora("2026-08-27T03:00:00Z")).toBe("27/08/2026 às 00:00h");
  });

  it("respeita o fuso pedido", () => {
    expect(formatarDataHora("2026-08-26T16:45:00Z", "UTC")).toBe("26/08/2026 às 16:45h");
  });

  it("lixo vira vazio", () => {
    expect(formatarDataHora(null)).toBe("");
    expect(formatarDataHora("ontem")).toBe("");
  });
});

describe("variaveisDoAgendamento", () => {
  it("monta as variáveis da mensagem do pedido", () => {
    const v = variaveisDoAgendamento(base);
    expect(v.agendamento_nome).toBe("Marcelo");
    expect(v.agendamento_evento).toBe("Reunião com Advogado - Kommo");
    expect(v.agendamento_data).toBe("26/08/2026 às 13:45h");
    expect(v.agendamento_telefone).toBe("(96) 99000-0016");
    expect(v.agendamento_inicio).toBe("2026-08-26T16:45:00.000000Z");
    expect(v.agendamento_link).toBe("https://meet.google.com/abc");
    expect(v.agendamento_situacao).toBe("Novo agendamento");
  });

  it("ausências viram string vazia — `{{vars.x}}` nunca imprime undefined", () => {
    const v = variaveisDoAgendamento({ ...base, telefone: null, link: null, inicio: null, email: null, eventoNome: null });
    expect(v.agendamento_telefone).toBe("");
    expect(v.agendamento_link).toBe("");
    expect(v.agendamento_data).toBe("");
    expect(v.agendamento_inicio).toBe("");
    expect(v.agendamento_email).toBe("");
    expect(v.agendamento_evento).toBe("");
  });

  it("reagendamento muda a situação", () => {
    expect(variaveisDoAgendamento({ ...base, reagendado: true }).agendamento_situacao).toBe("Reagendamento");
  });

  it("a lista da dica cobre exatamente as variáveis entregues", () => {
    expect([...VARIAVEIS_DO_AGENDAMENTO].sort()).toEqual(Object.keys(variaveisDoAgendamento(base)).sort());
  });
});
