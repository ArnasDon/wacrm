export type FailureNotice = {
  step: 'dump' | 'archive' | 'upload' | 'manifest';
  artifact: string | null;
  destinationScheme: string;
  folder: string;
  message: string;
  at: string;
};

/** Posts the failure notice. Returns false if undeliverable; never throws. */
export async function notifyFailure(
  webhookUrl: string,
  notice: FailureNotice,
  deps: { fetchFn?: typeof fetch; timeoutMs?: number } = {}
): Promise<boolean> {
  try {
    const fetchFn = deps.fetchFn ?? fetch;
    const response = await fetchFn(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'backup.failed', ...notice }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
