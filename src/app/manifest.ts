import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "wacrm — CRM para WhatsApp",
    short_name: "wacrm",
    description: "CRM para WhatsApp — caixa de entrada, funis e automações.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#7c3aed",
    icons: [
      { src: "/icon-192", sizes: "192x192", type: "image/png" },
      { src: "/icon-512", sizes: "512x512", type: "image/png" },
      { src: "/icon-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
