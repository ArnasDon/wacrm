import { Archivo, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./patio.css";

// Visual aprovado em 09/11 ("o pátio de dia"), compartilhado pelas telas
// novas (Pátio, Hoje, Relatório). Cores e fontes presas em .modulo-patio.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo" });
const hanken = Hanken_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-hanken" });
const plex = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-plex-mono" });

export function VisualPatio({ children }: { children: React.ReactNode }) {
  return <div className={`modulo-patio ${archivo.variable} ${hanken.variable} ${plex.variable}`}>{children}</div>;
}
