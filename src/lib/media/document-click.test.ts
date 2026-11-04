import { describe, it, expect } from "vitest";
import {
  shouldDownloadDocumentClick,
  type DocumentClickInput,
} from "./document-click";

const PROXY_URL = "/api/whatsapp/media/123456";
const BUCKET_URL =
  "https://x.supabase.co/storage/v1/object/public/chat-media/a/1700000000000-report.pdf";

const plainClick: DocumentClickInput = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
};

describe("shouldDownloadDocumentClick", () => {
  it("downloads a plain click on an inbound proxied document", () => {
    expect(shouldDownloadDocumentClick(PROXY_URL, plainClick)).toBe(true);
  });

  it("leaves outbound bucket documents to open natively", () => {
    expect(shouldDownloadDocumentClick(BUCKET_URL, plainClick)).toBe(false);
  });

  it("does nothing without a media url", () => {
    expect(shouldDownloadDocumentClick(undefined, plainClick)).toBe(false);
  });

  it.each(["metaKey", "ctrlKey", "shiftKey", "altKey"] as const)(
    "keeps the native link behaviour for %s clicks",
    (modifier) => {
      expect(
        shouldDownloadDocumentClick(PROXY_URL, {
          ...plainClick,
          [modifier]: true,
        }),
      ).toBe(false);
    },
  );

  it("ignores non-primary buttons", () => {
    expect(
      shouldDownloadDocumentClick(PROXY_URL, { ...plainClick, button: 1 }),
    ).toBe(false);
  });

  it("respects an already prevented click", () => {
    expect(
      shouldDownloadDocumentClick(PROXY_URL, {
        ...plainClick,
        defaultPrevented: true,
      }),
    ).toBe(false);
  });
});
