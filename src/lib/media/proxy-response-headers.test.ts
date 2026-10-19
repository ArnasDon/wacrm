import { describe, it, expect } from "vitest";
import {
  baseMimeType,
  isInlineSafeMimeType,
  mediaProxyHeaders,
} from "./proxy-response-headers";

describe("baseMimeType", () => {
  it("strips parameters and lowercases", () => {
    expect(baseMimeType("Audio/OGG; codecs=opus")).toBe("audio/ogg");
  });

  it("rejects missing or malformed types", () => {
    expect(baseMimeType(null)).toBeNull();
    expect(baseMimeType("")).toBeNull();
    expect(baseMimeType("not a mime")).toBeNull();
    expect(baseMimeType("text/html\r\nSet-Cookie: x=1")).toBeNull();
  });
});

describe("isInlineSafeMimeType", () => {
  it.each(["image/jpeg", "image/png", "image/webp", "audio/ogg", "video/mp4"])(
    "allows %s",
    (type) => {
      expect(isInlineSafeMimeType(type)).toBe(true);
    },
  );

  it.each([
    "image/svg+xml",
    "text/html",
    "application/xhtml+xml",
    "text/xml",
    "application/xml",
    "application/pdf",
    "application/javascript",
    "application/octet-stream",
  ])("refuses %s", (type) => {
    expect(isInlineSafeMimeType(type)).toBe(false);
  });
});

describe("mediaProxyHeaders", () => {
  it("serves a photo inline", () => {
    const headers = mediaProxyHeaders("123", "image/jpeg");
    expect(headers["Content-Type"]).toBe("image/jpeg");
    expect(headers["Content-Disposition"]).toBe("inline");
  });

  it("forces an HTML document to download", () => {
    const headers = mediaProxyHeaders("123", "text/html; charset=utf-8");
    expect(headers["Content-Type"]).toBe("text/html");
    expect(headers["Content-Disposition"]).toBe("attachment");
  });

  it("forces an SVG to download", () => {
    expect(mediaProxyHeaders("123", "image/svg+xml")["Content-Disposition"]).toBe(
      "attachment",
    );
  });

  it("names a known document type after the media id", () => {
    expect(mediaProxyHeaders("987", "application/pdf")["Content-Disposition"]).toBe(
      'attachment; filename="987.pdf"',
    );
  });

  it("omits the filename when the media id is not a plain token", () => {
    expect(
      mediaProxyHeaders('9"; x=', "application/pdf")["Content-Disposition"],
    ).toBe("attachment");
  });

  it("falls back to octet-stream for a malformed type", () => {
    const headers = mediaProxyHeaders("1", "garbage");
    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect(headers["Content-Disposition"]).toBe("attachment");
  });

  it("always sends the hardening and private cache headers", () => {
    for (const type of ["image/png", "text/html", undefined]) {
      const headers = mediaProxyHeaders("1", type);
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["Content-Security-Policy"]).toBe("default-src 'none'; sandbox");
      expect(headers["Cache-Control"]).toBe("private, max-age=86400");
    }
  });
});
