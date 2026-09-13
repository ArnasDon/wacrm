import { describe, expect, it } from "vitest";
import {
  validateAsaasReguaForActivation,
  validateStepsForActivation,
  validateTriggerForActivation,
} from "./validate";

describe("validateStepsForActivation", () => {
  it("rejects empty or missing step lists", () => {
    expect(validateStepsForActivation([])).toEqual([
      { path: "steps", message: "active automations need at least one step" },
    ]);
    expect(
      validateStepsForActivation(undefined as unknown as never[]),
    ).toEqual([
      { path: "steps", message: "active automations need at least one step" },
    ]);
  });

  it("passes a fully-populated step set", () => {
    const issues = validateStepsForActivation([
      { step_type: "send_message", step_config: { text: "hi" } },
      {
        step_type: "wait",
        step_config: { amount: 5, unit: "minutes" },
      },
      { step_type: "add_tag", step_config: { tag_id: "tag-uuid" } },
      { step_type: "close_conversation", step_config: {} },
    ]);
    expect(issues).toEqual([]);
  });

  it("flags every required field that is missing", () => {
    const issues = validateStepsForActivation([
      { step_type: "send_message", step_config: { text: "  " } },
      { step_type: "send_template", step_config: {} },
      { step_type: "add_tag", step_config: { tag_id: "" } },
    ]);
    expect(issues.map((i) => i.path)).toEqual([
      "steps[0].text",
      "steps[1].template_name",
      "steps[2].tag_id",
    ]);
  });

  it("checks wait amount and unit boundaries", () => {
    const issues = validateStepsForActivation([
      { step_type: "wait", step_config: { amount: 0, unit: "minutes" } },
      // `seconds` passou a ser unidade VÁLIDA (as pausas curtas das automações
      // do escritório); o inválido de verdade aqui é uma unidade que o motor
      // não sabe converter — `waitMs` cairia no fallback de minutos e a espera
      // de "2 semanas" duraria 2 minutos.
      { step_type: "wait", step_config: { amount: 5, unit: "weeks" } },
      { step_type: "wait", step_config: { amount: -1, unit: "hours" } },
      {
        step_type: "wait",
        step_config: { amount: Number.POSITIVE_INFINITY, unit: "days" },
      },
    ]);
    expect(issues.map((i) => i.path)).toEqual([
      "steps[0].amount",
      "steps[1].unit",
      "steps[2].amount",
      "steps[3].amount",
    ]);
  });

  it("validates webhook URLs", () => {
    const good = validateStepsForActivation([
      {
        step_type: "send_webhook",
        step_config: { url: "https://hooks.example.com/in" },
      },
    ]);
    expect(good).toEqual([]);

    const noUrl = validateStepsForActivation([
      { step_type: "send_webhook", step_config: {} },
    ]);
    expect(noUrl.map((i) => i.message)).toContain("webhook URL is required");

    const wrongProtocol = validateStepsForActivation([
      {
        step_type: "send_webhook",
        step_config: { url: "ftp://files.example.com" },
      },
    ]);
    expect(wrongProtocol.map((i) => i.message)).toContain(
      "webhook URL must use http or https",
    );

    const garbage = validateStepsForActivation([
      { step_type: "send_webhook", step_config: { url: "not a url" } },
    ]);
    expect(garbage.map((i) => i.message)).toContain(
      "webhook URL is not a valid URL",
    );
  });

  it("validates assign_conversation only when mode is 'specific'", () => {
    const roundRobinNoAgent = validateStepsForActivation([
      {
        step_type: "assign_conversation",
        step_config: { mode: "round_robin" },
      },
    ]);
    expect(roundRobinNoAgent).toEqual([]);

    const specificMissingAgent = validateStepsForActivation([
      { step_type: "assign_conversation", step_config: { mode: "specific" } },
    ]);
    expect(specificMissingAgent.map((i) => i.path)).toEqual([
      "steps[0].agent_id",
    ]);
  });

  it("flags create_deal when required fields are missing", () => {
    const issues = validateStepsForActivation([
      { step_type: "create_deal", step_config: {} },
    ]);
    expect(issues.map((i) => i.path).sort()).toEqual([
      "steps[0].pipeline_id",
      "steps[0].stage_id",
      "steps[0].title",
    ]);
  });

  it("validates send_buttons / send_list interactive payloads", () => {
    const good = validateStepsForActivation([
      {
        step_type: "send_buttons",
        step_config: {
          kind: "buttons",
          body: "Pick one",
          buttons: [{ id: "yes", title: "Yes" }],
        },
      },
    ]);
    expect(good).toEqual([]);

    const tooMany = validateStepsForActivation([
      {
        step_type: "send_buttons",
        step_config: {
          kind: "buttons",
          body: "Pick one",
          buttons: [
            { id: "a", title: "A" },
            { id: "b", title: "B" },
            { id: "c", title: "C" },
            { id: "d", title: "D" },
          ],
        },
      },
    ]);
    expect(tooMany.map((i) => i.path)).toEqual(["steps[0].interactive"]);
  });

  it("flags update_contact_field when field or value is missing", () => {
    const issues = validateStepsForActivation([
      { step_type: "update_contact_field", step_config: { field: "name" } },
      {
        step_type: "update_contact_field",
        step_config: { field: "", value: "x" },
      },
    ]);
    expect(issues.map((i) => i.path)).toEqual([
      "steps[0].value",
      "steps[1].field",
    ]);
  });

  it("recursively walks condition branches with stable dot-paths", () => {
    const issues = validateStepsForActivation([
      {
        step_type: "condition",
        step_config: { subject: "tag", operand: "vip" },
        branches: {
          yes: [{ step_type: "add_tag", step_config: { tag_id: "" } }],
          no: [
            {
              step_type: "send_message",
              step_config: { text: "" },
            },
          ],
        },
      },
    ]);
    expect(issues.map((i) => i.path)).toEqual([
      "steps[0].yes.steps[0].tag_id",
      "steps[0].no.steps[0].text",
    ]);
  });

  it("reports an issue for unknown step types", () => {
    const issues = validateStepsForActivation([
      { step_type: "do_a_barrel_roll", step_config: {} },
    ]);
    expect(issues).toEqual([
      { path: "steps[0]", message: "unknown step type: do_a_barrel_roll" },
    ]);
  });

  it("flags condition subject/operand independently", () => {
    const issues = validateStepsForActivation([
      { step_type: "condition", step_config: {} },
    ]);
    expect(issues.map((i) => i.path).sort()).toEqual([
      "steps[0].operand",
      "steps[0].subject",
    ]);
  });
});

