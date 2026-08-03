import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // next-intl@4 ships an ESM build that imports the bare specifiers
    // `next/server` and `next/navigation`. Next only exposes those through
    // its package `exports` map (as `.js` entrypoints), and Vitest's default
    // externalized resolution doesn't walk that map — so the imports throw
    // "Cannot find module 'next/server'", taking down src/middleware.test.ts
    // and any suite whose import graph touches @/i18n/navigation (e.g.
    // flow-editor-state.test.ts). Inlining next-intl routes it through
    // Vitest's transform pipeline, which resolves the subpaths correctly.
    // This is the fix recommended by next-intl's testing docs.
    server: {
      deps: {
        inline: ["next-intl"],
      },
    },
    // Dummy secrets — encryption.ts / webhook-signature.ts read these
    // at module load. Tests never hit a real Meta/Supabase service, so
    // any 32-byte hex / non-empty string will do; keep them lexically
    // identical to the CI build env so behaviour matches.
    env: {
      ENCRYPTION_KEY:
        "0000000000000000000000000000000000000000000000000000000000000000",
      META_APP_SECRET: "test-meta-app-secret",
    },
    clearMocks: true,
  },
});
