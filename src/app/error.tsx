"use client";

import { useEffect } from "react";
import { isChunkLoadError, reloadForNewVersion } from "@/lib/chunk-error";

/**
 * Root-level error boundary. Most stale-chunk failures surface here
 * — a client-side navigation (Link/router.push) that needs a route
 * segment's chunk throws during that segment's render, and this is
 * the nearest boundary. See lib/chunk-error.ts for the full story;
 * ChunkErrorListener (mounted in the root layout) covers failures
 * that happen outside a render entirely.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const isStaleChunk = isChunkLoadError(error);

  useEffect(() => {
    if (isStaleChunk) {
      reloadForNewVersion();
    } else {
      console.error("[app error boundary]", error);
    }
  }, [error, isStaleChunk]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        {isStaleChunk ? (
          <>
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Nova versão disponível, atualizando...</p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-foreground">Algo deu errado</h2>
            <button
              type="button"
              onClick={reset}
              className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Tentar novamente
            </button>
          </>
        )}
      </div>
    </div>
  );
}
