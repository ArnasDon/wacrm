'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

export interface CampaignStep {
  /** Clave estable para React keys y traducción. */
  key: string;
  /** Clave de traducción dentro del namespace de pasos. */
  labelKey: string;
}

interface CampaignStepperProps {
  /** Posición actual (0-based). */
  currentStep: number;
  /** Lista ordenada de pasos del wizard. */
  steps: readonly CampaignStep[];
  /** Namespace de next-intl donde viven `steps.<labelKey>`. */
  t?: (key: string) => string;
}

/**
 * Stepper de pasos numerados para los wizards de campaña (Broadcast y
 * Email). Rendering puro, sin estado — el padre controla `currentStep`.
 *
 * Extraído del wizard de broadcast (`broadcasts/new`) para compartirse
 * entre `broadcasts/new` y `email/new` sin duplicar la lógica visual.
 */
export function CampaignStepper({ currentStep, steps, t }: CampaignStepperProps) {
  return (
    <div className="flex items-center justify-between">
      {steps.map((step, index) => {
        const isActive = index === currentStep;
        const isCompleted = index < currentStep;

        return (
          <div key={step.key} className="flex flex-1 items-center">
            <div className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-all ${
                  isCompleted
                    ? 'bg-primary text-primary-foreground'
                    : isActive
                      ? 'border-2 border-primary bg-primary/10 text-primary'
                      : 'border border-border bg-muted text-muted-foreground'
                }`}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : index + 1}
              </div>
              {t && (
                <span
                  className={`hidden text-sm font-medium sm:block ${
                    isActive
                      ? 'text-foreground'
                      : isCompleted
                        ? 'text-primary'
                        : 'text-muted-foreground'
                  }`}
                >
                  {t(`steps.${step.labelKey}`)}
                </span>
              )}
            </div>
            {index < steps.length - 1 && (
              <div
                className={`mx-3 h-px flex-1 ${
                  index < currentStep ? 'bg-primary' : 'bg-muted'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
