import { describe, expect, it } from 'vitest';
import { toConnectionDTO } from './uazapi-connection-dto';

describe('toConnectionDTO', () => {
  it('nunca inclui campos sensíveis', () => {
    const dto = toConnectionDTO({
      id: 'c1',
      provider: 'uazapi',
      label: null,
      status: 'connected',
      is_primary: true,
      display_phone: '5511999998888',
      profile_name: 'Loja',
      last_connection_error: null,
      created_at: '2026-08-29T00:00:00Z',
      credential: 'enc-secret',
      uazapi_instance_id: 'inst-1',
      webhook_secret_hash: 'hash',
      phone_number_id: 'PN1',
    });
    expect(Object.keys(dto).sort()).toEqual([
      'created_at',
      'display_phone',
      'id',
      'is_primary',
      'label',
      'last_connection_error',
      'profile_name',
      'provider',
      'status',
    ]);
    expect(JSON.stringify(dto)).not.toContain('enc-secret');
    expect(JSON.stringify(dto)).not.toContain('inst-1');
  });
});
