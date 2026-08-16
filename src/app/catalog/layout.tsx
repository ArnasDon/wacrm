import type { ReactNode } from 'react';

export default function CatalogLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-gray-50">{children}</div>;
}
