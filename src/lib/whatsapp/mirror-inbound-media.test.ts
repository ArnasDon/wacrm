import {describe,it,expect} from "vitest";
import {mirrorFileName,normalizeMimeType} from "./mirror-inbound-media";
const MEDIA_ID="1234567890123456";
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

