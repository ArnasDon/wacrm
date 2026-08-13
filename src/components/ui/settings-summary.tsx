import { Fragment, ReactNode } from 'react'

/**
 * Compact label:value grid for a view-mode summary of a persisted
 * setting — pairs with CollapsibleEditor's collapsed `header`.
 */
export function SettingsSummary({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      {items.map((item) => (
        <Fragment key={item.label}>
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 truncate font-medium">{item.value}</dd>
        </Fragment>
      ))}
    </dl>
  )
}
