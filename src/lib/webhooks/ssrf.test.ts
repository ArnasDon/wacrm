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

  it('flags other IPv4 special-purpose ranges', () => {
    for (const ip of [
      '192.0.0.1', // IETF protocol assignments
      '192.0.2.5', // TEST-NET-1
      '192.88.99.1', // 6to4 relay anycast
      '198.18.0.1', // benchmarking
      '198.51.100.7', // TEST-NET-2
      '203.0.113.7', // TEST-NET-3
      '224.0.0.1', // multicast
      '255.255.255.255', // broadcast
    ]) {
      expect(isPrivateOrReservedIp(ip)).toBe(true);
    }
  });

  it('flags loopback / ULA / link-local IPv6 and IPv4-mapped privates', () => {
    for (const ip of [
      '::',
      '::1',
      'fe80::1',
      'fe80::1%eth0',
      'febf::1',
      'fc00::1',
      'fd12::34',
      'ff02::1', // multicast
      '100::1', // discard-only
      '2001:db8::1', // documentation
      '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateOrReservedIp(ip)).toBe(true);
    }
    expect(isPrivateOrReservedIp('2606:4700:4700::1111')).toBe(false);
    expect(isPrivateOrReservedIp('::ffff:8.8.8.8')).toBe(false);
  });

  // GHSA-m4cp-pqxq-x9f7 — the WHATWG URL parser rewrites the dotted
  // tail of an IPv4-mapped literal to hex, which the previous
  // dotted-decimal regex could not see.
  it('flags IPv4-mapped addresses written in hexadecimal', () => {
    for (const ip of [
      '::ffff:7f00:1', // 127.0.0.1
      '::ffff:a00:1', // 10.0.0.1
      '::ffff:a9fe:a9fe', // 169.254.169.254
      '::FFFF:7F00:1', // case-insensitive
      '[::ffff:7f00:1]', // bracketed, as URL.hostname yields it
    ]) {
      expect(isPrivateOrReservedIp(ip)).toBe(true);
    }
    expect(isPrivateOrReservedIp('::ffff:808:808')).toBe(false); // 8.8.8.8
  });

  // GHSA-q4p6-pj4g-26xx — IPv6 transition encodings carry an IPv4
  // address inside a prefix that looks like ordinary global unicast.
  it('flags IPv4 embedded in 6to4 / NAT64 / Teredo encodings', () => {
    for (const ip of [
      '2002:7f00:0001::', // 6to4 → 127.0.0.1
      '2002:a9fe:a9fe::', // 6to4 → 169.254.169.254
      '2002:a00:1::', // 6to4 → 10.0.0.1
      '64:ff9b::7f00:1', // NAT64 → 127.0.0.1
      '64:ff9b::a9fe:a9fe', // NAT64 → 169.254.169.254
      '64:ff9b::169.254.169.254', // NAT64, dotted tail
      '64:ff9b:1::a9fe:a9fe', // NAT64 local-use prefix
      '2001:0:53aa:64c:0:7f9a:a9fe:a9fe', // Teredo
      '2001::1', // Teredo prefix
    ]) {
      expect(isPrivateOrReservedIp(ip)).toBe(true);
    }
    // A 6to4 address wrapping public IPv4 space is still routable.
    expect(isPrivateOrReservedIp('2002:808:808::')).toBe(false);
  });

  it('fails closed on anything it cannot parse', () => {
    for (const ip of ['', 'not-an-ip', '1.2.3', '1.2.3.4.5', '256.1.1.1', 'gg::1', '::1::2']) {
      expect(isPrivateOrReservedIp(ip)).toBe(true);
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

  it('rejects the IPv6 spellings of an internal IPv4 target', async () => {
    // Each of these was accepted before GHSA-m4cp-pqxq-x9f7 /
    // GHSA-q4p6-pj4g-26xx; go through isDeliverableUrl so the URL
    // parser's own normalization is part of the assertion.
    for (const url of [
      'https://[::ffff:127.0.0.1]/hook',
      'https://[::ffff:169.254.169.254]/latest/meta-data',
      'https://[::ffff:10.0.0.1]/hook',
      'http://[2002:a9fe:a9fe::]:80/latest/meta-data/',
      'http://[2002:7f00:0001::]:8080/admin',
      'http://[64:ff9b::a9fe:a9fe]/latest/meta-data/',
      'http://[64:ff9b::ac10:fe01]/',
    ]) {
      expect(await isDeliverableUrl(url)).toBe(false);
    }
  });

  it('allows a literal public IP', async () => {
    expect(await isDeliverableUrl('https://8.8.8.8/hook')).toBe(true);
    expect(await isDeliverableUrl('https://[2606:4700:4700::1111]/hook')).toBe(true);
  });
});
