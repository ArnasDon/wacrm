import { describe, it, expect, vi } from "vitest";
import { getNodeDescriptor } from "./registry";
import { validateFlowForActivation, reachableFromEntry } from "./validate";

const validFlow = {
  name: "Welcome",
  trigger_type: "keyword" as const,
  trigger_config: { keywords: ["support"] },
  entry_node_id: "start",
};

const validNodes = [
  { node_key: "start", node_type: "start", config: { next_node_key: "menu" } },
  {
    node_key: "menu",
    node_type: "send_buttons",
    config: {
      text: "How can we help?",
      buttons: [
        { reply_id: "a", title: "A", next_node_key: "ho" },
        { reply_id: "b", title: "B", next_node_key: "ho" },
      ],
    },
  },
  { node_key: "ho", node_type: "handoff", config: {} },
];

describe("validateFlowForActivation — happy path", () => {
  it("produces no issues on a well-formed flow", () => {
    expect(validateFlowForActivation(validFlow, validNodes)).toEqual([]);
  });
});

describe("validateFlowForActivation — flow-level", () => {
  it("flags empty name", () => {
    expect(
      validateFlowForActivation({ ...validFlow, name: "" }, validNodes),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "flow", field: "name" }),
      ]),
    );
  });

  it("flags whitespace-only name", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, name: "   " },
      validNodes,
    );
    expect(issues.some((i) => i.field === "name")).toBe(true);
  });

  it("flags missing entry_node_id", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: null },
      validNodes,
    );
    expect(issues.some((i) => i.field === "entry_node_id")).toBe(true);
  });

  it("flags entry_node_id that doesn't exist in nodes", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "ghost" },
      validNodes,
    );
    expect(
      issues.some(
        (i) => i.field === "entry_node_id" && i.message.includes('"ghost"'),
      ),
    ).toBe(true);
  });

  it("flags empty node list", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: null },
      [],
    );
    expect(issues.some((i) => i.message.includes("at least one node"))).toBe(
      true,
    );
  });

  it("requires every required variable to have an initial typed value", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        variable_schema: [
          { key: "email", type: "string" as const, required: true },
        ],
      },
      validNodes,
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "flow",
          field: "variable_schema.email.default",
          severity: "error",
        }),
      ]),
    );
  });

  it("rejects incompatible persisted typed data bindings", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "collect" },
      [
        {
          node_key: "collect",
          node_type: "collect_input",
          config: {
            prompt_text: "Value?",
            var_key: "answer",
            next_node_key: "http",
          },
        },
        {
          node_key: "http",
          node_type: "http_request",
          config: {
            method: "POST",
            url: "https://api.example.com",
            headers: {},
            response_var: "response",
            next_node_key: "end",
            _data_inputs: {
              request: {
                source_node_key: "collect",
                source_handle: "value",
              },
            },
          },
        },
        { node_key: "end", node_type: "end", config: {} },
      ],
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node_key: "http",
          field: "_data_inputs.request",
          message: expect.stringContaining("incompatible"),
        }),
      ]),
    );
  });

  it("flags duplicate node_key", () => {
    const dupes = [
      { node_key: "a", node_type: "start", config: { next_node_key: "b" } },
      { node_key: "a", node_type: "end", config: {} },
      { node_key: "b", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "a" },
      dupes,
    );
    expect(
      issues.some(
        (i) => i.message.includes("Duplicate node_key") && i.node_key === "a",
      ),
    ).toBe(true);
  });
});

describe("validateFlowForActivation — trigger", () => {
  it("delegates flow trigger config validation to its descriptor", () => {
    const schema = getNodeDescriptor("trigger_keyword_match")!.configSchema;
    const parse = vi.spyOn(schema, "safeParse");

    validateFlowForActivation(
      { ...validFlow, trigger_config: { keywords: [] } },
      validNodes,
    );

    expect(parse).toHaveBeenCalled();
    parse.mockRestore();
  });

  it("flags keyword trigger with no keywords", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        trigger_config: { keywords: [] },
      },
      validNodes,
    );
    expect(
      issues.some(
        (i) =>
          i.scope === "trigger" && i.message.includes("at least one keyword"),
      ),
    ).toBe(true);
  });

  it("flags keyword trigger missing keywords field entirely", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, trigger_config: {} },
      validNodes,
    );
    expect(issues.some((i) => i.scope === "trigger")).toBe(true);
  });

  it("warns when keywords contain blanks", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        trigger_config: { keywords: ["support", "", " "] },
      },
      validNodes,
    );
    expect(
      issues.some(
        (i) =>
          i.scope === "trigger" &&
          i.severity === "warning" &&
          i.message.includes("blank"),
      ),
    ).toBe(true);
  });

  it("first_inbound_message trigger needs no config", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        trigger_type: "first_inbound_message",
        trigger_config: {},
      },
      validNodes,
    );
    expect(issues.filter((i) => i.scope === "trigger")).toEqual([]);
  });
});

