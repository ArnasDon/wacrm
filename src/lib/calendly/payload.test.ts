import { describe, expect, it } from "vitest";

import { eventoDoCorpo, lerAgendamento, lerCancelamento, normalizarRotulo, telefoneDoAgendamento } from "./payload";

/** A forma do exemplo oficial (`Webhook Payload`, doc do Calendly). */
function corpo(extra: Record<string, unknown> = {}, evento: Record<string, unknown> = {}) {
  return {
    created_at: "2026-08-20T17:51:19.000000Z",
    created_by: "https://api.calendly.com/users/AAAA",
    event: "invitee.created",
    payload: {
      cancel_url: "https://calendly.com/cancellations/INV1",
      created_at: "2026-08-20T17:51:18.327602Z",
      email: "marcelo@example.com",
      event: "https://api.calendly.com/scheduled_events/EVT1",
      name: "Marcelo",
      new_invitee: null,
      old_invitee: null,
      questions_and_answers: [],
      reschedule_url: "https://calendly.com/reschedulings/INV1",
      rescheduled: false,
      status: "active",
      text_reminder_number: null,
      timezone: "America/Sao_Paulo",
      tracking: {},
      uri: "https://api.calendly.com/scheduled_events/EVT1/invitees/INV1",
      scheduled_event: {
        uri: "https://api.calendly.com/scheduled_events/EVT1",
        name: "Reunião com Advogado - Kommo",
        status: "active",
        start_time: "2026-08-26T16:45:00.000000Z",
        end_time: "2026-08-26T17:15:00.000000Z",
        event_type: "https://api.calendly.com/event_types/TIPO1",
        location: { type: "google_conference", status: "pushed", join_url: "https://meet.google.com/abc-defg-hij" },
        ...evento,
      },
      ...extra,
    },
  };
}

describe("lerAgendamento", () => {
  it("lê o exemplo oficial", () => {
    const a = lerAgendamento(corpo());
    expect(a).not.toBeNull();
    expect(a!.nome).toBe("Marcelo");
    expect(a!.email).toBe("marcelo@example.com");
    expect(a!.inviteeUri).toBe("https://api.calendly.com/scheduled_events/EVT1/invitees/INV1");
    expect(a!.eventoUri).toBe("https://api.calendly.com/event_types/TIPO1");
    expect(a!.eventoNome).toBe("Reunião com Advogado - Kommo");
    expect(a!.inicio).toBe("2026-08-26T16:45:00.000000Z");
    expect(a!.link).toBe("https://meet.google.com/abc-defg-hij");
    expect(a!.reagendado).toBe(false);
    expect(a!.telefone).toBeNull();
    expect(a!.telefoneOrigem).toBeNull();
  });

  it("outro evento (cancelamento) não é agendamento", () => {
    expect(lerAgendamento({ ...corpo(), event: "invitee.canceled" })).toBeNull();
    expect(eventoDoCorpo({ ...corpo(), event: "invitee.canceled" })).toBe("invitee.canceled");
  });

  it("corpo sem forma é nulo, nunca estoura", () => {
    expect(lerAgendamento(null)).toBeNull();
    expect(lerAgendamento("x")).toBeNull();
    expect(lerAgendamento({ event: "invitee.created" })).toBeNull();
    expect(lerAgendamento({ event: "invitee.created", payload: { name: "X" } })).toBeNull();
  });

  it("nome separado em primeiro/último quando o evento é assim configurado", () => {
    const a = lerAgendamento(corpo({ name: "", first_name: "Ana", last_name: "Souza" }));
    expect(a!.nome).toBe("Ana Souza");
  });

  it("reagendamento: `old_invitee` preenchido", () => {
    const a = lerAgendamento(corpo({ old_invitee: "https://api.calendly.com/scheduled_events/E0/invitees/I0" }));
    expect(a!.reagendado).toBe(true);
  });

  it("link: join_url vence; local em URL serve; endereço físico não vira link", () => {
    expect(lerAgendamento(corpo({}, { location: { type: "custom", location: "https://zoom.us/j/1" } }))!.link).toBe(
      "https://zoom.us/j/1",
    );
    const fisico = lerAgendamento(corpo({}, { location: { type: "physical", location: "Escritório, sala 3" } }))!;
    expect(fisico.link).toBeNull();
    expect(fisico.local).toBe("Escritório, sala 3");
  });
});

