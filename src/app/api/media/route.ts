// ============================================================
// /api/media — media library endpoints (bucket `media`).
//
//   GET    — list the caller's images (account-scoped folder).
//   DELETE — remove one object (RLS keeps it account-scoped).
//
// The bucket is public (getPublicUrl serves bytes without auth, so
// landing pages can reference images directly); the SELECT policy
// (migration 064) is account-scoped, which is what makes `list`
// here only return the caller's own objects. Uploads go through
// the shared client-side helper `uploadAccountMedia` (src/lib/
// storage/upload-media.ts) so the RLS path convention is never
// hand-rolled.
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

export const MEDIA_BUCKET = 'media';

interface MediaItem {
  /** Full storage path (account-<id>/<name>) — used for deletes. */
  path: string;
  /** Object name (filename). */
  name: string;
  /** Public URL the editor can paste into landing blocks. */
  publicUrl: string;
  /** Bytes, when the storage backend reports them. */
  size: number;
  updatedAt: string | null;
}

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const folder = `account-${accountId}`;
    const { data, error } = await supabase.storage.from(MEDIA_BUCKET).list(folder, {
      limit: 1000,
      sortBy: { column: 'updated_at', order: 'desc' },
    });
    if (error) throw new Error(error.message);

    const media: MediaItem[] = (data ?? [])
      // Subfolders have no metadata; this bucket only stores flat images.
      .filter((item) => item.metadata)
      .map((item) => {
        const path = `${folder}/${item.name}`;
        const {
          data: { publicUrl },
        } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
        return {
          path,
          name: item.name,
          publicUrl,
          size: (item.metadata?.size as number | undefined) ?? 0,
          updatedAt: item.updated_at ?? null,
        };
      });

    return NextResponse.json({ media });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const body = (await request.json().catch(() => null)) as { path?: string } | null;
    const path = typeof body?.path === 'string' ? body.path.trim() : '';
    if (!path) {
      return NextResponse.json({ error: 'Falta el path del objeto.' }, { status: 400 });
    }

    // Defense in depth: the DELETE policy is account-scoped by the path's
    // first segment, but reject anything outside our own folder upfront so
    // a typo can't produce a confusing RLS error.
    if (!path.startsWith(`account-${accountId}/`)) {
      return NextResponse.json({ error: 'El objeto no pertenece a tu cuenta.' }, { status: 403 });
    }

    const { error } = await supabase.storage.from(MEDIA_BUCKET).remove([path]);
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
