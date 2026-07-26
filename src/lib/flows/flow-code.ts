import { createHash } from "node:crypto";

import { generatedAutomationSchema } from "@/lib/automations/dsl/schema";
import { automationToFlowGraph } from "@/lib/automations/to-flow-graph";
import { assertAuthorableHttpUrl } from "@/lib/flows/http-authoring-url";
import {
  canonicalNodeType,
  getNodeDescriptor,
  isFlowRuntimeNodeType,
  type PortableResourceKind,
  type PortableValueShape,
} from "@/lib/flows/registry";
import type { FlowVariableDeclaration } from "@/lib/flows/runtime-primitives";
import type {
  FlowFallbackPolicy,
  FlowNodeRow,
  FlowRow,
} from "@/lib/flows/types";

export const FLOW_CODE_LIMITS = {
  maxBytes: 1024 * 1024,
  maxNodes: 500,
  maxResources: 500,
  maxVariables: 100,
  maxSecretRequirements: 100,
  maxDepth: 40,
  maxString: 16_384,
  maxName: 200,
  maxDescription: 4_000,
} as const;

export type FlowCodeResourceKind = PortableResourceKind;

export interface FlowCodeResource {
  ref: string;
  kind: FlowCodeResourceKind;
  name: string;
  parent_ref?: string;
}

export interface FlowCodeSecretRequirement {
  name: string;
  node_key: string;
  path: string;
}

export interface FlowCodeVariable extends FlowVariableDeclaration {
  sensitive: boolean;
}

export interface FlowCodeNode {
  key: string;
  type: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface FlowCodeDocument {
  kind: "wacrm.flow";
  schema_version: 1;
  name: string;
  description: string | null;
  trigger: {
    type: "keyword" | "first_inbound_message" | "manual";
    config: Record<string, unknown>;
  };
  fallback: FlowFallbackPolicy;
  variables: FlowCodeVariable[];
  resources: FlowCodeResource[];
  secret_requirements: FlowCodeSecretRequirement[];
  entry: string | null;
  nodes: FlowCodeNode[];
}

export interface CatalogResource {
  id: string;
  kind: FlowCodeResourceKind;
  name: string;
  parentId?: string;
  /** Runtime value persisted for resources whose catalog id must remain opaque. */
  runtimeValue?: string;
  /** Only subflows use these destination-derived pins. */
  publishedVersionId?: string | null;
  entryNodeKey?: string | null;
  dependencies?: string[];
}

export interface FlowCodeCatalog {
  resources: CatalogResource[];
  flows: Array<{
    id: string;
    name: string;
    publishedVersionId?: string | null;
    entryNodeKey?: string | null;
    dependencies?: string[];
  }>;
}

export interface FlowCodeIssue {
  code: string;
  severity: "warning" | "blocking" | "fatal" | "activation";
  path?: string;
  message: string;
  candidates?: Array<{ id: string; name: string }>;
}

export interface FlowCodeGraph {
  name: string;
  description: string | null;
  trigger_type: FlowCodeDocument["trigger"]["type"];
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
  fallback_policy: FlowFallbackPolicy;
  variable_schema: FlowVariableDeclaration[];
  nodes: Array<{
    node_key: string;
    node_type: string;
    config: Record<string, unknown>;
    position_x: number;
    position_y: number;
  }>;
}

const TOP_LEVEL_FIELDS = [
  "kind",
  "schema_version",
  "name",
  "description",
  "trigger",
  "fallback",
  "variables",
  "resources",
  "secret_requirements",
  "entry",
  "nodes",
] as const;

const PROTOTYPE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const HIGH_CONFIDENCE_SECRET =
  /(?:\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b|\b[A-Fa-f0-9]{32,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
const UUID_IDENTIFIER =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const SAFE_KEY = /^[a-zA-Z_][a-zA-Z0-9_.:-]{0,127}$/;
const TRIGGER_SHAPES = {
  keyword: {
    keywords: [true],
    match_type: true,
    case_sensitive: true,
  },
  first_inbound_message: {},
  manual: {},
} as const;

export class FlowCodeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "FlowCodeError";
  }
}

function fail(code: string, message: string): never {
  throw new FlowCodeError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(
  value: unknown,
  path: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) fail("INVALID_DOCUMENT", `${path} must be an object`);
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
) {
  const allow = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allow.has(key)) fail("UNKNOWN_FIELD", `${path}.${key}`);
  }
}

function isPortableMarker(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    ((typeof value.$resource === "string" && SAFE_KEY.test(value.$resource)) ||
      (typeof value.$secret === "string" && SAFE_KEY.test(value.$secret)))
  );
}

function assertPortableShape(
  value: unknown,
  shape: PortableValueShape,
  path: string,
): void {
  if (isPortableMarker(value)) return;
  if (shape === "json") {
    assertNoPortableMarkers(value, path);
    return;
  }
  if (shape === "string_map") {
    if (!isRecord(value)) fail("INVALID_CONFIG_FIELD", path);
    for (const [key, entry] of Object.entries(value)) {
      if (PROTOTYPE_KEYS.has(key)) fail("PROTOTYPE_KEY", `${path}.${key}`);
      if (typeof entry !== "string" && !isPortableMarker(entry)) {
        fail("INVALID_CONFIG_FIELD", `${path}.${key}`);
      }
    }
    return;
  }
  if (shape === true) {
    if (
      value !== null &&
      (typeof value === "object" || typeof value === "function")
    ) {
      fail("INVALID_CONFIG_FIELD", path);
    }
    return;
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) fail("INVALID_CONFIG_FIELD", path);
    value.forEach((entry, index) =>
      assertPortableShape(entry, shape[0], `${path}[${index}]`),
    );
    return;
  }
  if (!isRecord(value)) fail("INVALID_CONFIG_FIELD", path);
  for (const key of Object.keys(value)) {
    if (!(key in shape)) fail("UNKNOWN_CONFIG_FIELD", `${path}.${key}`);
  }
  for (const [key, childShape] of Object.entries(shape)) {
    if (key in value) {
      assertPortableShape(value[key], childShape, `${path}.${key}`);
    }
  }
}

