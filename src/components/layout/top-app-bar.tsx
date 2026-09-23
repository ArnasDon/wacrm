'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface TopAppBarProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  leftAction?: React.ReactNode;
  rightAction?: React.ReactNode;
}

export function TopAppBar({ title, leftAction, rightAction, className, ...props }: TopAppBarProps) {
  return (
    <header
      className={cn(
        "flex items-center justify-between h-[calc(3.5rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] px-4 bg-background border-b border-border shrink-0 z-30",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {leftAction && <div className="shrink-0 flex items-center justify-center min-h-[44px] min-w-[44px] -ml-2">{leftAction}</div>}
        {title && <h1 className="text-base font-semibold truncate flex-1">{title}</h1>}
      </div>
      {rightAction && (
        <div className="flex items-center gap-2 shrink-0 min-h-[44px] justify-end -mr-2">
          {rightAction}
        </div>
      )}
    </header>
  );
}
