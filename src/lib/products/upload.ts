// ============================================================
// Products — client-side file upload for digital product files.
//
// Uploads go to the PRIVATE `product-files` bucket using the same
// account-scoped path convention as flow-media/chat-media:
//
//   product-files/account-<account_id>/<timestamp>-<basename>.<ext>
//
// The first path segment is what the bucket's storage RLS matches on,
// so callers MUST go through here rather than hand-rolling a path.
// Unlike the chat media helper we return the OBJECT PATH, not a
// public URL — the bucket is private and paid buyers receive
// short-lived signed URLs instead.
// ============================================================

import { createClient } from "@/lib/supabase/client";
import { PRODUCT_FILE_BUCKET } from "@/lib/products/fulfill";

/** 50 MB — matches the bucket's `file_size_limit` in migration 038. */
export const PRODUCT_FILE_MAX_BYTES = 50 * 1024 * 1024;

export interface UploadedProductFile {
  path: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
}

function sanitizeBaseName(name: string): string {
  const base = name.replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(0, 80);
  return base || "file";
}

/**
 * Upload a file for a product. `accountId` must be the caller's own
 * account id (from `useAuth`) — a mismatched segment is silently
 * rejected by storage RLS.
 */
export async function uploadProductFile(
  accountId: string,
  file: File,
): Promise<UploadedProductFile> {
  if (file.size > PRODUCT_FILE_MAX_BYTES) {
    throw new Error(`File exceeds the ${PRODUCT_FILE_MAX_BYTES / (1024 * 1024)} MB limit`);
  }

  const supabase = createClient();
  const timestamp = Date.now();
  const name = sanitizeBaseName(file.name);
  const path = `account-${accountId}/${timestamp}-${name}`;

  const { error } = await supabase.storage.from(PRODUCT_FILE_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw new Error(error.message);

  return {
    path,
    name: file.name,
    sizeBytes: file.size,
    mimeType: file.type || "application/octet-stream",
  };
}

/** Best-effort removal of a replaced/deleted product file. */
export async function removeProductFile(path: string): Promise<void> {
  if (!path) return;
  try {
    const supabase = createClient();
    await supabase.storage.from(PRODUCT_FILE_BUCKET).remove([path]);
  } catch (err) {
    console.error("[products] failed to remove old file:", path, err);
  }
}