function assertNoPortableMarkers(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoPortableMarkers(entry, `${path}[${index}]`),
    );
    return;
  }
  if (!isRecord(value)) return;
  if ("$secret" in value || "$resource" in value) {
    fail("PORTABLE_MARKER_FORBIDDEN", path);
  }
  for (const [key, entry] of Object.entries(value)) {
    assertNoPortableMarkers(entry, `${path}.${key}`);
  }
}

function assertPortableNodeConfig(
  nodeType: string,
  config: Record<string, unknown>,
  path: string,
) {
  const canonical = canonicalNodeType(nodeType);
  const descriptor = canonical ? getNodeDescriptor(canonical) : undefined;
  if (!descriptor) fail("UNKNOWN_NODE_TYPE", nodeType);
  assertPortableShape(config, descriptor.portability.configShape, path);
}

function assertSafeTree(value: unknown, depth = 0, path = "$"): void {
  if (depth > FLOW_CODE_LIMITS.maxDepth) {
    fail("MAX_DEPTH_EXCEEDED", path);
  }
  if (typeof value === "string" && value.length > FLOW_CODE_LIMITS.maxString) {
    fail("STRING_TOO_LONG", path);
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertSafeTree(entry, depth + 1, `${path}[${index}]`),
    );
    return;
  }
  const markerKeys = Object.keys(value).filter(
    (key) => key === "$resource" || key === "$secret",
  );
  const record = value as Record<string, unknown>;
  if (
    markerKeys.length > 0 &&
    (Object.keys(value).length !== 1 ||
      markerKeys.length !== 1 ||
      typeof record[markerKeys[0]] !== "string")
  ) {
    fail("INVALID_PORTABLE_MARKER", path);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (PROTOTYPE_KEYS.has(key)) fail("PROTOTYPE_KEY", `${path}.${key}`);
    assertSafeTree(entry, depth + 1, `${path}.${key}`);
  }
}

function expectString(
  value: unknown,
  path: string,
  max: number = FLOW_CODE_LIMITS.maxString,
): string {
  if (typeof value !== "string" || value.length > max) {
    fail("INVALID_DOCUMENT", `${path} must be a bounded string`);
  }
  return value;
}

function parseFallback(value: unknown): FlowFallbackPolicy {
  assertRecord(value, "fallback");
  assertExactKeys(
    value,
    [
      "on_unknown_reply",
      "max_reprompts",
      "on_timeout_hours",
      "on_exhaust",
      "execution",
    ],
    "fallback",
  );
  if (!["reprompt", "handoff", "ignore"].includes(String(value.on_unknown_reply))) {
    fail("INVALID_DOCUMENT", "fallback.on_unknown_reply");
  }
  if (
    !Number.isInteger(value.max_reprompts) ||
    Number(value.max_reprompts) < 0
  ) {
    fail("INVALID_DOCUMENT", "fallback.max_reprompts");
  }
  if (
    typeof value.on_timeout_hours !== "number" ||
    !Number.isFinite(value.on_timeout_hours) ||
    value.on_timeout_hours <= 0
  ) {
    fail("INVALID_DOCUMENT", "fallback.on_timeout_hours");
  }
  if (!["handoff", "end"].includes(String(value.on_exhaust))) {
    fail("INVALID_DOCUMENT", "fallback.on_exhaust");
  }
  assertNoPortableMarkers(value, "fallback");
  assertNoSecret(value, "fallback");
  assertNoSourceIdentifier(value, "fallback");
  return structuredClone(value) as unknown as FlowFallbackPolicy;
}

function parseVariable(value: unknown, index: number): FlowCodeVariable {
  assertRecord(value, `variables[${index}]`);
  assertExactKeys(
    value,
    ["key", "type", "required", "sensitive", "default"],
    `variables[${index}]`,
  );
  const key = expectString(value.key, `variables[${index}].key`, 128);
  if (!SAFE_KEY.test(key)) fail("INVALID_DOCUMENT", `variables[${index}].key`);
  if (
    !["string", "number", "boolean", "json", "contact", "message"].includes(
      String(value.type),
    )
  ) {
    fail("INVALID_DOCUMENT", `variables[${index}].type`);
  }
  if (typeof value.sensitive !== "boolean") {
    fail("INVALID_DOCUMENT", `variables[${index}].sensitive`);
  }
  if (typeof value.required !== "boolean") {
    fail("INVALID_VARIABLE_REQUIRED", `variables[${index}].required`);
  }
  if (value.sensitive && "default" in value) {
    fail("SENSITIVE_DEFAULT_FORBIDDEN", `variables[${index}].default`);
  }
  if ("default" in value) {
    assertNoPortableMarkers(value.default, `variables[${index}].default`);
    assertNoSecret(value.default, `variables[${index}].default`);
    assertNoSourceIdentifier(value.default, `variables[${index}].default`);
    const type = String(value.type);
    const compatible =
      (type === "string" && typeof value.default === "string") ||
      (type === "number" &&
        typeof value.default === "number" &&
        Number.isFinite(value.default)) ||
      (type === "boolean" && typeof value.default === "boolean") ||
      (type === "json" && value.default !== undefined) ||
      (["contact", "message"].includes(type) &&
        (isRecord(value.default) || Array.isArray(value.default)));
    let encoded: string | undefined;
    try {
      encoded = JSON.stringify(value.default);
    } catch {
      fail("INVALID_VARIABLE_DEFAULT", `variables[${index}].default`);
    }
    if (
      !compatible ||
      encoded === undefined ||
      new TextEncoder().encode(encoded).byteLength > 64 * 1024
    ) {
      fail("INVALID_VARIABLE_DEFAULT", `variables[${index}].default`);
    }
  }
  return structuredClone(value) as unknown as FlowCodeVariable;
}

function parseResource(value: unknown, index: number): FlowCodeResource {
  assertRecord(value, `resources[${index}]`);
  assertExactKeys(value, ["ref", "kind", "name", "parent_ref"], `resources[${index}]`);
  const ref = expectString(value.ref, `resources[${index}].ref`, 128);
  const name = expectString(value.name, `resources[${index}].name`, 512);
  if (!SAFE_KEY.test(ref)) fail("INVALID_DOCUMENT", `resources[${index}].ref`);
  if (
    !["tag", "member", "pipeline", "stage", "custom_field", "subflow", "asset"].includes(
      String(value.kind),
    )
  ) {
    fail("INVALID_DOCUMENT", `resources[${index}].kind`);
  }
  if (value.kind === "member" && /@|\+?\d{7,}/.test(name)) {
    fail("MEMBER_IDENTIFIER_FORBIDDEN", `resources[${index}].name`);
  }
  return structuredClone(value) as unknown as FlowCodeResource;
}

