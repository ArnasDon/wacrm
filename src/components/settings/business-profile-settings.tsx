'use client';

// ============================================================
// BusinessProfileSettings — AI Agents → Setup → Business Profile
// (AI optimization project, FASE 6).
//
// Structured business identity/contact/location/hours/delivery/
// payment/policy/links/FAQ info the agent draws on for exactly the
// class of question routing.ts already recognizes as Knowledge-shaped
// (horario, ubicación, delivery, pagos, "¿quién atiende ventas?") —
// see business-profile/context.ts's buildBusinessProfileContext and
// auto-reply.ts's routing.useKnowledge gate. READ-ONLY to the agent
// (Parte 19): this Settings panel is the only place any of it is ever
// written.
//
// Rendered from ai-config.tsx (AI Agents → Setup), not the generic
// Settings rail — same precedent as DataSourcesSettings/
// CatalogIntegrationsSettings (every source the agent itself consults
// lives there).
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Save, Trash2, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DestructiveConfirmDialog } from '@/components/ui/destructive-confirm-dialog';
import { RequireRole } from '@/components/auth/require-role';
import { SettingsPanelHead } from './settings-panel-head';
import { WEEKDAYS, type Weekday, type DayHours, type BusinessHours, type BusinessLink, type BusinessFaqItem, type BusinessProfileRow } from '@/lib/ai/business-profile/types';

export interface ProfileState {
  businessName: string;
  description: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  address: string;
  city: string;
  state: string;
  country: string;
  googleMapsUrl: string;
  businessHours: BusinessHours;
  deliveryEnabled: boolean;
  deliveryDescription: string;
  deliveryCoverageAreas: string; // comma-separated in the UI, array on the wire
  paymentMethods: string; // comma-separated in the UI, array on the wire
  warrantyPolicy: string;
  returnPolicy: string;
  financingPolicy: string;
  deliveryPolicy: string;
  links: BusinessLink[];
  faq: BusinessFaqItem[];
}

const EMPTY_PROFILE: ProfileState = {
  businessName: '',
  description: '',
  phone: '',
  whatsapp: '',
  email: '',
  website: '',
  address: '',
  city: '',
  state: '',
  country: '',
  googleMapsUrl: '',
  businessHours: {},
  deliveryEnabled: false,
  deliveryDescription: '',
  deliveryCoverageAreas: '',
  paymentMethods: '',
  warrantyPolicy: '',
  returnPolicy: '',
  financingPolicy: '',
  deliveryPolicy: '',
  links: [],
  faq: [],
};

// Root cause of the "data vanishes after saving/reloading" bug: this
// used to be a hand-written interface with snake_case field names
// (business_name, google_maps_url, ...), but GET/PUT /api/ai/business-
// profile actually return `BusinessProfileRow` — the camelCase shape
// service.ts's toProfile() produces (businessName, googleMapsUrl, ...).
// Every single-word field (phone, address, city, ...) happens to be
// spelled the same in both conventions, so those looked fine; every
// multi-word field never matched anything and silently fell back to
// its empty default on every load AND every post-save resync. Using
// the real shared type here — instead of a hand-rolled duplicate — is
// what makes that class of drift impossible to reintroduce.
export function fromApi(row: BusinessProfileRow | null): ProfileState {
  if (!row) return EMPTY_PROFILE;
  return {
    businessName: row.businessName ?? '',
    description: row.description ?? '',
    phone: row.phone ?? '',
    whatsapp: row.whatsapp ?? '',
    email: row.email ?? '',
    website: row.website ?? '',
    address: row.address ?? '',
    city: row.city ?? '',
    state: row.state ?? '',
    country: row.country ?? '',
    googleMapsUrl: row.googleMapsUrl ?? '',
    businessHours: row.businessHours ?? {},
    deliveryEnabled: row.deliveryEnabled ?? false,
    deliveryDescription: row.deliveryDescription ?? '',
    deliveryCoverageAreas: (row.deliveryCoverageAreas ?? []).join(', '),
    paymentMethods: (row.paymentMethods ?? []).join(', '),
    warrantyPolicy: row.warrantyPolicy ?? '',
    returnPolicy: row.returnPolicy ?? '',
    financingPolicy: row.financingPolicy ?? '',
    deliveryPolicy: row.deliveryPolicy ?? '',
    links: row.links ?? [],
    faq: row.faq ?? [],
  };
}

