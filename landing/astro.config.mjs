// ============================================================
// Astro config — landing estática (skill §2.3).
//
// base: '/landing' es CRÍTICO: los assets hasheados (_astro/*) se emiten bajo
// /landing/_astro/* para que la copia a public/landing/ de Next resuelva
// todas las URLs. Sin base, apuntarían a la raíz de Next y romperían.
//
// Sin Tailwind: el sistema de estilos es CSS nativo con @layer, tokens y las
// clases de src/styles/ (skill §1, regla 1 — cero dependencias de estilo).
//
// Build: `astro build` → dist/ → scripts/copy-dist.mjs lo copia a
// ../public/landing/ (servido por Next en /landing/...).
// ============================================================

import { defineConfig } from "astro/config";

export default defineConfig({
  base: "/landing",
  output: "static",
  site: "https://wacrm.tech",
  // El CSS se inyecta en el <head> en lugar de servirse como archivo: cero
  // requests bloqueantes para el estilo crítico. Es viable porque el CSS
  // total del sistema son unos pocos KB comprimidos.
  build: { inlineStylesheets: "always" },
  compressHTML: true,
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
});
