'use client';

import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CustomField, Tag, SegmentSummary, PipelineStage, Contact } from '@/types';
import { groupTagsByCategory } from '@/lib/contacts/tag-categories';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useBroadcastSending,
  type AudienceConfig,
  type CustomFieldFilter,
  type CustomFieldOperator,
} from '@/hooks/use-broadcast-sending';
import {
  Users,
  Tags,
  Filter,
  Upload,
  Loader2,
  ArrowRight,
  ArrowLeft,
  X,
  UserCheck,
  Bookmark,
  Kanban,
  Plus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

type AudienceType = AudienceConfig['type'];

interface Step2Props {
  audience: AudienceConfig;
  onUpdate: (audience: AudienceConfig) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step2SelectAudience({
  audience,
  onUpdate,
  onNext,
  onBack,
}: Step2Props) {
  const t = useTranslations('Campaigns.wizard');

  const OPERATOR_OPTIONS = useMemo<{ value: CustomFieldOperator; label: string }[]>(() => [
    { value: 'is', label: t('selectAudience.operatorIs') },
    { value: 'is_not', label: t('selectAudience.operatorIsNot') },
    { value: 'contains', label: t('selectAudience.operatorContains') },
  ], [t]);

  const audienceOptions = useMemo<{
    type: AudienceType;
    label: string;
    description: string;
    icon: typeof Users;
  }[]>(() => [
    {
      type: 'all',
      label: t('selectAudience.method.all'),
      description: t('selectAudience.allDescLoading'),
      icon: Users,
    },
    {
      type: 'tags',
      label: t('selectAudience.method.tags'),
      description: t('selectAudience.tagDesc'),
      icon: Tags,
    },
    {
      type: 'custom_field',
      label: t('selectAudience.method.customField'),
      description: t('selectAudience.customFieldDesc'),
      icon: Filter,
    },
    {
      type: 'csv',
      label: t('selectAudience.method.csv'),
      description: t('selectAudience.csvDesc'),
      icon: Upload,
    },
    {
      type: 'segment',
      label: t('selectAudience.method.segment'),
      description: t('selectAudience.segmentDesc'),
      icon: Bookmark,
    },
    {
      type: 'pipeline_stage',
      label: t('selectAudience.method.pipelineStage'),
      description: t('selectAudience.pipelineStageDesc'),
      icon: Kanban,
    },
    {
      type: 'contacts',
      label: t('selectAudience.method.contacts'),
      description: t('selectAudience.contactsDesc'),
      icon: UserCheck,
    },
  ], [t]);
  const { previewAudience } = useBroadcastSending();
  const [tags, setTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [segments, setSegments] = useState<SegmentSummary[]>([]);
  const [pipelineStages, setPipelineStages] = useState<PipelineStage[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [contactResults, setContactResults] = useState<Contact[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<Contact[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [loadingSegments, setLoadingSegments] = useState(false);
  const [loadingStages, setLoadingStages] = useState(false);
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);

  // Tags are used both by the primary "Filter by Tags" audience type
  // AND by the exclude-list below — so always load once on mount.
  useEffect(() => {
    async function fetchTags() {
      setLoadingTags(true);
      try {
        const supabase = createClient();
        const { data } = await supabase.from('tags').select('*').order('name');
        setTags(data ?? []);
      } finally {
        setLoadingTags(false);
      }
    }
    fetchTags();
  }, []);

  // Lazy-load custom fields only when that audience type is active.
  useEffect(() => {
    if (audience.type !== 'custom_field') return;
    async function fetchFields() {
      setLoadingFields(true);
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('custom_fields')
          .select('*')
          .order('field_name');
        setCustomFields(data ?? []);
      } finally {
        setLoadingFields(false);
      }
    }
    fetchFields();
  }, [audience.type]);

  // Segments — saved tag combinations (migration 040), reused as-is
  // rather than building a second segmentation system.
  useEffect(() => {
    if (audience.type !== 'segment') return;
    async function fetchSegments() {
      setLoadingSegments(true);
      try {
        const supabase = createClient();
        const { data } = await supabase.rpc('list_segments_with_counts');
        setSegments((data ?? []) as SegmentSummary[]);
      } finally {
        setLoadingSegments(false);
      }
    }
    fetchSegments();
  }, [audience.type]);

  // Pipeline stages — same `deals`/`pipeline_stages` tables the Kanban
  // board reads.
  useEffect(() => {
    if (audience.type !== 'pipeline_stage') return;
    async function fetchStages() {
      setLoadingStages(true);
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('pipeline_stages')
          .select('*, pipeline:pipelines(name)')
          .order('position');
        setPipelineStages((data ?? []) as PipelineStage[]);
      } finally {
        setLoadingStages(false);
      }
    }
    fetchStages();
  }, [audience.type]);

  // Individual lead search — section 3's "select leads individually".
  useEffect(() => {
    if (audience.type !== 'contacts') return;
    const query = contactSearch.trim();
    if (query.length < 2) {
      setContactResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
        .limit(20);
      setContactResults(data ?? []);
    }, 250);
    return () => clearTimeout(handle);
  }, [audience.type, contactSearch]);

  // Preview the resolved audience via the same resolver the send
  // engine uses (use-broadcast-sending.ts) — one implementation for
  // "how many will this reach" and "who actually gets messaged",
  // instead of a second, drift-prone estimate query per audience type.
  //
  // Keyed on JSON.stringify(audience) rather than the `audience`
  // object (which is a fresh reference every render from the parent's
  // setState) or `previewAudience` (a plain function re-created every
  // render by useBroadcastSending, not memoized) — either as an effect
  // dependency re-fires this on every render, which starts a new
  // request before the previous one's `finally` ever clears the
  // loading flag, so "Calculating…" never settles.
  useEffect(() => {
    const hasEnoughToPreview =
      audience.type === 'all' ||
      (audience.type === 'tags' && (audience.tagIds?.length ?? 0) > 0) ||
      (audience.type === 'custom_field' &&
        ((audience.customFields?.some((f) => f.fieldId && f.value)) ||
          Boolean(audience.customField?.fieldId && audience.customField.value))) ||
      (audience.type === 'csv' && (audience.csvContacts?.length ?? 0) > 0) ||
      (audience.type === 'contacts' && (audience.contactIds?.length ?? 0) > 0) ||
      (audience.type === 'segment' && Boolean(audience.segmentId)) ||
      (audience.type === 'pipeline_stage' && Boolean(audience.pipelineStageId));

    if (!hasEnoughToPreview) {
      setEstimatedCount(null);
      return;
    }

    let cancelled = false;
    setLoadingCount(true);
    previewAudience(audience)
      .then((contacts) => {
        if (!cancelled) setEstimatedCount(contacts.length);
      })
      .catch(() => {
        if (!cancelled) setEstimatedCount(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingCount(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(audience)]);

  function toggleTag(tagId: string) {
    const current = audience.tagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, tagIds: updated });
  }

  function toggleExcludeTag(tagId: string) {
    const current = audience.excludeTagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, excludeTagIds: updated });
  }

  // Multiple custom-field filters, ANDed (tipo de imóvel + faixa de
  // preço + …). `audience.customField` (singular) is normalized into
  // this list on first edit so older in-progress state still works.
  const customFieldFilters = audience.customFields ??
    (audience.customField ? [audience.customField] : []);

  function updateCustomFieldFilters(next: CustomFieldFilter[]) {
    onUpdate({ ...audience, customFields: next, customField: undefined });
  }

  function addCustomFieldFilter() {
    updateCustomFieldFilters([
      ...customFieldFilters,
      { fieldId: '', operator: 'is' as CustomFieldOperator, value: '' },
    ]);
  }

  function updateCustomFieldFilterAt(index: number, patch: Partial<CustomFieldFilter>) {
    updateCustomFieldFilters(
      customFieldFilters.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    );
  }

  function removeCustomFieldFilterAt(index: number) {
    updateCustomFieldFilters(customFieldFilters.filter((_, i) => i !== index));
  }

  function toggleSelectedContact(contact: Contact) {
    const exists = selectedContacts.some((c) => c.id === contact.id);
    const next = exists
      ? selectedContacts.filter((c) => c.id !== contact.id)
      : [...selectedContacts, contact];
    setSelectedContacts(next);
    onUpdate({ ...audience, contactIds: next.map((c) => c.id) });
  }

  const isValid =
    audience.type === 'all' ||
    (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) ||
    (audience.type === 'custom_field' &&
      customFieldFilters.some((f) => f.fieldId && f.value.length > 0)) ||
    (audience.type === 'csv' &&
      audience.csvContacts &&
      audience.csvContacts.length > 0) ||
    (audience.type === 'segment' && Boolean(audience.segmentId)) ||
    (audience.type === 'pipeline_stage' && Boolean(audience.pipelineStageId)) ||
    (audience.type === 'contacts' && (audience.contactIds?.length ?? 0) > 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('selectAudience.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('selectAudience.subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {audienceOptions.map((option: { type: AudienceType; label: string; description: string; icon: typeof Users }) => {
          const isSelected = audience.type === option.type;
          const Icon = option.icon;
          return (
            <button
              key={option.type}
              onClick={() =>
                onUpdate({
                  ...audience,
                  type: option.type,
                  // Wipe shape fields from other types to avoid stale
                  // config leaking across selections.
                  tagIds: option.type === 'tags' ? audience.tagIds : undefined,
                  customField: undefined,
                  customFields:
                    option.type === 'custom_field' ? audience.customFields : undefined,
                  csvContacts:
                    option.type === 'csv' ? audience.csvContacts : undefined,
                  segmentId: option.type === 'segment' ? audience.segmentId : undefined,
                  pipelineStageId:
                    option.type === 'pipeline_stage' ? audience.pipelineStageId : undefined,
                  contactIds: option.type === 'contacts' ? audience.contactIds : undefined,
                })
              }
              className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                isSelected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                  : 'border-border bg-card/50 hover:border-border'
              }`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  isSelected
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{option.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {option.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {audience.type === 'tags' && (
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">{t('selectAudience.selectTags')}</p>
            {(audience.tagIds?.length ?? 0) >= 2 && (
              <div className="flex gap-1">
                {(['any', 'all'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => onUpdate({ ...audience, matchAll: mode === 'all' })}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                      (audience.matchAll ?? false) === (mode === 'all')
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70'
                    }`}
                  >
                    {mode === 'any'
                      ? t('selectAudience.filterModeAny')
                      : t('selectAudience.filterModeAll')}
                  </button>
                ))}
              </div>
            )}
          </div>
          {loadingTags ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : tags.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('selectAudience.noTagsFound')}
            </p>
          ) : (
            <div className="space-y-3">
              {groupTagsByCategory(tags).map(([category, group]) => (
                <div key={category ?? '__none__'}>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {category ?? t('selectAudience.noCategory')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {group.map((tag) => {
                      const isSelected = audience.tagIds?.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          onClick={() => toggleTag(tag.id)}
                          className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                            isSelected
                              ? 'border-primary/30 bg-primary/10 text-primary'
                              : 'border-border bg-muted text-muted-foreground hover:border-border'
                          }`}
                        >
                          <span
                            className="mr-1.5 h-2 w-2 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {audience.type === 'custom_field' && (
        <div className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
          <p className="text-sm font-medium text-foreground">{t('selectAudience.method.customField')}</p>
          {loadingFields ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : customFields.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('selectAudience.errorLoadFields')}
            </p>
          ) : (
            <div className="space-y-2">
              {customFieldFilters.length === 0 && (
                <p className="text-xs text-muted-foreground">{t('selectAudience.noFiltersYet')}</p>
              )}
              {customFieldFilters.map((filter, index) => (
                <div
                  key={index}
                  className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)_auto]"
                >
                  <select
                    value={filter.fieldId}
                    onChange={(e) => updateCustomFieldFilterAt(index, { fieldId: e.target.value })}
                    className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  >
                    <option value="">{t('selectAudience.selectField')}</option>
                    {customFields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.field_name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={filter.operator}
                    onChange={(e) =>
                      updateCustomFieldFilterAt(index, {
                        operator: e.target.value as CustomFieldOperator,
                      })
                    }
                    className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  >
                    {OPERATOR_OPTIONS.map((op: { value: CustomFieldOperator; label: string }) => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={filter.value}
                    onChange={(e) => updateCustomFieldFilterAt(index, { value: e.target.value })}
                    placeholder={t('selectAudience.valuePlaceholder')}
                    className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => removeCustomFieldFilterAt(index)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted"
                    aria-label={t('selectAudience.removeFilter')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addCustomFieldFilter}
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary/30 hover:text-primary"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('selectAudience.addFilter')}
              </button>
              {customFieldFilters.length > 1 && (
                <p className="text-xs text-muted-foreground">{t('selectAudience.filtersAreAnd')}</p>
              )}
            </div>
          )}
        </div>
      )}

      {audience.type === 'segment' && (
        <div className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
          <p className="text-sm font-medium text-foreground">{t('selectAudience.method.segment')}</p>
          {loadingSegments ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : segments.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('selectAudience.noSegmentsFound')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {segments.map((segment) => {
                const isSelected = audience.segmentId === segment.id;
                return (
                  <button
                    key={segment.id}
                    onClick={() => onUpdate({ ...audience, segmentId: segment.id })}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                      isSelected
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-border bg-muted text-muted-foreground hover:border-border'
                    }`}
                  >
                    {segment.name}
                    <span className="text-muted-foreground/70">({segment.contact_count})</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {audience.type === 'pipeline_stage' && (
        <div className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
          <p className="text-sm font-medium text-foreground">{t('selectAudience.method.pipelineStage')}</p>
          {loadingStages ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : pipelineStages.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('selectAudience.noStagesFound')}</p>
          ) : (
            <select
              value={audience.pipelineStageId ?? ''}
              onChange={(e) => onUpdate({ ...audience, pipelineStageId: e.target.value })}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            >
              <option value="">{t('selectAudience.selectStage')}</option>
              {pipelineStages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.pipeline?.name ? `${stage.pipeline.name} — ${stage.name}` : stage.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {audience.type === 'contacts' && (
        <div className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
          <p className="text-sm font-medium text-foreground">{t('selectAudience.method.contacts')}</p>
          <Input
            value={contactSearch}
            onChange={(e) => setContactSearch(e.target.value)}
            placeholder={t('selectAudience.searchContactsPlaceholder')}
            className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
          />
          {contactResults.length > 0 && (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
              {contactResults.map((contact) => {
                const isSelected = selectedContacts.some((c) => c.id === contact.id);
                return (
                  <button
                    key={contact.id}
                    onClick={() => toggleSelectedContact(contact)}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                      isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    <span>{contact.name || contact.phone}</span>
                    <span className="text-xs text-muted-foreground">{contact.phone}</span>
                  </button>
                );
              })}
            </div>
          )}
          {selectedContacts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedContacts.map((contact) => (
                <span
                  key={contact.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
                >
                  {contact.name || contact.phone}
                  <button onClick={() => toggleSelectedContact(contact)} aria-label={t('selectAudience.removeContact')}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Exclude list — applies regardless of audience type */}
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <X className="h-4 w-4 text-red-400" />
          <p className="text-sm font-medium text-foreground">
            {t('selectAudience.excludeTags')}
          </p>
        </div>
        {tags.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('selectAudience.noTagsFound')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const isExcluded = audience.excludeTagIds?.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleExcludeTag(tag.id)}
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                    isExcluded
                      ? 'border-red-500/30 bg-red-500/10 text-red-300'
                      : 'border-border bg-muted text-muted-foreground hover:border-border'
                  }`}
                >
                  <span
                    className="mr-1.5 h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Audience Summary */}
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <p className="mb-2 text-sm font-medium text-foreground">Audience Summary</p>
        {loadingCount ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">Calculating…</span>
          </div>
        ) : estimatedCount !== null ? (
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm text-foreground">
              {estimatedCount.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">estimated recipients</span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Select an audience type to see the estimate.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={!isValid}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