describe("telefoneDoAgendamento (D1)", () => {
  const perguntas = [
    { pergunta: "Qual o seu WhatsApp?", resposta: "(96) 99000-0016" },
    { pergunta: "Valor da dívida", resposta: "R$ 15.000" },
  ];

  it("1º: o lembrete por SMS, quando existe", () => {
    expect(telefoneDoAgendamento({ text_reminder_number: "+55 83 98000-0016" }, perguntas)).toEqual({
      telefone: "5583980000016",
      origem: "sms",
    });
  });

  it("2º: a pergunta configurada pelo operador, por trecho e sem acento", () => {
    const lista = [
      { pergunta: "Telefone do escritório", resposta: "(83) 3222-1111" },
      { pergunta: "Seu número de contato (WhatsApp)", resposta: "96 99000-0016" },
    ];
    expect(telefoneDoAgendamento({}, lista, "whatsapp")).toEqual({ telefone: "5596990000016", origem: "pergunta" });
    expect(telefoneDoAgendamento({}, lista, "Numero de Contato")).toEqual({
      telefone: "5596990000016",
      origem: "pergunta",
    });
  });

  it("3º: heurística — a pergunta que fala de telefone vence qualquer outra resposta numérica", () => {
    const lista = [
      { pergunta: "CPF", resposta: "123.456.789-00" },
      { pergunta: "Celular", resposta: "83 98000-0016" },
    ];
    expect(telefoneDoAgendamento({}, lista)).toEqual({ telefone: "5583980000016", origem: "heuristica" });
  });

  it("3º: sem rótulo conhecido, a primeira resposta com cara de telefone", () => {
    const lista = [{ pergunta: "Como podemos te achar?", resposta: "+55 96 99000-0016" }];
    expect(telefoneDoAgendamento({}, lista)).toEqual({ telefone: "5596990000016", origem: "heuristica" });
  });

  it("sem nada que pareça telefone, fica sem — nunca inventa", () => {
    expect(telefoneDoAgendamento({}, [{ pergunta: "CPF", resposta: "123.456.789-00" }])).toEqual({
      telefone: null,
      origem: null,
    });
    expect(telefoneDoAgendamento({}, [])).toEqual({ telefone: null, origem: null });
  });

  it("CPF tem 11 dígitos como um celular: o rótulo e a pontuação o excluem da heurística", () => {
    // Rótulo diz que é documento — mesmo sem pontuação.
    expect(telefoneDoAgendamento({}, [{ pergunta: "Informe o CPF", resposta: "12345678900" }])).toEqual({
      telefone: null,
      origem: null,
    });
    // Rótulo neutro, mas a pontuação é de CPF/CNPJ.
    expect(telefoneDoAgendamento({}, [{ pergunta: "Documento", resposta: "123.456.789-00" }])).toEqual({
      telefone: null,
      origem: null,
    });
    expect(telefoneDoAgendamento({}, [{ pergunta: "Empresa", resposta: "12.345.678/0001-90" }])).toEqual({
      telefone: null,
      origem: null,
    });
    // A pergunta configurada pelo operador VENCE a lista de exclusão: se ele
    // disse que o telefone está em "Contato", é lá que está.
    expect(
      telefoneDoAgendamento({}, [{ pergunta: "Contato", resposta: "83980000016" }], "contato"),
    ).toEqual({ telefone: "5583980000016", origem: "pergunta" });
  });

  it("a pergunta configurada que não existe no formulário não trava a heurística", () => {
    expect(telefoneDoAgendamento({}, perguntas, "Telefone comercial")).toEqual({
      telefone: "5596990000016",
      origem: "heuristica",
    });
  });
});

describe("normalizarRotulo", () => {
  it("tira acento e caixa", () => {
    expect(normalizarRotulo("  Número de TELEFONE ")).toBe("numero de telefone");
  });
});

describe("lerCancelamento", () => {
  const corpo = (payload: Record<string, unknown>) => ({ event: "invitee.canceled", payload });

  it("lê o invitee, o horário e o motivo", () => {
    const c = lerCancelamento(
      corpo({
        uri: "https://api.calendly.com/scheduled_events/E1/invitees/I1",
        name: "Joel",
        email: "joel@x.com",
        cancellation: { reason: "imprevisto" },
        scheduled_event: { start_time: "2026-09-25T17:00:00Z", event_type: "T1", name: "Reunião" },
      }),
    );
    expect(c).toMatchObject({
      inviteeUri: "https://api.calendly.com/scheduled_events/E1/invitees/I1",
      nome: "Joel",
      email: "joel@x.com",
      inicio: "2026-09-25T17:00:00Z",
      eventoUri: "T1",
      reagendado: false,
      motivo: "imprevisto",
    });
  });

  it("CRÍTICO: reagendamento é reconhecido pelos DOIS sinais", () => {
    // Nenhum dos dois é garantido pelo Calendly, e tratar um reagendamento
    // como cancelamento puro calaria o lembrete da reunião NOVA.
    expect(lerCancelamento(corpo({ uri: "u", rescheduled: true }))?.reagendado).toBe(true);
    expect(lerCancelamento(corpo({ uri: "u", new_invitee: "https://api.calendly.com/…/I2" }))?.reagendado).toBe(true);
    expect(lerCancelamento(corpo({ uri: "u" }))?.reagendado).toBe(false);
  });

  it("outro evento, corpo torto ou sem invitee devolve null", () => {
    expect(lerCancelamento({ event: "invitee.created", payload: { uri: "u" } })).toBeNull();
    expect(lerCancelamento(corpo({}))).toBeNull();
    expect(lerCancelamento(null)).toBeNull();
    expect(lerCancelamento({ event: "invitee.canceled" })).toBeNull();
  });

  it("nome vem do name, ou de first+last, ou é nulo", () => {
    expect(lerCancelamento(corpo({ uri: "u", first_name: "Ana", last_name: "Lima" }))?.nome).toBe("Ana Lima");
    expect(lerCancelamento(corpo({ uri: "u" }))?.nome).toBeNull();
  });
});
