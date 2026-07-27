'use client';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type FreeTextMediaKind = 'image' | 'video' | 'document' | 'audio' | '';

interface Step1ComposeTextProps {
  bodyText: string;
  onBodyTextChange: (text: string) => void;
  mediaUrl: string;
  onMediaUrlChange: (url: string) => void;
  mediaKind: FreeTextMediaKind;
  onMediaKindChange: (kind: FreeTextMediaKind) => void;
  onNext: () => void;
  onBack: () => void;
}

/**
 * Step 1 for accounts on a non-Meta provider (uazapi): a free-text
 * composer instead of the approved-template picker. Meta requires
 * pre-approved templates for business-initiated broadcasts — that's
 * Meta's own policy, and uazapi has no equivalent pipeline, so this
 * account type composes the message directly instead.
 *
 * Personalization reuses the same {{1}}/{{2}} positional convention
 * templates already use — Step3Personalize maps them exactly the same
 * way regardless of which composer produced the body text.
 */
export function Step1ComposeText({
  bodyText,
  onBodyTextChange,
  mediaUrl,
  onMediaUrlChange,
  mediaKind,
  onMediaKindChange,
  onNext,
  onBack,
}: Step1ComposeTextProps) {
  const t = useTranslations('Broadcasts.wizard.composeText');
  const canProceed = bodyText.trim().length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
        <label className="block text-sm font-medium text-foreground">{t('bodyLabel')}</label>
        <textarea
          value={bodyText}
          onChange={(e) => onBodyTextChange(e.target.value)}
          placeholder={t('bodyPlaceholder')}
          rows={6}
          className="w-full resize-y rounded-lg border border-border bg-muted p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <p className="text-xs text-muted-foreground">{t('bodyHint')}</p>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
        <label className="block text-sm font-medium text-foreground">{t('mediaLabel')}</label>
        <p className="text-xs text-muted-foreground">{t('mediaHint')}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            value={mediaKind || undefined}
            onValueChange={(val) => onMediaKindChange(val as FreeTextMediaKind)}
          >
            <SelectTrigger className="w-full border-border bg-muted text-foreground">
              <SelectValue placeholder={t('mediaKindPlaceholder')} />
            </SelectTrigger>
            <SelectContent className="border-border bg-popover">
              <SelectItem value="image">{t('mediaKindImage')}</SelectItem>
              <SelectItem value="video">{t('mediaKindVideo')}</SelectItem>
              <SelectItem value="document">{t('mediaKindDocument')}</SelectItem>
              <SelectItem value="audio">{t('mediaKindAudio')}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="url"
            value={mediaUrl}
            onChange={(e) => onMediaUrlChange(e.target.value)}
            placeholder={t('mediaUrlPlaceholder')}
            disabled={!mediaKind}
            className="border-border bg-muted text-foreground placeholder:text-muted-foreground disabled:opacity-50"
          />
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={onBack} className="border-border text-muted-foreground">
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={!canProceed}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
