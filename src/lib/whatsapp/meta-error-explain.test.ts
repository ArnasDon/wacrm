import { describe, expect, it } from "vitest";
import {
  explainMetaError,
  metaErrorPayload,
  type MetaErrorLike,
} from "./meta-error-explain";

function metaErr(overrides: Partial<MetaErrorLike> & { message?: string } = {}): MetaErrorLike {
  return {
    message: "Meta said no",
    code: null,
    subcode: null,
    type: "OAuthException",
    fbtraceId: "AbCdEf123",
    httpStatus: 400,
    details: null,
    ...overrides,
  };
}

describe("explainMetaError — access token", () => {
  it("maps 190 to a regenerate-the-System-User-token instruction", () => {
    const x = explainMetaError(metaErr({ code: 190, message: "Invalid OAuth access token." }), "verify_number");
    expect(x.field).toBe("access_token");
    expect(x.side).toBe("user");
    expect(x.httpStatus).toBe(400);
    expect(x.summary).toMatch(/System Users/);
    expect(x.summary).toMatch(/whatsapp_business_management/);
    expect(x.code).toBe(190);
    expect(x.fbtraceId).toBe("AbCdEf123");
  });

  it("names expiry for 190/463", () => {
    const x = explainMetaError(metaErr({ code: 190, subcode: 463 }), "verify_number");
    expect(x.summary).toMatch(/expired/i);
    expect(x.subcode).toBe(463);
  });

  it("treats a code-less OAuthException as a token problem", () => {
    const x = explainMetaError(metaErr({ code: null, type: "OAuthException" }), "subscribe_waba");
    expect(x.field).toBe("access_token");
  });
});

describe("explainMetaError — permissions", () => {
  it.each([10, 200, 230, 299])("maps code %i to the missing-permission explanation", (code) => {
    const x = explainMetaError(metaErr({ code }), "subscribe_waba");
    expect(x.field).toBe("access_token");
    expect(x.side).toBe("user");
    expect(x.summary).toMatch(/whatsapp_business_management and whatsapp_business_messaging/);
    expect(x.summary).toMatch(/subscribing the WhatsApp Business Account/);
  });

  it("maps 131005 (access denied) to a System-User-assignment hint naming the id", () => {
    const x = explainMetaError(metaErr({ code: 131005 }), "verify_number", {
      phoneNumberId: "123456789",
    });
    expect(x.field).toBe("access_token");
    expect(x.summary).toMatch(/Phone Number ID 123456789/);
    expect(x.summary).toMatch(/Assign the System User/);
  });
});

