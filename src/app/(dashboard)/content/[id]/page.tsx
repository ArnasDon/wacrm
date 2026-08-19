'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  LocalizationPanel,
  type VoiceNoteItem,
} from '@/components/content/localization-panel';
import { ScheduleDialog } from '@/components/content/schedule-dialog';
import { getAccountMediaPublicUrl } from '@/lib/storage/upload-media';

const LANGUAGES = ['ur', 'ps', 'pa', 'ur-Roman'] as const;
const CHAT_MEDIA_BUCKET = 'chat-media';

interface Translation {
  id: string;
  language: string;
  body: string;
}

interface ContentDetail {
  id: string;
  title: string;
  content_type: string;
  body: string | null;
  media_url: string | null;
  status: string;
  translations: Translation[];
  voice_notes: {
    id: string;
    language: string;
    storage_path: string;
    duration_seconds: number | null;
  }[];
}

export default function ContentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, canEditSettings } = useAuth();
  const userId = user?.id ?? null;

  const [content, setContent] = useState<ContentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [myLanguages, setMyLanguages] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [savingCopy, setSavingCopy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const isAdmin = canEditSettings; // admin/owner, per canEditSettings' own definition
  const canEditCopy = content
    ? ['Draft', 'In Review'].includes(content.status)
    : false;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/content/${params.id}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to load content.');
        return;
      }
      setContent(data.content);
      setTitle(data.content.title);
      setBody(data.content.body ?? '');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // My own BA languages — drives which localization tabs I can edit
  // (§14). Fetched directly rather than through the shared auth
  // context, which doesn't carry this field.
  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    supabase
      .from('profiles')
      .select('languages')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        setMyLanguages(Array.isArray(data?.languages) ? data.languages : []);
      });
  }, [userId]);

  const voiceNotesByLanguage = useMemo(() => {
    const map = new Map<string, VoiceNoteItem[]>();
    for (const vn of content?.voice_notes ?? []) {
      const list = map.get(vn.language) ?? [];
      list.push({
        id: vn.id,
        language: vn.language,
        storage_path: vn.storage_path,
        public_url: getAccountMediaPublicUrl(
          CHAT_MEDIA_BUCKET,
          vn.storage_path
        ),
        duration_seconds: vn.duration_seconds,
      });
      map.set(vn.language, list);
    }
    return map;
  }, [content?.voice_notes]);

  async function handleSaveCopy() {
    if (!content) return;
    setSavingCopy(true);
    try {
      const res = await fetch(`/api/content/${content.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to save.');
        return;
      }
      toast.success('Saved.');
      setContent((c) => (c ? { ...c, title, body } : c));
    } finally {
      setSavingCopy(false);
    }
  }

  async function runAction(
    url: string,
    init: RequestInit,
    successMessage: string
  ) {
    setBusy(true);
    try {
      const res = await fetch(url, init);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Action failed.');
        return;
      }
      toast.success(successMessage);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!content) return;
    if (!confirm(`Delete "${content.title}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/content/${content.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || 'Failed to delete.');
      return;
    }
    toast.success('Content deleted.');
    router.push('/content');
  }

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (!content) {
    return <p className="text-muted-foreground text-sm">Content not found.</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-foreground text-2xl font-bold">
              {content.title}
            </h1>
            <Badge variant="outline">{content.status}</Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {content.content_type}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void handleDelete()}
          disabled={busy}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Original copy</CardTitle>
          <CardDescription>
            The source-language version every translation is based on.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-title">Title</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!canEditCopy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-body">Body</Label>
            <Textarea
              id="edit-body"
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={!canEditCopy}
            />
          </div>
          {content.media_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={content.media_url}
              alt=""
              className="border-border max-h-64 rounded-md border"
            />
          )}
          {canEditCopy && (
            <div className="flex justify-end">
              <Button size="sm" onClick={handleSaveCopy} disabled={savingCopy}>
                {savingCopy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                Save
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Localization</CardTitle>
          <CardDescription>
            Manual entry only — a bilingual BA writes each language directly.
            Urdu and Pashto render right-to-left.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={LANGUAGES[0]}>
            <TabsList>
              {LANGUAGES.map((lang) => (
                <TabsTrigger key={lang} value={lang}>
                  {lang}
                  {content.translations.some((t) => t.language === lang)
                    ? ' ✓'
                    : ''}
                </TabsTrigger>
              ))}
            </TabsList>
            {LANGUAGES.map((lang) => {
              const existing = content.translations.find(
                (t) => t.language === lang
              );
              const canEditLanguage = isAdmin || myLanguages.includes(lang);
              return (
                <TabsContent key={lang} value={lang}>
                  <LocalizationPanel
                    contentId={content.id}
                    language={lang}
                    initialBody={existing?.body ?? ''}
                    canEdit={canEditLanguage}
                    disabledReason={
                      canEditLanguage
                        ? undefined
                        : `You're not registered for ${lang} — ask an admin to add it to your BA languages.`
                    }
                    voiceNotes={voiceNotesByLanguage.get(lang) ?? []}
                    onTranslationSaved={() => void load()}
                    onVoiceNoteAdded={() => void load()}
                    onVoiceNoteRemoved={() => void load()}
                  />
                </TabsContent>
              );
            })}
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">
            Review, approval &amp; scheduling
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {content.status === 'Draft' && (
            <Button
              onClick={() =>
                void runAction(
                  `/api/content/${content.id}/submit`,
                  { method: 'POST' },
                  'Submitted for review.'
                )
              }
              disabled={busy}
            >
              Submit for review
            </Button>
          )}
          {content.status === 'In Review' && isAdmin && (
            <>
              <Button
                onClick={() =>
                  void runAction(
                    `/api/content/${content.id}/approve`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ approve: true }),
                    },
                    'Approved.'
                  )
                }
                disabled={busy}
              >
                Approve
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void runAction(
                    `/api/content/${content.id}/approve`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ approve: false }),
                    },
                    'Sent back to Draft.'
                  )
                }
                disabled={busy}
              >
                Send back to Draft
              </Button>
            </>
          )}
          {content.status === 'In Review' && !isAdmin && (
            <p className="text-muted-foreground text-sm">
              Waiting on admin approval.
            </p>
          )}
          {content.status === 'Approved' && (
            <>
              <Button onClick={() => setScheduleOpen(true)} disabled={busy}>
                Schedule
              </Button>
              <ScheduleDialog
                contentId={content.id}
                open={scheduleOpen}
                onOpenChange={setScheduleOpen}
                availableLanguages={content.translations.map((t) => t.language)}
                onScheduled={() => void load()}
              />
            </>
          )}
          {content.status === 'Scheduled' && (
            <p className="text-muted-foreground text-sm">
              Scheduled — the next scheduler run will send it. You can schedule
              additional language variants above once this one has gone out.
            </p>
          )}
          {content.status === 'Published' && (
            <p className="text-muted-foreground text-sm">Published.</p>
          )}
          {content.status === 'Failed' && (
            <p className="text-destructive text-sm">
              Every scheduled send for this post failed — check the WhatsApp
              connection in Settings and try scheduling again.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
