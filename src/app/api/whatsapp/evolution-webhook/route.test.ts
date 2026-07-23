import { describe, expect, it } from "vitest";

import { safeEqual, jidToPhone, parseContent } from "./route";

describe("safeEqual", () => {
  it("returns true for identical strings", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
  });

  it("returns false for different same-length strings", () => {
    expect(safeEqual("abc123", "abc124")).toBe(false);
  });

  it("returns false for different-length strings without throwing", () => {
    expect(safeEqual("short", "a-much-longer-secret")).toBe(false);
  });

  it("returns false when either side is empty", () => {
    expect(safeEqual("", "x")).toBe(false);
    expect(safeEqual("x", "")).toBe(false);
  });
});

describe("jidToPhone", () => {
  it("extracts an E.164 phone from a user JID", () => {
    expect(jidToPhone("5547999998888@s.whatsapp.net")).toBe("+5547999998888");
  });

  it("strips a device suffix (:12)", () => {
    expect(jidToPhone("5547999998888:12@s.whatsapp.net")).toBe(
      "+5547999998888",
    );
  });

  it("returns null for group JIDs", () => {
    expect(jidToPhone("120363000000000000@g.us")).toBeNull();
  });

  it("returns null for broadcast / status JIDs", () => {
    expect(jidToPhone("status@broadcast")).toBeNull();
    expect(jidToPhone("123@broadcast")).toBeNull();
  });

  it("returns null for undefined or empty input", () => {
    expect(jidToPhone(undefined)).toBeNull();
    expect(jidToPhone("")).toBeNull();
  });
});

describe("parseContent", () => {
  it("reads a plain text conversation", () => {
    expect(parseContent({ message: { conversation: "oi" } })).toEqual({
      contentType: "text",
      contentText: "oi",
    });
  });

  it("reads an extended text message (with link preview / reply)", () => {
    expect(
      parseContent({ message: { extendedTextMessage: { text: "hey" } } }),
    ).toEqual({ contentType: "text", contentText: "hey" });
  });

  it("uses the image caption when present, else a placeholder", () => {
    expect(
      parseContent({ message: { imageMessage: { caption: "veja" } } }),
    ).toEqual({ contentType: "image", contentText: "veja" });
    expect(parseContent({ message: { imageMessage: {} } })).toEqual({
      contentType: "image",
      contentText: "[image]",
    });
  });

  it("falls back to fileName for documents without a caption", () => {
    expect(
      parseContent({ message: { documentMessage: { fileName: "nf.pdf" } } }),
    ).toEqual({ contentType: "document", contentText: "nf.pdf" });
  });

  it("records audio as a placeholder", () => {
    expect(parseContent({ message: { audioMessage: {} } })).toEqual({
      contentType: "audio",
      contentText: "[audio]",
    });
  });

  it("handles an unknown/empty message shape without throwing", () => {
    expect(parseContent({})).toEqual({
      contentType: "text",
      contentText: "[unsupported message]",
    });
  });
});