describe("explainMetaError — wrong object ids", () => {
  const unsupported =
    "Unsupported get request. Object with ID '123' does not exist, cannot be loaded due to missing permissions, or does not support this operation";

  it("blames the Phone Number ID when verify_number hits (#100) Unsupported get request", () => {
    const x = explainMetaError(
      metaErr({ code: 100, subcode: 33, message: unsupported }),
      "verify_number",
      { phoneNumberId: "123" },
    );
    expect(x.field).toBe("phone_number_id");
    expect(x.side).toBe("user");
    expect(x.summary).toMatch(/cannot find Phone Number ID 123/);
    expect(x.summary).toMatch(/does not own it/);
  });

  it("blames the WABA ID when the WABA-scoped steps hit the same error", () => {
    for (const step of ["waba_phone_numbers", "subscribe_waba", "subscribed_apps"] as const) {
      const x = explainMetaError(metaErr({ code: 100, message: unsupported }), step, {
        wabaId: "9876",
      });
      expect(x.field).toBe("waba_id");
      expect(x.summary).toMatch(/WhatsApp Business Account ID 9876/);
    }
  });

  it("recognises the message pattern even without subcode 33", () => {
    const x = explainMetaError(
      metaErr({ code: 100, message: "Unsupported post request. Object with ID '1' does not exist" }),
      "subscribe_waba",
    );
    expect(x.field).toBe("waba_id");
    expect(x.summary).toMatch(/cannot find the WhatsApp Business Account ID/);
  });

  it("maps a bare code 33 the same way", () => {
    const x = explainMetaError(metaErr({ code: 33 }), "verify_number");
    expect(x.field).toBe("phone_number_id");
  });

  it("maps other 100 param errors to a copy-it-exactly hint and keeps Meta's text", () => {
    const x = explainMetaError(
      metaErr({ code: 100, message: "(#100) Invalid parameter" }),
      "verify_number",
    );
    expect(x.field).toBe("phone_number_id");
    expect(x.summary).toMatch(/\(#100\) Invalid parameter/);
    expect(x.summary).toMatch(/digits only/);
  });

  it("points a 100 PIN param error at the PIN field during register", () => {
    const x = explainMetaError(
      metaErr({ code: 100, message: "(#100) The parameter pin is required" }),
      "register",
    );
    expect(x.field).toBe("pin");
  });
});

describe("explainMetaError — registration and PIN", () => {
  it("133010 → number not registered → needs PIN + /register", () => {
    const x = explainMetaError(metaErr({ code: 133010 }), "verify_number");
    expect(x.field).toBe("pin");
    expect(x.side).toBe("user");
    expect(x.summary).toMatch(/\/register/);
  });

  it.each([133005, 136025])("%i → wrong PIN", (code) => {
    const x = explainMetaError(metaErr({ code }), "register");
    expect(x.field).toBe("pin");
    expect(x.side).toBe("user");
    expect(x.summary).toMatch(/PIN is wrong/);
  });

  it("133008 → too many PIN guesses is a wait, not a form fix", () => {
    const x = explainMetaError(metaErr({ code: 133008 }), "register");
    expect(x.field).toBe("pin");
    expect(x.side).toBe("meta");
    expect(x.httpStatus).toBe(502);
  });
});

describe("explainMetaError — account state and throttling", () => {
  it("131031 → account restricted, Meta side, nothing to fix in wacrm", () => {
    const x = explainMetaError(metaErr({ code: 131031 }), "verify_number");
    expect(x.field).toBe("meta_account");
    expect(x.side).toBe("meta");
    expect(x.summary).toMatch(/restricted or locked/);
  });

  it.each([4, 80007, 130429])("%i → rate limit, retry later", (code) => {
    const x = explainMetaError(metaErr({ code }), "verify_number");
    expect(x.field).toBeNull();
    expect(x.side).toBe("meta");
    expect(x.summary).toMatch(/rate-limiting/);
  });

  it("131000 → temporary Meta-side failure with the code named", () => {
    const x = explainMetaError(metaErr({ code: 131000 }), "subscribe_waba");
    expect(x.side).toBe("meta");
    expect(x.summary).toMatch(/code 131000/);
  });
});

describe("explainMetaError — fallbacks", () => {
  it("keeps Meta's message, details, code and trace id for unknown codes", () => {
    const x = explainMetaError(
      metaErr({
        code: 999999,
        subcode: 7,
        message: "Something odd",
        details: "more detail",
        fbtraceId: "TRACE1",
      }),
      "register",
    );
    expect(x.side).toBe("meta");
    expect(x.httpStatus).toBe(502);
    expect(x.summary).toMatch(/registering the phone number/);
    expect(x.summary).toMatch(/code 999999\/7/);
    expect(x.summary).toMatch(/Something odd \(more detail\)/);
    expect(x.summary).toMatch(/Trace id TRACE1/);
    expect(x.metaMessage).toBe("Something odd (more detail)");
  });

  it("explains a plain network Error as a Meta-side reachability problem", () => {
    const x = explainMetaError(new TypeError("fetch failed"), "verify_number");
    expect(x.side).toBe("meta");
    expect(x.code).toBeNull();
    expect(x.fbtraceId).toBeNull();
    expect(x.summary).toMatch(/Could not reach the Meta Graph API/);
    expect(x.summary).toMatch(/fetch failed/);
  });

  it("handles a non-Error throw", () => {
    const x = explainMetaError("boom", "register");
    expect(x.metaMessage).toBe("boom");
    expect(x.step).toBe("register");
  });
});

describe("metaErrorPayload", () => {
  it("emits the wire shape the config route returns", () => {
    const x = explainMetaError(
      metaErr({ code: 190, subcode: 463, fbtraceId: "T", message: "expired" }),
      "verify_number",
    );
    expect(metaErrorPayload(x)).toEqual({
      code: 190,
      subcode: 463,
      fbtrace_id: "T",
      step: "verify_number",
      field: "access_token",
      message: "expired",
    });
  });
});
