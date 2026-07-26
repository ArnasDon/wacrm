import { describe, expect, it } from "vitest";

import { FLOW_CODE_LIMITS } from "@/lib/flows/flow-code";
import { readFlowCodeRequest } from "./request";

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
});
