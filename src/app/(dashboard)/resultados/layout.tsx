import { VisualPatio } from "../patio/visual";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <VisualPatio>{children}</VisualPatio>;
}