describe("validateTriggerForActivation", () => {
  it("accepts a valid keyword_match config", () => {
    expect(
      validateTriggerForActivation("keyword_match", {
        keywords: ["hello", "hi"],
        match_type: "exact",
      }),
    ).toEqual([]);
  });

  it("rejects keyword_match with empty keyword array", () => {
    const issues = validateTriggerForActivation("keyword_match", {
      keywords: [],
      match_type: "exact",
    });
    expect(issues.map((i) => i.path)).toContain("trigger.keywords");
  });

  it("rejects keyword_match with whitespace-only entries", () => {
    const issues = validateTriggerForActivation("keyword_match", {
      keywords: ["hi", "   "],
      match_type: "contains",
    });
    expect(issues.map((i) => i.message)).toContain(
      "keywords cannot be empty strings",
    );
  });

  it("rejects keyword_match with an unknown match_type", () => {
    const issues = validateTriggerForActivation("keyword_match", {
      keywords: ["hi"],
      match_type: "fuzzy",
    });
    expect(issues.map((i) => i.path)).toContain("trigger.match_type");
  });

  it("accepts keyword_match with a missing match_type (defaults to contains)", () => {
    expect(
      validateTriggerForActivation("keyword_match", { keywords: ["hi"] }),
    ).toEqual([]);
  });

  it("accepts the word match_type (issue #409)", () => {
    // Activation validation has to stay in step with the engine and the
    // builder's dropdown — an automation the UI can save must not be
    // rejected on activation.
    expect(
      validateTriggerForActivation("keyword_match", {
        keywords: ["hi"],
        match_type: "word",
      }),
    ).toEqual([]);
  });

  it("requires schedule on time_based triggers", () => {
    expect(validateTriggerForActivation("time_based", {})).toEqual([
      { path: "trigger.schedule", message: "schedule is required" },
    ]);
    expect(
      validateTriggerForActivation("time_based", { schedule: "0 9 * * *" }),
    ).toEqual([]);
  });

  it("requires tag_id on tag_added triggers", () => {
    expect(validateTriggerForActivation("tag_added", {})).toEqual([
      { path: "trigger.tag_id", message: "tag is required" },
    ]);
    expect(
      validateTriggerForActivation("tag_added", { tag_id: "tag-uuid" }),
    ).toEqual([]);
  });

  it("requires reply_ids on interactive_reply triggers", () => {
    expect(validateTriggerForActivation("interactive_reply", {})).toEqual([
      { path: "trigger.reply_ids", message: "at least one reply id is required" },
    ]);
    expect(
      validateTriggerForActivation("interactive_reply", { reply_ids: ["yes", "no"] }),
    ).toEqual([]);
    const empties = validateTriggerForActivation("interactive_reply", {
      reply_ids: ["yes", "  "],
    });
    expect(empties.map((i) => i.message)).toContain(
      "reply ids cannot be empty strings",
    );
  });

  it("does not flag unknown trigger types (handled elsewhere)", () => {
    expect(validateTriggerForActivation("some_future_trigger", {})).toEqual([]);
  });
});

