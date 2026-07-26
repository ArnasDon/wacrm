import { describe, expect, it, vi } from "vitest";

import { FLOW_NODE_DESCRIPTORS } from "@/lib/flows/registry";
import {
  FLOW_CODE_LIMITS,
  canonicalFlowCodeText,
  compileFlowCode,
  exportFlowCode,
  parseFlowCodeInput,
  parseFlowCodeText,
  type FlowCodeCatalog,
} from "@/lib/flows/flow-code";

const emptyCatalog: FlowCodeCatalog = {
  resources: [],
  flows: [],
};

const draft = {
  kind: "wacrm.flow" as const,
  schema_version: 1 as const,
  name: "Empty draft",
  description: null,
  trigger: { type: "manual" as const, config: {} },
  fallback: {
    on_unknown_reply: "reprompt" as const,
    max_reprompts: 2,
    on_timeout_hours: 24,
    on_exhaust: "handoff" as const,
  },
  variables: [],
  resources: [],
  secret_requirements: [],
  entry: null,
  nodes: [],
};

describe("flow code v1", () => {
  it("accepts empty drafts and emits deterministic canonical bytes", () => {
    const first = canonicalFlowCodeText(draft);
    const second = canonicalFlowCodeText({
      nodes: [],
      entry: null,
      secret_requirements: [],
      resources: [],
      variables: [],
      fallback: {
        on_unknown_reply: "reprompt",
        max_reprompts: 2,
        on_timeout_hours: 24,
        on_exhaust: "handoff",
      },
      trigger: { config: {}, type: "manual" },
      description: null,
      name: "Empty draft",
      schema_version: 1,
      kind: "wacrm.flow",
    });

    expect(first).toBe(second);
    expect(first.endsWith("\n")).toBe(true);
    expect(parseFlowCodeText(first).document).toEqual(draft);
  });

  it("rejects future schemas, unknown envelope fields and prototype keys", () => {
    expect(() =>
      parseFlowCodeText(
        JSON.stringify({ ...draft, schema_version: 2 }),
      ),
    ).toThrowError(/UNSUPPORTED_SCHEMA_VERSION/);
    expect(() =>
      parseFlowCodeText(JSON.stringify({ ...draft, flow_id: "source-id" })),
    ).toThrowError(/UNKNOWN_FIELD/);
    expect(() =>
      parseFlowCodeText(
        '{"kind":"wacrm.flow","schema_version":1,"name":"x","description":null,"trigger":{"type":"manual","config":{}},"fallback":{"strategy":"handoff"},"variables":[],"resources":[],"secret_requirements":[],"entry":null,"nodes":[],"__proto__":{}}',
      ),
    ).toThrowError(/PROTOTYPE_KEY/);
  });

  it("rejects unknown nested node config fields and malformed map values", () => {
    expect(() =>
      parseFlowCodeText(
        JSON.stringify({
          ...draft,
          nodes: [
            {
              key: "menu",
              type: "send_buttons",
              config: {
                text: "Choose",
                buttons: [
                  {
                    reply_id: "yes",
                    title: "Yes",
                    next_node_key: "end",
                    source_id: "must-not-pass",
                  },
                ],
              },
              position: { x: 0, y: 0 },
            },
          ],
        }),
      ),
    ).toThrowError(/UNKNOWN_CONFIG_FIELD/);
    expect(() =>
      parseFlowCodeText(
        JSON.stringify({
          ...draft,
          nodes: [
            {
              key: "request",
              type: "http_request",
              config: {
                method: "GET",
                url: "https://example.test",
                headers: { Authorization: { value: "secret" } },
                response_var: "result",
                next_node_key: "end",
              },
              position: { x: 0, y: 0 },
            },
          ],
        }),
      ),
    ).toThrowError(/INVALID_CONFIG_FIELD/);
  });

  it("enforces input bytes, depth and collection limits", () => {
    expect(() =>
      parseFlowCodeText(" ".repeat(FLOW_CODE_LIMITS.maxBytes + 1)),
    ).toThrowError(/DOCUMENT_TOO_LARGE/);

    let nested: unknown = "leaf";
    for (let index = 0; index < FLOW_CODE_LIMITS.maxDepth + 1; index += 1) {
      nested = { nested };
    }
    expect(() =>
      parseFlowCodeText(
        JSON.stringify({
          ...draft,
          trigger: { type: "manual", config: nested },
        }),
      ),
    ).toThrowError(/MAX_DEPTH_EXCEEDED/);

    expect(() =>
      parseFlowCodeText(
        JSON.stringify({
          ...draft,
          nodes: Array.from(
            { length: FLOW_CODE_LIMITS.maxNodes + 1 },
            (_, index) => ({
              key: `node_${index}`,
              type: "end",
              config: {},
              position: { x: 0, y: index },
            }),
          ),
        }),
      ),
    ).toThrowError(/TOO_MANY_NODES/);
    expect(() =>
      parseFlowCodeText(
        JSON.stringify({
          ...draft,
          variables: Array.from({ length: 101 }, (_, index) => ({
            key: `v_${index}`,
            type: "string",
            sensitive: true,
          })),
        }),
      ),
    ).toThrowError(/TOO_MANY_VARIABLES/);
    expect(() =>
      parseFlowCodeText(
        JSON.stringify({
          ...draft,
          secret_requirements: Array.from({ length: 101 }, (_, index) => ({
            name: `secret_${index}`,
            node_key: "node",
            path: `config.headers.h_${index}`,
          })),
        }),
      ),
    ).toThrowError(/TOO_MANY_SECRET_REQUIREMENTS/);
  });

  it("sorts canonical arrays by code points independent of host locale", () => {
    const text = canonicalFlowCodeText({
      ...draft,
      variables: [
        { key: "éclair", type: "string", sensitive: true },
        { key: "zebra", type: "string", sensitive: true },
        { key: "Alpha", type: "string", sensitive: true },
      ],
    });
    const parsed = JSON.parse(text) as {
      variables: Array<{ key: string }>;
    };
    expect(parsed.variables.map(({ key }) => key)).toEqual([
      "Alpha",
      "zebra",
      "éclair",
    ]);
  });

  it("requires every registered node to declare an allowlisted portability contract", () => {
    expect(FLOW_NODE_DESCRIPTORS.length).toBeGreaterThan(0);
    for (const descriptor of FLOW_NODE_DESCRIPTORS) {
      expect(descriptor.portability, descriptor.id).toBeDefined();
      expect(descriptor.portability.portableFields, descriptor.id).toBeInstanceOf(
        Array,
      );
    }
  });

  it("redacts source identifiers, pins, secrets and unknown config fields", () => {
    const input = {
      flow: {
        id: "flow-uuid",
        account_id: "account-uuid",
        user_id: "user-uuid",
        name: "Portable",
        description: null,
        trigger_type: "manual",
        trigger_config: {},
        entry_node_id: "request",
        fallback_policy: {
          on_unknown_reply: "reprompt",
          max_reprompts: 2,
          on_timeout_hours: 24,
          on_exhaust: "handoff",
        },
        variable_schema: [
          { key: "public", type: "string", sensitive: false, default: "ok" },
          { key: "implicit_secret", type: "string", default: "hidden" },
        ],
      },
      nodes: [
        {
          id: "node-uuid",
          flow_id: "flow-uuid",
          node_key: "request",
          node_type: "http_fetch",
          position_x: 1,
          position_y: 2,
          config: {
            method: "GET",
            url: "https://example.test/path",
            headers: { Authorization: "Bearer super-secret-token" },
            query: { api_key: "abcdef0123456789abcdef0123456789" },
            next_node_key: "done",
            pinned_version_id: "version-uuid",
            api_key: "must-not-export",
            unexpected: "discard me",
          },
        },
        {
          id: "end-uuid",
          flow_id: "flow-uuid",
          node_key: "done",
          node_type: "end",
          position_x: 3,
          position_y: 4,
          config: {},
        },
      ],
      resourceCatalog: emptyCatalog,
    } satisfies Parameters<typeof exportFlowCode>[0];
    expect(() => exportFlowCode(input)).toThrowError(/UNKNOWN_CONFIG_FIELD/);
    const requestConfig = input.nodes[0].config;
    delete requestConfig.pinned_version_id;
    delete requestConfig.api_key;
    delete requestConfig.unexpected;
    const result = exportFlowCode(input);
    const text = canonicalFlowCodeText(result.document);

    expect(
      result.document.nodes.find((node) => node.key === "request")?.type,
    ).toBe("http_request");
    expect(result.document.variables).toEqual([
      {
        key: "implicit_secret",
        type: "string",
        required: false,
        sensitive: true,
      },
      {
        key: "public",
        type: "string",
        required: false,
        sensitive: false,
        default: "ok",
      },
    ]);
    expect(result.document.secret_requirements.length).toBe(2);
    expect(text).not.toMatch(
      /flow-uuid|account-uuid|user-uuid|node-uuid|version-uuid|super-secret|abcdef|must-not-export|unexpected/,
    );
    expect(result.warnings).toEqual([]);
  });

  it("blocks UUID-shaped identifiers, URL userinfo and malformed marker objects", () => {
    const baseInput = {
      flow: {
        name: "Unsafe",
        description: null,
        trigger_type: "manual" as const,
        trigger_config: {},
        entry_node_id: "request",
        fallback_policy: draft.fallback,
        variable_schema: [],
      },
      nodes: [
        {
          node_key: "request",
          node_type: "http_request",
          position_x: 0,
          position_y: 0,
          config: {
            method: "POST",
            url: "https://example.test",
            body: "11111111-1111-4111-8111-111111111111",
            response_var: "result",
            next_node_key: "done",
          },
        },
      ],
      resourceCatalog: emptyCatalog,
    };
    expect(() => exportFlowCode(baseInput)).toThrowError(
      /SOURCE_IDENTIFIER_FORBIDDEN/,
    );
    expect(() =>
      exportFlowCode({
        ...baseInput,
        nodes: [
          {
            ...baseInput.nodes[0],
            config: {
              ...baseInput.nodes[0].config,
              body: "safe",
              url: "https://user:pass@example.test",
            },
          },
        ],
      }),
    ).toThrowError(/URL_USERINFO_FORBIDDEN/);
    expect(() =>
      parseFlowCodeText(
        JSON.stringify({
          ...draft,
          nodes: [
            {
              key: "end",
              type: "end",
              config: { unexpected: { $resource: "tag:vip", extra: true } },
              position: { x: 0, y: 0 },
            },
          ],
        }),
      ),
    ).toThrowError(/INVALID_PORTABLE_MARKER/);
  });

  it("rejects unsafe trigger, variable-default and raw node values", () => {
    expect(() =>
      parseFlowCodeText(
        JSON.stringify({
          ...draft,
          trigger: {
            type: "keyword",
            config: {
              keywords: ["hello"],
              match_type: "contains",
              case_sensitive: false,
              unknown: true,
            },
          },
        }),
      ),
    ).toThrowError(/UNKNOWN_CONFIG_FIELD/);
    expect(() =>
      parseFlowCodeText(
        JSON.stringify({
          ...draft,
          trigger: {
            type: "keyword",
            config: {
              keywords: ["sk-abcdefghijklmnopqrstuvwxyz"],
              match_type: "contains",
              case_sensitive: false,
            },
          },
        }),
      ),
    ).toThrowError(/SUSPECTED_SECRET/);
    expect(() =>
      parseFlowCodeText(
        JSON.stringify({
          ...draft,
          variables: [
            {
              key: "public",
              type: "string",
              required: false,
              sensitive: false,
              default: "11111111-1111-4111-8111-111111111111",
            },
          ],
        }),
      ),
    ).toThrowError(/SOURCE_IDENTIFIER_FORBIDDEN/);
    expect(() =>
      parseFlowCodeText(
        JSON.stringify({
          ...draft,
          variables: [
            {
              key: "private",
              type: "string",
              required: false,
              sensitive: true,
              default: "hidden",
            },
          ],
        }),
      ),
    ).toThrowError(/SENSITIVE_DEFAULT_FORBIDDEN/);
    expect(() =>
      parseFlowCodeText(
        JSON.stringify({
          ...draft,
          nodes: [
            {
              key: "request",
              type: "http_request",
              config: {
                method: "GET",
                url: "https://example.test",
                headers: { Authorization: "sk-abcdefghijklmnopqrstuvwxyz" },
                response_var: "response",
                next_node_key: "end",
              },
              position: { x: 0, y: 0 },
            },
          ],
        }),
      ),
    ).toThrowError(/SUSPECTED_SECRET/);
  });

  it("rejects portable markers anywhere inside trigger config", () => {
    for (const marker of [
      { $secret: "trigger.keyword" },
      { $resource: "tag:vip" },
    ]) {
      expect(() =>
        parseFlowCodeText(
          JSON.stringify({
            ...draft,
            trigger: {
              type: "keyword",
              config: {
                keywords: [marker],
                match_type: "contains",
                case_sensitive: false,
              },
            },
          }),
        ),
      ).toThrowError(/PORTABLE_MARKER_FORBIDDEN: trigger\.config/);
    }
  });

  it("allows portable markers only at descriptor-declared paths", () => {
    expect(() =>
      parseFlowCodeText(
        JSON.stringify({
          ...draft,
          nodes: [
            {
              key: "message",
              type: "send_message",
              config: {
                text: { $secret: "message.text" },
                next_node_key: "end",
              },
              position: { x: 0, y: 0 },
            },
          ],
          secret_requirements: [
            { name: "message.text", node_key: "message", path: "config.text" },
          ],
        }),
      ),
    ).toThrowError(/SECRET_MARKER_PATH_INVALID/);

    expect(() =>
      parseFlowCodeText(
        JSON.stringify({
          ...draft,
          resources: [{ ref: "member:owner", kind: "member", name: "Owner" }],
          nodes: [
            {
              key: "tag",
              type: "set_tag",
              config: {
                mode: "add",
                tag_id: { $resource: "member:owner" },
                next_node_key: "end",
              },
              position: { x: 0, y: 0 },
            },
          ],
        }),
      ),
    ).toThrowError(/RESOURCE_KIND_MISMATCH/);
    expect(() =>
      parseFlowCodeText(
        JSON.stringify({
          ...draft,
          resources: [{ ref: "tag:vip", kind: "tag", name: "VIP" }],
          nodes: [
            {
              key: "condition",
              type: "condition",
              config: {
                subject: "var",
                subject_key: { $resource: "tag:vip" },
                operator: "present",
                true_next: "end",
                false_next: "end",
              },
              position: { x: 0, y: 0 },
            },
          ],
        }),
      ),
    ).toThrowError(/RESOURCE_MARKER_PATH_INVALID/);
  });

  it("requires a one-to-one match between secret markers and requirements", () => {
    const secretDocument = {
      ...draft,
      variables: [
        { key: "response", type: "json", required: false, sensitive: true },
      ],
      nodes: [
        {
          key: "request",
          type: "http_request",
          config: {
            method: "GET",
            url: "https://example.test",
            headers: {
              Authorization: { $secret: "request.headers.Authorization" },
            },
            response_var: "response",
            next_node_key: "end",
          },
          position: { x: 0, y: 0 },
        },
      ],
      secret_requirements: [
        {
          name: "request.headers.Authorization",
          node_key: "request",
          path: "config.headers.Authorization",
        },
      ],
    };
    expect(parseFlowCodeText(JSON.stringify(secretDocument)).document).toEqual(
      expect.objectContaining({
        secret_requirements: secretDocument.secret_requirements,
      }),
    );
    expect(() =>
      parseFlowCodeText(
        JSON.stringify({
          ...secretDocument,
          secret_requirements: [
            {
              name: "request.headers.Other",
              node_key: "request",
              path: "config.headers.Authorization",
            },
          ],
        }),
      ),
    ).toThrowError(/SECRET_REQUIREMENT_MISMATCH/);
    expect(() =>
      parseFlowCodeText(
        JSON.stringify({
          ...draft,
          secret_requirements: [
            { name: "orphan", node_key: "missing", path: "config.headers.value" },
          ],
        }),
      ),
    ).toThrowError(/ORPHAN_SECRET_REQUIREMENT/);
  });

  it("requires strict variable flags and type-compatible bounded defaults", () => {
    const variableDocument = (variable: Record<string, unknown>) =>
      JSON.stringify({ ...draft, variables: [variable] });
    expect(() =>
      parseFlowCodeText(
        variableDocument({
          key: "missing_required",
          type: "string",
          sensitive: false,
        }),
      ),
    ).toThrowError(/INVALID_VARIABLE_REQUIRED/);
    expect(() =>
      parseFlowCodeText(
        variableDocument({
          key: "wrong_type",
          type: "number",
          required: false,
          sensitive: false,
          default: "42",
        }),
      ),
    ).toThrowError(/INVALID_VARIABLE_DEFAULT/);
    expect(
      parseFlowCodeText(
        variableDocument({
          key: "contact",
          type: "contact",
          required: false,
          sensitive: false,
          default: { name: "Ada" },
        }),
      ).document.variables[0],
    ).toEqual(
      expect.objectContaining({
        default: { name: "Ada" },
      }),
    );
    expect(
      parseFlowCodeText(
        variableDocument({
          key: "message",
          type: "message",
          required: false,
          sensitive: false,
          default: [{ kind: "text", text: "Hello" }],
        }),
      ).document.variables[0],
    ).toEqual(
      expect.objectContaining({
        default: [{ kind: "text", text: "Hello" }],
      }),
    );
    for (const type of ["contact", "message"]) {
      expect(() =>
        parseFlowCodeText(
          variableDocument({
            key: type,
            type,
            required: false,
            sensitive: false,
            default: "invalid",
          }),
        ),
      ).toThrowError(/INVALID_VARIABLE_DEFAULT/);
    }
    expect(() =>
      parseFlowCodeText(
        variableDocument({
          key: "oversized_contact",
          type: "contact",
          required: false,
          sensitive: false,
          default: {
            notes: Array.from({ length: 7_000 }, () => "0123456789"),
          },
        }),
      ),
    ).toThrowError(/INVALID_VARIABLE_DEFAULT/);
    expect(
      parseFlowCodeText(
        variableDocument({
          key: "settings",
          type: "json",
          required: false,
          sensitive: false,
          default: { enabled: true, retries: 2 },
        }),
      ).document.variables[0],
    ).toEqual(
      expect.objectContaining({
        required: false,
        default: { enabled: true, retries: 2 },
      }),
    );
  });

  it("round-trips canonical contact and message defaults through export", () => {
    const variableSchema = [
      {
        key: "contact",
        type: "contact" as const,
        required: false,
        sensitive: false,
        default: { name: "Ada", tags: ["vip"] },
      },
      {
        key: "message",
        type: "message" as const,
        required: false,
        sensitive: false,
        default: [{ kind: "text", text: "Hello" }],
      },
    ];
    const exported = exportFlowCode({
      flow: {
        name: "Variable defaults",
        description: null,
        trigger_type: "manual",
        trigger_config: {},
        entry_node_id: null,
        fallback_policy: draft.fallback,
        variable_schema: variableSchema,
      },
      nodes: [],
    }).document;

    expect(exported.variables).toEqual(variableSchema);
    expect(
      parseFlowCodeText(canonicalFlowCodeText(exported)).document.variables,
    ).toEqual(variableSchema);
  });

  it("treats runtime config validation after hydration as fatal", () => {
    const invalid = compileFlowCode(
      {
        ...draft,
        nodes: [
          {
            key: "wait",
            type: "wait",
            config: {
              amount: "1",
              unit: "hours",
              next_node_key: "end",
            },
            position: { x: 0, y: 0 },
          },
        ],
      },
      emptyCatalog,
    );
    expect(invalid.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_NODE_CONFIG",
          severity: "fatal",
        }),
      ]),
    );
  });

  it("round-trips registered runtime nodes through strict compile", () => {
    const runtimeNodes = FLOW_NODE_DESCRIPTORS.filter(
      (descriptor) =>
        descriptor.supportsFlowRuntime && descriptor.id !== "start",
    ).map((descriptor, index) => ({
      key: `node_${index}`,
      type: descriptor.id,
      config: descriptor.builder.defaultConfig,
      position: { x: index * 10, y: index * 20 },
    }));
    const document = {
      ...draft,
      name: "All nodes",
      nodes: runtimeNodes,
    };

    const compiled = compileFlowCode(
      parseFlowCodeText(canonicalFlowCodeText(document)).document,
      emptyCatalog,
    );
    expect(compiled.issues.filter((issue) => issue.severity === "fatal")).toEqual(
      [],
    );
    expect(
      compiled.graph.nodes.map((node) => node.node_type).sort(),
    ).toEqual(runtimeNodes.map((node) => node.type).sort());
  });

  it("resolves resources only by unique account-scoped names and pipeline parents", () => {
    const document = {
      ...draft,
      resources: [
        { ref: "pipeline:sales", kind: "pipeline" as const, name: "Sales" },
        {
          ref: "stage:won",
          kind: "stage" as const,
          name: "Won",
          parent_ref: "pipeline:sales",
        },
      ],
      nodes: [
        {
          key: "move",
          type: "move_deal_stage",
          config: {
            pipeline_id: { $resource: "pipeline:sales" },
            stage_id: { $resource: "stage:won" },
            next_node_key: "done",
          },
          position: { x: 0, y: 0 },
        },
        {
          key: "done",
          type: "end",
          config: {},
          position: { x: 0, y: 100 },
        },
      ],
      entry: "move",
    };
    const catalog: FlowCodeCatalog = {
      flows: [],
      resources: [
        { id: "pipe-1", kind: "pipeline", name: " sales " },
        { id: "stage-1", kind: "stage", name: "Won", parentId: "pipe-1" },
        { id: "stage-2", kind: "stage", name: "Won", parentId: "pipe-2" },
        { id: "pipe-2", kind: "pipeline", name: "Other" },
      ],
    };

    const compiled = compileFlowCode(document, catalog);
    expect(compiled.issues.filter((issue) => issue.severity === "blocking")).toEqual(
      [],
    );
    expect(compiled.graph.nodes[0].config).toEqual(
      expect.objectContaining({ pipeline_id: "pipe-1", stage_id: "stage-1" }),
    );

    const ambiguous = compileFlowCode(document, {
      ...catalog,
      resources: [
        ...catalog.resources,
        { id: "pipe-duplicate", kind: "pipeline", name: "Sales" },
      ],
    });
    expect(ambiguous.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "RESOURCE_AMBIGUOUS" }),
      ]),
    );
    const manuallyResolved = compileFlowCode(
      document,
      {
        ...catalog,
        resources: [
          ...catalog.resources,
          { id: "pipe-duplicate", kind: "pipeline", name: "Sales" },
        ],
      },
      { resourceBindings: { "pipeline:sales": "pipe-1" } },
    );
    expect(
      manuallyResolved.issues.filter(
        (issue) => issue.severity === "blocking",
      ),
    ).toEqual([]);
    expect(manuallyResolved.resolved["pipeline:sales"]).toBe("pipe-1");

    const homonymousCatalog: FlowCodeCatalog = {
      flows: [],
      resources: [
        { id: "pipe-1", kind: "pipeline", name: "Sales" },
        { id: "pipe-2", kind: "pipeline", name: "Sales" },
        { id: "stage-1", kind: "stage", name: "Won", parentId: "pipe-1" },
        { id: "stage-2", kind: "stage", name: "Won", parentId: "pipe-2" },
      ],
    };
    const wrongChild = compileFlowCode(document, homonymousCatalog, {
      resourceBindings: {
        "pipeline:sales": "pipe-1",
        "stage:won": "stage-2",
      },
    });
    expect(wrongChild.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "RESOURCE_BINDING_INVALID" }),
      ]),
    );
    const correctChild = compileFlowCode(
      { ...document, resources: [...document.resources].reverse() },
      homonymousCatalog,
      {
        resourceBindings: {
          "pipeline:sales": "pipe-1",
          "stage:won": "stage-1",
        },
      },
    );
    expect(
      correctChild.issues.filter((issue) => issue.severity === "blocking"),
    ).toEqual([]);
    expect(correctChild.graph.nodes[0].config.stage_id).toBe("stage-1");
  });

  it("normalizes resource names independently of the process locale", () => {
    const localeLower = vi
      .spyOn(String.prototype, "toLocaleLowerCase")
      .mockReturnValue("locale-dependent");
    try {
      const document = {
        ...draft,
        resources: [{ ref: "tag:i", kind: "tag" as const, name: "I" }],
      };
      const correct = compileFlowCode(document, {
        flows: [],
        resources: [{ id: "tag-i", kind: "tag", name: "i" }],
      });
      expect(correct.resolved["tag:i"]).toBe("tag-i");
      const dotted = compileFlowCode(
        {
          ...draft,
          resources: [{ ref: "tag:dotted", kind: "tag", name: "İ" }],
        },
        {
          flows: [],
          resources: [{ id: "tag-dotted", kind: "tag", name: "i\u0307" }],
        },
      );
      expect(dotted.resolved["tag:dotted"]).toBe("tag-dotted");

      const wrong = compileFlowCode(document, {
        flows: [],
        resources: [{ id: "tag-other", kind: "tag", name: "Other" }],
      });
      expect(wrong.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "RESOURCE_MISSING" }),
        ]),
      );
    } finally {
      localeLower.mockRestore();
    }
  });

  it("round-trips account-scoped assets without leaking their URL", () => {
    const sourceUrl =
      "https://storage.example.test/flow-media/account-source/private.png";
    const destinationUrl =
      "https://storage.example.test/flow-media/account-destination/private.png";
    const exported = exportFlowCode({
      flow: {
        name: "Media",
        description: null,
        trigger_type: "manual",
        trigger_config: {},
        entry_node_id: "media",
        fallback_policy: draft.fallback,
        variable_schema: [],
      },
      nodes: [
        {
          node_key: "media",
          node_type: "send_media",
          position_x: 0,
          position_y: 0,
          config: {
            media_type: "image",
            media_url: sourceUrl,
            caption: "",
            filename: "private.png",
            next_node_key: "",
          },
        },
      ],
      resourceCatalog: {
        flows: [],
        resources: [
          {
            id: "asset:source-hash",
            kind: "asset",
            name: "private.png",
            runtimeValue: sourceUrl,
          },
        ],
      },
    });
    const canonical = canonicalFlowCodeText(exported.document);
    expect(canonical).not.toContain(sourceUrl);
    expect(canonical).not.toContain("account-source");

    const compiled = compileFlowCode(exported.document, {
      flows: [],
      resources: [
        {
          id: "asset:destination-hash",
          kind: "asset",
          name: "private.png",
          runtimeValue: destinationUrl,
        },
      ],
    });
    expect(
      compiled.issues.filter((issue) => issue.severity === "blocking"),
    ).toEqual([]);
    expect(compiled.graph.nodes[0].config.media_url).toBe(destinationUrl);
    const assetRef = exported.document.resources[0].ref;
    expect(compiled.resolved[assetRef]).toBe("asset:destination-hash");
  });

  it("creates stable collision-free refs for resource names with the same slug", () => {
    const exportInput = {
      flow: {
        name: "Colliding resources",
        description: null,
        trigger_type: "manual" as const,
        trigger_config: {},
        entry_node_id: "first",
        fallback_policy: draft.fallback,
        variable_schema: [],
      },
      nodes: [
        {
          node_key: "first",
          node_type: "set_tag",
          position_x: 0,
          position_y: 0,
          config: {
            mode: "add",
            tag_id: "tag-1",
            next_node_key: "second",
          },
        },
        {
          node_key: "second",
          node_type: "set_tag",
          position_x: 0,
          position_y: 100,
          config: {
            mode: "add",
            tag_id: "tag-2",
            next_node_key: "end",
          },
        },
      ],
      resourceCatalog: {
        flows: [],
        resources: [
          { id: "tag-1", kind: "tag" as const, name: "A-B" },
          { id: "tag-2", kind: "tag" as const, name: "A B" },
        ],
      },
    };
    const first = exportFlowCode(exportInput).document;
    const reversed = exportFlowCode({
      ...exportInput,
      nodes: [...exportInput.nodes].reverse(),
      resourceCatalog: {
        ...exportInput.resourceCatalog,
        resources: [...exportInput.resourceCatalog.resources].reverse(),
      },
    }).document;
    const refs = first.resources.map(({ ref }) => ref);

    expect(new Set(refs).size).toBe(2);
    expect(canonicalFlowCodeText(first)).toBe(canonicalFlowCodeText(reversed));
    expect(
      first.nodes.map((node) => (node.config.tag_id as { $resource: string }).$resource),
    ).toEqual(expect.arrayContaining(refs));

    const compiled = compileFlowCode(first, exportInput.resourceCatalog);
    expect(compiled.issues.filter((issue) => issue.severity === "blocking")).toEqual(
      [],
    );
    expect(
      compiled.graph.nodes.map((node) => node.config.tag_id),
    ).toEqual(expect.arrayContaining(["tag-1", "tag-2"]));
  });

  it("rejects distinct source resources with the same portable identity", () => {
    expect(() =>
      exportFlowCode({
        flow: {
          name: "Duplicate resources",
          description: null,
          trigger_type: "manual",
          trigger_config: {},
          entry_node_id: "first",
          fallback_policy: draft.fallback,
          variable_schema: [],
        },
        nodes: [
          {
            node_key: "first",
            node_type: "set_tag",
            position_x: 0,
            position_y: 0,
            config: {
              mode: "add",
              tag_id: "tag-1",
              next_node_key: "second",
            },
          },
          {
            node_key: "second",
            node_type: "set_tag",
            position_x: 0,
            position_y: 100,
            config: {
              mode: "add",
              tag_id: "tag-2",
              next_node_key: "end",
            },
          },
        ],
        resourceCatalog: {
          flows: [],
          resources: [
            { id: "tag-1", kind: "tag", name: "VIP" },
            { id: "tag-2", kind: "tag", name: "VIP" },
          ],
        },
      }),
    ).toThrowError(/RESOURCE_REF_COLLISION/);
  });

  it("keeps clean external HTTPS media portable and rejects secret or foreign-storage URLs", () => {
    const inputForUrl = (mediaUrl: string) => ({
      flow: {
        name: "External media",
        description: null,
        trigger_type: "manual" as const,
        trigger_config: {},
        entry_node_id: "media",
        fallback_policy: draft.fallback,
        variable_schema: [],
      },
      nodes: [
        {
          node_key: "media",
          node_type: "send_media",
          position_x: 0,
          position_y: 0,
          config: {
            media_type: "image",
            media_url: mediaUrl,
            caption: "",
            filename: "image.png",
            next_node_key: "",
          },
        },
      ],
      resourceCatalog: emptyCatalog,
    });
    const cleanUrl = "https://cdn.example.test/public/image.png";
    const exported = exportFlowCode(inputForUrl(cleanUrl));
    expect(exported.document.nodes[0].config.media_url).toBe(cleanUrl);
    expect(
      compileFlowCode(exported.document, emptyCatalog).graph.nodes[0].config
        .media_url,
    ).toBe(cleanUrl);

    for (const unsafe of [
      "https://cdn.example.test/image.png?token=secret",
      "https://cdn.example.test/image.png#secret",
      "https://user:pass@cdn.example.test/image.png",
      "https://project.supabase.co/storage/v1/object/public/flow-media/account-foreign/image.png",
    ]) {
      expect(() => exportFlowCode(inputForUrl(unsafe))).toThrowError(
        /UNSAFE_EXTERNAL_ASSET_URL|SOURCE_RESOURCE_NOT_FOUND/,
      );
    }
  });

  it("repins subflows to the destination published version and rejects self references", () => {
    const document = {
      ...draft,
      resources: [
        { ref: "subflow:child", kind: "subflow" as const, name: "Child" },
      ],
      nodes: [
        {
          key: "child",
          type: "sub_flow",
          config: {
            flow_id: { $resource: "subflow:child" },
            input_mapping: [],
            output_mapping: [],
            max_depth: 8,
            next_node_key: "done",
          },
          position: { x: 0, y: 0 },
        },
        {
          key: "done",
          type: "end",
          config: {},
          position: { x: 0, y: 100 },
        },
      ],
      entry: "child",
    };
    const catalog: FlowCodeCatalog = {
      resources: [],
      flows: [
        {
          id: "child-id",
          name: "Child",
          publishedVersionId: "published-id",
          entryNodeKey: "start",
        },
      ],
    };
    const compiled = compileFlowCode(document, catalog);
    expect(compiled.graph.nodes[0].config).toEqual(
      expect.objectContaining({
        flow_id: "child-id",
        flow_version_id: "published-id",
        child_entry_node_key: "start",
      }),
    );
    expect(
      compileFlowCode(document, catalog, { replacingFlowId: "child-id" }).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SUBFLOW_SELF_REFERENCE" }),
      ]),
    );
    const cyclic = compileFlowCode(
      document,
      {
        resources: [],
        flows: [
          {
            ...catalog.flows[0],
            dependencies: ["parent-id"],
          },
        ],
      },
      { replacingFlowId: "parent-id" },
    );
    expect(cyclic.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SUBFLOW_CYCLE" }),
      ]),
    );
  });

  it("migrates safe legacy automations and rejects unsupported legacy triggers", () => {
    const legacy = {
      name: "Legacy",
      description: "",
      trigger_type: "keyword_match",
      trigger_config: { keywords: ["hello"], match_type: "contains" },
      steps: [
        {
          step_type: "send_message",
          step_config: { text: "Hi" },
          branch: null,
          parent_index: null,
        },
      ],
    };
    const parsed = parseFlowCodeInput(JSON.stringify(legacy));
    expect(parsed.document.kind).toBe("wacrm.flow");
    expect(parsed.document.trigger.type).toBe("keyword");
    expect(parsed.document.nodes.map((node) => node.type)).toEqual([
      "end",
      "send_message",
    ]);
    expect(parsed.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "LEGACY_AUTOMATION_MIGRATED" }),
      ]),
    );

    expect(() =>
      parseFlowCodeInput(
        JSON.stringify({
          ...legacy,
          trigger_type: "time_based",
          trigger_config: {
            schedule: "09:00",
            timezone: "America/Sao_Paulo",
          },
        }),
      ),
    ).toThrowError(/UNSUPPORTED_LEGACY_TRIGGER/);
  });

  it.each([
    ["send_message", { text: "Hi" }, "send_message"],
    [
      "send_buttons",
      {
        kind: "buttons",
        body: "Choose",
        buttons: [{ id: "yes", title: "Yes" }],
      },
      "send_buttons",
    ],
    [
      "send_list",
      {
        kind: "list",
        body: "Choose",
        button_label: "Open",
        sections: [{ rows: [{ id: "one", title: "One" }] }],
      },
      "send_list",
    ],
    ["add_tag", { tag_id: "legacy-tag" }, "set_tag"],
    ["remove_tag", { tag_id: "legacy-tag" }, "set_tag"],
    ["wait", { amount: 1, unit: "hours" }, "wait"],
    [
      "condition",
      { subject: "contact_field", operand: "email", value: "a@example.test" },
      "condition",
    ],
    [
      "send_webhook",
      { url: "https://example.test/hook" },
      "http_request",
    ],
  ])(
    "migrates legacy %s to the safe runtime node %s",
    (stepType, stepConfig, expectedType) => {
      const result = parseFlowCodeInput(
        JSON.stringify({
          name: "Legacy matrix",
          description: "",
          trigger_type: "first_inbound_message",
          trigger_config: {},
          steps: [
            {
              step_type: stepType,
              step_config: stepConfig,
              branch: null,
              parent_index: null,
            },
          ],
        }),
      );
      expect(result.document.nodes.some((node) => node.type === expectedType)).toBe(
        true,
      );
    },
  );

  it.each([
    ["send_template", { template_name: "welcome" }],
    ["assign_conversation", { mode: "round_robin" }],
    ["update_contact_field", { field: "name", value: "New" }],
    [
      "create_deal",
      {
        pipeline_id: "pipeline",
        stage_id: "stage",
        title: "Deal",
      },
    ],
    ["move_deal_stage", { pipeline_id: "pipeline", stage_id: "stage" }],
    ["close_conversation", {}],
  ])("rejects legacy %s explicitly", (stepType, stepConfig) => {
    expect(() =>
      parseFlowCodeInput(
        JSON.stringify({
          name: "Legacy unsupported",
          description: "",
          trigger_type: "first_inbound_message",
          trigger_config: {},
          steps: [
            {
              step_type: stepType,
              step_config: stepConfig,
              branch: null,
              parent_index: null,
            },
          ],
        }),
      ),
    ).toThrowError(/UNSUPPORTED_LEGACY_STEP/);
  });
});
