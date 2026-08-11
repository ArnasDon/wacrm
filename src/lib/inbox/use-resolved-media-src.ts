import { useCallback, useEffect, useState } from "react";

/**
 * Resolves a message's `media_url` to something an `<img>`/lightbox can
 * load directly. Inbound (customer) media is a same-origin authenticated
 * proxy path (`/api/whatsapp/media/<id>`, see that route) — the browser
 * can't just point an `<img src>` at it and get a stable result across
 * re-renders the way it can a plain URL, so this fetches it once and
 * hands back a `blob:` URL instead. Outbound (agent-sent) media is
 * already a plain public Supabase Storage URL and passes through as-is.
 *
 * Extracted out of `message-bubble.tsx`'s `MediaImage` so the same
 * resolution (and blob lifecycle — revoked on unmount/url change) is
 * shared with the media gallery's image thumbnails instead of a second
 * copy of this fetch-and-revoke dance.
 */
export function useResolvedMediaSrc(url: string | undefined) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setError(false);

    if (url.startsWith("/api/whatsapp/media/")) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to load media");
        const blob = await res.blob();
        setSrc(URL.createObjectURL(blob));
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    } else {
      setSrc(url);
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    load();
    return () => {
      setSrc((current) => {
        if (current?.startsWith("blob:")) URL.revokeObjectURL(current);
        return current;
      });
    };
  }, [load]);

  return { src, loading, error, setError };
}
