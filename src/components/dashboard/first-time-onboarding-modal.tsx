'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Sparkles,
  Building2,
  MessageSquare,
  Users,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  ShoppingBag,
  ExternalLink,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const INDUSTRIES = [
  'Jewellery & Luxury Retail',
  'Real Estate & Developers',
  'Coaching & Education',
  'E-Commerce & D2C',
  'Healthcare & Clinics',
  'Automobile Dealership',
  'B2B Wholesale / Services',
];

export function FirstTimeOnboardingModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [industry, setIndustry] = useState(INDUSTRIES[0]);
  const [businessName, setBusinessName] = useState('');

  useEffect(() => {
    // Show only if user has never completed or dismissed the first-time modal
    const completed = localStorage.getItem('wacrm_ft_onboarding_completed');

    if (!completed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
    }
  }, []);

  const handleFinish = () => {
    localStorage.setItem('wacrm_ft_onboarding_completed', 'true');
    setOpen(false);
  };

  const handleDismiss = () => {
    localStorage.setItem('wacrm_ft_onboarding_completed', 'true');
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(val) => !val && handleDismiss()}>
      <DialogContent className="sm:max-w-[540px] p-6 bg-card border-border">
        {/* Step Indicator */}
        <div className="flex items-center justify-between pb-3 border-b border-border text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 font-semibold text-primary">
            <Sparkles className="h-4 w-4" />
            <span>Workspace Setup Guide</span>
          </div>
          <span className="font-medium">Step {step} of 4</span>
        </div>

        {/* Step 1: Business Profile */}
        {step === 1 && (
          <div className="space-y-4 py-2">
            <DialogHeader>
              <DialogTitle className="text-xl flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Tell us about your business
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                We customize your sales pipeline, currency, and WhatsApp automations to match your industry.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 pt-2">
              <div>
                <label className="text-xs font-medium text-foreground block mb-1">Business / Brand Name</label>
                <input
                  type="text"
                  placeholder="e.g. Tanisha Jewellers, Apex Coaching"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="w-full text-sm rounded-lg border border-border bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-foreground block mb-1.5">Primary Industry</label>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                  {INDUSTRIES.map((ind) => (
                    <button
                      key={ind}
                      type="button"
                      onClick={() => setIndustry(ind)}
                      className={`text-left p-2 rounded-lg border text-xs font-medium transition-all ${
                        industry === ind
                          ? 'border-primary bg-primary/10 text-primary font-semibold'
                          : 'border-border bg-muted/20 text-muted-foreground hover:bg-muted/40'
                      }`}
                    >
                      {ind}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter className="pt-4 flex justify-between sm:justify-between w-full">
              <Button variant="ghost" size="sm" onClick={handleDismiss}>
                Skip Setup
              </Button>
              <Button size="sm" onClick={() => setStep(2)} className="gap-1.5">
                Continue <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Connect WhatsApp */}
        {step === 2 && (
          <div className="space-y-4 py-2">
            <DialogHeader>
              <DialogTitle className="text-xl flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-emerald-500" />
                Connect Your WhatsApp Number
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                WACRM connects directly through Meta&apos;s Official WhatsApp Cloud API so you never risk ban penalties.
              </DialogDescription>
            </DialogHeader>

            <div className="p-4 rounded-xl border border-border bg-muted/20 space-y-3 text-xs text-muted-foreground">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-foreground">Official Meta Cloud API:</strong> Verified green tick eligibility, high throughput, and multi-agent shared inbox.
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-foreground">Two-Minute Setup:</strong> Copy your Phone Number ID and Access Token from your Meta Developer portal.
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <Link
                href="/settings"
                onClick={handleFinish}
                className="w-full text-center text-xs font-semibold py-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm flex items-center justify-center gap-1.5"
              >
                Go to WhatsApp Configuration <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>

            <DialogFooter className="pt-4 flex justify-between sm:justify-between w-full">
              <Button variant="outline" size="sm" onClick={() => setStep(1)} className="gap-1">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              <Button size="sm" onClick={() => setStep(3)} className="gap-1.5">
                Next Step <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 3: Contacts & Catalog */}
        {step === 3 && (
          <div className="space-y-4 py-2">
            <DialogHeader>
              <DialogTitle className="text-xl flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Import Contacts &amp; Products
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Start by uploading your existing customer phone list or creating product payment links.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <Link
                href="/contacts"
                onClick={handleFinish}
                className="p-3.5 rounded-xl border border-border bg-card/60 hover:border-primary/40 hover:bg-muted/30 transition text-left space-y-1.5 block group"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Users className="h-4 w-4" />
                </div>
                <h4 className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                  Import CSV Contacts
                </h4>
                <p className="text-[11px] text-muted-foreground line-clamp-2">
                  Upload customer mobile numbers with custom tags.
                </p>
              </Link>

              <Link
                href="/products"
                onClick={handleFinish}
                className="p-3.5 rounded-xl border border-border bg-card/60 hover:border-primary/40 hover:bg-muted/30 transition text-left space-y-1.5 block group"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                  <ShoppingBag className="h-4 w-4" />
                </div>
                <h4 className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                  Product Catalog
                </h4>
                <p className="text-[11px] text-muted-foreground line-clamp-2">
                  Add items to send 1-tap WhatsApp payment links.
                </p>
              </Link>
            </div>

            <DialogFooter className="pt-4 flex justify-between sm:justify-between w-full">
              <Button variant="outline" size="sm" onClick={() => setStep(2)} className="gap-1">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              <Button size="sm" onClick={() => setStep(4)} className="gap-1.5">
                Next <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 4: Ready! */}
        {step === 4 && (
          <div className="space-y-4 py-2 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
              <CheckCircle2 className="h-6 w-6" />
            </div>

            <DialogHeader className="text-center">
              <DialogTitle className="text-xl">Your Workspace is Ready!</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                You have 14 days of free access to all Growth features: Multi-Agent Inbox, Visual Automations, and Broadcasts.
              </DialogDescription>
            </DialogHeader>

            <div className="py-2 flex items-center justify-center gap-2">
              <Badge variant="outline" className="text-xs font-semibold px-2.5 py-0.5">
                {industry}
              </Badge>
              <Badge variant="outline" className="text-xs font-semibold px-2.5 py-0.5 text-emerald-500 border-emerald-500/30">
                14-Day Free Trial
              </Badge>
            </div>

            <DialogFooter className="pt-4 flex justify-center sm:justify-center w-full">
              <Button onClick={handleFinish} className="w-full gap-1.5">
                Go to Workspace Dashboard <ArrowRight className="h-4 w-4" />
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
