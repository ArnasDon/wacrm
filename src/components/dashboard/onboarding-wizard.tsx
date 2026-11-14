'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  BookOpen,
  MessageSquare,
  UserPlus,
  ShoppingBag,
  Zap,
  ArrowRight,
  Sparkles,
  X,
} from 'lucide-react';

interface Step {
  id: string;
  title: string;
  description: string;
  href: string;
  icon: typeof MessageSquare;
}

const STEPS: Step[] = [
  {
    id: 'whatsapp',
    title: 'Connect WhatsApp Number',
    description: 'Connect your business number in 2 clicks via Meta.',
    href: '/settings',
    icon: MessageSquare,
  },
  {
    id: 'contact',
    title: 'Add First Contact',
    description: 'Import customer contacts or create your first lead manually.',
    href: '/contacts',
    icon: UserPlus,
  },
  {
    id: 'products',
    title: 'Catalog & Payments',
    description: 'Set up product pricing & 1-tap WhatsApp payment links.',
    href: '/products',
    icon: ShoppingBag,
  },
  {
    id: 'automation',
    title: 'Launch Conversational Bot',
    description: 'Activate instant auto-replies or automated welcome flows.',
    href: '/automations',
    icon: Zap,
  },
];

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  return () => window.removeEventListener('storage', callback);
}

function getDismissedSnapshot() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('wacrm_onboarding_dismissed') === 'true';
}

function getDismissedServerSnapshot() {
  return false;
}

export function OnboardingWizard() {
  const dismissed = useSyncExternalStore(
    subscribe,
    getDismissedSnapshot,
    getDismissedServerSnapshot
  );

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem('wacrm_onboarding_dismissed', 'true');
    window.dispatchEvent(new Event('storage'));
  };

  const completedCount = 0;
  const progressPercent = Math.round((completedCount / STEPS.length) * 100);

  return (
    <Card className="border-primary/20 bg-gradient-to-r from-primary/5 via-card to-card relative overflow-hidden shadow-sm">
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="bg-primary/10 text-primary flex h-6 w-6 items-center justify-center rounded-full">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <h3 className="text-foreground text-base font-semibold">
                Welcome to WACRM! Getting Started Checklist
              </h3>
            </div>
            <p className="text-muted-foreground text-sm">
              Complete these {STEPS.length} simple steps to launch your WhatsApp CRM and start acquiring customers.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/help"
              className="border-border bg-card hover:bg-muted text-foreground flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition"
            >
              <BookOpen className="text-primary h-3.5 w-3.5" />
              <span>Implementation & Meta Guides</span>
            </Link>
            <button
              onClick={handleDismiss}
              className="text-muted-foreground hover:text-foreground rounded-md p-1 transition-colors"
              title="Dismiss checklist"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-4 flex items-center gap-3">
          <Progress value={progressPercent} className="h-2 flex-1" />
          <span className="text-muted-foreground text-xs font-semibold">
            {completedCount}/{STEPS.length} Completed ({progressPercent}%)
          </span>
        </div>

        {/* Steps Grid */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <Link
                key={step.id}
                href={step.href}
                className="group border-border bg-card/60 hover:bg-muted/50 hover:border-primary/30 flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="bg-muted text-primary flex h-7 w-7 items-center justify-center rounded-lg">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="text-muted-foreground text-xs font-medium">
                      Step {index + 1}
                    </span>
                  </div>
                  <div>
                    <h4 className="text-foreground group-hover:text-primary text-sm font-medium transition-colors">
                      {step.title}
                    </h4>
                    <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                      {step.description}
                    </p>
                  </div>
                </div>
                <div className="text-primary mt-3 flex items-center gap-1 text-xs font-medium transition-transform group-hover:translate-x-0.5">
                  <span>Start step</span>
                  <ArrowRight className="h-3 w-3" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
