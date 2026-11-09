import "./patio.css";

// Visual padrão das telas novas (Pátio, Hoje, Relatório, Site, Ajustes).
// As fontes (Archivo, Hanken Grotesk, IBM Plex Mono) já vêm do layout raiz;
// as cores vêm do tema do sistema (globals.css).
export function VisualPatio({ children }: { children: React.ReactNode }) {
  return <div className="modulo-patio">{children}</div>;
}
