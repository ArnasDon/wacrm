import Image from 'next/image';

import { cn } from '@/lib/utils';

interface DecizyonLogoProps {
  className?: string;
  priority?: boolean;
}

export function DecizyonLogo({
  className,
  priority = false,
}: DecizyonLogoProps) {
  return (
    <Image
      src="/brand/logo-decizyon-tech-transparent.png"
      alt="Decizyon Tech"
      width={929}
      height={307}
      priority={priority}
      className={cn('h-auto w-36', className)}
    />
  );
}