describe("validateFlowForActivation — nodes", () => {
  it("validates variable-using nodes against a declared schema", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        entry_node_id: "set",
        variable_schema: [
          { key: "count", type: "number", required: true, default: 0 },
          { key: "response", type: "json" },
        ],
      },
      [
        {
          node_key: "set",
          node_type: "variable_set",
          config: {
            assignments: [
              { key: "missing", type: "string", value: "x" },
              { key: "count", type: "string", value: "1" },
            ],
            next_node_key: "end",
          },
        },
        { node_key: "end", node_type: "end", config: {} },
      ],
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node_key: "set",
          field: "assignments.0.key",
          message: expect.stringContaining("not declared"),
        }),
        expect.objectContaining({
          node_key: "set",
          field: "assignments.1.type",
          message: expect.stringContaining("declared as number"),
        }),
      ]),
    );
  });

  it("requires declarations for authoring nodes that reference variables", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        entry_node_id: "loop",
        variable_schema: [],
      },
      [
        {
          node_key: "loop",
          node_type: "loop",
          config: {
            subject: "var",
            subject_key: "count",
            operator: "greater_than",
            value: 5,
            max_iterations: 10,
            body_next: "body",
            done_next: "done",
          },
        },
        {
          node_key: "body",
          node_type: "variable_set",
          config: {
            assignments: [{ key: "count", type: "number", value: 1 }],
            next_node_key: "loop",
            _control_targets: { next_node_key: "continue" },
          },
        },
        { node_key: "done", node_type: "end", config: {} },
      ],
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node_key: "loop",
          field: "subject_key",
          message: expect.stringContaining("not declared"),
        }),
        expect.objectContaining({
          node_key: "body",
          field: "assignments.0.key",
          message: expect.stringContaining("not declared"),
        }),
      ]),
    );
  });

  it("requires numeric loop subjects to be declared as numbers", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        entry_node_id: "loop",
        variable_schema: [{ key: "count", type: "string", default: "0" }],
      },
      [
        {
          node_key: "loop",
          node_type: "loop",
          config: {
            subject: "var",
            subject_key: "count",
            operator: "less_than",
            value: 5,
            max_iterations: 10,
            body_next: "done",
            done_next: "done",
          },
        },
        { node_key: "done", node_type: "end", config: {} },
      ],
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node_key: "loop",
          field: "subject_key",
          message: expect.stringContaining("number"),
        }),
      ]),
    );
  });
  it("validates common execution-policy bounds", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "m" } },
      {
        node_key: "m",
        node_type: "send_message",
        config: {
          text: "hello",
          next_node_key: "h",
          retry: {
            max_attempts: 99,
            interval_ms: -1,
            backoff: "random",
          },
          timeout_ms: 60_000,
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];

    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ node_key: "m", field: "retry.max_attempts" }),
        expect.objectContaining({ node_key: "m", field: "retry.interval_ms" }),
        expect.objectContaining({ node_key: "m", field: "retry.backoff" }),
        expect.objectContaining({ node_key: "m", field: "timeout_ms" }),
      ]),
    );
  });

  it("requires a real reachable error branch only for fail_branch", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "m" } },
      {
        node_key: "m",
        node_type: "send_message",
        config: {
          text: "hello",
          next_node_key: "ok",
          on_error: "fail_branch",
          error_next_node_key: "recover",
        },
      },
      { node_key: "ok", node_type: "end", config: {} },
      { node_key: "recover", node_type: "end", config: {} },
    ];

    expect(
      validateFlowForActivation({ ...validFlow, entry_node_id: "s" }, nodes),
    ).toEqual([]);
    expect(reachableFromEntry("s", nodes)).toEqual(
      new Set(["s", "m", "ok", "recover"]),
    );

    const missing = structuredClone(nodes);
    delete missing[1].config.error_next_node_key;
    expect(
      validateFlowForActivation({ ...validFlow, entry_node_id: "s" }, missing),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node_key: "m",
          field: "error_next_node_key",
        }),
      ]),
    );

  });

  it("requires a typed default value for default_value handling", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "m" } },
      {
        node_key: "m",
        node_type: "send_message",
        config: {
          text: "hello",
          next_node_key: "h",
          on_error: "default_value",
          default_value: { key: "sent", type: "boolean", value: "no" },
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    expect(
      validateFlowForActivation({ ...validFlow, entry_node_id: "s" }, nodes),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node_key: "m",
          field: expect.stringContaining("default_value"),
        }),
      ]),
    );

    (nodes[1].config as Record<string, unknown>).default_value = {
      key: "sent",
      type: "boolean",
      value: false,
    };
    expect(
      validateFlowForActivation({ ...validFlow, entry_node_id: "s" }, nodes),
    ).toEqual([]);
  });

  it.each([
    [
      "condition",
      {
        subject: "var",
        subject_key: "tier",
        operator: "equals",
        value: "vip",
        true_next: "h",
        false_next: "h",
      },
    ],
    [
      "send_buttons",
      {
        text: "Choose",
        buttons: [
          { reply_id: "yes", title: "Yes", next_node_key: "h" },
          { reply_id: "no", title: "No", next_node_key: "h" },
        ],
      },
    ],
    [
      "send_list",
      {
        text: "Choose",
        button_label: "Options",
        sections: [
          {
            title: "Choices",
            rows: [
              { reply_id: "one", title: "One", next_node_key: "h" },
              { reply_id: "two", title: "Two", next_node_key: "h" },
            ],
          },
        ],
      },
    ],
    ["handoff", {}],
  ])(
    "rejects default_value for non-deterministic %s nodes",
    (nodeType, config) => {
      const configured = {
        ...config,
        on_error: "default_value",
        default_value: { key: "fallback", type: "string", value: "skipped" },
      };
      const nodes = [
        { node_key: "s", node_type: "start", config: { next_node_key: "x" } },
        { node_key: "x", node_type: nodeType, config: configured },
        { node_key: "h", node_type: "handoff", config: {} },
      ];

      expect(
        validateFlowForActivation({ ...validFlow, entry_node_id: "s" }, nodes),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            node_key: "x",
            field: "default_value",
            message: expect.stringMatching(/exactly one|deterministic/i),
          }),
        ]),
      );
    },
  );

  it.each([
    [
      "send_webhook",
      { url: "https://hooks.example.com/in", next_node_key: "h" },
    ],
    ["trigger_keyword_match", { keywords: ["hello"], next_node_key: "h" }],
  ])(
    "rejects registered %s nodes that the flow runtime cannot execute",
    (nodeType, config) => {
      const nodes = [
        { node_key: "s", node_type: "start", config: { next_node_key: "x" } },
        { node_key: "x", node_type: nodeType, config },
        { node_key: "h", node_type: "handoff", config: {} },
      ];

      const issues = validateFlowForActivation(
        { ...validFlow, entry_node_id: "s" },
        nodes,
      );

      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            severity: "error",
            scope: "node",
            node_key: "x",
            field: "node_type",
            message: expect.stringContaining("flow runtime"),
          }),
        ]),
      );
    },
  );

  it.each([
    [
      "send_buttons",
      {
        kind: "buttons",
        body: "Pick one",
        buttons: [{ id: "yes", title: "Yes" }],
        next_node_key: "h",
      },
    ],
    [
      "send_list",
      {
        kind: "list",
        body: "Pick one",
        button_label: "Options",
        sections: [{ rows: [{ id: "yes", title: "Yes" }] }],
        next_node_key: "h",
      },
    ],
  ])(
    "rejects automation-compatible legacy %s config in a flow",
    (nodeType, config) => {
      const nodes = [
        { node_key: "s", node_type: "start", config: { next_node_key: "x" } },
        { node_key: "x", node_type: nodeType, config },
        { node_key: "h", node_type: "handoff", config: {} },
      ];

      const issues = validateFlowForActivation(
        { ...validFlow, entry_node_id: "s" },
        nodes,
      );

      expect(issues.some((issue) => issue.node_key === "x")).toBe(true);
    },
  );

  it.each(["message_content", "tag_presence", "time_of_day", "deal_stage"])(
    "rejects automation-only condition subject %s in a flow",
    (subject) => {
      const nodes = [
        { node_key: "s", node_type: "start", config: { next_node_key: "c" } },
        {
          node_key: "c",
          node_type: "condition",
          config: {
            subject,
            operand: "vip",
            value: "vip",
            true_next: "h",
            false_next: "h",
          },
        },
        { node_key: "h", node_type: "handoff", config: {} },
      ];

      const issues = validateFlowForActivation(
        { ...validFlow, entry_node_id: "s" },
        nodes,
      );

      expect(
        issues.some(
          (issue) => issue.node_key === "c" && issue.field === "subject",
        ),
      ).toBe(true);
    },
  );

  it("flags send_buttons without text", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          buttons: [{ reply_id: "x", title: "X", next_node_key: "h" }],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(issues.some((i) => i.node_key === "b" && i.field === "text")).toBe(
      true,
    );
  });

  it("flags send_buttons with zero buttons", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: { text: "Hi", buttons: [] },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "b" &&
          i.field === "buttons" &&
          i.message.includes("at least one"),
      ),
    ).toBe(true);
  });

  it("flags send_buttons with more than 3 buttons (Meta limit)", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "1", title: "1", next_node_key: "h" },
            { reply_id: "2", title: "2", next_node_key: "h" },
            { reply_id: "3", title: "3", next_node_key: "h" },
            { reply_id: "4", title: "4", next_node_key: "h" },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "b" &&
          i.field === "buttons" &&
          i.message.includes("at most 3"),
      ),
    ).toBe(true);
  });

  it("flags button title over 20 chars", () => {
    const longTitle = "x".repeat(21);
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [{ reply_id: "1", title: longTitle, next_node_key: "h" }],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "b" &&
          i.field === "buttons.0.title" &&
          i.message.includes("over 20"),
      ),
    ).toBe(true);
  });

  it("flags button pointing at non-existent next node", () => {
    const descriptor = getNodeDescriptor("send_buttons")!;
    const edgeTargets = vi.spyOn(descriptor, "outgoingEdgeTargets");
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [{ reply_id: "1", title: "Go", next_node_key: "ghost" }],
        },
      },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.field === "buttons.0.next_node_key" && i.message.includes("ghost"),
      ),
    ).toBe(true);
    expect(edgeTargets).toHaveBeenCalled();
    edgeTargets.mockRestore();
  });

  it("flags duplicate button reply_ids", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Hi",
          buttons: [
            { reply_id: "x", title: "X1", next_node_key: "h" },
            { reply_id: "x", title: "X2", next_node_key: "h" },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some((i) => i.message.includes("Duplicate button reply id")),
    ).toBe(true);
  });

  it("flags send_list with more than 10 rows total", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      reply_id: `r${i}`,
      title: `Row ${i}`,
      next_node_key: "h",
    }));
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "l" } },
      {
        node_key: "l",
        node_type: "send_list",
        config: {
          text: "Pick",
          button_label: "Pick",
          sections: [{ rows: eleven }],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "l" &&
          i.field === "sections" &&
          i.message.includes("at most 10"),
      ),
    ).toBe(true);
  });

  it("flags list row title over 24 chars", () => {
    const longTitle = "x".repeat(25);
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "l" } },
      {
        node_key: "l",
        node_type: "send_list",
        config: {
          text: "Pick",
          button_label: "Pick",
          sections: [
            {
              rows: [
                {
                  reply_id: "x",
                  title: longTitle,
                  next_node_key: "h",
                },
              ],
            },
          ],
        },
      },
      { node_key: "h", node_type: "handoff", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(issues.some((i) => i.message.includes("exceeds 24 chars"))).toBe(
      true,
    );
  });

  it("warns about unreachable nodes", () => {
    const nodes = [
      { node_key: "s", node_type: "start", config: { next_node_key: "h" } },
      { node_key: "h", node_type: "handoff", config: {} },
      // Orphaned — nothing points at it.
      { node_key: "orphan", node_type: "end", config: {} },
    ];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "orphan" &&
          i.severity === "warning" &&
          i.message.includes("unreachable"),
      ),
    ).toBe(true);
  });

  it("doesn't crash on unknown node_type — flags it", () => {
    const nodes = [{ node_key: "s", node_type: "wibble", config: {} }];
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "s" },
      nodes,
    );
    expect(issues.some((i) => i.message.includes("Unknown node type"))).toBe(
      true,
    );
  });
});

