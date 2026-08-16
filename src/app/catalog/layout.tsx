import type { ReactNode } from 'react';

export default function CatalogLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-background">{children}</div>;
}
