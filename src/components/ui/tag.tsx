import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Tag — a compact colour-coded pill, modelled on Twenty's
 * (twentyhq/twenty) `Tag`: 4px radius, 12–13px text, a soft tinted
 * background with matching text, and an optional leading dot.
 *
 * Re-implemented on Tailwind's built-in palette (not copied from
 * Twenty's source) so it reads correctly in both light and dark
 * mode. Use it for lead temperature, pipeline stage, deal status,
 * quote status, channel — anywhere a short categorical label needs
 * to be scannable at a glance.
 */
const tagVariants = cva(
  "inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap select-none",
  {
    variants: {
      color: {
        gray: "bg-muted text-muted-foreground",
        blue: "bg-blue-500/12 text-blue-700 dark:text-blue-300",
        sky: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
        turquoise: "bg-teal-500/12 text-teal-700 dark:text-teal-300",
        green: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
        yellow: "bg-amber-400/15 text-amber-700 dark:text-amber-300",
        orange: "bg-orange-500/12 text-orange-700 dark:text-orange-300",
        red: "bg-red-500/12 text-red-700 dark:text-red-300",
        pink: "bg-pink-500/12 text-pink-700 dark:text-pink-300",
        purple: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
      },
    },
    defaultVariants: {
      color: "gray",
    },
  },
);

export type TagColor = NonNullable<VariantProps<typeof tagVariants>["color"]>;

interface TagProps
  extends Omit<React.ComponentProps<"span">, "color">,
    VariantProps<typeof tagVariants> {
  /** Show the small leading colour dot (Twenty's default look). */
  dot?: boolean;
}

function Tag({ className, color, dot = false, children, ...props }: TagProps) {
  return (
    <span
      data-slot="tag"
      className={cn(tagVariants({ color }), className)}
      {...props}
    >
      {dot ? (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-current opacity-70"
        />
      ) : null}
      {children}
    </span>
  );
}

export { Tag, tagVariants };
