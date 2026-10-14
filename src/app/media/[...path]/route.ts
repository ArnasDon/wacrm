import { withConnection } from '@/lib/db/transaction';
import { getPool } from '@/lib/db/pool';
import { queryRows } from '@/lib/db/rows';
import type { StoredObject } from '@/lib/db/storage';
import { getLocalAccountContext, withAccount } from '@/lib/db/context';
import { storageBucket, storageRoot, readStoredFile } from '@/lib/storage/filesystem';
import { requireUUID } from '@/lib/api/local-route';
export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const { path } = await context.params;
    if (path.length < 2 || path.length > 3) return new Response('Not found', { status: 404 });
    const bucket = storageBucket(path[0]);
    const id = requireUUID(path[1]);
    const [object] = await withConnection(getPool('worker'), db => queryRows<StoredObject>(db, 'SELECT * FROM public.stored_objects WHERE bucket=$1 AND id=$2', [bucket, id]));
    if (!object) return new Response('Not found', { status: 404 });
    if (!object.is_public) {
      const ctx = await getLocalAccountContext();
      const visible = await withAccount(ctx, db => queryRows(db, 'SELECT id FROM public.stored_objects WHERE id=$1 AND account_id=$2', [id, ctx.accountId]));
      if (!visible.length) return new Response('Not found', { status: 404 });
    }
    const bytes = await readStoredFile(storageRoot(), bucket, id);
    return new Response(new Uint8Array(bytes), { headers: {
      'Content-Type': object.mime,
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': `${/^(image|audio|video)\//.test(object.mime) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(object.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': object.is_public ? 'public, max-age=3600' : 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    } });
  } catch { return new Response('Not found', { status: 404 }); }
}