describe("validateFlowForActivation — send_media", () => {
  const baseFlow = { ...validFlow, entry_node_id: "s" };
  const nodesWith = (mediaConfig: Record<string, unknown>) => [
    { node_key: "s", node_type: "start", config: { next_node_key: "m" } },
    { node_key: "m", node_type: "send_media", config: mediaConfig },
    { node_key: "h", node_type: "handoff", config: {} },
  ];

  it("passes on a fully-populated send_media node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "document",
        media_url: "https://cdn.example/invoice.pdf",
        caption: "Your invoice",
        filename: "invoice.pdf",
        next_node_key: "h",
      }),
    );
    expect(issues).toEqual([]);
  });

  it("flags missing media_url", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "image",
        media_url: "",
        next_node_key: "h",
      }),
    );
    expect(
      issues.some((i) => i.node_key === "m" && i.field === "media_url"),
    ).toBe(true);
  });

  it("flags missing media_type", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_url: "https://cdn.example/x.png",
        next_node_key: "h",
      }),
    );
    expect(
      issues.some((i) => i.node_key === "m" && i.field === "media_type"),
    ).toBe(true);
  });

  it("flags next_node_key pointing at a non-existent node", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "image",
        media_url: "https://cdn.example/x.png",
        next_node_key: "ghost",
      }),
    );
    expect(
      issues.some(
        (i) =>
          i.node_key === "m" &&
          i.field === "next_node_key" &&
          i.message.includes("ghost"),
      ),
    ).toBe(true);
  });

  it("flags caption exceeding 1024 chars", () => {
    const issues = validateFlowForActivation(
      baseFlow,
      nodesWith({
        media_type: "image",
        media_url: "https://cdn.example/x.png",
        caption: "x".repeat(1025),
        next_node_key: "h",
      }),
    );
    expect(
      issues.some((i) => i.node_key === "m" && i.field === "caption"),
    ).toBe(true);
  });

  it("contributes its next_node_key to reachability", () => {
    const set = reachableFromEntry(
      "s",
      nodesWith({
        media_type: "image",
        media_url: "https://cdn.example/x.png",
        next_node_key: "h",
      }),
    );
    expect(set).toEqual(new Set(["s", "m", "h"]));
  });
});