function parseSecretRequirement(
  value: unknown,
  index: number,
): FlowCodeSecretRequirement {
  assertRecord(value, `secret_requirements[${index}]`);
  assertExactKeys(
    value,
    ["name", "node_key", "path"],
    `secret_requirements[${index}]`,
  );
  const requirement = {
    name: expectString(value.name, `secret_requirements[${index}].name`, 256),
    node_key: expectString(
      value.node_key,
      `secret_requirements[${index}].node_key`,
      128,
    ),
    path: expectString(value.path, `secret_requirements[${index}].path`, 256),
  };
  if (
    !SAFE_KEY.test(requirement.name) ||
    !SAFE_KEY.test(requirement.node_key) ||
    !SAFE_KEY.test(requirement.path)
  ) {
    fail("INVALID_DOCUMENT", `secret_requirements[${index}]`);
  }
  return requirement;
}

function parseNode(value: unknown, index: number): FlowCodeNode {
  assertRecord(value, `nodes[${index}]`);
  assertExactKeys(value, ["key", "type", "config", "position"], `nodes[${index}]`);
  assertRecord(value.config, `nodes[${index}].config`);
  assertRecord(value.position, `nodes[${index}].position`);
  assertExactKeys(value.position, ["x", "y"], `nodes[${index}].position`);
  const x = value.position.x;
  const y = value.position.y;
  if (
    typeof x !== "number" ||
    !Number.isFinite(x) ||
    typeof y !== "number" ||
    !Number.isFinite(y)
  ) {
    fail("INVALID_DOCUMENT", `nodes[${index}].position`);
  }
  const nodeType = expectString(value.type, `nodes[${index}].type`, 128);
  assertPortableNodeConfig(
    nodeType,
    value.config,
    `nodes[${index}].config`,
  );
  assertNoSecret(value.config, `nodes[${index}].config`);
  assertNoSourceIdentifier(value.config, `nodes[${index}].config`);
  assertSafeUrlFields(value.config, `nodes[${index}]`);
  return {
    key: expectString(value.key, `nodes[${index}].key`, 128),
    type: nodeType,
    config: structuredClone(value.config),
    position: { x, y },
  };
}

function validateDocumentMarkers(document: FlowCodeDocument): void {
  const requirements = new Map(
    document.secret_requirements.map((requirement) => [
      requirement.name,
      requirement,
    ]),
  );
  const resources = new Map(
    document.resources.map((resource) => [resource.ref, resource]),
  );
  const usedRequirements = new Map<string, number>();

  const visit = (
    node: FlowCodeNode,
    descriptor: NonNullable<ReturnType<typeof getNodeDescriptor>>,
    value: unknown,
    path: string,
  ): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) =>
        visit(node, descriptor, entry, `${path}[${index}]`),
      );
      return;
    }
    if (!isRecord(value)) return;
    if (typeof value.$secret === "string") {
      const allowed = (descriptor.portability.secretMaps ?? []).some(
        (mapPath) => path.startsWith(`${mapPath}.`) && path.length > mapPath.length + 1,
      );
      if (!allowed) fail("SECRET_MARKER_PATH_INVALID", `${node.key}.${path}`);
      const requirement = requirements.get(value.$secret);
      if (
        !requirement ||
        requirement.node_key !== node.key ||
        requirement.path !== `config.${path}`
      ) {
        fail("SECRET_REQUIREMENT_MISMATCH", `${node.key}.${path}`);
      }
      usedRequirements.set(
        requirement.name,
        (usedRequirements.get(requirement.name) ?? 0) + 1,
      );
      return;
    }
    if (typeof value.$resource === "string") {
      const resourceRef = descriptor.portability.resourceRefs?.find(
        (candidate) => candidate.field === path,
      );
      if (
        !resourceRef ||
        (descriptor.id === "condition" &&
          path === "subject_key" &&
          node.config.subject !== "tag")
      ) {
        fail("RESOURCE_MARKER_PATH_INVALID", `${node.key}.${path}`);
      }
      const resource = resources.get(value.$resource);
      if (!resource) {
        fail("RESOURCE_MARKER_MISMATCH", `${node.key}.${path}`);
      }
      if (resource.kind !== resourceRef.kind) {
        fail("RESOURCE_KIND_MISMATCH", `${node.key}.${path}`);
      }
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      visit(node, descriptor, entry, path ? `${path}.${key}` : key);
    }
  };

  for (const node of document.nodes) {
    const descriptor = getNodeDescriptor(node.type);
    if (!descriptor) fail("UNKNOWN_NODE_TYPE", node.type);
    visit(node, descriptor, node.config, "");
  }
  for (const requirement of document.secret_requirements) {
    const count = usedRequirements.get(requirement.name) ?? 0;
    if (count === 0) {
      fail("ORPHAN_SECRET_REQUIREMENT", requirement.name);
    }
    if (count !== 1) {
      fail("SECRET_REQUIREMENT_MISMATCH", requirement.name);
    }
  }
}

