'use client';

export interface ApiFailure { message: string; status: number; code?: string }
export async function apiResult<T>(path: string, init: RequestInit = {}): Promise<{ data: T | null; error: ApiFailure | null }> {
  try {
    const response = await fetch(path, { ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...init.headers } });
    const body = await response.json();
    if (!response.ok) return { data: null, error: { message: body.error ?? 'Request failed.', status: response.status, ...(response.status === 409 ? { code: '23505' } : {}) } };
    return { data: body as T, error: null };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : 'Unable to connect.', status: 0 } };
  }
}
