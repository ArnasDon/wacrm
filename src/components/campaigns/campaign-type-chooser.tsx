'use client';

import { useState } from 'react';
import { ArrowRight, Check, Layers, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

/**
 * First screen of "New campaign": the single-template standard wizard,
 * or the multi-channel advanced one.
 */
export function CampaignTypeChooser({
  name,
  onNameChange,
  onStandard,
  onAdvanced,
}: {
  name: string;
  onNameChange: (name: string) => void;
  onStandard: () => void;
  onAdvanced: () => void;
}) {
  const t = useTranslations('Broadcasts.new.mode');
  const [touched, setTouched] = useState(false);
  const named = name.trim() !== '';
  // The campaign is named before its type is picked.
  const choose = (go: () => void) => () => {
    setTouched(true);
    if (named) go();
  };

  const cards = [
    {
      key: 'standard',
      icon: Send,
      title: t('standardTitle'),
      body: t('standardBody'),
      cta: t('standardCta'),
      onClick: choose(onStandard),
      features: [] as string[],
      badge: null as string | null,
    },
    {
      key: 'advanced',
      icon: Layers,
      title: t('advancedTitle'),
      body: t('advancedBody'),
      cta: t('advancedCta'),
      onClick: choose(onAdvanced),
      features: [
        t('featureChannels'),
        t('featureFallback'),
        t('featureColumns'),
        t('featureSchedule'),
      ],
      badge: t('advancedBadge'),
    },
  ];

  return (
    <div className="space-y-6">
      <section className="bg-card border-border rounded-xl border p-5">
        <label
          htmlFor="campaign-name"
          className="text-foreground block text-sm font-medium"
        >
          {t('nameLabel')}
        </label>
        <p className="text-muted-foreground mt-0.5 text-xs">{t('nameHint')}</p>
        <input
          id="campaign-name"
          autoFocus
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('namePlaceholder')}
          maxLength={120}
          aria-invalid={touched && !named}
          className={cn(
            'bg-background focus-visible:border-ring mt-3 h-11 w-full rounded-md border px-3 text-sm outline-none',
            touched && !named ? 'border-red-500' : 'border-border'
          )}
        />
        {touched && !named ? (
          <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">
            {t('nameRequired')}
          </p>
        ) : null}
      </section>
      <div>
        <h2 className="text-foreground text-lg font-semibold">{t('title')}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map(
          ({ key, icon: Icon, title, body, cta, onClick, features, badge }) => (
            <button
              key={key}
              type="button"
              onClick={onClick}
              className={cn(
                'group bg-card focus-visible:ring-ring flex flex-col rounded-xl border p-6 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2 focus-visible:outline-none',
                !named && 'opacity-60',
                key === 'advanced'
                  ? 'border-primary/40 hover:border-primary'
                  : 'border-border hover:border-foreground/30'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  className={cn(
                    'flex size-11 items-center justify-center rounded-lg',
                    key === 'advanced'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-foreground'
                  )}
                >
                  <Icon className="size-5" />
                </span>
                {badge ? (
                  <span className="border-primary/30 bg-primary/10 text-primary rounded-full border px-2.5 py-0.5 font-mono text-[11px] tracking-[0.15em] uppercase">
                    {badge}
                  </span>
                ) : null}
              </div>
              <h3 className="text-foreground mt-4 text-base font-semibold">
                {title}
              </h3>
              <p className="text-muted-foreground mt-1 text-sm">{body}</p>
              {features.length > 0 ? (
                <ul className="mt-4 space-y-1.5">
                  {features.map((f) => (
                    <li
                      key={f}
                      className="text-foreground flex items-start gap-2 text-sm"
                    >
                      <Check className="text-primary mt-0.5 size-4 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              ) : null}
              <span className="text-primary mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-medium">
                {cta}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          )
        )}
      </div>
    </div>
  );
}