export function parseFlowCodeText(text: string): {
  document: FlowCodeDocument;
  digest: string;
} {
  if (new TextEncoder().encode(text).byteLength > FLOW_CODE_LIMITS.maxBytes) {
    fail("DOCUMENT_TOO_LARGE", "flow code exceeds 1 MiB");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail("INVALID_JSON", "flow code is not valid JSON");
  }
  assertSafeTree(value);
  assertRecord(value, "$");
  assertExactKeys(value, TOP_LEVEL_FIELDS, "$");
  if (value.kind !== "wacrm.flow") {
    fail("INVALID_KIND", "kind must be wacrm.flow");
  }
  if (value.schema_version !== 1) {
    fail("UNSUPPORTED_SCHEMA_VERSION", String(value.schema_version));
  }
  const name = expectString(value.name, "name", FLOW_CODE_LIMITS.maxName).trim();
  if (!name) fail("INVALID_DOCUMENT", "name is required");
  if (
    value.description !== null &&
    typeof value.description !== "string"
  ) {
    fail("INVALID_DOCUMENT", "description");
  }
  if (
    typeof value.description === "string" &&
    value.description.length > FLOW_CODE_LIMITS.maxDescription
  ) {
    fail("STRING_TOO_LONG", "description");
  }
  assertRecord(value.trigger, "trigger");
  assertExactKeys(value.trigger, ["type", "config"], "trigger");
  if (
    !["keyword", "first_inbound_message", "manual"].includes(
      String(value.trigger.type),
    )
  ) {
    fail("INVALID_TRIGGER", String(value.trigger.type));
  }
  assertRecord(value.trigger.config, "trigger.config");
  assertPortableShape(
    value.trigger.config,
    TRIGGER_SHAPES[
      value.trigger.type as keyof typeof TRIGGER_SHAPES
    ],
    "trigger.config",
  );
  assertNoPortableMarkers(value.trigger.config, "trigger.config");
  assertNoSecret(value.trigger.config, "trigger.config");
  assertNoSourceIdentifier(value.trigger.config, "trigger.config");
  if (!Array.isArray(value.variables)) {
    fail("INVALID_DOCUMENT", "variables must be an array");
  }
  if (value.variables.length > FLOW_CODE_LIMITS.maxVariables) {
    fail("TOO_MANY_VARIABLES", String(value.variables.length));
  }
  if (!Array.isArray(value.resources)) {
    fail("INVALID_DOCUMENT", "resources must be an array");
  }
  if (value.resources.length > FLOW_CODE_LIMITS.maxResources) {
    fail("TOO_MANY_RESOURCES", String(value.resources.length));
  }
  if (!Array.isArray(value.secret_requirements)) {
    fail("INVALID_DOCUMENT", "secret_requirements must be an array");
  }
  if (
    value.secret_requirements.length >
    FLOW_CODE_LIMITS.maxSecretRequirements
  ) {
    fail(
      "TOO_MANY_SECRET_REQUIREMENTS",
      String(value.secret_requirements.length),
    );
  }
  if (!Array.isArray(value.nodes)) fail("INVALID_DOCUMENT", "nodes must be an array");
  if (value.nodes.length > FLOW_CODE_LIMITS.maxNodes) {
    fail("TOO_MANY_NODES", String(value.nodes.length));
  }
  if (value.entry !== null && typeof value.entry !== "string") {
    fail("INVALID_DOCUMENT", "entry");
  }
  const document: FlowCodeDocument = {
    kind: "wacrm.flow",
    schema_version: 1,
    name,
    description: value.description,
    trigger: {
      type: value.trigger.type as FlowCodeDocument["trigger"]["type"],
      config: structuredClone(value.trigger.config),
    },
    fallback: parseFallback(value.fallback),
    variables: value.variables.map(parseVariable),
    resources: value.resources.map(parseResource),
    secret_requirements: value.secret_requirements.map(parseSecretRequirement),
    entry: value.entry,
    nodes: value.nodes.map(parseNode),
  };
  assertUnique(document.variables, "key", "DUPLICATE_VARIABLE");
  assertUnique(document.resources, "ref", "DUPLICATE_RESOURCE_REF");
  assertUnique(document.secret_requirements, "name", "DUPLICATE_SECRET");
  assertUnique(document.nodes, "key", "DUPLICATE_NODE_KEY");
  validateDocumentMarkers(document);
  const canonical = canonicalFlowCodeText(document);
  return { document, digest: digestFlowCode(canonical) };
}

/**
 * Version-isolated import gateway. Native v1 is attempted first. Documents
 * without a `kind` discriminator are parsed only through the legacy
 * automation schema and migrated into v1; callers never need legacy branches.
 */
export function parseFlowCodeInput(text: string): {
  document: FlowCodeDocument;
  digest: string;
  warnings: FlowCodeIssue[];
} {
  if (new TextEncoder().encode(text).byteLength > FLOW_CODE_LIMITS.maxBytes) {
    fail("DOCUMENT_TOO_LARGE", "flow code exceeds 1 MiB");
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    fail("INVALID_JSON", "flow code is not valid JSON");
  }
  assertSafeTree(candidate);
  if (isRecord(candidate) && "kind" in candidate) {
    return { ...parseFlowCodeText(text), warnings: [] };
  }
  const generated = generatedAutomationSchema.safeParse(candidate);
  const manual =
    !generated.success &&
    isRecord(candidate) &&
    candidate.trigger_type === "manual" &&
    isRecord(candidate.trigger_config) &&
    Object.keys(candidate.trigger_config).length === 0
      ? generatedAutomationSchema.safeParse({
          ...candidate,
          trigger_type: "first_inbound_message",
          trigger_config: {},
        })
      : null;
  const parsed = generated.success
    ? generated.data
    : manual?.success
      ? {
          ...manual.data,
          trigger_type: "manual" as const,
          trigger_config: {},
        }
      : null;
  if (!parsed) {
    if (isRecord(candidate) && typeof candidate.trigger_type === "string") {
      fail("UNSUPPORTED_LEGACY_TRIGGER", candidate.trigger_type);
    }
    fail("INVALID_LEGACY_AUTOMATION", "legacy automation is invalid");
  }
  if (
    parsed.trigger_type !== "keyword_match" &&
    parsed.trigger_type !== "first_inbound_message" &&
    parsed.trigger_type !== "manual"
  ) {
    fail("UNSUPPORTED_LEGACY_TRIGGER", parsed.trigger_type);
  }
  const graph = automationToFlowGraph({
    trigger_type:
      parsed.trigger_type === "manual"
        ? "first_inbound_message"
        : parsed.trigger_type,
    trigger_config: parsed.trigger_config,
    steps: parsed.steps,
  });
  const trigger = graph.nodes[0];
  const migratedResources: FlowCodeResource[] = [];
  const migratedVariables: FlowCodeVariable[] = [];
  const migratedNodes = graph.nodes.slice(1).map((node, index) => {
    const migrated = migrateLegacyNode(
      node.node_type,
      node.config,
      index,
      migratedResources,
      migratedVariables,
    );
    return {
      key: node.node_key,
      type: migrated.type,
      config: migrated.config,
      position: { x: 0, y: index * 120 },
    };
  });
  const document: FlowCodeDocument = {
    kind: "wacrm.flow",
    schema_version: 1,
    name: parsed.name,
    description: parsed.description || null,
    trigger: {
      type:
        parsed.trigger_type === "keyword_match"
          ? "keyword"
          : parsed.trigger_type === "manual"
            ? "manual"
            : "first_inbound_message",
      config: structuredClone(parsed.trigger_config),
    },
    fallback: {
      on_unknown_reply: "reprompt",
      max_reprompts: 2,
      on_timeout_hours: 24,
      on_exhaust: "handoff",
    },
    variables: migratedVariables,
    resources: migratedResources,
    secret_requirements: [],
    entry:
      typeof trigger?.config.next_node_key === "string"
        ? trigger.config.next_node_key
        : null,
    nodes: migratedNodes,
  };
  const native = parseFlowCodeText(canonicalFlowCodeText(document));
  return {
    ...native,
    warnings: [
      {
        code: "LEGACY_AUTOMATION_MIGRATED",
        severity: "warning",
        message: "Legacy automation was migrated to native flow code v1.",
      },
    ],
  };
}

