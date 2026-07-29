"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { isChunkLoadError, reloadForNewVersion } from "@/lib/chunk-error";

/**
 * Headless — mounted once in the root layout. Catches stale-chunk
 * failures that surface OUTSIDE a React render (a rejected dynamic
 * `import()` during route prefetch, for instance) as a plain
 * `unhandledrejection`/`error` event rather than something an
 * error.tsx boundary would ever see. app/error.tsx and
 * app/global-error.tsx cover the render-phase case; this covers the
 * rest. See lib/chunk-error.ts for why this matters — do not delete
 * as "unused", it only ever fires against a tab that has outlived a
 * deploy.
 */
export function ChunkErrorListener() {
  useEffect(() => {
    function handleError(event: ErrorEvent) {
      if (isChunkLoadError(event.error ?? event.message)) {
        reloadForNewVersion(() => toast.message("Nova versão disponível, atualizando..."));
      }
    }
    function handleRejection(event: PromiseRejectionEvent) {
      if (isChunkLoadError(event.reason)) {
        reloadForNewVersion(() => toast.message("Nova versão disponível, atualizando..."));
      }
    }

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}
