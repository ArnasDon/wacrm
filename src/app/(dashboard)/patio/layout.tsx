import { VisualPatio } from "./visual";

// Pátio (sistema único, Fase 3): estoque do site dentro do sistema.
export default function PatioLayout({ children }: { children: React.ReactNode }) {
  return <VisualPatio>{children}</VisualPatio>;
}
