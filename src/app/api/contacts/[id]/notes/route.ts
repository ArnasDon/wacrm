import {
  accountRoute,
  readObject,
  RequestError,
  requireUUID,
} from '@/lib/api/local-route';
import { addNote, listNotes, deleteNote } from '@/lib/db/contact-details';

type Context = { params: Promise<{ id: string }> };
export function GET(request: Request, { params }: Context) {
  return accountRoute(request, 'viewer', async (db, ctx) => ({
    notes: await listNotes(db, ctx.accountId, requireUUID((await params).id)),
  }));
}
export function POST(request: Request, { params }: Context) {
  return accountRoute(request, 'agent', async (db, ctx) => {
    const body = await readObject(request);
    if (
      typeof body.note_text !== 'string' ||
      !body.note_text.trim() ||
      body.note_text.length > 20000
    )
      throw new RequestError('Provide a note of at most 20,000 characters.');
    return {
      note: await addNote(
        db,
        ctx.userId,
        requireUUID((await params).id),
        body.note_text
      ),
    };
  });
}
export function DELETE(request: Request, { params }: Context) {
  return accountRoute(request, 'agent', async (db, ctx) => {
    if (
      !(await deleteNote(
        db,
        ctx.accountId,
        requireUUID((await params).id),
        requireUUID((await readObject(request)).note_id)
      ))
    )
      throw new RequestError('Note not found.', 404);
    return { ok: true };
  });
}
