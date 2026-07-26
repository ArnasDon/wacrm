import { FLOW_CODE_LIMITS } from "@/lib/flows/flow-code";

const REQUEST_OVERHEAD_BYTES = 32 * 1024;

export async function readFlowCodeRequest(
  request: Request,
  mode: "preview" | "create" | "replace",
): Promise<
  | {
      ok: true;
      document: string;
      previewDigest?: string;
      expectedDraftRevision?: number;
      resourceBindings: Record<string, string>;
      bindingToken?: string;
    }
  | { ok: false; status: number; code: string }
> {
  const declared = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declared) &&
    declared > FLOW_CODE_LIMITS.maxBytes + REQUEST_OVERHEAD_BYTES
  ) {
    return { ok: false, status: 413, code: "DOCUMENT_TOO_LARGE" };
  }
  const raw = await request.text();
  if (
    new TextEncoder().encode(raw).byteLength >
    FLOW_CODE_LIMITS.maxBytes + REQUEST_OVERHEAD_BYTES
  ) {
    return { ok: false, status: 413, code: "DOCUMENT_TOO_LARGE" };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, code: "INVALID_REQUEST_JSON" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, status: 400, code: "INVALID_IMPORT_REQUEST" };
  }
  const body = value as Record<string, unknown>;
  const allowed =
    mode === "preview"
      ? ["document", "resource_bindings"]
      : mode === "create"
        ? [
            "document",
            "preview_digest",
            "resource_bindings",
            "binding_token",
          ]
        : [
            "document",
            "preview_digest",
            "expected_draft_revision",
            "resource_bindings",
            "binding_token",
          ];
  if (
    Object.keys(body).some((key) => !allowed.includes(key)) ||
    typeof body.document !== "string"
  ) {
    return { ok: false, status: 400, code: "INVALID_IMPORT_REQUEST" };
  }
  const resourceBindings =
    body.resource_bindings === undefined
      ? {}
      : body.resource_bindings &&
          typeof body.resource_bindings === "object" &&
          !Array.isArray(body.resource_bindings) &&
          Object.keys(body.resource_bindings).length <= 500 &&
          Object.values(body.resource_bindings).every(
            (value) => typeof value === "string" && value.length <= 128,
          )
        ? (body.resource_bindings as Record<string, string>)
        : null;
  if (!resourceBindings) {
    return { ok: false, status: 400, code: "INVALID_RESOURCE_BINDINGS" };
  }
  if (
    body.binding_token !== undefined &&
    (typeof body.binding_token !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(body.binding_token))
  ) {
    return { ok: false, status: 400, code: "INVALID_BINDING_TOKEN" };
  }
  if (
    mode !== "preview" &&
    (typeof body.preview_digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(body.preview_digest))
  ) {
    return { ok: false, status: 428, code: "PREVIEW_DIGEST_REQUIRED" };
  }
  if (
    mode === "replace" &&
    (!Number.isSafeInteger(body.expected_draft_revision) ||
      Number(body.expected_draft_revision) < 0)
  ) {
    return { ok: false, status: 428, code: "DRAFT_REVISION_REQUIRED" };
  }
  return {
    ok: true,
    document: body.document,
    resourceBindings,
    ...(typeof body.binding_token === "string"
      ? { bindingToken: body.binding_token }
      : {}),
    ...(mode === "preview"
      ? {}
      : { previewDigest: body.preview_digest as string }),
    ...(mode === "replace"
      ? { expectedDraftRevision: body.expected_draft_revision as number }
      : {}),
  };
}