describe("send_to_number / calendly_booking (977)", () => {
  it("exige telefone com DDI e texto", () => {
    expect(
      validateStepsForActivation([{ step_type: "send_to_number", step_config: { phone: "(83) 98874-5316", text: "oi" } }]),
    ).toEqual([]);
    expect(
      validateStepsForActivation([{ step_type: "send_to_number", step_config: { phone: "123", text: "oi" } }]),
    ).toEqual([{ path: "steps[0].phone", message: "phone must be a valid number with country code" }]);
    expect(
      validateStepsForActivation([{ step_type: "send_to_number", step_config: { phone: "5583988745316", text: " " } }]),
    ).toEqual([{ path: "steps[0].text", message: "message text is required" }]);
  });

  it("gatilho: vazio é 'qualquer evento'; só lixo é recusado", () => {
    expect(validateTriggerForActivation("calendly_booking", {})).toEqual([]);
    expect(validateTriggerForActivation("calendly_booking", { event_type_uri: "https://api.calendly.com/event_types/A" })).toEqual([]);
    expect(validateTriggerForActivation("calendly_booking", { event_type_uri: 12 })).toEqual([
      { path: "trigger.event_type_uri", message: "event type must be a string" },
    ]);
  });
});

// ============================================================
// A régua do Asaas (998): o marco obrigatório na cobrança, a hora na faixa
// 08:00–17:00, e as duas regras a MAIS dos passos — sem "Aguardar" e toda
// mensagem com a conexão escolhida (D19).
// ============================================================

describe('régua do Asaas — o gatilho', () => {
  it('a cobrança exige o marco (1..365); o lembrete não tem marco', () => {
    expect(validateTriggerForActivation('asaas_cobranca_vencida', {})).toHaveLength(1)
    expect(validateTriggerForActivation('asaas_cobranca_vencida', { dias_de_atraso: 0 })).toHaveLength(1)
    expect(validateTriggerForActivation('asaas_cobranca_vencida', { dias_de_atraso: 366 })).toHaveLength(1)
    expect(validateTriggerForActivation('asaas_cobranca_vencida', { dias_de_atraso: 5 })).toEqual([])
    expect(validateTriggerForActivation('asaas_cobranca_vence_hoje', {})).toEqual([])
  })

  it('a hora fica entre 08:00 e 17:00, e "só dia útil" é booleano', () => {
    expect(validateTriggerForActivation('asaas_cobranca_vence_hoje', { hora_envio: '07:30' })).toHaveLength(1)
    expect(validateTriggerForActivation('asaas_cobranca_vence_hoje', { hora_envio: '17:00' })).toEqual([])
    expect(validateTriggerForActivation('asaas_cobranca_vence_hoje', { hora_envio: '9h' })).toHaveLength(1)
    expect(validateTriggerForActivation('asaas_cobranca_vence_hoje', { somente_dias_uteis: 'false' })).toHaveLength(1)
    expect(validateTriggerForActivation('asaas_cobranca_vence_hoje', { somente_dias_uteis: false })).toEqual([])
  })
})

describe('régua do Asaas — os passos', () => {
  const msg = (channel_id?: string) => ({ step_type: 'send_message', step_config: channel_id ? { text: 'x', channel_id } : { text: 'x' } })

  it('toda mensagem precisa da conexão escolhida, em qualquer escopo', () => {
    expect(validateAsaasReguaForActivation('asaas_cobranca_vencida', [msg('c1')])).toEqual([])
    expect(validateAsaasReguaForActivation('asaas_cobranca_vencida', [msg()])).toHaveLength(1)
    expect(
      validateAsaasReguaForActivation('asaas_cobranca_vence_hoje', [
        { step_type: 'condition', step_config: { subject: 'tag_presence', operand: 't' }, branches: { yes: [msg()], no: [msg('c1')] } },
      ]),
    ).toHaveLength(1)
  })

  it('"Aguardar" é recusado em qualquer escopo — cada marco é uma automação própria', () => {
    expect(validateAsaasReguaForActivation('asaas_cobranca_vencida', [msg('c1'), { step_type: 'wait', step_config: { amount: 1, unit: 'minutes' } }])).toHaveLength(1)
  })

  it('outros gatilhos não são tocados', () => {
    expect(validateAsaasReguaForActivation('keyword_match', [msg(), { step_type: 'wait', step_config: { amount: 1, unit: 'days' } }])).toEqual([])
  })
})
