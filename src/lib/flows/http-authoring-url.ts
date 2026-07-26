function parseIpv4(input: string): number[] | null {
  const parts = input.split(".");
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^\d{1,3}$/.test(part))
  ) {
    return null;
  }
  const octets = parts.map(Number);
  return octets.some((part) => part < 0 || part > 255) ? null : octets;
}

function parseIpv6Bytes(input: string): Uint8Array | null {
  let value = input.toLowerCase().replace(/^\[|\]$/g, "");
  if (!value.includes(":") || value.includes("%")) return null;
  const ipv4Match = value.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match) {
    const octets = parseIpv4(ipv4Match[1]);
    if (!octets) return null;
    value = `${value.slice(0, -ipv4Match[1].length)}${(
      (octets[0] << 8) |
      octets[1]
    ).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if (
    [...left, ...right].some(
      (word) => !/^[0-9a-f]{1,4}$/.test(word),
    )
  ) {
    return null;
  }
  const missing = 8 - left.length - right.length;
  if (
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    return null;
  }
  const words = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ].map((word) => Number.parseInt(word, 16));
  if (words.length !== 8) return null;
  return Uint8Array.from(words.flatMap((word) => [word >> 8, word & 0xff]));
}

function matchesIpv6Prefix(
  address: Uint8Array,
  prefix: number[],
  bits: number,
): boolean {
  const whole = Math.floor(bits / 8);
  for (let index = 0; index < whole; index += 1) {
    if (address[index] !== prefix[index]) return false;
  }
  const remaining = bits % 8;
  if (remaining === 0) return true;
  const mask = (0xff << (8 - remaining)) & 0xff;
  return (address[whole] & mask) === ((prefix[whole] ?? 0) & mask);
}

function isPrivateOrReservedIp(ip: string): boolean {
  const raw = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const octets = parseIpv4(raw);
  if (octets) {
    const [a, b, c] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 198 && b >= 18 && b <= 19) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  const bytes = parseIpv6Bytes(raw);
  if (!bytes) return false;
  if (
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  ) {
    return isPrivateOrReservedIp(
      `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`,
    );
  }
  if ((bytes[0] & 0xe0) !== 0x20) return true;
  if (matchesIpv6Prefix(bytes, [0x20, 0x01], 23)) return true;
  if (matchesIpv6Prefix(bytes, [0x20, 0x01, 0x0d, 0xb8], 32)) return true;
  if (matchesIpv6Prefix(bytes, [0x20, 0x02], 16)) return true;
  if (matchesIpv6Prefix(bytes, [0x3f, 0xff], 20)) return true;
  return false;
}

export function assertAuthorableHttpUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("HTTP request URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("HTTP request URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("HTTP request URL cannot contain credentials");
  }
  if (url.hash) throw new Error("HTTP request URL cannot contain a fragment");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    isPrivateOrReservedIp(host)
  ) {
    throw new Error("HTTP request host is not publicly routable");
  }
  return url.toString();
}
