import { beforeEach, it, expect, vi } from 'vitest';
const h = vi.hoisted(() => ({ download: vi.fn(), persist: vi.fn() }));
vi.mock('./meta-api', () => ({ downloadMedia: h.download }));
vi.mock('@/lib/db/pool', () => ({
  withTransaction: (work: (db: unknown) => Promise<unknown>) => work({}),
}));
vi.mock('@/lib/storage/inbound', () => ({ persistInboundMedia: h.persist }));
vi.mock('@/lib/storage/filesystem', () => ({
  storageRoot: () => '/local/uploads',
}));
vi.mock('@/lib/storage/access', () => ({
  mediaPublicURL: (_bucket: string, id: string, name: string) =>
    '/media/' + id + '/' + name,
}));
import { mirrorInboundLocal } from './mirror-inbound-local';
const input = {
  accountId: 'account',
  userId: 'user',
  mediaId: '123456789',
  downloadUrl: 'https://meta.test/media',
  accessToken: 'token',
  mimeType: 'image/jpeg',
  messageTimestamp: '1700000000',
};
beforeEach(() => {
  h.download
    .mockReset()
    .mockResolvedValue({
      buffer: Buffer.from('image'),
      contentType: 'image/jpeg',
    });
  h.persist
    .mockReset()
    .mockResolvedValue({ id: 'stored', filename: 'image.jpg' });
});
it('persists account-scoped bytes and returns the durable local URL', async () => {
  expect(await mirrorInboundLocal(input)).toBe('/media/stored/image.jpg');
  expect(h.persist).toHaveBeenCalledWith(
    expect.anything(),
    '/local/uploads',
    expect.objectContaining({
      accountId: 'account',
      userId: 'user',
      mediaId: '123456789',
      mime: 'image/jpeg',
      buffer: Buffer.from('image'),
    })
  );
});
it('skips oversized declared files before downloading', async () => {
  expect(
    await mirrorInboundLocal({ ...input, fileSize: 17 * 1024 * 1024 })
  ).toBeNull();
  expect(h.download).not.toHaveBeenCalled();
});
it('rejects oversized downloaded bytes before storage', async () => {
  h.download.mockResolvedValue({
    buffer: Buffer.alloc(17 * 1024 * 1024),
    contentType: 'image/jpeg',
  });
  expect(await mirrorInboundLocal(input)).toBeNull();
  expect(h.persist).not.toHaveBeenCalled();
});
it('normalizes MIME parameters and preserves the document filename', async () => {
  await mirrorInboundLocal({
    ...input,
    mimeType: 'application/pdf; charset=binary',
    fileName: 'invoice.pdf',
  });
  expect(h.persist.mock.calls[0][2]).toMatchObject({
    mime: 'application/pdf',
    filename: '123456789-invoice.pdf',
  });
});
it('falls back to the downloaded MIME when metadata is absent', async () => {
  await mirrorInboundLocal({ ...input, mimeType: null });
  expect(h.persist.mock.calls[0][2].mime).toBe('image/jpeg');
});
it('returns null on download failure', async () => {
  h.download.mockRejectedValue(new Error('unavailable'));
  expect(await mirrorInboundLocal(input)).toBeNull();
  expect(h.persist).not.toHaveBeenCalled();
});
it('returns null on local storage failure', async () => {
  h.persist.mockRejectedValue(new Error('unavailable'));
  expect(await mirrorInboundLocal(input)).toBeNull();
});
