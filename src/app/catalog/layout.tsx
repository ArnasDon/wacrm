import type { ReactNode } from 'react';

export default function CatalogLayout({ children }: { children: ReactNode }) {
  // The global app shell locks body scroll; public catalog routes provide
  // their own dynamic-viewport scroller so mobile Safari/Chrome remain usable.
  return (
    <div className="app-scroll h-dvh overflow-x-hidden overflow-y-auto bg-gray-50">
      {children}
    </div>
  );
}
