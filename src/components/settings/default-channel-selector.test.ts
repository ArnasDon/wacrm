import { describe, expect, it } from 'vitest';

import { shouldShowChannelSelector } from './default-channel-selector';
import type { ConnectionDTO } from '@/lib/whatsapp/uazapi-connection-dto';

const c = (provider: string, status: string) =>
  ({ provider, status }) as unknown as ConnectionDTO;

describe('shouldShowChannelSelector', () => {
  it('is true only when a connected meta AND a connected uazapi both exist', () => {
    expect(
      shouldShowChannelSelector([
        c('meta', 'connected'),
        c('uazapi', 'connected'),
      ])
    ).toBe(true);
  });

  it('is false when the uazapi connection is not yet connected', () => {
    expect(
      shouldShowChannelSelector([
        c('meta', 'connected'),
        c('uazapi', 'connecting'),
      ])
    ).toBe(false);
  });

  it('is false when the meta connection is not connected', () => {
    expect(
      shouldShowChannelSelector([
        c('meta', 'disconnected'),
        c('uazapi', 'connected'),
      ])
    ).toBe(false);
  });

  it('is false with only a connected meta connection', () => {
    expect(shouldShowChannelSelector([c('meta', 'connected')])).toBe(false);
  });

  it('is false with only a connected uazapi connection', () => {
    expect(shouldShowChannelSelector([c('uazapi', 'connected')])).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(shouldShowChannelSelector([])).toBe(false);
  });
});
