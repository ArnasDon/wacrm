'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  uploadAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';

const CONTENT_TYPES = [
  { value: 'poster', label: 'Poster' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'text_post', label: 'Text post' },
  { value: 'voice_note', label: 'Voice note' },
  { value: 'product_post', label: 'Product post' },
  { value: 'campaign_post', label: 'Campaign post' },
];

const CHAT_MEDIA_BUCKET = 'chat-media';

export default function NewContentPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [contentType, setContentType] = useState('text_post');
  const [body, setBody] = useState('');
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const needsMedia = [
    'poster',
    'image',
    'video',
    'product_post',
    'campaign_post',
  ].includes(contentType);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const kind = file.type.startsWith('video') ? 'video' : 'image';
    if (file.size > MEDIA_MAX_BYTES_BY_KIND[kind]) {
      toast.error(
        `File is too large (max ${MEDIA_MAX_BYTES_BY_KIND[kind] / (1024 * 1024)} MB).`
      );
      return;
    }

    setUploading(true);
    try {
      const { publicUrl } = await uploadAccountMedia(CHAT_MEDIA_BUCKET, file);
      setMediaUrl(publicUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function handleCreate() {
    if (!title.trim()) {
      toast.error('Title is required.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          content_type: contentType,
          body: body.trim() || null,
          media_url: mediaUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to create content.');
        return;
      }
      toast.success('Content created.');
      router.push(`/content/${data.content.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-foreground text-2xl font-bold">New content</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Write the original copy first — languages and voice notes are added
          after creation.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Original copy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="content-title">Title</Label>
            <Input
              id="content-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Fleet Check-Up Reminder"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="content-type">Content type</Label>
            <Select
              value={contentType}
              onValueChange={(v) => v && setContentType(v)}
            >
              <SelectTrigger id="content-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTENT_TYPES.map((ct) => (
                  <SelectItem key={ct.value} value={ct.value}>
                    {ct.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="content-body">Body</Label>
            <Textarea
              id="content-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What should this post say?"
              rows={6}
            />
          </div>

          {needsMedia && (
            <div className="space-y-1.5">
              <Label>Media</Label>
              {mediaUrl ? (
                <div className="border-border flex items-center gap-3 rounded-md border p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={mediaUrl}
                    alt=""
                    className="h-16 w-16 rounded object-cover"
                  />
                  <span className="text-muted-foreground flex-1 truncate text-xs">
                    {mediaUrl}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setMediaUrl(null)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <label className="border-border text-muted-foreground hover:bg-muted flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-4 text-sm">
                  {uploading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                  {uploading ? 'Uploading...' : 'Upload image or video'}
                  <input
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={handleFileChange}
                    disabled={uploading}
                  />
                </label>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => router.push('/content')}>
          Cancel
        </Button>
        <Button onClick={handleCreate} disabled={saving || uploading}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Create draft
        </Button>
      </div>
    </div>
  );
}
