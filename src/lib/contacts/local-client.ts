'use client';
import { apiResult } from '@/lib/api/client';
import type { ExistingContact } from './dedupe';

export async function lookupContactDuplicate(phone: string): Promise<ExistingContact | null> {
  const result = await apiResult<{ contact: ExistingContact | null }>(`/api/contacts/duplicate?phone=${encodeURIComponent(phone)}`);
  if (result.error) throw new Error(result.error.message);
  return result.data?.contact ?? null;
}