function migrateLegacyNode(
  nodeType: string,
  input: Record<string, unknown>,
  index: number,
  resources: FlowCodeResource[],
  variables: FlowCodeVariable[],
): { type: string; config: Record<string, unknown> } {
  if (nodeType === "send_buttons" && input.kind === "buttons") {
    const next =
      typeof input.next_node_key === "string" ? input.next_node_key : "";
    return { type: "send_buttons", config: {
      text: input.body,
      ...(input.header ? { header_text: input.header } : {}),
      ...(input.footer ? { footer_text: input.footer } : {}),
      buttons: Array.isArray(input.buttons)
        ? input.buttons.map((button) =>
            isRecord(button)
              ? {
                  reply_id: button.id,
                  title: button.title,
                  next_node_key: next,
                }
              : button,
          )
        : [],
    } };
  }
  if (nodeType === "send_list" && input.kind === "list") {
    const next =
      typeof input.next_node_key === "string" ? input.next_node_key : "";
    return { type: "send_list", config: {
      text: input.body,
      button_label: input.button_label,
      ...(input.header ? { header_text: input.header } : {}),
      ...(input.footer ? { footer_text: input.footer } : {}),
      sections: Array.isArray(input.sections)
        ? input.sections.map((section) =>
            isRecord(section) && Array.isArray(section.rows)
              ? {
                  ...(section.title ? { title: section.title } : {}),
                  rows: section.rows.map((row) =>
                    isRecord(row)
                      ? {
                          reply_id: row.id,
                          title: row.title,
                          ...(row.description
                            ? { description: row.description }
                            : {}),
                          next_node_key: next,
                        }
                      : row,
                  ),
                }
              : section,
          )
        : [],
    } };
  }
  if (nodeType === "add_tag" || nodeType === "remove_tag") {
    const ref = `legacy_manual_tag_${index}`;
    resources.push({
      ref,
      kind: "tag",
      name: "Select destination tag",
    });
    return {
      type: "set_tag",
      config: {
        mode: nodeType === "add_tag" ? "add" : "remove",
        tag_id: { $resource: ref },
        next_node_key: input.next_node_key,
      },
    };
  }
  if (nodeType === "condition") {
    if (
      input.subject !== "contact_field" ||
      typeof input.operand !== "string" ||
      !["name", "email", "phone", "company"].includes(input.operand)
    ) {
      fail("UNSUPPORTED_LEGACY_STEP", `${nodeType}:${String(input.subject)}`);
    }
    return {
      type: "condition",
      config: {
        subject: "contact_field",
        subject_key: input.operand,
        operator: "equals",
        value: input.value,
        true_next: input.true_next,
        false_next: input.false_next,
      },
    };
  }
  if (nodeType === "send_webhook") {
    const responseVar = `legacy_webhook_response_${index}`;
    variables.push({
      key: responseVar,
      type: "json",
      required: false,
      sensitive: true,
    });
    return {
      type: "http_request",
      config: {
        method: input.body_template ? "POST" : "GET",
        url: input.url,
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.body_template ? { body: input.body_template } : {}),
        response_var: responseVar,
        next_node_key: input.next_node_key,
      },
    };
  }
  if (isFlowRuntimeNodeType(nodeType)) {
    return { type: nodeType, config: structuredClone(input) };
  }
  fail("UNSUPPORTED_LEGACY_STEP", nodeType);
}

function assertUnique<T extends object>(
  values: readonly T[],
  key: keyof T,
  code: string,
) {
  const seen = new Set<unknown>();
  for (const value of values) {
    if (seen.has(value[key])) fail(code, String(value[key]));
    seen.add(value[key]);
  }
}

function sortRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecord);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortRecord(value[key])]),
  );
}

export function canonicalFlowCodeText(document: FlowCodeDocument): string {
  const normalized: FlowCodeDocument = {
    ...structuredClone(document),
    variables: [...document.variables].sort((a, b) =>
      compareCodePoints(a.key, b.key),
    ),
    resources: [...document.resources].sort((a, b) =>
      compareCodePoints(a.ref, b.ref),
    ),
    secret_requirements: [...document.secret_requirements].sort((a, b) =>
      compareCodePoints(a.name, b.name),
    ),
    nodes: [...document.nodes].sort((a, b) =>
      compareCodePoints(a.key, b.key),
    ),
  };
  return `${JSON.stringify(sortRecord(normalized), null, 2)}\n`;
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function digestFlowCode(canonicalText: string): string {
  return createHash("sha256").update(canonicalText, "utf8").digest("hex");
}

function slug(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "resource"
  );
}

function canonicalResourceRef(
  resource: CatalogResource,
  parent?: CatalogResource,
): string {
  const identity = JSON.stringify([
    resource.kind,
    resource.name.normalize("NFKC").trim(),
    parent?.kind ?? null,
    parent?.name.normalize("NFKC").trim() ?? null,
  ]);
  const suffix = createHash("sha256")
    .update(identity, "utf8")
    .digest("hex")
    .slice(0, 12);
  return `${resource.kind}:${slug(resource.name)}_${suffix}`;
}

