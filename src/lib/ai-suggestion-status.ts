/**
 * Shared display config for ai_suggestions.status / .category.
 *
 * `labelKey` resolves against the `AiHub` message namespace (see
 * messages/*.json) rather than carrying a hardcoded label — unlike
 * templateStatusConfig, whose statuses are Meta's raw wire values,
 * these are our own vocabulary and should follow the app's locale.
 */

import {
  Ban,
  CheckCircle2,
  CircleDot,
  EyeOff,
  GitBranch,
  Lightbulb,
  ListTodo,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { AiSuggestionCategory, AiSuggestionStatus } from '@/types';

export interface StatusDisplay {
  labelKey: string;
  icon: LucideIcon;
  classes: string;
}

export const aiSuggestionStatusConfig: Record<AiSuggestionStatus, StatusDisplay> = {
  pending: {
    labelKey: 'pending',
    icon: CircleDot,
    classes: 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30',
  },
  approved: {
    labelKey: 'approved',
    icon: CheckCircle2,
    classes: 'bg-primary/20 text-primary border-primary/30',
  },
  rejected: {
    labelKey: 'rejected',
    icon: Ban,
    classes: 'bg-red-600/20 text-red-400 border-red-600/30',
  },
  ignored: {
    labelKey: 'ignored',
    icon: EyeOff,
    classes: 'bg-slate-600/20 text-muted-foreground border-slate-600/30',
  },
  done: {
    labelKey: 'done',
    icon: CheckCircle2,
    classes: 'bg-emerald-600/20 text-emerald-400 border-emerald-600/30',
  },
};

export interface CategoryDisplay {
  labelKey: string;
  icon: LucideIcon;
}

export const aiSuggestionCategoryConfig: Record<AiSuggestionCategory, CategoryDisplay> = {
  pipeline_move: { labelKey: 'pipelineMove', icon: GitBranch },
  action: { labelKey: 'action', icon: ListTodo },
  followup: { labelKey: 'followup', icon: Sparkles },
  learning: { labelKey: 'learning', icon: Lightbulb },
  inconsistency: { labelKey: 'inconsistency', icon: TriangleAlert },
  other: { labelKey: 'other', icon: CircleDot },
};

export const AI_SUGGESTION_CATEGORIES: readonly AiSuggestionCategory[] = [
  'pipeline_move',
  'action',
  'followup',
  'learning',
  'inconsistency',
  'other',
];

export const AI_SUGGESTION_STATUSES: readonly AiSuggestionStatus[] = [
  'pending',
  'approved',
  'rejected',
  'ignored',
  'done',
];
