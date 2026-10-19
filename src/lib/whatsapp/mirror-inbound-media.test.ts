import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MIRROR_BUCKET,
  mirrorFileName,
  mirrorInboundMedia,
  normalizeMimeType,
} from "./mirror-inbound-media";
import { MEDIA_MAX_BYTES } from "@/lib/storage/upload-media";

const ACCOUNT = "11111111-2222-3333-4444-555555555555";
const MEDIA_ID = "1234567890123456";

/**
 * Minimal stand-in for `supabase.storage`. Records every upload so a
 * test can assert on the object path and the content type without a
 * Supabase project.
 */
function fakeStorage(uploadError: { message: string } | null = null) {
  const uploads: Array<{
    bucket: string;
    path: string;
    body: Uint8Array | Buffer;
    options: { contentType: string; cacheControl: string; upsert: boolean };
  }> = [];

  const storage = {
    from(bucket: string) {
      return {
        async upload(
          path: string,
          body: Uint8Array | Buffer,
          options: {
            contentType: string;
            cacheControl: string;
            upsert: boolean;
          },
        ) {
          uploads.push({ bucket, path, body, options });
          return { error: uploadError };
        },
        getPublicUrl(path: string) {
          return {
            data: { publicUrl: `https://cdn.test/storage/${bucket}/${path}` },
          };
        },
      };
    },
  };

  return { storage, uploads };
}

function fakeDownload(bytes: number, contentType = "image/jpeg") {
  return vi.fn(async () => ({
    buffer: Buffer.alloc(bytes),
    contentType,
  }));
}

const BASE = {
  accountId: ACCOUNT,
  mediaId: MEDIA_ID,
  downloadUrl: "https://lookaside.fbsbx.com/whatsapp/abc",
  accessToken: "test-token",
} as const;

describe("normalizeMimeType", () => {
  it("strips parameters and lower-cases", () => {
    // What Meta actually sends for a voice note.
    expect(normalizeMimeType("audio/ogg; codecs=opus")).toBe("audio/ogg");
    expect(normalizeMimeType("IMAGE/JPEG")).toBe("image/jpeg");
  });

  it("rejects values that aren't a MIME type", () => {
    expect(normalizeMimeType(null)).toBeNull();
    expect(normalizeMimeType("")).toBeNull();
    expect(normalizeMimeType("binary")).toBeNull();
  });
});

describe("mirrorFileName", () => {
  it("keeps a document's own name so the download reads sensibly", () => {
    const name = mirrorFileName({
      mediaId: MEDIA_ID,
      mimeType: "application/pdf",
      fileName: "invoice.pdf",
    });
    expect(name).toBe(`${MEDIA_ID}-invoice.pdf`);
  });

  it("re-derives the extension from the MIME, not the sender's name", () => {
    // A sender-controlled ".exe" must not survive into the object path.
    const name = mirrorFileName({
      mediaId: MEDIA_ID,
      mimeType: "application/pdf",
      fileName: "../../payload.exe",
    });
    expect(name).toBe(`${MEDIA_ID}-payload.pdf`);
  });

  it("synthesises a stamped name when there is no filename", () => {
    const name = mirrorFileName({
      mediaId: MEDIA_ID,
      mimeType: "image/jpeg",
      messageTimestamp: "1754899200",
    });
    expect(name).toBe(`${MEDIA_ID}-image-1754899200.jpg`);
  });

  it("stays under buildMediaPath's 40-char basename cap", () => {
    // A 19-digit id is the longest Meta realistically issues; if the
    // synthesised name outgrows the cap, buildMediaPath silently
    // truncates it and the timestamp stops disambiguating anything.
    const name = mirrorFileName({
      mediaId: "1234567890123456789",
      mimeType: "image/jpeg",
      messageTimestamp: "1754899200",
    });
    expect(name.replace(/\.[^.]+$/, "").length).toBeLessThanOrEqual(40);
  });

  it("falls back to a .bin extension for an unknown MIME", () => {
    const name = mirrorFileName({
      mediaId: MEDIA_ID,
      mimeType: "application/x-nonsense",
      messageTimestamp: "1754899200",
    });
    expect(name).toBe(`${MEDIA_ID}-document-1754899200.bin`);
  });
});

