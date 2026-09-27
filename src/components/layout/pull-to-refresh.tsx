'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export function PullToRefresh({
  children,
  onRefresh,
}: {
  children: ReactNode;
  onRefresh?: () => Promise<void> | void;
}) {
  const router = useRouter();
  const [isPulling, setIsPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let startY = 0;
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      // Only enable pull-to-refresh if we are at the very top of the page
      if (window.scrollY === 0) {
        startY = e.touches[0].clientY;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startY === 0) return;
      const y = e.touches[0].clientY;
      const dy = y - startY;

      // Pulling down while at the top
      if (dy > 0 && window.scrollY === 0) {
        // Prevent default browser scrolling
        if (e.cancelable) e.preventDefault();

        setPullProgress(Math.min(dy / 2.5, 60));
        setIsPulling(true);
      }
    };

    const onTouchEnd = async () => {
      if (pullProgress >= 50) {
        // Trigger haptic feedback if supported
        if ('vibrate' in navigator) {
          navigator.vibrate(50);
        }
        if (onRefresh) {
          await onRefresh();
        } else {
          // Refresh the current route
          router.refresh();
        }
      }
      setIsPulling(false);
      setPullProgress(0);
      startY = 0;
    };

    // passive: false is required to call e.preventDefault() in touchmove
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [pullProgress, router, onRefresh]);

  return (
    <div ref={containerRef} className="relative min-h-full w-full bg-inherit">
      {isPulling && (
        <div
          className="text-muted-foreground pointer-events-none absolute top-0 left-0 z-50 flex w-full items-center justify-center"
          style={{ height: `${pullProgress}px`, opacity: pullProgress / 60 }}
        >
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
      <div
        style={{ transform: `translateY(${isPulling ? pullProgress : 0}px)` }}
        className={isPulling ? '' : 'transition-transform duration-300'}
      >
        {children}
      </div>
    </div>
  );
}
