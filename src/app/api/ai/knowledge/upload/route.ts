// ============================================================
// /api/ai/knowledge/upload
//
//   POST — accept an uploaded file, extract its text, and create a
//          `source_type='file'` knowledge_base_entries row.
//
// This is the file-import counterpart of the manual-create endpoint
// (`POST /api/ai/knowledge`, spec §9.4 / §10). It authenticates the
// dashboard way (cookie session → RLS client) and is admin+ only:
// the KB is account-settings-class data (spec §4.2 RLS: all ops for
// `is_account_member(account_id, 'admin')`), so we enforce the same
// admin floor on the wire that the table's RLS policies enforce in
// the database — the exact guard the sibling `route.ts` uses.
//
// Supported inputs (spec §9.4):
//   .txt / .md — read directly as UTF-8 text.
//   .pdf       — text extracted server-side with `unpdf` (a serverless
//                PDF.js build). On any extraction failure we return a
//                clear 422 telling the user to paste the text manually,
//                rather than persisting an empty/garbage entry.
//
// `token_estimate` is computed from the extracted text via the shared
// chars/4 heuristic (`estimateTokens`, spec §4.2 / §9), identical to
// the manual route, so the Settings size meter stays consistent
// regardless of how an entry was created.
//
// Runtime note: PDF extraction runs Mozilla's PDF.js, which needs the
// Node.js runtime — pin it explicitly so this route never gets pushed
// onto the Edge runtime where those APIs are unavailable.
// ============================================================

import { NextResponse } from 'next/server';

import {
  ForbiddenError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { canEditSettings } from '@/lib/auth/roles';
import { estimateTokens } from '@/lib/ai/knowledge-base';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export const runtime = 'nodejs';

const MAX_TITLE_LEN = 200;
// Hard ceiling on a single entry's content, mirroring the manual
// create route. Extracted text longer than this is almost certainly a
// misuse (a whole manual / site dump) and would blow the prompt budget
// on its own — reject rather than silently truncate.
const MAX_CONTENT_LEN = 200_000;

// Cap the raw upload so a single request can't pull a huge file into
// memory before we even look at it. 10 MB comfortably covers a text
// KB page or a reasonable PDF while bounding the PDF.js workload.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Columns safe to expose. Mirrors the `KnowledgeBaseEntry` shape and
// the SAFE_COLUMNS list in the sibling `route.ts`.
const SAFE_COLUMNS =
  'id, account_id, title, content, source_type, source_filename, enabled, token_estimate, created_by_user_id, created_at, updated_at';

/** Classify an upload by its filename extension. */
type FileKind = 'text' | 'pdf' | 'unsupported';

function classify(filename: string): FileKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text';
  if (lower.endsWith('.pdf')) return 'pdf';
  return 'unsupported';
}

/**
 * Extract text from a PDF buffer using `unpdf` (serverless PDF.js).
 * Returns the merged text, or `null` on any failure / empty result so
 * the caller can surface a clean 422 rather than persisting nothing.
 */
async function extractPdfText(bytes: Uint8Array): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (err) {
    console.error('[POST /api/ai/knowledge/upload] PDF extract error:', err);
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    // Defence in depth: the capability predicate is the single source
    // of truth for "can edit account settings" (the KB is settings-
    // class), alongside the role floor above and the table RLS policy.
    if (!canEditSettings(ctx.role)) {
      throw new ForbiddenError('This action requires the admin role or higher');
    }

    const limit = checkRateLimit(
      `admin:knowledgeUpload:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    // Reject oversized uploads before buffering the whole multipart body
    // into memory. Content-Length can be understated by a hostile client
    // but not inflated, so this is an early filter; the authoritative
    // bound is the file.size check below after the body is parsed.
    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          error: `File is too large. Maximum size is ${Math.floor(
            MAX_FILE_BYTES / (1024 * 1024)
          )} MB.`,
        },
        { status: 413 }
      );
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "A 'file' field is required" },
        { status: 400 }
      );
    }

    const filename = file.name?.trim() || 'upload';
    const kind = classify(filename);
    if (kind === 'unsupported') {
      return NextResponse.json(
        { error: 'Unsupported file type. Upload a .txt, .md, or .pdf file.' },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          error: `File is too large. Maximum size is ${Math.floor(
            MAX_FILE_BYTES / (1024 * 1024)
          )} MB.`,
        },
        { status: 400 }
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) {
      return NextResponse.json(
        { error: 'The uploaded file is empty.' },
        { status: 400 }
      );
    }

    let content: string;
    if (kind === 'pdf') {
      const extracted = await extractPdfText(bytes);
      if (extracted === null) {
        // Fail safe: don't persist an empty/garbage entry. Tell the
        // user exactly what to do instead (spec §1 fail-safe bias).
        return NextResponse.json(
          {
            error:
              "Couldn't extract text from this PDF. It may be scanned, " +
              'image-only, or encrypted. Copy the text and paste it in ' +
              'manually instead.',
          },
          { status: 422 }
        );
      }
      content = extracted;
    } else {
      content = new TextDecoder('utf-8').decode(bytes).trim();
    }

    if (!content) {
      return NextResponse.json(
        {
          error:
            "Couldn't read any text from this file. Copy the text and " +
            'paste it in manually instead.',
        },
        { status: 422 }
      );
    }
    if (content.length > MAX_CONTENT_LEN) {
      return NextResponse.json(
        {
          error: `Extracted text is too long (${content.length} characters). Maximum is ${MAX_CONTENT_LEN}. Split it into smaller entries.`,
        },
        { status: 400 }
      );
    }

    // Derive a title from the filename (strip the extension), clamped
    // to the same ceiling the manual route enforces. Falls back to the
    // raw filename if stripping leaves nothing.
    const baseTitle = filename.replace(/\.[^.]+$/, '').trim() || filename;
    const title = baseTitle.slice(0, MAX_TITLE_LEN);

    const { data, error } = await ctx.supabase
      .from('knowledge_base_entries')
      .insert({
        account_id: ctx.accountId,
        title,
        content,
        source_type: 'file',
        source_filename: filename.slice(0, MAX_TITLE_LEN),
        token_estimate: estimateTokens(content),
        created_by_user_id: ctx.userId,
      })
      .select(SAFE_COLUMNS)
      .single();

    if (error || !data) {
      console.error('[POST /api/ai/knowledge/upload] insert error:', error);
      return NextResponse.json(
        { error: 'Failed to create knowledge base entry' },
        { status: 500 }
      );
    }

    return NextResponse.json({ entry: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