function toApiBody(p: ProfileState) {
  return {
    business_name: p.businessName.trim() || null,
    description: p.description.trim() || null,
    phone: p.phone.trim() || null,
    whatsapp: p.whatsapp.trim() || null,
    email: p.email.trim() || null,
    website: p.website.trim() || null,
    address: p.address.trim() || null,
    city: p.city.trim() || null,
    state: p.state.trim() || null,
    country: p.country.trim() || null,
    google_maps_url: p.googleMapsUrl.trim() || null,
    business_hours: p.businessHours,
    delivery_enabled: p.deliveryEnabled,
    delivery_description: p.deliveryDescription.trim() || null,
    delivery_coverage_areas: p.deliveryCoverageAreas
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    payment_methods: p.paymentMethods
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    warranty_policy: p.warrantyPolicy.trim() || null,
    return_policy: p.returnPolicy.trim() || null,
    financing_policy: p.financingPolicy.trim() || null,
    delivery_policy: p.deliveryPolicy.trim() || null,
    links: p.links,
    faq: p.faq,
  };
}

// ------------------------------------------------------------
// Per-section save (Parte "Business Profile robustness" fix).
//
// Root cause of the original bug: ONE button sent the ENTIRE `profile`
// snapshot on every save. Two browser tabs (or one tab left open across
// a page reload with unsaved edits in a different section) could each
// hold a different, incomplete copy of the form — whichever saved LAST
// silently overwrote every other section back to whatever ITS stale
// snapshot had, even fields it never touched. The API/service layer
// already supported a true partial update (only keys present in the
// body are written — see upsertBusinessProfile's `!== undefined`
// contract); this UI simply never used that capability.
//
// The fix: one save button per section, each sending ONLY that
// section's snake_case keys. `SECTION_API_FIELDS` partitions every key
// `toApiBody()` can produce into exactly one section — the assertion in
// this file's test suite guards that partition against ever going out
// of sync with `toApiBody()` again.
// ------------------------------------------------------------

type SectionKey = 'identity' | 'location' | 'hours' | 'delivery' | 'policies' | 'linksFaq';

type ApiBody = ReturnType<typeof toApiBody>;

const SECTION_API_FIELDS: Record<SectionKey, (keyof ApiBody)[]> = {
  identity: ['business_name', 'description', 'phone', 'whatsapp', 'email', 'website'],
  location: ['address', 'city', 'state', 'country', 'google_maps_url'],
  hours: ['business_hours'],
  delivery: ['delivery_enabled', 'delivery_description', 'delivery_coverage_areas', 'payment_methods'],
  policies: ['warranty_policy', 'return_policy', 'financing_policy', 'delivery_policy'],
  linksFaq: ['links', 'faq'],
};

/** The exact partial body one section's Guardar button sends — every
 *  other key is genuinely ABSENT (not `undefined`-valued, actually
 *  missing from the JSON), so the API's `readString`/`readStringArray`
 *  treat it as "leave unchanged" rather than "clear it". */
function buildSectionBody(section: SectionKey, p: ProfileState): Partial<ApiBody> {
  const full = toApiBody(p);
  const body: Partial<ApiBody> = {};
  for (const key of SECTION_API_FIELDS[section]) {
    (body as Record<string, unknown>)[key] = full[key];
  }
  return body;
}

interface DepartmentRow {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
}

interface ContactRow {
  id: string;
  department_id: string | null;
  name: string;
  role_title: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
}