function toCatalog(input?: FlowCodeCatalog): CatalogResource[] {
  return [
    ...(input?.resources ?? []),
    ...(input?.flows ?? []).map((flow) => ({
      ...flow,
      kind: "subflow" as const,
    })),
  ];
}

type ExportFlow = Pick<
  FlowRow,
  | "name"
  | "description"
  | "trigger_type"
  | "trigger_config"
  | "entry_node_id"
  | "fallback_policy"
  | "variable_schema"
> &
  Partial<Pick<FlowRow, "id" | "account_id" | "user_id">>;

type ExportNode = Pick<
  FlowNodeRow,
  "node_key" | "config" | "position_x" | "position_y"
> & {
  node_type: string;
} &
  Partial<Pick<FlowNodeRow, "id" | "flow_id">>;

export function exportFlowCode(input: {
  flow: ExportFlow;
  nodes: ExportNode[];
  resourceCatalog?: FlowCodeCatalog;
}): { document: FlowCodeDocument; warnings: FlowCodeIssue[] } {
  const warnings: FlowCodeIssue[] = [];
  const resources = new Map<string, FlowCodeResource>();
  const sourceResourceIdsByRef = new Map<string, string>();
  const requirements = new Map<string, FlowCodeSecretRequirement>();
  const catalog = toCatalog(input.resourceCatalog);

  const nodes = input.nodes.map((node): FlowCodeNode => {
    const nodeType = canonicalNodeType(node.node_type);
    const descriptor = nodeType ? getNodeDescriptor(nodeType) : undefined;
    if (!descriptor || !isFlowRuntimeNodeType(nodeType!)) {
      fail("UNKNOWN_NODE_TYPE", node.node_type);
    }
    const portable = descriptor.portability;
    assertPortableNodeConfig(
      node.node_type,
      node.config,
      `nodes.${node.node_key}.config`,
    );
    const allowed = new Set(portable.portableFields);
    const config: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.config)) {
      if (portable.derivedFields?.includes(key)) continue;
      if (!allowed.has(key)) {
        fail(
          "UNKNOWN_CONFIG_FIELD",
          `nodes.${node.node_key}.config.${key}`,
        );
      }
      config[key] = structuredClone(value);
    }

    for (const secretMap of portable.secretMaps ?? []) {
      const raw = config[secretMap];
      if (raw === undefined) continue;
      if (!isRecord(raw)) fail("INVALID_SECRET_MAP", `${node.node_key}.${secretMap}`);
      config[secretMap] = Object.fromEntries(
        Object.entries(raw).map(([key, value]) => {
          if (typeof value !== "string") {
            fail("INVALID_SECRET_MAP", `${node.node_key}.${secretMap}.${key}`);
          }
          const name = `${node.node_key}.${secretMap}.${slug(key)}`;
          requirements.set(name, {
            name,
            node_key: node.node_key,
            path: `config.${secretMap}.${key}`,
          });
          return [key, { $secret: name }];
        }),
      );
    }

    for (const resourceRef of portable.resourceRefs ?? []) {
      const sourceId = config[resourceRef.field];
      if (typeof sourceId !== "string" || !sourceId) continue;
      if (
        descriptor.id === "condition" &&
        resourceRef.field === "subject_key" &&
        config.subject !== "tag"
      ) {
        continue;
      }
      if (
        descriptor.id === "update_contact_field" &&
        resourceRef.field === "field" &&
        !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(sourceId)
      ) {
        continue;
      }
      const found = catalog.find(
        (candidate) =>
          (candidate.id === sourceId || candidate.runtimeValue === sourceId) &&
          candidate.kind === resourceRef.kind,
      );
      if (!found) {
        if (resourceRef.kind === "asset") {
          assertCleanExternalAssetUrl(
            sourceId,
            `${node.node_key}.${resourceRef.field}`,
          );
          continue;
        }
        fail(
          "SOURCE_RESOURCE_NOT_FOUND",
          `${node.node_key}.${resourceRef.field}`,
        );
      }
      const parent = found.parentId
        ? catalog.find((candidate) => candidate.id === found.parentId)
        : undefined;
      const ref = canonicalResourceRef(found, parent);
      const existingSourceId = sourceResourceIdsByRef.get(ref);
      if (existingSourceId !== undefined && existingSourceId !== found.id) {
        fail("RESOURCE_REF_COLLISION", ref);
      }
      sourceResourceIdsByRef.set(ref, found.id);
      resources.set(ref, {
        ref,
        kind: found.kind,
        name: found.name,
        ...(parent ? { parent_ref: canonicalResourceRef(parent) } : {}),
      });
      config[resourceRef.field] = { $resource: ref };
    }

    assertNoSecret(config, `nodes.${node.node_key}.config`);
    assertNoSourceIdentifier(config, `nodes.${node.node_key}.config`);
    assertSafeUrlFields(config, node.node_key);
    return {
      key: node.node_key,
      type: nodeType!,
      config,
      position: {
        x: Number.isFinite(node.position_x) ? node.position_x : 0,
        y: Number.isFinite(node.position_y) ? node.position_y : 0,
      },
    };
  });

  const variables = input.flow.variable_schema.map(
    (variable): FlowCodeVariable => {
      const sensitive = variable.sensitive !== false;
      const portable: FlowCodeVariable = {
        key: variable.key,
        type: variable.type,
        required: variable.required === true,
        sensitive,
      };
      if (!sensitive && variable.default !== undefined) {
        assertNoSecret(variable.default, `variables.${variable.key}.default`);
        portable.default = structuredClone(variable.default);
      }
      return portable;
    },
  );
  const document: FlowCodeDocument = {
    kind: "wacrm.flow",
    schema_version: 1,
    name: input.flow.name,
    description: input.flow.description,
    trigger: {
      type: input.flow.trigger_type,
      config: structuredClone(
        input.flow.trigger_config as unknown as Record<string, unknown>,
      ),
    },
    fallback: structuredClone(input.flow.fallback_policy),
    variables,
    resources: [...resources.values()],
    secret_requirements: [...requirements.values()],
    entry: input.flow.entry_node_id,
    nodes,
  };
  assertPortableShape(
    document.trigger.config,
    TRIGGER_SHAPES[document.trigger.type],
    "trigger.config",
  );
  assertNoPortableMarkers(document.trigger.config, "trigger.config");
  assertNoSecret(document.trigger.config, "trigger.config");
  assertNoSourceIdentifier(document.trigger.config, "trigger.config");
  // Reparse the canonical document to enforce the same limits as import.
  return {
    document: parseFlowCodeText(canonicalFlowCodeText(document)).document,
    warnings,
  };
}

