import { Archivo, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./patio.css";

// Pátio (sistema único, Fase 3): estoque do site dentro do sistema, no
// visual aprovado em 09/11. As fontes e cores ficam presas em
// .modulo-patio até a troca de visual do sistema inteiro.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo" });
const hanken = Hanken_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-hanken" });
const plex = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-plex-mono" });

export default function PatioLayout({ children }: { children: React.ReactNode }) {
  return <div className={`modulo-patio ${archivo.variable} ${hanken.variable} ${plex.variable}`}>{children}</div>;
}
