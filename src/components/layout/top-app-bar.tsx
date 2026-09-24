'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface TopAppBarProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  leftAction?: React.ReactNode;
  rightAction?: React.ReactNode;
}

export function TopAppBar({
  title,
  leftAction,
  rightAction,
  className,
  ...props
}: TopAppBarProps) {
  return (
    <header
      className={cn(
        'bg-background border-border z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center justify-between border-b px-4 pt-[env(safe-area-inset-top)]',
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {leftAction && (
          <div className="-ml-2 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center">
            {leftAction}
          </div>
        )}
        {title && (
          <h1 className="flex-1 truncate text-base font-semibold">{title}</h1>
        )}
      </div>
      {rightAction && (
        <div className="-mr-2 flex min-h-[44px] shrink-0 items-center justify-end gap-2">
          {rightAction}
        </div>
      )}
    </header>
  );
}