function assertSafeUrlFields(config: Record<string, unknown>, nodeKey: string) {
  for (const key of ["url", "media_url"]) {
    if (typeof config[key] !== "string" || !config[key]) continue;
    let url: URL;
    try {
      url = new URL(config[key] as string);
    } catch {
      fail("INVALID_URL", `${nodeKey}.${key}`);
    }
    if (url.username || url.password) {
      fail("URL_USERINFO_FORBIDDEN", `${nodeKey}.${key}`);
    }
    if (key === "media_url") {
      assertCleanExternalAssetUrl(config[key] as string, `${nodeKey}.${key}`);
    }
  }
}

function assertCleanExternalAssetUrl(rawUrl: string, path: string): void {
  let url: URL;
  try {
    url = new URL(assertAuthorableHttpUrl(rawUrl));
  } catch {
    fail("UNSAFE_EXTERNAL_ASSET_URL", path);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /\/storage\/v1\/object\/|\/flow-media\/account-/i.test(url.pathname)
  ) {
    fail("UNSAFE_EXTERNAL_ASSET_URL", path);
  }
}

function assertNoSecret(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (HIGH_CONFIDENCE_SECRET.test(value)) {
      fail(
        path.includes("default_value")
          ? "SECRET_IN_DEFAULT_VALUE"
          : "SUSPECTED_SECRET",
        path,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecret(entry, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "$secret") continue;
    assertNoSecret(entry, `${path}.${key}`);
  }
}

function assertNoSourceIdentifier(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (UUID_IDENTIFIER.test(value)) {
      fail("SOURCE_IDENTIFIER_FORBIDDEN", path);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoSourceIdentifier(entry, `${path}[${index}]`),
    );
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.$resource === "string" || typeof value.$secret === "string") {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    assertNoSourceIdentifier(entry, `${path}.${key}`);
  }
}

function normalizedName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function subflowReaches(
  startId: string,
  targetId: string,
  catalog: readonly CatalogResource[],
  seen = new Set<string>(),
): boolean {
  if (startId === targetId) return true;
  if (seen.has(startId)) return false;
  seen.add(startId);
  const current = catalog.find(
    (resource) => resource.kind === "subflow" && resource.id === startId,
  );
  return (current?.dependencies ?? []).some((dependency) =>
    subflowReaches(dependency, targetId, catalog, seen),
  );
}

function resolveResource(
  requested: FlowCodeResource,
  allRequested: readonly FlowCodeResource[],
  catalog: readonly CatalogResource[],
  resolved: ReadonlyMap<string, CatalogResource>,
  manualId?: string,
): { resource?: CatalogResource; issue?: FlowCodeIssue } {
  const parentRequest = requested.parent_ref
    ? allRequested.find((resource) => resource.ref === requested.parent_ref)
    : undefined;
  if (requested.parent_ref && !parentRequest) {
    return {
      issue: {
        code: "RESOURCE_PARENT_MISSING",
        severity: "blocking",
        path: `resources.${requested.ref}.parent_ref`,
        message: `Parent resource "${requested.parent_ref}" is missing.`,
      },
    };
  }
  const resolvedParent = requested.parent_ref
    ? resolved.get(requested.parent_ref)
    : undefined;
  if (requested.parent_ref && !resolvedParent) {
    return {
      issue: {
        code: "RESOURCE_PARENT_UNRESOLVED",
        severity: "blocking",
        path: `resources.${requested.ref}.parent_ref`,
        message: `Parent resource "${requested.parent_ref}" is unresolved.`,
      },
    };
  }
  const requiresManualBinding = requested.ref.startsWith("legacy_manual_");
  const matches = catalog.filter((candidate) => {
    if (candidate.kind !== requested.kind) return false;
    if (
      !requiresManualBinding &&
      normalizedName(candidate.name) !== normalizedName(requested.name)
    ) {
      return false;
    }
    if (!resolvedParent) return true;
    return candidate.parentId === resolvedParent.id;
  });
  if (manualId) {
    const selected = matches.find((candidate) => candidate.id === manualId);
    if (selected) return { resource: selected };
    return {
      issue: {
        code: "RESOURCE_BINDING_INVALID",
        severity: "blocking",
        path: `resources.${requested.ref}`,
        message: `Manual binding for "${requested.name}" is not a valid candidate.`,
        candidates: matches.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
        })),
      },
    };
  }
  if (!requiresManualBinding && matches.length === 1) {
    return { resource: matches[0] };
  }
  return {
    issue: {
      code:
        matches.length === 0 ? "RESOURCE_MISSING" : "RESOURCE_AMBIGUOUS",
      severity: "blocking",
      path: `resources.${requested.ref}`,
      message:
        matches.length === 0
          ? `Resource "${requested.name}" is missing.`
          : `Resource "${requested.name}" is ambiguous.`,
      candidates: matches.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
      })),
    },
  };
}

function hydrateMarkers(
  value: unknown,
  resolved: ReadonlyMap<string, CatalogResource>,
  secrets: Readonly<Record<string, string>>,
  issues: FlowCodeIssue[],
  path: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      hydrateMarkers(entry, resolved, secrets, issues, `${path}[${index}]`),
    );
  }
  if (!isRecord(value)) return value;
  if (
    Object.keys(value).length === 1 &&
    typeof value.$resource === "string"
  ) {
    const resource = resolved.get(value.$resource);
    if (!resource) {
      issues.push({
        code: "RESOURCE_UNRESOLVED",
        severity: "blocking",
        path,
        message: `Resource "${value.$resource}" is unresolved.`,
      });
      return "";
    }
    return resource.runtimeValue ?? resource.id;
  }
  if (Object.keys(value).length === 1 && typeof value.$secret === "string") {
    const secret = secrets[value.$secret];
    if (!secret) {
      issues.push({
        code: "SECRET_REQUIRED",
        severity: "blocking",
        path,
        message: `Secret "${value.$secret}" must be bound.`,
      });
      return "";
    }
    return secret;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      hydrateMarkers(entry, resolved, secrets, issues, `${path}.${key}`),
    ]),
  );
}

