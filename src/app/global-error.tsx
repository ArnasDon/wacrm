"use client";

import { useEffect } from "react";
import { isChunkLoadError, reloadForNewVersion } from "@/lib/chunk-error";

/**
 * Catches errors thrown by the root layout itself (rare — most
 * stale-chunk failures hit app/error.tsx instead, one level down).
 * Required by Next.js to define its own <html>/<body> since it
 * replaces the root layout when active — see lib/chunk-error.ts for
 * why this exists at all.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const isStaleChunk = isChunkLoadError(error);

  useEffect(() => {
    if (isStaleChunk) {
      reloadForNewVersion();
    } else {
      console.error("[global error boundary]", error);
    }
  }, [error, isStaleChunk]);

  return (
    <html>
      <body style={{ background: "#020617", color: "#e2e8f0" }}>
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "1rem",
          }}
        >
          <p style={{ fontSize: "0.875rem" }}>
            {isStaleChunk ? "Nova versão disponível, atualizando..." : "Algo deu errado. Recarregue a página."}
          </p>
        </div>
      </body>
    </html>
  );
}
