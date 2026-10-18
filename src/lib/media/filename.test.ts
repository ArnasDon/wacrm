import { describe, it, expect } from "vitest";
import {
  basenameFromUrl,
  extensionForMime,
  mediaFilename,
  sanitizeFilename,
} from "./filename";

const AT = "2026-08-04T14:15:30.000Z";

/**
 * A media message row carries no filename and no MIME type, so the name a
 * download lands under is reconstructed. These pin the three sources and,
 * more importantly, the sanitisation — the document filename comes straight
 * from whatever the customer's phone sent.
 */
describe("extensionForMime", () => {
  it("maps the bucket's allow-list and inbound-only types", () => {
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("image/webp")).toBe("webp");
    expect(extensionForMime("video/3gpp")).toBe("3gp");
    expect(extensionForMime("audio/ogg")).toBe("ogg");
    expect(extensionForMime("application/pdf")).toBe("pdf");
    expect(
      extensionForMime(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe("xlsx");
  });

  it("ignores parameters and case", () => {
    expect(extensionForMime("IMAGE/JPEG; charset=binary")).toBe("jpg");
  });

  it("falls back to bin for unknown or missing types", () => {
    expect(extensionForMime("application/x-nonsense")).toBe("bin");
    expect(extensionForMime(undefined)).toBe("bin");
    expect(extensionForMime(null)).toBe("bin");
    expect(extensionForMime("")).toBe("bin");
  });
});

describe("sanitizeFilename", () => {
  it("keeps only the last path segment", () => {
    expect(sanitizeFilename("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(sanitizeFilename("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
  });

  it("strips control characters and replaces reserved ones", () => {
    expect(sanitizeFilename("in\u0000voi\u001fce.pdf")).toBe("invoice.pdf");
    expect(sanitizeFilename('quote:"final"?.pdf')).toBe("quote__final__.pdf");
  });

  it("refuses to produce a dotfile or a bare dot", () => {
    expect(sanitizeFilename(".hidden")).toBe("hidden");
    expect(sanitizeFilename("..")).toBe("");
    expect(sanitizeFilename("   ")).toBe("");
  });

  it("truncates the stem but never the extension", () => {
    const long = `${"a".repeat(200)}.pdf`;
    const out = sanitizeFilename(long);
    expect(out.length).toBe(80);
    expect(out.endsWith(".pdf")).toBe(true);
  });
});

describe("basenameFromUrl", () => {
  it("drops the epoch-ms prefix buildMediaPath adds", () => {
    expect(
      basenameFromUrl(
        "https://x.supabase.co/storage/v1/object/public/chat-media/account-abc/1770000000000-invoice.pdf",
      ),
    ).toBe("invoice.pdf");
  });

  it("ignores query strings and percent-decodes", () => {
    expect(
      basenameFromUrl(
        "https://x.supabase.co/storage/v1/object/public/chat-media/account-abc/1770000000000-my%20photo.jpg?token=1",
      ),
    ).toBe("my photo.jpg");
  });

  it("returns nothing for a proxy URL, whose last segment is a Meta id", () => {
    expect(basenameFromUrl("/api/whatsapp/media/1234567890123456")).toBe("");
  });

  it("returns nothing when the last segment has no extension", () => {
    expect(basenameFromUrl("https://example.com/files/report")).toBe("");
  });
});

describe("mediaFilename", () => {
  it("uses a document's own filename when content_text is one", () => {
    expect(
      mediaFilename(
        {
          content_type: "document",
          content_text: "Q3 statement.pdf",
          media_url: "/api/whatsapp/media/999",
          created_at: AT,
        },
        "application/pdf",
      ),
    ).toBe("Q3 statement.pdf");
  });

  it("sanitises a document filename that tries to escape the folder", () => {
    expect(
      mediaFilename(
        {
          content_type: "document",
          content_text: "../../../.ssh/authorized_keys.txt",
          created_at: AT,
        },
        "text/plain",
      ),
    ).toBe("authorized_keys.txt");
  });

  it("does not mistake a document caption for a filename", () => {
    expect(
      mediaFilename(
        {
          content_type: "document",
          content_text: "here is the thing you asked for",
          media_url:
            "https://x.supabase.co/storage/v1/object/public/chat-media/account-a/1770000000000-contract.pdf",
          created_at: AT,
        },
        "application/pdf",
      ),
    ).toBe("contract.pdf");
  });

  it("does not treat an image caption as a filename", () => {
    // "cat.jpg" here is prose, and the URL has the real name.
    expect(
      mediaFilename(
        {
          content_type: "image",
          content_text: "is this the right cat.jpg",
          media_url:
            "https://x.supabase.co/storage/v1/object/public/chat-media/account-a/1770000000000-tabby.png",
          created_at: AT,
        },
        "image/png",
      ),
    ).toBe("tabby.png");
  });

  it("synthesises a timestamped name for inbound media", () => {
    const name = mediaFilename(
      {
        content_type: "image",
        media_url: "/api/whatsapp/media/1234567890123456",
        created_at: AT,
      },
      "image/jpeg",
    );
    // Local time, so assert the shape rather than a fixed clock reading.
    expect(name).toMatch(/^whatsapp-image-\d{8}-\d{6}\.jpg$/);
  });

  it("falls back to bin when the MIME type is unknown", () => {
    expect(
      mediaFilename(
        {
          content_type: "audio",
          media_url: "/api/whatsapp/media/42",
          created_at: AT,
        },
        undefined,
      ),
    ).toMatch(/^whatsapp-audio-\d{8}-\d{6}\.bin$/);
  });

  it("drops the timestamp rather than throwing on an unparseable created_at", () => {
    expect(
      mediaFilename(
        {
          content_type: "video",
          media_url: "/api/whatsapp/media/42",
          created_at: "not a date",
        },
        "video/mp4",
      ),
    ).toBe("whatsapp-video.mp4");
  });

  it("takes the extension from the row's media_type when the blob has none", () => {
    // A Blob minted from a response with no usable Content-Type reports
    // `type === ""`, which would otherwise synthesise a useless `.bin`.
    expect(
      mediaFilename(
        {
          content_type: "audio",
          media_url: "/api/whatsapp/media/42",
          media_type: "audio/ogg; codecs=opus",
          created_at: AT,
        },
        "",
      ),
    ).toMatch(/^whatsapp-audio-\d{8}-\d{6}\.ogg$/);
  });

  it("prefers media_type over a generic octet-stream from the browser", () => {
    expect(
      mediaFilename(
        {
          content_type: "image",
          media_url: "/api/whatsapp/media/42",
          media_type: "image/png",
          created_at: AT,
        },
        "application/octet-stream",
      ),
    ).toMatch(/\.png$/);
  });

  it("ignores an unhelpful media_type in favour of what the browser saw", () => {
    expect(
      mediaFilename(
        {
          content_type: "image",
          media_url: "/api/whatsapp/media/42",
          media_type: "application/octet-stream",
          created_at: AT,
        },
        "image/jpeg",
      ),
    ).toMatch(/\.jpg$/);
  });

  it("recovers the sender's filename from a mirrored inbound object path", () => {
    // Migration 039 prefixes the object with Meta's media id; the same
    // leading-digits rule that hides the outbound epoch stamp hides it.
    expect(
      mediaFilename(
        {
          content_type: "document",
          content_text: "have a look at this",
          media_url:
            "https://x.supabase.co/storage/v1/object/public/chat-media/account-a/inbound/1234567890123456-invoice.pdf",
          media_type: "application/pdf",
          created_at: AT,
        },
        "application/pdf",
      ),
    ).toBe("invoice.pdf");
  });
});
