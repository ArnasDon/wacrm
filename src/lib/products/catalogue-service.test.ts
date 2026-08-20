import { describe, expect, it } from 'vitest';
import {
  resolveProductCatalogueService,
  StubProductCatalogueService,
  CatalogueNotConfiguredError,
} from './catalogue-service';

describe('resolveProductCatalogueService', () => {
  it('always resolves the stub — no catalogue credential concept exists yet', () => {
    const service = resolveProductCatalogueService();
    expect(service).toBeInstanceOf(StubProductCatalogueService);
    expect(service.isConfigured).toBe(false);
  });
});

describe('StubProductCatalogueService', () => {
  const service = new StubProductCatalogueService();

  it('syncProduct always throws CatalogueNotConfiguredError, never a fake success', async () => {
    await expect(
      service.syncProduct({
        productId: 'p1',
        retailerId: 'p1',
        name: 'Rimula R6',
        description: null,
        imageUrl: null,
      })
    ).rejects.toBeInstanceOf(CatalogueNotConfiguredError);
  });

  it('deleteProduct also throws — never silently succeeds', async () => {
    await expect(
      service.deleteProduct('whatsapp-cat-1')
    ).rejects.toBeInstanceOf(CatalogueNotConfiguredError);
  });
});
