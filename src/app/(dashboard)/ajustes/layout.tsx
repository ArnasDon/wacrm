import { VisualPatio } from "../patio/visual";

export default function AjustesLayout({ children }: { children: React.ReactNode }) {
  return <VisualPatio>{children}</VisualPatio>;
}
