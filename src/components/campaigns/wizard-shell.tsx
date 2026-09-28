'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

const FooterSlot = createContext<HTMLElement | null>(null);

/**
 * Full-height wizard layout: the steps scroll, the Back / Next bar stays
 * pinned at the bottom. It is sized to the viewport below the 56px app
 * header (h-14) and cancels <main>'s padding, so the bar is part of the
 * layout rather than a sticky element that depends on the scroller.
 *
 * Steps put their buttons in the bar with {@link WizardFooter}, so each
 * step keeps owning its own validation and actions.
 */
export function WizardShell({
  children,
  width = 'max-w-6xl',
}: {
  children: ReactNode;
  /** Tailwind max-width class for content and footer. */
  width?: string;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <FooterSlot.Provider value={slot}>
      <div className="-m-4 flex h-[calc(100dvh-3.5rem)] flex-col sm:-m-6">
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className={cn('mx-auto space-y-6 pb-4', width)}>{children}</div>
        </div>
        <div className="border-border bg-card/90 shrink-0 border-t px-4 py-3 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.15)] backdrop-blur sm:px-6">
          <div ref={setSlot} className={cn('mx-auto min-h-9', width)} />
        </div>
      </div>
    </FooterSlot.Provider>
  );
}

/** Renders its children into the pinned bar of the nearest WizardShell. */
export function WizardFooter({ children }: { children: ReactNode }) {
  const slot = useContext(FooterSlot);
  if (!slot) return null;
  return createPortal(
    <div className="flex flex-wrap items-center justify-between gap-3">
      {children}
    </div>,
    slot
  );
}
