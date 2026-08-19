'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Play, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  VoiceNoteRecorder,
  type RecordedVoiceNote,
} from './voice-note-recorder';

// Urdu, Pashto, and Punjabi are right-to-left; Roman Urdu is not. In
// the Pakistani context this platform targets, Punjabi is written in
// Shahmukhi (Perso-Arabic script), not Gurmukhi — that's what makes
// it RTL alongside Urdu/Pashto rather than LTR (§10).
const RTL_LANGUAGES = new Set(['ur', 'ps', 'pa']);

const LANGUAGE_LABELS: Record<string, string> = {
  ur: 'Urdu',
  ps: 'Pashto',
  pa: 'Punjabi',
  'ur-Roman': 'Roman Urdu',
};

export interface VoiceNoteItem {
  id: string;
  language: string;
  storage_path: string;
  public_url: string;
  duration_seconds: number | null;
}

export function LocalizationPanel({
  contentId,
  language,
  initialBody,
  canEdit,
  disabledReason,
  voiceNotes,
  onTranslationSaved,
  onVoiceNoteAdded,
  onVoiceNoteRemoved,
}: {
  contentId: string;
  language: string;
  initialBody: string;
  canEdit: boolean;
  disabledReason?: string;
  voiceNotes: VoiceNoteItem[];
  onTranslationSaved: (language: string, body: string) => void;
  onVoiceNoteAdded: (note: VoiceNoteItem) => void;
  onVoiceNoteRemoved: (id: string) => void;
}) {
  const [body, setBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const isRtl = RTL_LANGUAGES.has(language);

  async function handleSave() {
    if (!body.trim()) {
      toast.error('Translation cannot be empty.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/content/${contentId}/translations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, body: body.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to save translation.');
        return;
      }
      toast.success(`${LANGUAGE_LABELS[language]} translation saved.`);
      onTranslationSaved(language, body.trim());
    } finally {
      setSaving(false);
    }
  }

  async function handleVoiceRecorded(note: RecordedVoiceNote) {
    const res = await fetch(`/api/content/${contentId}/voice-notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language,
        storage_path: note.storagePath,
        duration_seconds: note.durationSeconds || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || 'Failed to save voice note.');
      return;
    }
    toast.success('Voice note added.');
    onVoiceNoteAdded({
      id: data.voice_note.id,
      language,
      storage_path: data.voice_note.storage_path,
      public_url: note.publicUrl,
      duration_seconds: data.voice_note.duration_seconds,
    });
  }

  async function handleDeleteVoiceNote(id: string) {
    const res = await fetch(`/api/content/${contentId}/voice-notes/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || 'Failed to delete voice note.');
      return;
    }
    onVoiceNoteRemoved(id);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          dir={isRtl ? 'rtl' : 'ltr'}
          rows={6}
          placeholder={`Write the ${LANGUAGE_LABELS[language]} translation here...`}
          disabled={!canEdit}
          className={isRtl ? 'text-right' : undefined}
        />
        {!canEdit && disabledReason && (
          <p className="text-muted-foreground text-xs">{disabledReason}</p>
        )}
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={!canEdit || saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Save {LANGUAGE_LABELS[language]} translation
        </Button>
      </div>

      <div className="border-border space-y-2 border-t pt-4">
        <p className="text-muted-foreground text-xs font-medium">Voice notes</p>
        {voiceNotes.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No voice notes for this language yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {voiceNotes.map((vn) => (
              <li
                key={vn.id}
                className="border-border flex items-center gap-2 rounded-md border p-2 text-sm"
              >
                <Play className="text-muted-foreground size-3.5" />
                <audio controls src={vn.public_url} className="h-8 flex-1" />
                {vn.duration_seconds ? (
                  <span className="text-muted-foreground text-xs">
                    {vn.duration_seconds}s
                  </span>
                ) : null}
                {canEdit && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => void handleDeleteVoiceNote(vn.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <VoiceNoteRecorder
            onRecorded={(n) => void handleVoiceRecorded(n)}
            disabled={!canEdit}
          />
        )}
      </div>
    </div>
  );
}
