'use client';

// ============================================================
// CreatePartnerDialog — "Create Partner" form on the Partners page.
//
// Validates with the same pure validator the API uses, so the user
// gets instant field errors and the server's 400/409 remain the
// authority. Never sends an owner/role field: the server derives the
// parent user from the session.
// ============================================================

import { useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  MAX_COMPANY_NAME_LEN,
  MAX_EMAIL_LEN,
  validatePartnerInvite,
  type PartnerInviteInput,
} from '@/lib/partners/validation';

type Field = keyof PartnerInviteInput;
type FieldErrors = Partial<Record<Field, string>>;

export interface InviteResult {
  emailSent: boolean;
  signupUrl?: string;
  email: string;
}

interface CreatePartnerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: InviteResult) => void;
}

const EMPTY = { companyName: '', email: '', phone: '' };

export function CreatePartnerDialog({ open, onOpenChange, onCreated }: CreatePartnerDialogProps) {
  const t = useTranslations('Partners.create');
  const tErr = useTranslations('Partners.errors');
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setValues(EMPTY);
    setErrors({});
    setSubmitting(false);
  }

  function update(field: Field, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = validatePartnerInvite(values);
    if (!parsed.ok) {
      const next: FieldErrors = {};
      for (const [field, code] of Object.entries(parsed.errors)) {
        next[field as Field] = tErr(code as string);
      }
      setErrors(next);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/partners/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.value),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Map server-side field codes (duplicate account / pending
        // invite / format) back onto the form where possible.
        const fields = (payload.fields ?? {}) as Record<string, string>;
        const mapped: FieldErrors = {};
        for (const [field, code] of Object.entries(fields)) {
          if (field in EMPTY && tErr.has(code)) mapped[field as Field] = tErr(code);
        }
        if (Object.keys(mapped).length > 0) setErrors(mapped);
        else toast.error(payload.error || t('failed'));
        return;
      }

      onCreated({
        emailSent: !!payload.emailSent,
        signupUrl: payload.signupUrl,
        email: parsed.value.email,
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      console.error('[CreatePartnerDialog] submit error:', err);
      toast.error(t('networkError'));
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass =
    'border-border bg-muted text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-primary/20 aria-invalid:border-destructive';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="bg-popover border-border sm:max-w-md">
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('title')}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('description')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            {(
              [
                { field: 'companyName', type: 'text', max: MAX_COMPANY_NAME_LEN, auto: 'organization' },
                { field: 'email', type: 'email', max: MAX_EMAIL_LEN, auto: 'email' },
                { field: 'phone', type: 'tel', max: 32, auto: 'tel' },
              ] as const
            ).map(({ field, type, max, auto }) => (
              <div key={field} className="flex flex-col gap-2">
                <Label htmlFor={`partner-${field}`} className="text-muted-foreground">
                  {t(`${field}Label`)}
                </Label>
                <Input
                  id={`partner-${field}`}
                  type={type}
                  autoComplete={auto}
                  maxLength={max}
                  placeholder={t(`${field}Placeholder`)}
                  value={values[field]}
                  onChange={(e) => update(field, e.target.value)}
                  aria-invalid={!!errors[field]}
                  aria-describedby={errors[field] ? `partner-${field}-error` : undefined}
                  required
                  className={fieldClass}
                />
                {errors[field] ? (
                  <p id={`partner-${field}-error`} className="text-xs text-destructive">
                    {errors[field]}
                  </p>
                ) : field === 'phone' ? (
                  <p className="text-xs text-muted-foreground">{t('phoneHint')}</p>
                ) : null}
              </div>
            ))}
          </div>

          <DialogFooter className="bg-popover border-border">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('sending')}
                </>
              ) : (
                <>
                  <Send className="size-4" />
                  {t('submit')}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
