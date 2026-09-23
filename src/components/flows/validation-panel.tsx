'use client';

/**
 * Validation panel — surfaces every error and warning from
 * `validateFlowForActivation`. Lives once at the bottom of the
 * editor shell so it's visible in both views (canvas + list).
 *
 * Node-scoped issues are clickable: tapping one calls
 * `requestFlash(node_key)` on the editor context. List view's
 * useEffect on `flashKey` expands + scrolls + flashes the row;
 * canvas view's useEffect pans the viewport + flashes the card.
 * Both views read the same flashKey so the panel doesn't need
 * per-view plumbing.
 *
 * Trigger-scoped issues are NOT clickable from canvas — trigger
 * config is a list-only panel (it's a flat form, not a graph
 * concept). User can switch to List to address them.
 */

import { CircleAlert, CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { ValidationIssue } from '@/lib/flows/validate';
import { useFlowEditor } from './flow-editor-state';

export function ValidationPanel() {
  const { issues, requestFlash } = useFlowEditor();
  const t = useTranslations('Flows.validation');

  if (issues.length === 0) {
    // Slate-950 base + emerald accents so the panel stays readable when
    // sticky-positioned over scrolled-behind node cards (a translucent
    // bg-emerald-500/10 would bleed through ugly).
    return (
      <div className="bg-background flex items-center gap-2 rounded-lg border border-emerald-600/50 p-3 text-sm font-medium text-emerald-300">
        <CircleCheck className="h-4 w-4 shrink-0" />
        {t('noIssues')}
      </div>
    );
  }
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return (
    <div
      className={cn(
        'bg-background rounded-lg border p-3',
        errors.length > 0 ? 'border-red-500/40' : 'border-amber-500/40'
      )}
    >
      <div className="text-muted-foreground mb-2 flex items-center gap-2 text-xs">
        {errors.length > 0 ? (
          <CircleAlert className="h-4 w-4 text-red-400" />
        ) : (
          <CircleAlert className="h-4 w-4 text-amber-400" />
        )}
        {t('summary', {
          errorCount: errors.length,
          warningCount: warnings.length,
        })}
      </div>
      <div className="flex flex-col gap-1">
        {issues.map((i, ix) => (
          <IssueLine key={ix} issue={i} onJump={requestFlash} t={t} />
        ))}
      </div>
    </div>
  );
}

/**
 * Exported so the per-node card (list view) and the trigger panel
 * can render the same "icon + node key chip + message" formatting
 * for their own per-row issue lists without re-implementing the
 * tone / icon / accessibility logic.
 */
export function IssueLine({
  issue,
  onJump,
  t,
}: {
  issue: ValidationIssue;
  onJump?: (key: string) => void;
  t?: ReturnType<typeof useTranslations>;
}) {
  const tone = issue.severity === 'error' ? 'text-red-300' : 'text-amber-300';
  const iconTone =
    issue.severity === 'error' ? 'text-red-400' : 'text-amber-400';
  const body = (
    <>
      <CircleAlert className={cn('mt-0.5 h-3 w-3 shrink-0', iconTone)} />
      <span className="min-w-0 flex-1">
        {issue.node_key && (
          <code className="bg-muted text-muted-foreground mr-1 rounded px-1 py-0.5 text-[10px]">
            {issue.node_key}
          </code>
        )}
        {issue.message}
      </span>
    </>
  );

  // Only node-scoped issues can jump; trigger-scoped issues have no
  // destination (the trigger panel is list-only and already at the
  // top of that view).
  if (issue.node_key && onJump) {
    return (
      <button
        type="button"
        onClick={() => onJump(issue.node_key!)}
        className={cn(
          'hover:bg-muted/60 flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors',
          tone
        )}
        aria-label={
          t
            ? t('jumpToNode', { key: issue.node_key! })
            : `Jump to node ${issue.node_key}`
        }
      >
        {body}
      </button>
    );
  }
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md px-2 py-1 text-xs',
        tone
      )}
    >
      {body}
    </div>
  );
}
