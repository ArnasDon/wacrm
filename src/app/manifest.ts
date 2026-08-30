import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Chat Sandía",
    short_name: "Sandía",
    description: "Plataforma de inteligencia comercial para empresas.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    // Newer browsers use this to keep a browser-tab fallback when the
    // display mode isn't available (e.g. some in-app browsers).
    display_override: ["standalone", "minimal-ui"],
    background_color: "#020617",
    theme_color: "#020617",
    orientation: "portrait-primary",
    lang: "es",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Bandeja de entrada", short_name: "Inbox", url: "/inbox", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Contactos", url: "/contacts", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Pipelines", url: "/pipelines", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