export function compileFlowCode(
  document: FlowCodeDocument,
  catalog: FlowCodeCatalog,
  options: {
    secretBindings?: Readonly<Record<string, string>>;
    resourceBindings?: Readonly<Record<string, string>>;
    replacingFlowId?: string;
  } = {},
): { graph: FlowCodeGraph; issues: FlowCodeIssue[]; resolved: Record<string, string> } {
  const issues: FlowCodeIssue[] = [];
  const resolved = new Map<string, CatalogResource>();
  const available = toCatalog(catalog);
  const resourcesInDependencyOrder = [...document.resources].sort(
    (left, right) =>
      Number(Boolean(left.parent_ref)) - Number(Boolean(right.parent_ref)),
  );
  for (const resource of resourcesInDependencyOrder) {
    const result = resolveResource(
      resource,
      document.resources,
      available,
      resolved,
      options.resourceBindings?.[resource.ref],
    );
    if (result.resource) resolved.set(resource.ref, result.resource);
    if (result.issue) issues.push(result.issue);
  }
  const keys = new Set(document.nodes.map((node) => node.key));
  if (document.entry !== null && !keys.has(document.entry)) {
    issues.push({
      code: "ENTRY_NODE_MISSING",
      severity: "fatal",
      path: "entry",
      message: `Entry node "${document.entry}" does not exist.`,
    });
  }
  const graphNodes = document.nodes.map((node) => {
    const nodeType = canonicalNodeType(node.type);
    const descriptor = nodeType ? getNodeDescriptor(nodeType) : undefined;
    if (!descriptor || !descriptor.supportsFlowRuntime) {
      issues.push({
        code: "UNKNOWN_NODE_TYPE",
        severity: "fatal",
        path: `nodes.${node.key}.type`,
        message: `Node type "${node.type}" is unsupported.`,
      });
    }
    const allowed = new Set(descriptor?.portability.portableFields ?? []);
    try {
      assertPortableNodeConfig(
        node.type,
        node.config,
        `nodes.${node.key}.config`,
      );
    } catch (error) {
      issues.push({
        code:
          error instanceof FlowCodeError ? error.code : "INVALID_NODE_CONFIG",
        severity: "fatal",
        path: `nodes.${node.key}.config`,
        message:
          error instanceof Error ? error.message : "Node config is invalid.",
      });
    }
    const config: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.config)) {
      if (!allowed.has(key)) {
        issues.push({
          code: "UNKNOWN_CONFIG_FIELD",
          severity: "fatal",
          path: `nodes.${node.key}.config.${key}`,
          message: `Config field "${key}" was discarded.`,
        });
        continue;
      }
      config[key] = hydrateMarkers(
        value,
        resolved,
        options.secretBindings ?? {},
        issues,
        `nodes.${node.key}.config.${key}`,
      );
    }
    if (nodeType === "sub_flow") {
      const flowId = config.flow_id;
      const subflow = available.find(
        (resource) => resource.kind === "subflow" && resource.id === flowId,
      );
      if (subflow) {
        if (subflow.id === options.replacingFlowId) {
          issues.push({
            code: "SUBFLOW_SELF_REFERENCE",
            severity: "blocking",
            path: `nodes.${node.key}.config.flow_id`,
            message: "A flow cannot invoke itself.",
          });
        } else if (
          options.replacingFlowId &&
          subflowReaches(subflow.id, options.replacingFlowId, available)
        ) {
          issues.push({
            code: "SUBFLOW_CYCLE",
            severity: "blocking",
            path: `nodes.${node.key}.config.flow_id`,
            message: "This subflow dependency would create a cycle.",
          });
        }
        if (!subflow.publishedVersionId || !subflow.entryNodeKey) {
          issues.push({
            code: "SUBFLOW_NOT_PUBLISHED",
            severity: "blocking",
            path: `nodes.${node.key}.config.flow_id`,
            message: `Subflow "${subflow.name}" has no published version.`,
          });
        } else {
          config.flow_version_id = subflow.publishedVersionId;
          config.child_entry_node_key = subflow.entryNodeKey;
        }
      }
    }
    const result = descriptor?.flowConfigSchema.safeParse(config);
    if (descriptor && !result?.success) {
      const hasRuntimeTypeFailure = result?.error.issues.some(
        (issue) => issue.code === "invalid_type",
      );
      issues.push({
        code: "INVALID_NODE_CONFIG",
        severity: hasRuntimeTypeFailure ? "fatal" : "activation",
        path: `nodes.${node.key}.config`,
        message:
          result?.error.issues[0]?.message ?? "Node config is invalid.",
      });
    }
    return {
      node_key: node.key,
      node_type: nodeType ?? node.type,
      config,
      position_x: Math.round(node.position.x),
      position_y: Math.round(node.position.y),
    };
  });
  if (document.nodes.length === 0 && document.entry !== null) {
    issues.push({
      code: "EMPTY_DRAFT_ENTRY",
      severity: "fatal",
      path: "entry",
      message: "An empty draft cannot have an entry node.",
    });
  }
  return {
    graph: {
      name: document.name,
      description: document.description,
      trigger_type: document.trigger.type,
      trigger_config: structuredClone(document.trigger.config),
      entry_node_id: document.entry,
      fallback_policy: structuredClone(document.fallback),
      variable_schema: document.variables.map((variable) => ({
        key: variable.key,
        type: variable.type,
        ...(variable.required === undefined ? {} : { required: variable.required }),
        sensitive: variable.sensitive,
        ...(!variable.sensitive && variable.default !== undefined
          ? { default: structuredClone(variable.default) }
          : {}),
      })),
      nodes: graphNodes,
    },
    issues,
    resolved: Object.fromEntries(
      [...resolved].map(([ref, resource]) => [ref, resource.id]),
    ),
  };
}
