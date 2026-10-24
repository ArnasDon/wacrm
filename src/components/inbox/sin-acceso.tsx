'use client';

import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function SinAcceso({ onVolver }: { onVolver: () => void }) {
  const t = useTranslations('Inbox.visibilidad');
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <Lock className="h-8 w-8 text-muted-foreground" />
      <h2 className="text-base font-medium text-foreground">
        {t('sinAccesoTitulo')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('sinAccesoTexto')}</p>
      <button
        type="button"
        onClick={onVolver}
        className="rounded-md bg-muted px-3 py-1.5 text-sm text-foreground hover:bg-muted/70"
      >
        {t('volver')}
      </button>
    </div>
  );
}
