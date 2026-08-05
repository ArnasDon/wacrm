// ============================================================
// Astro config — landing estática del Revenue Engine (DAD §3).
//
// base: '/landing' es CRÍTICO: los assets hasheados (_astro/*) se
// emiten bajo /landing/_astro/* para que la copia a public/landing/
// de Next resuelva todas las URLs. Sin base, los <script>/<link>
// apuntarían a /_astro/... (raíz de Next) y romperían la referencia.
//
// Tailwind v4: @astrojs/tailwind está DEPRECADA (verificado context7).
// Se usa el plugin Vite oficial @tailwindcss/vite + `@import "tailwindcss"`
// en el CSS global.
//
// Build: `astro build` → dist/ → scripts/copy-dist.mjs lo copia a
// ../public/landing/ (servido por Next en /landing/...).
// ============================================================

import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/landing",
  output: "static",
  site: "https://wacrm.tech",
  vite: {
    plugins: [tailwindcss()],
  },
});