export function BusinessProfileSettings() {
  const t = useTranslations('Settings.businessProfile');
  const [loading, setLoading] = useState(true);
  // Which section is currently saving, if any. ALL section buttons are
  // disabled while this is non-null — simpler and safer than allowing
  // concurrent section saves, at the cost of a very brief (one network
  // round trip) disable of unrelated buttons.
  const [savingSection, setSavingSection] = useState<SectionKey | null>(null);
  const [profile, setProfile] = useState<ProfileState>(EMPTY_PROFILE);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/business-profile', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('loadFailed'));
        return;
      }
      setProfile(fromApi(data.profile));
      setDepartments(data.departments ?? []);
      setContacts(data.contacts ?? []);
    } catch {
      toast.error(t('networkError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Saves ONLY `section`'s fields (see buildSectionBody). On success the
  // form is resynced from the server's full row, not just the section
  // just saved — every other field comes back exactly as Supabase has
  // it, self-healing any staleness the rest of the form may have
  // accumulated (e.g. a change another admin made meanwhile).
  async function saveSection(section: SectionKey) {
    if (savingSection) return; // belt-and-suspenders; buttons are also disabled while saving
    setSavingSection(section);
    try {
      const res = await fetch('/api/ai/business-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSectionBody(section, profile)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('saveFailed'));
        return;
      }
      toast.success(t('saveSuccess'));
      setProfile(fromApi(data.profile));
    } catch {
      toast.error(t('networkError'));
    } finally {
      setSavingSection(null);
    }
  }

  function setDay(day: Weekday, patch: Partial<DayHours>) {
    setProfile((prev) => ({
      ...prev,
      businessHours: {
        ...prev.businessHours,
        [day]: { enabled: false, open: null, close: null, ...prev.businessHours[day], ...patch },
      },
    }));
  }

  function addLink() {
    setProfile((prev) => ({ ...prev, links: [...prev.links, { label: '', url: '', type: 'website' }] }));
  }
  function updateLink(index: number, patch: Partial<BusinessLink>) {
    setProfile((prev) => ({
      ...prev,
      links: prev.links.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    }));
  }
  function removeLink(index: number) {
    setProfile((prev) => ({ ...prev, links: prev.links.filter((_, i) => i !== index) }));
  }

  function addFaq() {
    setProfile((prev) => ({ ...prev, faq: [...prev.faq, { question: '', answer: '' }] }));
  }
  function updateFaq(index: number, patch: Partial<BusinessFaqItem>) {
    setProfile((prev) => ({ ...prev, faq: prev.faq.map((f, i) => (i === index ? { ...f, ...patch } : f)) }));
  }
  function removeFaq(index: number) {
    setProfile((prev) => ({ ...prev, faq: prev.faq.filter((_, i) => i !== index) }));
  }

  const WEEKDAY_LABEL: Record<Weekday, string> = {
    monday: t('monday'),
    tuesday: t('tuesday'),
    wednesday: t('wednesday'),
    thursday: t('thursday'),
    friday: t('friday'),
    saturday: t('saturday'),
    sunday: t('sunday'),
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('identityTitle')}</CardTitle>
          <CardDescription>{t('identityDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('businessName')}</Label>
              <Input value={profile.businessName} onChange={(e) => setProfile((p) => ({ ...p, businessName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('phone')}</Label>
              <Input value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('descriptionLabel')}</Label>
            <Textarea
              value={profile.description}
              onChange={(e) => setProfile((p) => ({ ...p, description: e.target.value }))}
              rows={2}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('whatsapp')}</Label>
              <Input value={profile.whatsapp} onChange={(e) => setProfile((p) => ({ ...p, whatsapp: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('email')}</Label>
              <Input value={profile.email} onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('website')}</Label>
              <Input value={profile.website} onChange={(e) => setProfile((p) => ({ ...p, website: e.target.value }))} />
            </div>
          </div>
          <SectionSaveButton section="identity" savingSection={savingSection} onSave={saveSection} label={t('save')} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('locationTitle')}</CardTitle>
          <CardDescription>{t('locationDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('address')}</Label>
            <Input value={profile.address} onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('city')}</Label>
              <Input value={profile.city} onChange={(e) => setProfile((p) => ({ ...p, city: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('state')}</Label>
              <Input value={profile.state} onChange={(e) => setProfile((p) => ({ ...p, state: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('country')}</Label>
              <Input value={profile.country} onChange={(e) => setProfile((p) => ({ ...p, country: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('googleMapsUrl')}</Label>
            <Input value={profile.googleMapsUrl} onChange={(e) => setProfile((p) => ({ ...p, googleMapsUrl: e.target.value }))} />
          </div>
          <SectionSaveButton section="location" savingSection={savingSection} onSave={saveSection} label={t('save')} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('hoursTitle')}</CardTitle>
          <CardDescription>{t('hoursDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {WEEKDAYS.map((day) => {
            const entry = profile.businessHours[day];
            const enabled = entry?.enabled ?? false;
            return (
              <div key={day} className="flex flex-wrap items-center gap-3 py-1">
                <label className="flex w-32 shrink-0 cursor-pointer items-center gap-2">
                  <Checkbox checked={enabled} onCheckedChange={(c) => setDay(day, { enabled: c === true })} />
                  <span className="text-foreground text-sm">{WEEKDAY_LABEL[day]}</span>
                </label>
                {enabled ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      className="w-28"
                      value={entry?.open ?? ''}
                      onChange={(e) => setDay(day, { open: e.target.value })}
                    />
                    <span className="text-muted-foreground text-sm">{t('to')}</span>
                    <Input
                      type="time"
                      className="w-28"
                      value={entry?.close ?? ''}
                      onChange={(e) => setDay(day, { close: e.target.value })}
                    />
                  </div>
                ) : (
                  <span className="text-muted-foreground text-xs">{t('closed')}</span>
                )}
              </div>
            );
          })}
          <SectionSaveButton section="hours" savingSection={savingSection} onSave={saveSection} label={t('save')} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('deliveryTitle')}</CardTitle>
          <CardDescription>{t('deliveryDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-center gap-2.5">
            <Checkbox
              checked={profile.deliveryEnabled}
              onCheckedChange={(c) => setProfile((p) => ({ ...p, deliveryEnabled: c === true }))}
            />
            <span className="text-foreground text-sm">{t('deliveryEnabled')}</span>
          </label>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('deliveryDetails')}</Label>
            <Textarea
              value={profile.deliveryDescription}
              onChange={(e) => setProfile((p) => ({ ...p, deliveryDescription: e.target.value }))}
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('coverageAreas')}</Label>
            <Input
              value={profile.deliveryCoverageAreas}
              onChange={(e) => setProfile((p) => ({ ...p, deliveryCoverageAreas: e.target.value }))}
              placeholder={t('commaSeparatedPlaceholder')}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('paymentMethods')}</Label>
            <Input
              value={profile.paymentMethods}
              onChange={(e) => setProfile((p) => ({ ...p, paymentMethods: e.target.value }))}
              placeholder={t('commaSeparatedPlaceholder')}
            />
          </div>
          <SectionSaveButton section="delivery" savingSection={savingSection} onSave={saveSection} label={t('save')} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('policiesTitle')}</CardTitle>
          <CardDescription>{t('policiesDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('warrantyPolicy')}</Label>
            <Textarea rows={2} value={profile.warrantyPolicy} onChange={(e) => setProfile((p) => ({ ...p, warrantyPolicy: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('returnPolicy')}</Label>
            <Textarea rows={2} value={profile.returnPolicy} onChange={(e) => setProfile((p) => ({ ...p, returnPolicy: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('financingPolicy')}</Label>
            <Textarea rows={2} value={profile.financingPolicy} onChange={(e) => setProfile((p) => ({ ...p, financingPolicy: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('deliveryPolicy')}</Label>
            <Textarea rows={2} value={profile.deliveryPolicy} onChange={(e) => setProfile((p) => ({ ...p, deliveryPolicy: e.target.value }))} />
          </div>
          <div className="sm:col-span-2">
            <SectionSaveButton section="policies" savingSection={savingSection} onSave={saveSection} label={t('save')} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('linksTitle')}</CardTitle>
          <CardDescription>{t('linksDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {profile.links.map((link, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Input
                className="w-40"
                placeholder={t('linkLabelPlaceholder')}
                value={link.label}
                onChange={(e) => updateLink(i, { label: e.target.value })}
              />
              <Input
                className="min-w-0 flex-1"
                placeholder="https://…"
                value={link.url}
                onChange={(e) => updateLink(i, { url: e.target.value })}
              />
              <Button variant="outline" size="sm" onClick={() => removeLink(i)}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addLink}>
            <Plus className="size-3.5" />
            {t('addLink')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('faqTitle')}</CardTitle>
          <CardDescription>{t('faqDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {profile.faq.map((item, i) => (
            <div key={i} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-start gap-2">
                <Input
                  className="min-w-0 flex-1"
                  placeholder={t('faqQuestionPlaceholder')}
                  value={item.question}
                  onChange={(e) => updateFaq(i, { question: e.target.value })}
                />
                <Button variant="outline" size="sm" onClick={() => removeFaq(i)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              <Textarea
                rows={2}
                placeholder={t('faqAnswerPlaceholder')}
                value={item.answer}
                onChange={(e) => updateFaq(i, { answer: e.target.value })}
              />
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addFaq}>
            <Plus className="size-3.5" />
            {t('addFaqItem')}
          </Button>
          {/* Shared button — Links and FAQ save together as one section
              (per the agreed section grouping), each sending only its
              own two keys (`links`, `faq`), never touching any other
              field. */}
          <SectionSaveButton section="linksFaq" savingSection={savingSection} onSave={saveSection} label={t('save')} />
        </CardContent>
      </Card>

      <DirectoryCard departments={departments} contacts={contacts} onChanged={load} />
    </section>
  );
}

// ------------------------------------------------------------
// One save button per Business Profile section. Admin-gated exactly
// like the old single button was; disabled while ANY section is
// saving (not just this one) — see the `savingSection` state doc in
// BusinessProfileSettings for why a global guard was chosen over
// allowing sections to save concurrently.
// ------------------------------------------------------------
function SectionSaveButton({
  section,
  savingSection,
  onSave,
  label,
}: {
  section: SectionKey;
  savingSection: SectionKey | null;
  onSave: (section: SectionKey) => void;
  label: string;
}) {
  const isSaving = savingSection === section;
  return (
    <RequireRole min="admin">
      <div className="flex justify-end pt-2">
        <Button onClick={() => onSave(section)} disabled={savingSection !== null}>
          {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {label}
        </Button>
      </div>
    </RequireRole>
  );
}

// ------------------------------------------------------------
// Departments + contacts directory — separate CRUD entities, same
// list+dialog pattern as DataSourcesSettings. A contact belongs to
// zero-or-one department (Parte 7); `notes` is intentionally the only
// field never surfaced to the agent (see context.ts's doc), but IS
// editable here since it's a plain internal admin annotation.
// ------------------------------------------------------------
function DirectoryCard({
  departments,
  contacts,
  onChanged,
}: {
  departments: DepartmentRow[];
  contacts: ContactRow[];
  onChanged: () => void;
}) {
  const t = useTranslations('Settings.businessProfile');
  const [deptDialogOpen, setDeptDialogOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<DepartmentRow | null>(null);
  const [deleteDept, setDeleteDept] = useState<DepartmentRow | null>(null);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ContactRow | null>(null);
  const [deleteContact, setDeleteContact] = useState<ContactRow | null>(null);

  const departmentName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4" />
          {t('directoryTitle')}
        </CardTitle>
        <CardDescription>{t('directoryDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-foreground text-sm font-medium">{t('departmentsHeading')}</h4>
            <RequireRole min="admin">
              <Button variant="outline" size="sm" onClick={() => { setEditingDept(null); setDeptDialogOpen(true); }}>
                <Plus className="size-3.5" />
                {t('addDepartment')}
              </Button>
            </RequireRole>
          </div>
          {departments.length === 0 ? (
            <p className="text-muted-foreground text-xs">{t('noDepartments')}</p>
          ) : (
            <ul className="divide-border divide-y rounded-md border border-border">
              {departments.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground text-sm">{d.name}</span>
                    {!d.active && <Badge className="border-border bg-muted text-muted-foreground text-[10px]">{t('inactive')}</Badge>}
                  </div>
                  <RequireRole min="admin">
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setEditingDept(d); setDeptDialogOpen(true); }}>
                        {t('edit')}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setDeleteDept(d)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </RequireRole>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-foreground text-sm font-medium">{t('contactsHeading')}</h4>
            <RequireRole min="admin">
              <Button variant="outline" size="sm" onClick={() => { setEditingContact(null); setContactDialogOpen(true); }}>
                <Plus className="size-3.5" />
                {t('addContact')}
              </Button>
            </RequireRole>
          </div>
          {contacts.length === 0 ? (
            <p className="text-muted-foreground text-xs">{t('noContacts')}</p>
          ) : (
            <ul className="divide-border divide-y rounded-md border border-border">
              {contacts.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-foreground text-sm">{c.name}</span>
                      {c.role_title && <span className="text-muted-foreground text-xs">{c.role_title}</span>}
                      {departmentName(c.department_id) && (
                        <Badge className="border-border bg-muted text-muted-foreground text-[10px]">
                          {departmentName(c.department_id)}
                        </Badge>
                      )}
                      {!c.active && <Badge className="border-border bg-muted text-muted-foreground text-[10px]">{t('inactive')}</Badge>}
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {[c.phone, c.whatsapp, c.email].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <RequireRole min="admin">
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setEditingContact(c); setContactDialogOpen(true); }}>
                        {t('edit')}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setDeleteContact(c)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </RequireRole>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>

      <DepartmentDialog
        open={deptDialogOpen}
        onOpenChange={setDeptDialogOpen}
        department={editingDept}
        onSaved={onChanged}
      />
      <ContactDialog
        open={contactDialogOpen}
        onOpenChange={setContactDialogOpen}
        contact={editingContact}
        departments={departments}
        onSaved={onChanged}
      />

      <DestructiveConfirmDialog
        open={deleteDept !== null}
        onOpenChange={(next) => { if (!next) setDeleteDept(null); }}
        title={t('deleteDepartmentTitle')}
        description={t('deleteDepartmentDescription', { name: deleteDept?.name ?? '' })}
        cancelLabel={t('cancel')}
        confirmLabel={t('delete')}
        errorFallback={t('deleteFailed')}
        onConfirm={async () => {
          if (!deleteDept) return;
          const res = await fetch(`/api/ai/business-profile/departments/${deleteDept.id}`, { method: 'DELETE' });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || t('deleteFailed'));
          onChanged();
        }}
      />
      <DestructiveConfirmDialog
        open={deleteContact !== null}
        onOpenChange={(next) => { if (!next) setDeleteContact(null); }}
        title={t('deleteContactTitle')}
        description={t('deleteContactDescription', { name: deleteContact?.name ?? '' })}
        cancelLabel={t('cancel')}
        confirmLabel={t('delete')}
        errorFallback={t('deleteFailed')}
        onConfirm={async () => {
          if (!deleteContact) return;
          const res = await fetch(`/api/ai/business-profile/contacts/${deleteContact.id}`, { method: 'DELETE' });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || t('deleteFailed'));
          onChanged();
        }}
      />
    </Card>
  );
}

function DepartmentDialog({
  open,
  onOpenChange,
  department,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  department: DepartmentRow | null;
  onSaved: () => void;
}) {
  const t = useTranslations('Settings.businessProfile');
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(department?.name ?? '');
      setActive(department?.active ?? true);
    }
  }, [open, department]);

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error(t('nameRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const url = department ? `/api/ai/business-profile/departments/${department.id}` : '/api/ai/business-profile/departments';
      const res = await fetch(url, {
        method: department ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), active }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('saveFailed'));
        return;
      }
      toast.success(t('saveSuccess'));
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error(t('networkError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{department ? t('editDepartment') : t('addDepartment')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{t('departmentDialogDesc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('departmentName')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {department && (
            <label className="flex cursor-pointer items-center gap-2.5">
              <Checkbox checked={active} onCheckedChange={(c) => setActive(c === true)} />
              <span className="text-foreground text-sm">{t('activeLabel')}</span>
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border text-muted-foreground hover:bg-muted">
            {t('cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ContactDialog({
  open,
  onOpenChange,
  contact,
  departments,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: ContactRow | null;
  departments: DepartmentRow[];
  onSaved: () => void;
}) {
  const t = useTranslations('Settings.businessProfile');
  const NO_DEPARTMENT = '__none__';
  const [name, setName] = useState('');
  const [departmentId, setDepartmentId] = useState<string>(NO_DEPARTMENT);
  const [roleTitle, setRoleTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [active, setActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(contact?.name ?? '');
      setDepartmentId(contact?.department_id ?? NO_DEPARTMENT);
      setRoleTitle(contact?.role_title ?? '');
      setPhone(contact?.phone ?? '');
      setWhatsapp(contact?.whatsapp ?? '');
      setEmail(contact?.email ?? '');
      setNotes(contact?.notes ?? '');
      setActive(contact?.active ?? true);
    }
  }, [open, contact]);

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error(t('nameRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const url = contact ? `/api/ai/business-profile/contacts/${contact.id}` : '/api/ai/business-profile/contacts';
      const res = await fetch(url, {
        method: contact ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          department_id: departmentId === NO_DEPARTMENT ? null : departmentId,
          role_title: roleTitle.trim() || null,
          phone: phone.trim() || null,
          whatsapp: whatsapp.trim() || null,
          email: email.trim() || null,
          notes: notes.trim() || null,
          active,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || t('saveFailed'));
        return;
      }
      toast.success(t('saveSuccess'));
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error(t('networkError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{contact ? t('editContact') : t('addContact')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{t('contactDialogDesc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('contactName')}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('roleTitle')}</Label>
              <Input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('departmentLabel')}</Label>
            <Select value={departmentId} onValueChange={(v) => setDepartmentId(v ?? NO_DEPARTMENT)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_DEPARTMENT}>{t('noDepartmentOption')}</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('phone')}</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('whatsapp')}</Label>
              <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">{t('email')}</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t('internalNotes')}</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('internalNotesHint')} />
          </div>
          {contact && (
            <label className="flex cursor-pointer items-center gap-2.5">
              <Checkbox checked={active} onCheckedChange={(c) => setActive(c === true)} />
              <span className="text-foreground text-sm">{t('activeLabel')}</span>
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border text-muted-foreground hover:bg-muted">
            {t('cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
