import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Chat Sandía",
    short_name: "Sandía",
    description: "Plataforma de inteligencia comercial para empresas.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#020617",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icon",
        sizes: "any",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
