import { describe, expect, it } from "vitest";

import { FLOW_CODE_LIMITS } from "@/lib/flows/flow-code";
import { readFlowCodeRequest } from "./request";

async function multipartRequest(form: FormData, declaredLength?: number) {
  const encoded = new Request("http://localhost/api/flows/import", {
    method: "POST",
    body: form,
  });
  const contentType = encoded.headers.get("content-type")!;
  const body = await encoded.arrayBuffer();
  return new Request("http://localhost/api/flows/import", {
    method: "POST",
    headers: {
      "content-type": contentType,
      "content-length": String(declaredLength ?? body.byteLength),
    },
    body,
  });
}

describe("flow code API request reader", () => {
  it("requires preview digest and replace CAS without accepting extra fields", async () => {
    const missingDigest = await readFlowCodeRequest(
      new Request("http://localhost/api/flows/import", {
        method: "POST",
        body: JSON.stringify({ document: "{}" }),
      }),
      "create",
    );
    const missingRevision = await readFlowCodeRequest(
      new Request("http://localhost/api/flows/id/import", {
        method: "POST",
        body: JSON.stringify({
          document: "{}",
          preview_digest: "a".repeat(64),
        }),
      }),
      "replace",
    );
    const extra = await readFlowCodeRequest(
      new Request("http://localhost/api/flows/import/preview", {
        method: "POST",
        body: JSON.stringify({ document: "{}", secret_bindings: {} }),
      }),
      "preview",
    );

    expect(missingDigest).toMatchObject({
      ok: false,
      code: "PREVIEW_DIGEST_REQUIRED",
    });
    expect(missingRevision).toMatchObject({
      ok: false,
      code: "DRAFT_REVISION_REQUIRED",
    });
    expect(extra).toMatchObject({
      ok: false,
      code: "INVALID_IMPORT_REQUEST",
    });
  });

  it("rejects oversized bodies before parsing", async () => {
    const response = await readFlowCodeRequest(
      new Request("http://localhost/api/flows/import/preview", {
        method: "POST",
        headers: {
          "content-length": String(FLOW_CODE_LIMITS.maxBytes + 40_000),
        },
        body: "{}",
      }),
      "preview",
    );

    expect(response).toMatchObject({
      ok: false,
      status: 413,
      code: "DOCUMENT_TOO_LARGE",
    });
  });

  it("reads bounded secret bindings only from the same multipart commit", async () => {
    const form = new FormData();
    form.set("document", "{}");
    form.set("preview_digest", "a".repeat(64));
    form.set("resource_bindings", "{}");
    form.set("secret:request.headers.Authorization", "Bearer sk-private-value");
    const result = await readFlowCodeRequest(
      new Request("http://localhost/api/flows/import", {
        method: "POST",
        headers: { "content-length": "1024" },
        body: form,
      }),
      "create",
    );

    expect(result).toMatchObject({
      ok: true,
      secretBindings: {
        "request.headers.Authorization": "Bearer sk-private-value",
      },
    });
  });

  it("requires a bounded content length before parsing multipart secrets", async () => {
    const form = new FormData();
    form.set("document", "{}");
    form.set("preview_digest", "a".repeat(64));
    const missing = await readFlowCodeRequest(
      new Request("http://localhost/api/flows/import", {
        method: "POST",
        body: form,
      }),
      "create",
    );
    const oversized = await readFlowCodeRequest(
      new Request("http://localhost/api/flows/import", {
        method: "POST",
        headers: {
          "content-length": String(
            FLOW_CODE_LIMITS.maxBytes * 2 + 64 * 1024 + 1,
          ),
        },
        body: form,
      }),
      "create",
    );

    expect(missing).toMatchObject({
      ok: false,
      status: 411,
      code: "CONTENT_LENGTH_REQUIRED",
    });
    expect(oversized).toMatchObject({
      ok: false,
      status: 413,
      code: "DOCUMENT_TOO_LARGE",
    });
  });

  it("allows a max-sized document plus reasonable multipart overhead", async () => {
    const form = new FormData();
    form.set("document", "x".repeat(FLOW_CODE_LIMITS.maxBytes));
    form.set("preview_digest", "a".repeat(64));
    form.set("resource_bindings", "{}");
    const request = await multipartRequest(form);

    expect(Number(request.headers.get("content-length"))).toBeGreaterThan(
      FLOW_CODE_LIMITS.maxBytes,
    );
    const result = await readFlowCodeRequest(request, "create");

    expect(result).toMatchObject({
      ok: true,
      previewDigest: "a".repeat(64),
    });
    if (result.ok) {
      expect(new TextEncoder().encode(result.document).byteLength).toBe(
        FLOW_CODE_LIMITS.maxBytes,
      );
    }
  });

  it("rejects only the document field when it exceeds maxBytes", async () => {
    const form = new FormData();
    form.set("document", "x".repeat(FLOW_CODE_LIMITS.maxBytes + 1));
    form.set("preview_digest", "a".repeat(64));
    const result = await readFlowCodeRequest(
      await multipartRequest(form),
      "create",
    );

    expect(result).toMatchObject({
      ok: false,
      status: 413,
      code: "DOCUMENT_TOO_LARGE",
    });
  });

  it("caps aggregate secret binding bytes at one MiB", async () => {
    const formAtLimit = new FormData();
    formAtLimit.set("document", "{}");
    formAtLimit.set("preview_digest", "a".repeat(64));
    for (let index = 0; index < 64; index += 1) {
      formAtLimit.set(`secret:s_${index}`, "x".repeat(16 * 1024));
    }
    const accepted = await readFlowCodeRequest(
      await multipartRequest(formAtLimit),
      "create",
    );

    const formOverLimit = new FormData();
    formOverLimit.set("document", "{}");
    formOverLimit.set("preview_digest", "a".repeat(64));
    for (let index = 0; index < 65; index += 1) {
      formOverLimit.set(`secret:s_${index}`, "x".repeat(16 * 1024));
    }
    const rejected = await readFlowCodeRequest(
      await multipartRequest(formOverLimit),
      "create",
    );

    expect(accepted).toMatchObject({ ok: true });
    expect(rejected).toMatchObject({
      ok: false,
      status: 400,
      code: "INVALID_SECRET_BINDINGS",
    });
  });

  it("allows all bounded fields together with multipart framing", async () => {
    const form = new FormData();
    form.set("document", "x".repeat(FLOW_CODE_LIMITS.maxBytes));
    form.set("preview_digest", "a".repeat(64));
    form.set("resource_bindings", "{}");
    const secretBytes = FLOW_CODE_LIMITS.maxBytes;
    const baseValueBytes = Math.floor(secretBytes / 100);
    const remainder = secretBytes % 100;
    for (let index = 0; index < 100; index += 1) {
      const name = `s_${index}_${"n".repeat(240)}`;
      form.set(
        `secret:${name}`,
        "x".repeat(baseValueBytes + (index < remainder ? 1 : 0)),
      );
    }

    const result = await readFlowCodeRequest(
      await multipartRequest(form),
      "create",
    );

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(Object.keys(result.secretBindings)).toHaveLength(100);
    }
  });

  it("enforces the multipart hard cap when content-length is understated", async () => {
    const form = new FormData();
    form.set("document", "{}");
    form.set(
      "padding",
      "x".repeat(FLOW_CODE_LIMITS.maxBytes * 2 + 64 * 1024),
    );

    const result = await readFlowCodeRequest(
      await multipartRequest(form, 1),
      "create",
    );

    expect(result).toMatchObject({
      ok: false,
      status: 413,
      code: "DOCUMENT_TOO_LARGE",
    });
  });
});
