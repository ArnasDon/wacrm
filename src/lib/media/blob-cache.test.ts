import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  __resetMediaBlobCache,
  isProxiedMediaUrl,
  loadMediaBlob,
  MediaResponseError,
  type MediaFetch,
} from "./blob-cache";

const PROXY = "/api/whatsapp/media/";
const BUCKET = "https://x.supabase.co/storage/v1/object/public/chat-media/a/1-p.png";

function okResponse(body: string): Response {
  return new Response(body, { status: 200 });
}

/** Records every URL requested so de-duplication is observable. */
function trackingFetch(): MediaFetch & { calls: string[] } {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string) => {
    calls.push(url);
    return okResponse(`bytes:${url}`);
  }) as unknown as MediaFetch & { calls: string[] };
  impl.calls = calls;
  return impl;
}

beforeEach(() => {
  __resetMediaBlobCache();
});

describe("isProxiedMediaUrl", () => {
  it("recognises inbound media, not bucket URLs", () => {
    expect(isProxiedMediaUrl(`${PROXY}123`)).toBe(true);
    expect(isProxiedMediaUrl(BUCKET)).toBe(false);
  });
});

describe("loadMediaBlob", () => {
  it("caches proxied media so a second consumer costs nothing", async () => {
    const fetchImpl = trackingFetch();
    const first = await loadMediaBlob(`${PROXY}1`, fetchImpl);
    const second = await loadMediaBlob(`${PROXY}1`, fetchImpl);

    expect(fetchImpl.calls).toEqual([`${PROXY}1`]);
    // Same Blob instance — the thumbnail, the viewer and a download all end
    // up holding the bytes that were fetched once.
    expect(second).toBe(first);
  });

  it("de-duplicates concurrent loads of the same URL", async () => {
    const fetchImpl = trackingFetch();
    const [a, b] = await Promise.all([
      loadMediaBlob(`${PROXY}2`, fetchImpl),
      loadMediaBlob(`${PROXY}2`, fetchImpl),
    ]);

    expect(fetchImpl.calls).toEqual([`${PROXY}2`]);
    expect(a).toBe(b);
  });

  it("does not cache public bucket URLs", async () => {
    // The browser's HTTP cache already covers these, and a 16 MB video has
    // no business being pinned in JS memory.
    const fetchImpl = trackingFetch();
    await loadMediaBlob(BUCKET, fetchImpl);
    await loadMediaBlob(BUCKET, fetchImpl);

    expect(fetchImpl.calls).toEqual([BUCKET, BUCKET]);
  });

  it("evicts the least-recently-used entry past the cap", async () => {
    const fetchImpl = trackingFetch();
    for (let i = 0; i < 30; i++) {
      await loadMediaBlob(`${PROXY}${i}`, fetchImpl);
    }
    // Touch the oldest so it is no longer the eviction candidate.
    await loadMediaBlob(`${PROXY}0`, fetchImpl);
    // One more entry pushes the cache over the cap.
    await loadMediaBlob(`${PROXY}30`, fetchImpl);

    const before = fetchImpl.calls.length;
    await loadMediaBlob(`${PROXY}0`, fetchImpl); // still cached
    expect(fetchImpl.calls.length).toBe(before);

    await loadMediaBlob(`${PROXY}1`, fetchImpl); // evicted → refetched
    expect(fetchImpl.calls.length).toBe(before + 1);
  });

  it("throws on a failed request and caches nothing", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }));

    await expect(
      loadMediaBlob(`${PROXY}3`, fetchImpl as unknown as MediaFetch),
    ).rejects.toThrow("404");

    // A retry genuinely retries rather than replaying the failure.
    await expect(
      loadMediaBlob(`${PROXY}3`, fetchImpl as unknown as MediaFetch),
    ).rejects.toThrow("404");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("distinguishes a refused response from a fetch that never completed", async () => {
    // `downloadMediaMessage` branches on this: a refused response must
    // surface as an error, while a blocked fetch falls back to a new tab.
    // Getting the two confused made an expired attachment silently open a
    // tab onto its own 401 instead of telling the agent.
    const refuse = vi.fn(async () => new Response("no", { status: 401 }));
    await expect(
      loadMediaBlob(`${PROXY}5`, refuse as unknown as MediaFetch),
    ).rejects.toBeInstanceOf(MediaResponseError);

    const blocked = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      loadMediaBlob(BUCKET, blocked as unknown as MediaFetch),
    ).rejects.not.toBeInstanceOf(MediaResponseError);
  });

  it("carries the status on a refused response", async () => {
    const refuse = vi.fn(async () => new Response("no", { status: 401 }));
    await expect(
      loadMediaBlob(`${PROXY}6`, refuse as unknown as MediaFetch),
    ).rejects.toMatchObject({ status: 401, name: "MediaResponseError" });
  });

  it("lets a retry succeed after a failure", async () => {
    let attempt = 0;
    const fetchImpl = vi.fn(async () => {
      attempt += 1;
      return attempt === 1
        ? new Response("nope", { status: 500 })
        : okResponse("bytes");
    });

    await expect(
      loadMediaBlob(`${PROXY}4`, fetchImpl as unknown as MediaFetch),
    ).rejects.toThrow();
    const blob = await loadMediaBlob(
      `${PROXY}4`,
      fetchImpl as unknown as MediaFetch,
    );
    expect(await blob.text()).toBe("bytes");
  });
});