describe("mirrorInboundMedia", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uploads to chat-media and returns the durable public URL", async () => {
    const { storage, uploads } = fakeStorage();
    const download = fakeDownload(1024);

    const url = await mirrorInboundMedia({
      ...BASE,
      storage,
      mimeType: "image/jpeg",
      fileSize: 1024,
      messageTimestamp: "1754899200",
      download,
    });

    expect(uploads).toHaveLength(1);
    expect(uploads[0].bucket).toBe(MIRROR_BUCKET);
    expect(uploads[0].path).toBe(
      `account-${ACCOUNT}/inbound/${MEDIA_ID}-image-1754899200.jpg`,
    );
    expect(uploads[0].options.contentType).toBe("image/jpeg");
    expect(url).toBe(
      `https://cdn.test/storage/chat-media/account-${ACCOUNT}/inbound/${MEDIA_ID}-image-1754899200.jpg`,
    );
  });

  it("writes the same path on a redelivery, so a retry can't orphan a copy", async () => {
    const { storage, uploads } = fakeStorage();
    const args = {
      ...BASE,
      storage,
      mimeType: "image/jpeg" as const,
      messageTimestamp: "1754899200",
      download: fakeDownload(1024),
    };

    await mirrorInboundMedia(args);
    await mirrorInboundMedia(args);

    expect(uploads).toHaveLength(2);
    expect(uploads[0].path).toBe(uploads[1].path);
    // upsert, so the second write replaces rather than erroring.
    expect(uploads[1].options.upsert).toBe(true);
  });

  it("strips MIME parameters before handing the type to Storage", async () => {
    // The bucket's allowed_mime_types is an exact-match list, so an
    // unstripped `audio/ogg; codecs=opus` would be rejected outright.
    const { storage, uploads } = fakeStorage();

    await mirrorInboundMedia({
      ...BASE,
      storage,
      mimeType: "audio/ogg; codecs=opus",
      download: fakeDownload(2048, "audio/ogg; codecs=opus"),
    });

    expect(uploads[0].options.contentType).toBe("audio/ogg");
    expect(uploads[0].path).toMatch(/\.ogg$/);
  });

  it("skips oversized media without downloading it", async () => {
    const { storage, uploads } = fakeStorage();
    const download = fakeDownload(1024);

    const url = await mirrorInboundMedia({
      ...BASE,
      storage,
      mimeType: "application/pdf",
      fileSize: MEDIA_MAX_BYTES + 1,
      download,
    });

    expect(url).toBeNull();
    expect(download).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(0);
  });

  it("skips media that turns out oversized once downloaded", async () => {
    // Meta's file_size is advisory; the transfer is the truth.
    const { storage, uploads } = fakeStorage();

    const url = await mirrorInboundMedia({
      ...BASE,
      storage,
      mimeType: "video/mp4",
      fileSize: 1024,
      download: fakeDownload(MEDIA_MAX_BYTES + 1, "video/mp4"),
    });

    expect(url).toBeNull();
    expect(uploads).toHaveLength(0);
  });

  it("returns null when Storage refuses the upload", async () => {
    // e.g. a document whose MIME is outside the bucket's allow-list.
    const { storage } = fakeStorage({ message: "mime type not supported" });

    const url = await mirrorInboundMedia({
      ...BASE,
      storage,
      mimeType: "application/x-7z-compressed",
      download: fakeDownload(1024, "application/x-7z-compressed"),
    });

    expect(url).toBeNull();
  });

  it("returns null instead of throwing when the download fails", async () => {
    // The caller is the Meta webhook: a throw here would surface as a
    // failed delivery and have Meta retry the whole message.
    const { storage } = fakeStorage();

    const url = await mirrorInboundMedia({
      ...BASE,
      storage,
      mimeType: "image/png",
      download: vi.fn(async () => {
        throw new Error("Media download failed: 404");
      }),
    });

    expect(url).toBeNull();
  });

  it("falls back to the download's content type when Meta gave none", async () => {
    const { storage, uploads } = fakeStorage();

    await mirrorInboundMedia({
      ...BASE,
      storage,
      mimeType: null,
      download: fakeDownload(1024, "image/png"),
    });

    expect(uploads[0].options.contentType).toBe("image/png");
  });
});
