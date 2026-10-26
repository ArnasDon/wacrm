import { describe, expect, it } from "vitest";
import {
  appSubscriptionState,
  describeWabaPhoneMismatch,
  isNumericMetaId,
  phoneNumberBelongsToWaba,
} from "./waba-pairing";

describe("isNumericMetaId", () => {
  it("accepts digit strings", () => {
    expect(isNumericMetaId("123456789012345")).toBe(true);
    expect(isNumericMetaId("1")).toBe(true);
  });

  it("rejects phone numbers, whitespace, names and non-strings", () => {
    expect(isNumericMetaId("+15551234567")).toBe(false);
    expect(isNumericMetaId(" 123")).toBe(false);
    expect(isNumericMetaId("123 456")).toBe(false);
    expect(isNumericMetaId("my-waba")).toBe(false);
    expect(isNumericMetaId("")).toBe(false);
    expect(isNumericMetaId(123)).toBe(false);
    expect(isNumericMetaId(null)).toBe(false);
    expect(isNumericMetaId(undefined)).toBe(false);
  });
});

describe("phoneNumberBelongsToWaba", () => {
  const numbers = [
    { id: "111", display_phone_number: "+1 555-0100" },
    { id: "222", display_phone_number: "+1 555-0200" },
  ];

  it("finds a listed id", () => {
    expect(phoneNumberBelongsToWaba(numbers, "222")).toBe(true);
  });

  it("rejects an unlisted id and an empty list", () => {
    expect(phoneNumberBelongsToWaba(numbers, "333")).toBe(false);
    expect(phoneNumberBelongsToWaba([], "111")).toBe(false);
  });
});

describe("describeWabaPhoneMismatch", () => {
  it("names both ids and lists the WABA's numbers", () => {
    const text = describeWabaPhoneMismatch(
      [{ id: "111", display_phone_number: "+1 555-0100" }, { id: "222" }],
      "333",
      "999",
    );
    expect(text).toMatch(/Phone Number ID 333 does not belong to WhatsApp Business Account 999/);
    expect(text).toMatch(/\+1 555-0100 \(111\), 222/);
    expect(text).toMatch(/API Setup/);
  });

  it("says so when the WABA has no numbers at all", () => {
    expect(describeWabaPhoneMismatch([], "333", "999")).toMatch(/lists no phone numbers/);
  });

  it("caps the listing at five and counts the rest", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: String(i) }));
    const text = describeWabaPhoneMismatch(many, "x", "y");
    expect(text).toMatch(/0, 1, 2, 3, 4 and 3 more/);
  });
});

describe("appSubscriptionState", () => {
  const subs = [
    { whatsapp_business_api_data: { id: "app-1", name: "wacrm" } },
    { whatsapp_business_api_data: { id: "app-2", name: "other" } },
  ];

  it("reports subscribed + match when META_APP_ID is listed", () => {
    expect(appSubscriptionState(subs, "app-1")).toEqual({ subscribed: true, appIdMatch: true });
  });

  it("reports subscribed but no match when a different app holds the WABA", () => {
    expect(appSubscriptionState(subs, "app-9")).toEqual({ subscribed: true, appIdMatch: false });
  });

  it("leaves the match unknown when META_APP_ID is not configured", () => {
    expect(appSubscriptionState(subs, undefined)).toEqual({ subscribed: true, appIdMatch: null });
    expect(appSubscriptionState(subs, "  ")).toEqual({ subscribed: true, appIdMatch: null });
  });

  it("reports not subscribed for an empty list", () => {
    expect(appSubscriptionState([], "app-1")).toEqual({ subscribed: false, appIdMatch: false });
  });

  it("ignores entries without an app id", () => {
    expect(appSubscriptionState([{}], "app-1")).toEqual({ subscribed: true, appIdMatch: false });
  });
});
