import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseAppSecrets,
  verifyMetaWebhookSignature,
} from "./webhook-signature";

const SECRET = process.env.META_APP_SECRET!;

function signedHeader(body: string, secret: string = SECRET): string {
  const hex = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${hex}`;
}

describe("verifyMetaWebhookSignature", () => {
  it("accepts a request signed with the correct secret", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account" });
    expect(verifyMetaWebhookSignature(body, signedHeader(body))).toBe(true);
  });

  it("rejects a signature computed with a different secret", () => {
    const body = "{}";
    expect(verifyMetaWebhookSignature(body, signedHeader(body, "wrong"))).toBe(
      false,
    );
  });

  it("rejects when the body has been tampered with after signing", () => {
    const original = '{"entry":[]}';
    const header = signedHeader(original);
    const tampered = '{"entry":[{"id":"injected"}]}';
    expect(verifyMetaWebhookSignature(tampered, header)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyMetaWebhookSignature("anything", null)).toBe(false);
  });

  it("rejects a header without the sha256= prefix", () => {
    const body = "{}";
    const hex = crypto
      .createHmac("sha256", SECRET)
      .update(body)
      .digest("hex");
    expect(verifyMetaWebhookSignature(body, hex)).toBe(false);
    expect(verifyMetaWebhookSignature(body, `sha512=${hex}`)).toBe(false);
  });

  it("rejects a header of the wrong length without throwing", () => {
    // timingSafeEqual would throw on length mismatch — the guard inside
    // the verifier should catch this and return false instead.
    expect(verifyMetaWebhookSignature("{}", "sha256=tooshort")).toBe(false);
  });

  describe("several comma-separated secrets (issue #500)", () => {
    const originalSecret = process.env.META_APP_SECRET;
    const SECOND = "second-app-secret";
    const THIRD = "third-app-secret";
    beforeEach(() => {
      // Deliberately messy: stray spaces and an empty slot, which an
      // operator editing a hosting panel's env field will produce.
      process.env.META_APP_SECRET = ` ${SECRET} , ${SECOND},,${THIRD} `;
    });
    afterEach(() => {
      process.env.META_APP_SECRET = originalSecret;
    });

    it("accepts a request signed by any configured app", () => {
      const body = '{"entry":[{"id":"waba-under-app-2"}]}';
      expect(verifyMetaWebhookSignature(body, signedHeader(body, SECRET))).toBe(true);
      expect(verifyMetaWebhookSignature(body, signedHeader(body, SECOND))).toBe(true);
      expect(verifyMetaWebhookSignature(body, signedHeader(body, THIRD))).toBe(true);
    });

    it("still rejects a signature from an app that is not configured", () => {
      const body = "{}";
      expect(
        verifyMetaWebhookSignature(body, signedHeader(body, "some-fourth-app")),
      ).toBe(false);
    });

    it("does not treat the empty slot between commas as a valid secret", () => {
      const body = "{}";
      expect(verifyMetaWebhookSignature(body, signedHeader(body, ""))).toBe(false);
    });

    it("rejects tampering regardless of which app signed", () => {
      const header = signedHeader('{"a":1}', SECOND);
      expect(verifyMetaWebhookSignature('{"a":2}', header)).toBe(false);
    });
  });

  describe("parseAppSecrets", () => {
    it("splits on commas, trims, and drops empties", () => {
      expect(parseAppSecrets(" a , b,,c ,")).toEqual(["a", "b", "c"]);
    });

    it("returns a single secret unchanged", () => {
      expect(parseAppSecrets("only-one")).toEqual(["only-one"]);
    });

    it("returns nothing for unset, empty, or comma-only values", () => {
      expect(parseAppSecrets(undefined)).toEqual([]);
      expect(parseAppSecrets("")).toEqual([]);
      expect(parseAppSecrets(" , ,")).toEqual([]);
    });
  });

  describe("fail-closed when secret is missing", () => {
    const originalSecret = process.env.META_APP_SECRET;
    beforeEach(() => {
      delete process.env.META_APP_SECRET;
    });
    afterEach(() => {
      process.env.META_APP_SECRET = originalSecret;
    });

    it("rejects even a correctly-formed signature when no secret is configured", () => {
      const body = "{}";
      // Use the original secret to produce the header so we can verify
      // the rejection is solely due to missing config.
      const header = signedHeader(body, originalSecret!);
      expect(verifyMetaWebhookSignature(body, header)).toBe(false);
    });

    it("treats a value of only commas and spaces as not configured", () => {
      process.env.META_APP_SECRET = " , ";
      const body = "{}";
      expect(verifyMetaWebhookSignature(body, signedHeader(body, " , "))).toBe(false);
      expect(verifyMetaWebhookSignature(body, signedHeader(body, ""))).toBe(false);
    });
  });
});
