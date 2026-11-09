import { VisualPatio } from "../patio/visual";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <VisualPatio>{children}</VisualPatio>;
}
