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
      secretBindings: Record<string, string>;
    }
  | { ok: false; status: number; code: string }
> {
  const contentType = request.headers.get("content-type") ?? "";
  const isMultipart = contentType.toLowerCase().startsWith("multipart/form-data");
  const contentLength = request.headers.get("content-length");
  if (isMultipart && (!contentLength || !/^\d+$/.test(contentLength))) {
    return { ok: false, status: 411, code: "CONTENT_LENGTH_REQUIRED" };
  }
  const declared = Number(contentLength);
  if (
    Number.isFinite(declared) &&
    declared >
      (isMultipart
        ? FLOW_CODE_LIMITS.maxBytes
        : FLOW_CODE_LIMITS.maxBytes + REQUEST_OVERHEAD_BYTES)
  ) {
    return { ok: false, status: 413, code: "DOCUMENT_TOO_LARGE" };
  }
  const secretBindings: Record<string, string> = {};
  let value: unknown;
  if (isMultipart) {
    if (mode === "preview") {
      return { ok: false, status: 400, code: "INVALID_IMPORT_REQUEST" };
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return { ok: false, status: 400, code: "INVALID_IMPORT_REQUEST" };
    }
    const body: Record<string, unknown> = {};
    for (const [key, entry] of form.entries()) {
      if (typeof entry !== "string") {
        return { ok: false, status: 400, code: "INVALID_IMPORT_REQUEST" };
      }
      if (key.startsWith("secret:")) {
        const name = key.slice("secret:".length);
        if (
          name in secretBindings ||
          !/^[a-zA-Z_][a-zA-Z0-9_.:-]{0,255}$/.test(name) ||
          !entry ||
          entry.length > 16_384 ||
          Object.keys(secretBindings).length >=
            FLOW_CODE_LIMITS.maxSecretRequirements
        ) {
          return { ok: false, status: 400, code: "INVALID_SECRET_BINDINGS" };
        }
        secretBindings[name] = entry;
        continue;
      }
      if (key in body) {
        return { ok: false, status: 400, code: "INVALID_IMPORT_REQUEST" };
      }
      if (key === "resource_bindings") {
        try {
          body.resource_bindings = JSON.parse(entry);
        } catch {
          return { ok: false, status: 400, code: "INVALID_RESOURCE_BINDINGS" };
        }
      } else if (key === "expected_draft_revision") {
        body.expected_draft_revision = Number(entry);
      } else {
        body[key] = entry;
      }
    }
    value = body;
  } else {
    const raw = await request.text();
    if (
      new TextEncoder().encode(raw).byteLength >
      FLOW_CODE_LIMITS.maxBytes + REQUEST_OVERHEAD_BYTES
    ) {
      return { ok: false, status: 413, code: "DOCUMENT_TOO_LARGE" };
    }
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, status: 400, code: "INVALID_REQUEST_JSON" };
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, status: 400, code: "INVALID_IMPORT_REQUEST" };
  }
  const body = value as Record<string, unknown>;
  const allowed =
    mode === "preview"
      ? ["document", "resource_bindings"]
      : mode === "create"
        ? ["document", "preview_digest", "resource_bindings"]
        : [
            "document",
            "preview_digest",
            "expected_draft_revision",
            "resource_bindings",
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
    secretBindings,
    ...(mode === "preview"
      ? {}
      : { previewDigest: body.preview_digest as string }),
    ...(mode === "replace"
      ? { expectedDraftRevision: body.expected_draft_revision as number }
      : {}),
  };
}