describe("reachableFromEntry", () => {
  it("walks the graph from the entry", () => {
    const set = reachableFromEntry("start", validNodes);
    expect(set.has("start")).toBe(true);
    expect(set.has("menu")).toBe(true);
    expect(set.has("ho")).toBe(true);
  });

  it("returns the entry alone when no edges lead out", () => {
    const set = reachableFromEntry("only", [
      { node_key: "only", node_type: "handoff", config: {} },
    ]);
    expect(set).toEqual(new Set(["only"]));
  });

  it("survives a cycle (visited guard)", () => {
    const nodes = [
      { node_key: "a", node_type: "start", config: { next_node_key: "b" } },
      {
        node_key: "b",
        node_type: "send_buttons",
        config: {
          text: "Loop",
          buttons: [{ reply_id: "x", title: "Back", next_node_key: "a" }],
        },
      },
    ];
    const set = reachableFromEntry("a", nodes);
    expect(set).toEqual(new Set(["a", "b"]));
  });
});

describe("structured composite topology", () => {
  it("rejects an arbitrary runtime cycle", () => {
    const issues = validateFlowForActivation(
      { ...validFlow, entry_node_id: "a" },
      [
        {
          node_key: "a",
          node_type: "send_message",
          config: { text: "a", next_node_key: "b" },
        },
        {
          node_key: "b",
          node_type: "send_message",
          config: { text: "b", next_node_key: "a" },
        },
      ],
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "node",
          message: expect.stringMatching(/structured each or loop/i),
        }),
      ]),
    );
  });

  it("allows a body to return to its bounded each node", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        entry_node_id: "each",
        variable_schema: [
          { key: "items", type: "json" as const, default: [] },
          { key: "item", type: "string" as const, default: "" },
          { key: "index", type: "number" as const, default: 0 },
        ],
      },
      [
        {
          node_key: "each",
          node_type: "each",
          config: {
            array_variable: "items",
            item_variable: "item",
            index_variable: "index",
            max_iterations: 10,
            body_next: "body",
            done_next: "end",
          },
        },
        {
          node_key: "body",
          node_type: "variable_set",
          config: {
            assignments: [{ key: "item", type: "string", value: "next" }],
            next_node_key: "each",
            _control_targets: { next: "continue" },
          },
        },
        { node_key: "end", node_type: "end", config: {} },
      ],
    );
    expect(issues.filter(({ severity }) => severity === "error")).toEqual([]);
  });

  it("rejects a back-edge that does not enter the controller continue handle", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        entry_node_id: "loop",
        variable_schema: [{ key: "done", type: "boolean", default: false }],
      },
      [
        {
          node_key: "loop",
          node_type: "loop",
          config: {
            subject: "var",
            subject_key: "done",
            operator: "equals",
            value: true,
            max_iterations: 3,
            body_next: "body",
            done_next: "end",
          },
        },
        {
          node_key: "body",
          node_type: "send_message",
          config: { text: "again", next_node_key: "loop" },
        },
        { node_key: "end", node_type: "end", config: {} },
      ],
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          message: expect.stringMatching(/continue/i),
        }),
      ]),
    );
  });

  it("rejects a done branch that can return to the controller", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        entry_node_id: "each",
        variable_schema: [
          { key: "items", type: "json", default: [] },
          { key: "item", type: "string", default: "" },
        ],
      },
      [
        {
          node_key: "each",
          node_type: "each",
          config: {
            array_variable: "items",
            item_variable: "item",
            max_iterations: 3,
            body_next: "body",
            done_next: "done_path",
          },
        },
        {
          node_key: "body",
          node_type: "send_message",
          config: {
            text: "body",
            next_node_key: "each",
            _control_targets: { next: "continue" },
          },
        },
        {
          node_key: "done_path",
          node_type: "send_message",
          config: {
            text: "bad",
            next_node_key: "each",
            _control_targets: { next: "continue" },
          },
        },
      ],
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          message: expect.stringMatching(/done.*outside/i),
        }),
      ]),
    );
  });

  it("rejects cycles that merely contain a controller or have ambiguous controllers", () => {
    const baseSchema = [
      { key: "done", type: "boolean" as const, default: false },
    ];
    const merelyContains = validateFlowForActivation(
      { ...validFlow, entry_node_id: "a", variable_schema: baseSchema },
      [
        {
          node_key: "a",
          node_type: "send_message",
          config: { text: "a", next_node_key: "loop" },
        },
        {
          node_key: "loop",
          node_type: "loop",
          config: {
            subject: "var",
            subject_key: "done",
            operator: "equals",
            value: true,
            max_iterations: 3,
            body_next: "end",
            done_next: "a",
          },
        },
        { node_key: "end", node_type: "end", config: {} },
      ],
    );
    expect(merelyContains.some((issue) => /structured/i.test(issue.message))).toBe(
      true,
    );

    const ambiguous = validateFlowForActivation(
      { ...validFlow, entry_node_id: "outer", variable_schema: baseSchema },
      [
        {
          node_key: "outer",
          node_type: "loop",
          config: {
            subject: "var",
            subject_key: "done",
            operator: "equals",
            value: true,
            max_iterations: 3,
            body_next: "inner",
            done_next: "outer_end",
            _control_targets: { body: "continue" },
          },
        },
        {
          node_key: "inner",
          node_type: "loop",
          config: {
            subject: "var",
            subject_key: "done",
            operator: "equals",
            value: true,
            max_iterations: 3,
            body_next: "outer",
            done_next: "inner_end",
            _control_targets: { body: "continue" },
          },
        },
        { node_key: "outer_end", node_type: "end", config: {} },
        { node_key: "inner_end", node_type: "end", config: {} },
      ],
    );
    expect(ambiguous).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringMatching(/ambiguous/i),
        }),
      ]),
    );
  });

  it("allows hierarchically nested structured loops", () => {
    const issues = validateFlowForActivation(
      {
        ...validFlow,
        entry_node_id: "outer",
        variable_schema: [
          { key: "outer_done", type: "boolean", default: false },
          { key: "inner_done", type: "boolean", default: false },
        ],
      },
      [
        {
          node_key: "outer",
          node_type: "loop",
          config: {
            subject: "var",
            subject_key: "outer_done",
            operator: "equals",
            value: true,
            max_iterations: 3,
            body_next: "inner",
            done_next: "end",
          },
        },
        {
          node_key: "inner",
          node_type: "loop",
          config: {
            subject: "var",
            subject_key: "inner_done",
            operator: "equals",
            value: true,
            max_iterations: 3,
            body_next: "inner_body",
            done_next: "outer_back",
          },
        },
        {
          node_key: "inner_body",
          node_type: "send_message",
          config: {
            text: "inner",
            next_node_key: "inner",
            _control_targets: { next: "continue" },
          },
        },
        {
          node_key: "outer_back",
          node_type: "send_message",
          config: {
            text: "outer",
            next_node_key: "outer",
            _control_targets: { next: "continue" },
          },
        },
        { node_key: "end", node_type: "end", config: {} },
      ],
    );
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });
});
