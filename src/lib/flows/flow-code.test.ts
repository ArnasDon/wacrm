import { describe, expect, it } from "vitest";

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
    const result = exportFlowCode({
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
    });
    const text = canonicalFlowCodeText(result.document);

    expect(
      result.document.nodes.find((node) => node.key === "request")?.type,
    ).toBe("http_request");
    expect(result.document.variables).toEqual([
      { key: "implicit_secret", type: "string", sensitive: true },
      { key: "public", type: "string", sensitive: false, default: "ok" },
    ]);
    expect(result.document.secret_requirements.length).toBe(2);
    expect(text).not.toMatch(
      /flow-uuid|account-uuid|user-uuid|node-uuid|version-uuid|super-secret|abcdef|must-not-export|unexpected/,
    );
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "UNKNOWN_CONFIG_FIELD_DROPPED",
    );
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
});
