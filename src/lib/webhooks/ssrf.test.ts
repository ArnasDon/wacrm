import { describe, it, expect } from 'vitest';
import { isPrivateOrReservedIp, isDeliverableUrl } from './ssrf';

describe('isPrivateOrReservedIp', () => {
  it('flags loopback / private / link-local / CGNAT IPv4', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '100.64.0.1', // CGNAT
      '0.0.0.0',
    ]) {
      expect(isPrivateOrReservedIp(ip)).toBe(true);
    }
  });

  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '93.184.216.34']) {
      expect(isPrivateOrReservedIp(ip)).toBe(false);
    }
  });

  it('flags loopback / ULA / link-local IPv6 and IPv4-mapped privates', () => {
    for (const ip of ['::1', 'fe80::1', 'fc00::1', 'fd12::34', '::ffff:127.0.0.1']) {
      expect(isPrivateOrReservedIp(ip)).toBe(true);
    }
    expect(isPrivateOrReservedIp('2606:4700:4700::1111')).toBe(false);
  });

  // ⚠️ A forma HEXADECIMAL é a que chega de `isDeliverableUrl`: o parser de
  // URL reescreve `[::ffff:127.0.0.1]` como `[::ffff:7f00:1]`, e o guarda
  // antigo só casava a forma com pontos.
  it('IPv4-mapeado em forma hexadecimal (e escrita por extenso) é julgado pelo IPv4 embutido', () => {
    for (const ip of [
      '::ffff:7f00:1', // 127.0.0.1
      '::ffff:a00:5', // 10.0.0.5
      '::ffff:a9fe:a9fe', // 169.254.169.254
      '::FFFF:7F00:1',
      '0:0:0:0:0:ffff:7f00:1',
      '[::ffff:7f00:1]',
    ]) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
    expect(isPrivateOrReservedIp('::ffff:808:808')).toBe(false); // 8.8.8.8
    expect(isPrivateOrReservedIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('o resto de ::/64 é recusado (IPv4-compatível, SIIT, não especificado por extenso)', () => {
    for (const ip of ['::7f00:1', '::127.0.0.1', '::ffff:0:7f00:1', '0:0:0:0:0:0:0:0', '::1:0:0']) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
  });

  it('NAT64 (64:ff9b::/96) e 6to4 (2002::/16): julgados pelo IPv4 embutido', () => {
    expect(isPrivateOrReservedIp('64:ff9b::7f00:1')).toBe(true); // 127.0.0.1
    expect(isPrivateOrReservedIp('64:ff9b::10.0.0.5')).toBe(true);
    expect(isPrivateOrReservedIp('2002:a9fe:a9fe::1')).toBe(true); // 169.254.169.254
    expect(isPrivateOrReservedIp('2002:c0a8:101::')).toBe(true); // 192.168.1.1
    // Público embutido continua entregável — DNS64 devolve esta forma para
    // todo site só-IPv4 numa rede só-IPv6.
    expect(isPrivateOrReservedIp('64:ff9b::808:808')).toBe(false);
    expect(isPrivateOrReservedIp('2002:808:808::1')).toBe(false);
  });

  it('NAT64 de uso local (64:ff9b:1::/48) e o resto de 64:ff9b::/32 são recusados inteiros', () => {
    expect(isPrivateOrReservedIp('64:ff9b:1::808:808')).toBe(true);
    expect(isPrivateOrReservedIp('64:ff9b:0:1::808:808')).toBe(true);
  });

  it('site-local (fec0::/10) e link-local com zona são recusados', () => {
    expect(isPrivateOrReservedIp('fec0::1')).toBe(true);
    expect(isPrivateOrReservedIp('fe80::1%eth0')).toBe(true);
  });

  it('IPv6 público continua liberado, em qualquer grafia', () => {
    for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '2606:4700:4700:0:0:0:0:1111']) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(false);
    }
  });

  it('texto com `:` que não é IPv6 falha FECHADO', () => {
    for (const ip of [':::', '1::2::3', '12345::1', '::ffff:999.0.0.1', '1:2:3:4:5:6:7:8:9', 'g::1']) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
  });
});

describe('isDeliverableUrl', () => {
  it('rejects literal private IPs and internal names without DNS', async () => {
    expect(await isDeliverableUrl('https://127.0.0.1/hook')).toBe(false);
    expect(await isDeliverableUrl('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(await isDeliverableUrl('https://[::1]/hook')).toBe(false);
    expect(await isDeliverableUrl('https://localhost/hook')).toBe(false);
    expect(await isDeliverableUrl('https://foo.internal/hook')).toBe(false);
  });

  it('rejects a malformed URL', async () => {
    expect(await isDeliverableUrl('not a url')).toBe(false);
  });

  it('allows a literal public IP', async () => {
    expect(await isDeliverableUrl('https://8.8.8.8/hook')).toBe(true);
  });

  it('⚠️ recusa IPv4 privado escondido num IPv6 mapeado (o parser de URL o normaliza para hex)', async () => {
    expect(new URL('https://[::ffff:127.0.0.1]/').hostname).toBe('[::ffff:7f00:1]');
    expect(await isDeliverableUrl('https://[::ffff:127.0.0.1]/')).toBe(false);
    expect(await isDeliverableUrl('https://[::ffff:10.0.0.5]/hook')).toBe(false);
    expect(await isDeliverableUrl('https://[::ffff:169.254.169.254]/latest/meta-data')).toBe(false);
    expect(await isDeliverableUrl('https://[64:ff9b::127.0.0.1]/hook')).toBe(false);
    expect(await isDeliverableUrl('https://[2002:7f00:1::]/hook')).toBe(false);
  });

  it('allows a literal public IPv6', async () => {
    expect(await isDeliverableUrl('https://[2606:4700:4700::1111]/hook')).toBe(true);
    expect(await isDeliverableUrl('https://[::ffff:8.8.8.8]/hook')).toBe(true);
  });
});
