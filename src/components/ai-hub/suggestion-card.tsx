'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { formatDistanceToNow } from 'date-fns';
import { Check, ChevronRight, Loader2, EyeOff, MessageSquare, RotateCcw, X } from 'lucide-react';
import { getDateFnsLocale } from '@/lib/date-fns-locale';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  aiSuggestionCategoryConfig,
  aiSuggestionStatusConfig,
} from '@/lib/ai-suggestion-status';
import { scoreConfidenceBand } from '@/lib/ai/lead-analysis-config';
import { FollowupDialog } from './followup-dialog';
import { LearningDialog } from './learning-dialog';
import type { AiSuggestion, AiSuggestionStatus } from '@/types';

interface PipelineMovePayload {
  score?: number;
}
interface FollowupPayload {
  score?: number;
}
interface LearningPayload {
  occurrence_count?: number;
}

export function SuggestionCard({
  suggestion,
  onUpdateStatus,
  onRefresh,
}: {
  suggestion: AiSuggestion;
  onUpdateStatus: (id: string, status: AiSuggestionStatus) => Promise<void>;
  /** Called after an action taken inside the follow-up dialog
   *  (ignore/snooze/complete) that bypasses `onUpdateStatus`'s
   *  optimistic-removal path — tells the parent list to refetch. */
  onRefresh?: () => void;
}) {
  const t = useTranslations('AiHub');
  const appLocale = useLocale();
  const dateFnsLocale = getDateFnsLocale(appLocale);
  const [pendingAction, setPendingAction] = useState<AiSuggestionStatus | null>(null);
  const [followupOpen, setFollowupOpen] = useState(false);
  const [learningOpen, setLearningOpen] = useState(false);

  const category = aiSuggestionCategoryConfig[suggestion.category];
  const CategoryIcon = category.icon;
  const status = aiSuggestionStatusConfig[suggestion.status];
  const isPending = suggestion.status === 'pending';
  const isPipelineMove = suggestion.category === 'pipeline_move';
  const isFollowup = suggestion.category === 'followup';
  const isLearning = suggestion.category === 'learning';
  const score = isPipelineMove
    ? (suggestion.payload as PipelineMovePayload | undefined)?.score
    : isFollowup
      ? (suggestion.payload as FollowupPayload | undefined)?.score
      : undefined;
  const occurrenceCount = isLearning
    ? (suggestion.payload as LearningPayload | undefined)?.occurrence_count
    : undefined;

  const act = async (next: AiSuggestionStatus) => {
    setPendingAction(next);
    try {
      await onUpdateStatus(suggestion.id, next);
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <CategoryIcon className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {suggestion.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(`categories.${category.labelKey}`)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge className={`border text-xs ${status.classes}`}>
              {t(`status.${status.labelKey}`)}
            </Badge>
            {typeof score === 'number' && (
              <span
                className="text-[11px] text-muted-foreground"
                title={t(`confidenceBand.${scoreConfidenceBand(score)}`)}
              >
                {t('confidence')}: {score}%
              </span>
            )}
            {typeof occurrenceCount === 'number' && occurrenceCount > 1 && (
              <span className="text-[11px] text-muted-foreground">
                {t('learning.occurrencesShort', { count: occurrenceCount })}
              </span>
            )}
          </div>
        </div>

        {suggestion.description && (
          <p className="text-sm text-muted-foreground">{suggestion.description}</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {suggestion.contact ? (
              suggestion.conversation_id ? (
                <Link
                  href={`/inbox?c=${suggestion.conversation_id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {suggestion.contact.name}
                </Link>
              ) : (
                <span className="font-medium">{suggestion.contact.name}</span>
              )
            ) : null}
            <span>
              {formatDistanceToNow(new Date(suggestion.created_at), {
                addSuffix: true,
                locale: dateFnsLocale,
              })}
            </span>
          </div>

          {isPending && isFollowup ? (
            <>
              <Button size="sm" onClick={() => setFollowupOpen(true)}>
                {t('followup.open')}
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <FollowupDialog
                suggestion={suggestion}
                open={followupOpen}
                onOpenChange={setFollowupOpen}
                onResolved={() => onRefresh?.()}
              />
            </>
          ) : isPending && isLearning ? (
            <>
              <Button size="sm" onClick={() => setLearningOpen(true)}>
                {t('learning.open')}
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <LearningDialog
                suggestion={suggestion}
                open={learningOpen}
                onOpenChange={setLearningOpen}
                onResolved={() => onRefresh?.()}
              />
            </>
          ) : isPending ? (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={pendingAction !== null}
                onClick={() => act('approved')}
              >
                {pendingAction === 'approved' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                {isPipelineMove ? t('actions.accept') : t('actions.approve')}
              </Button>
              {isPipelineMove ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pendingAction !== null}
                  onClick={() => act('rejected')}
                >
                  {pendingAction === 'rejected' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                  {t('actions.keep')}
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pendingAction !== null}
                    onClick={() => act('rejected')}
                  >
                    {pendingAction === 'rejected' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                    {t('actions.reject')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pendingAction !== null}
                    onClick={() => act('ignored')}
                  >
                    {pendingAction === 'ignored' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5" />
                    )}
                    {t('actions.ignore')}
                  </Button>
                </>
              )}
              {isPipelineMove && suggestion.conversation_id && (
                <Button size="sm" variant="ghost" render={<Link href={`/inbox?c=${suggestion.conversation_id}`} />}>
                  <MessageSquare className="h-3.5 w-3.5" />
                  {t('actions.viewConversation')}
                </Button>
              )}
            </div>
          ) : suggestion.status === 'ignored' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pendingAction !== null}
              onClick={() => act('pending')}
            >
              {pendingAction === 'pending' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              {t('actions.restore')}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
